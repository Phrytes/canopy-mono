import { describe, it, expect, vi } from 'vitest';
import { Emitter } from '@onderling/core';
import { InMemoryBridge } from '@onderling/chat-agent';
import {
  Notifier,
  InMemoryScheduleStore,
} from '../src/index.js';

// Helper: build a Notifier with controllable time.
function buildNotifier({ channels, ...rest } = {}) {
  let now = 1_700_000_000_000;
  const timers = [];
  const setTimeoutFn = (fn, delay) => {
    const id = timers.length;
    timers.push({ fn, fireAt: now + delay, cancelled: false });
    return id;
  };
  const clearTimeoutFn = (id) => {
    if (timers[id]) timers[id].cancelled = true;
  };
  const advance = async (ms) => {
    now += ms;
    // Fire all timers that have matured
    let fired;
    do {
      fired = false;
      for (const t of timers) {
        if (!t.cancelled && t.fireAt <= now) {
          t.cancelled = true;
          fired = true;
          await t.fn();
        }
      }
    } while (fired);
  };
  const channel = new InMemoryBridge({ id: 'chat' });
  const notifier = new Notifier({
    channels: channels ?? { chat: channel },
    store:    new InMemoryScheduleStore(),
    now:           () => now,
    setTimeoutFn,
    clearTimeoutFn,
    ...rest,
  });
  return { notifier, channel, advance, getNow: () => now };
}

describe('Notifier — scheduleOnce', () => {
  it('fires after the trigger time', async () => {
    const { notifier, channel, advance, getNow } = buildNotifier();
    await notifier.start();
    await notifier.scheduleOnce({
      triggerAt: getNow() + 1000,
      recipient: 'chat-A',
      channel:   'chat',
      builder:   async () => ({ text: 'hi!' }),
    });
    expect(channel.outbox).toHaveLength(0);
    await advance(1000);
    expect(channel.outbox).toEqual([{ chatId: 'chat-A', text: 'hi!' }]);
  });

  it('removes the job after firing', async () => {
    const { notifier, advance, getNow } = buildNotifier();
    await notifier.start();
    await notifier.scheduleOnce({
      triggerAt: getNow() + 100,
      recipient: 'chat-A',
      channel:   'chat',
      builder:   async () => ({ text: 'hi' }),
    });
    expect(await notifier.listJobs()).toHaveLength(1);
    await advance(100);
    expect(await notifier.listJobs()).toHaveLength(0);
  });

  it('cancel(cancelKey) removes the job before it fires', async () => {
    const { notifier, channel, advance, getNow } = buildNotifier();
    await notifier.start();
    await notifier.scheduleOnce({
      triggerAt: getNow() + 1000,
      recipient: 'chat-A',
      channel:   'chat',
      builder:   async () => ({ text: 'hi' }),
      cancelKey: 'nudge-item-X',
    });
    await notifier.cancel('nudge-item-X');
    await advance(1000);
    expect(channel.outbox).toHaveLength(0);
  });

  it('emits fired event on success', async () => {
    const { notifier, advance, getNow } = buildNotifier();
    const events = [];
    // Self-event subscription is plain Emitter.on(name, handler).
    notifier.on('fired', (e) => events.push(e));
    await notifier.start();
    await notifier.scheduleOnce({
      triggerAt: getNow() + 50,
      recipient: 'chat-A',
      channel:   'chat',
      builder:   async () => ({ text: 'hi' }),
    });
    await advance(50);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'once', recipient: 'chat-A' });
  });
});

describe('Notifier — schedule (recurring)', () => {
  it('fires on cadence (interval)', async () => {
    const { notifier, channel, advance } = buildNotifier();
    await notifier.start();
    await notifier.schedule({
      id:         'digest',
      cadence:    { kind: 'interval', intervalMs: 5000 },
      recipients: ['chat-A', 'chat-B'],
      channel:    'chat',
      builder:    async (recipient) => ({ text: `digest for ${recipient}` }),
    });
    await advance(5000);
    expect(channel.outbox).toHaveLength(2);
    expect(channel.outbox.map((d) => d.chatId).sort()).toEqual(['chat-A', 'chat-B']);
    channel.clearOutbox();
    await advance(5000);
    expect(channel.outbox).toHaveLength(2);
  });

  it('cancel(id) stops a recurring job', async () => {
    const { notifier, channel, advance } = buildNotifier();
    await notifier.start();
    await notifier.schedule({
      id:         'digest',
      cadence:    { kind: 'interval', intervalMs: 1000 },
      recipients: ['chat-A'],
      channel:    'chat',
      builder:    async () => ({ text: 'tick' }),
    });
    await advance(1000);
    expect(channel.outbox).toHaveLength(1);
    await notifier.cancel('digest');
    channel.clearOutbox();
    await advance(5000);
    expect(channel.outbox).toHaveLength(0);
  });
});

describe('Notifier — generic event hook', () => {
  it('subscribe() targets a foreign emitter; off-fn cleans up', async () => {
    const { notifier } = buildNotifier();
    const upstream = new Emitter();
    const handler = vi.fn();
    const off = notifier.subscribe(upstream, 'item-added', handler);

    upstream.emit('item-added', { id: '1' });
    expect(handler).toHaveBeenCalledOnce();

    off();
    upstream.emit('item-added', { id: '2' });
    expect(handler).toHaveBeenCalledOnce();        // not called again
  });

  it('stop() removes all subscribers', async () => {
    const { notifier } = buildNotifier();
    const upstream = new Emitter();
    const handler = vi.fn();
    notifier.subscribe(upstream, 'item-added', handler);
    await notifier.start();

    upstream.emit('item-added', {});
    expect(handler).toHaveBeenCalledOnce();

    await notifier.stop();
    upstream.emit('item-added', {});
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe('Notifier — channel handling', () => {
  it('throws on unknown channel id at schedule time', async () => {
    const { notifier, getNow } = buildNotifier();
    await expect(
      notifier.scheduleOnce({
        triggerAt: getNow() + 1, recipient: 'x', channel: 'doesnotexist',
        builder:   async () => ({ text: 'x' }),
      }),
    ).rejects.toThrow(/unknown channel/);
  });

  it('emits error event when channel.sendReply throws (no retry by default)', async () => {
    const errors = [];
    const failingChannel = {
      id: 'chat',
      sendReply: vi.fn(async () => { throw new Error('upstream-down'); }),
    };
    const { notifier, advance, getNow } = buildNotifier({ channels: { chat: failingChannel } });
    notifier.on('error', (e) => errors.push(e));
    await notifier.start();
    await notifier.scheduleOnce({
      triggerAt: getNow() + 1,
      recipient: 'chat-A',
      channel:   'chat',
      builder:   async () => ({ text: 'x' }),
    });
    await advance(1);
    expect(failingChannel.sendReply).toHaveBeenCalledTimes(1);  // V0: no retries
    expect(errors).toHaveLength(1);
    expect(errors[0].error.message).toBe('upstream-down');
  });
});

describe('Notifier — scheduleBefore (lend / deadline reminders)', () => {
  const HOUR = 60 * 60 * 1000;

  it('fires leadMs before dueAt', async () => {
    const { notifier, channel, advance, getNow } = buildNotifier();
    await notifier.start();
    const dueAt = getNow() + 24 * HOUR;
    await notifier.scheduleBefore({
      dueAt,
      leadMs:    24 * HOUR,        // fire immediately (24h before, dueAt is 24h away)
      recipient: 'chat-A',
      channel:   'chat',
      builder:   async () => ({ text: 'Return the drill tomorrow' }),
    });
    expect(channel.outbox).toHaveLength(0);
    await advance(0);
    expect(channel.outbox).toHaveLength(1);
    expect(channel.outbox[0].text).toBe('Return the drill tomorrow');
  });

  it('fires at exactly dueAt - leadMs', async () => {
    const { notifier, channel, advance, getNow } = buildNotifier();
    await notifier.start();
    const dueAt = getNow() + 48 * HOUR;
    await notifier.scheduleBefore({
      dueAt,
      leadMs:    24 * HOUR,        // fire 24h before → 24h from now
      recipient: 'chat-A',
      channel:   'chat',
      builder:   async () => ({ text: 'Return tomorrow' }),
    });
    await advance(23 * HOUR);
    expect(channel.outbox).toHaveLength(0);
    await advance(HOUR);
    expect(channel.outbox).toHaveLength(1);
  });

  it('cancel(cancelKey) cancels a scheduleBefore reminder', async () => {
    const { notifier, channel, advance, getNow } = buildNotifier();
    await notifier.start();
    const dueAt = getNow() + 48 * HOUR;
    await notifier.scheduleBefore({
      dueAt,
      leadMs:    24 * HOUR,
      recipient: 'chat-A',
      channel:   'chat',
      builder:   async () => ({ text: 'remind' }),
      cancelKey: 'due:item-XYZ',
    });
    await notifier.cancel('due:item-XYZ');
    await advance(48 * HOUR);
    expect(channel.outbox).toHaveLength(0);
  });

  it('past triggerAt fires on next arm pass (matches scheduleOnce semantics)', async () => {
    const { notifier, channel, advance, getNow } = buildNotifier();
    await notifier.start();
    // dueAt is 1h from now, but lead is 24h → triggerAt is 23h in the past.
    const dueAt = getNow() + 1 * HOUR;
    await notifier.scheduleBefore({
      dueAt,
      leadMs:    24 * HOUR,
      recipient: 'chat-A',
      channel:   'chat',
      builder:   async () => ({ text: 'overdue-warning' }),
    });
    await advance(0);
    expect(channel.outbox).toHaveLength(1);
  });

  it('rejects missing dueAt or leadMs', async () => {
    const { notifier } = buildNotifier();
    await notifier.start();
    await expect(notifier.scheduleBefore({ leadMs: 1, recipient: 'r', channel: 'chat', builder: async () => ({ text: 'x' }) }))
      .rejects.toThrow(/dueAt/);
    await expect(notifier.scheduleBefore({ dueAt: 1, recipient: 'r', channel: 'chat', builder: async () => ({ text: 'x' }) }))
      .rejects.toThrow(/leadMs/);
  });
});

// 5.7b — quiet-hours / per-recipient suppression hook.
describe('Notifier — isSuppressed hook', () => {
  it('skips delivery and emits "suppressed" when the predicate is truthy', async () => {
    const { notifier, channel, advance, getNow } = buildNotifier({
      isSuppressed: (recipient) => recipient === 'chat-A',
    });
    const suppressed = vi.fn();
    notifier.on('suppressed', suppressed);
    await notifier.start();
    await notifier.scheduleOnce({
      triggerAt: getNow() + 100, recipient: 'chat-A', channel: 'chat',
      builder:   async () => ({ text: 'hi' }),
    });
    await advance(100);
    expect(channel.outbox).toEqual([]);
    expect(suppressed).toHaveBeenCalledTimes(1);
    expect(suppressed.mock.calls[0][0]).toMatchObject({ recipient: 'chat-A', kind: 'once' });
  });

  it('delivers normally when the predicate is falsy', async () => {
    const { notifier, channel, advance, getNow } = buildNotifier({
      isSuppressed: () => false,
    });
    await notifier.start();
    await notifier.scheduleOnce({
      triggerAt: getNow() + 100, recipient: 'chat-A', channel: 'chat',
      builder:   async () => ({ text: 'hi' }),
    });
    await advance(100);
    expect(channel.outbox).toEqual([{ chatId: 'chat-A', text: 'hi' }]);
  });

  it('skips suppressed recipients individually on a recurring job', async () => {
    const { notifier, channel, advance, getNow } = buildNotifier({
      isSuppressed: (recipient) => recipient === 'chat-B',
    });
    await notifier.start();
    await notifier.schedule({
      id:         'digest-1',
      cadence:    { kind: 'daily', atLocal: '09:00', tz: 'UTC' },
      recipients: ['chat-A', 'chat-B', 'chat-C'],
      channel:    'chat',
      builder:    async (r) => ({ text: `to ${r}` }),
    });
    // Advance to the next 09:00 UTC tick.
    const ms = 24 * 60 * 60 * 1000;
    await advance(ms);
    const chatIds = channel.outbox.map((m) => m.chatId).sort();
    expect(chatIds).toEqual(['chat-A', 'chat-C']);
  });

  it('a throwing predicate is treated as "do not suppress"', async () => {
    const { notifier, channel, advance, getNow } = buildNotifier({
      isSuppressed: () => { throw new Error('boom'); },
    });
    await notifier.start();
    await notifier.scheduleOnce({
      triggerAt: getNow() + 100, recipient: 'chat-A', channel: 'chat',
      builder:   async () => ({ text: 'hi' }),
    });
    await advance(100);
    expect(channel.outbox).toEqual([{ chatId: 'chat-A', text: 'hi' }]);
  });

  it('setSuppressionPredicate swaps the hook at runtime', async () => {
    const { notifier, channel, advance, getNow } = buildNotifier();
    await notifier.start();
    // No predicate yet → delivers.
    await notifier.scheduleOnce({
      triggerAt: getNow() + 100, recipient: 'chat-A', channel: 'chat',
      builder:   async () => ({ text: 'first' }),
    });
    await advance(100);
    expect(channel.outbox).toHaveLength(1);

    // Install a predicate, schedule again → suppressed.
    notifier.setSuppressionPredicate(() => true);
    await notifier.scheduleOnce({
      triggerAt: getNow() + 100, recipient: 'chat-A', channel: 'chat',
      builder:   async () => ({ text: 'second' }),
    });
    await advance(100);
    expect(channel.outbox).toHaveLength(1);   // unchanged

    // Disable the predicate (null) → delivers again.
    notifier.setSuppressionPredicate(null);
    await notifier.scheduleOnce({
      triggerAt: getNow() + 100, recipient: 'chat-A', channel: 'chat',
      builder:   async () => ({ text: 'third' }),
    });
    await advance(100);
    expect(channel.outbox).toHaveLength(2);
  });
});
