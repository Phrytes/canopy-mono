/**
 * Tests for Group A/D integration — receive-message skill.
 *
 * Registers the skill on a test agent (as agent.js does) and drives it via
 * invoke() from a peer agent.  Uses InternalBus so no React Native native
 * modules are needed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { InternalBus, DataPart, TextPart, Parts } from '@canopy/core';
import { MessageStore }                           from '../src/store/messages.js';
import { makeAgent, startAndConnect }             from './helpers.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Register the receive-message skill on `agent` backed by `store`.
 * Mirrors the registration in src/agent.js.
 */
function registerReceiveMessage(agent, store) {
  agent.register('receive-message', async ({ parts, originFrom, from, originVerified }) => {
    const text   = Parts.text(parts) ?? JSON.stringify(Parts.data(parts));
    const sender = originFrom ?? from;
    store.add(sender, {
      direction:      'in',
      text,
      originVerified: !!originVerified,
      relayedBy:      originFrom && originFrom !== from ? from : null,
    });
    return [DataPart({ ack: true })];
  }, { visibility: 'public', description: 'Receive a text message' });
}

// ── Shared setup ──────────────────────────────────────────────────────────────

let bus, sender, receiver, store;

beforeEach(async () => {
  bus      = new InternalBus();
  sender   = await makeAgent(bus, { label: 'sender' });
  receiver = await makeAgent(bus, { label: 'receiver' });
  store    = new MessageStore();

  registerReceiveMessage(receiver, store);

  await startAndConnect(sender, receiver);
});

// ── Skill response ────────────────────────────────────────────────────────────

describe('receive-message skill response', () => {
  it('returns ack:true for a text message', async () => {
    const result = await sender.invoke(receiver.address, 'receive-message', [
      TextPart('hello'),
    ]);
    expect(Parts.data(result)?.ack).toBe(true);
  });

  it('returns ack:true for a data message', async () => {
    const result = await sender.invoke(receiver.address, 'receive-message', [
      DataPart({ value: 42 }),
    ]);
    expect(Parts.data(result)?.ack).toBe(true);
  });
});

// ── MessageStore side-effects ─────────────────────────────────────────────────

describe('receive-message → MessageStore', () => {
  it('stores the message as direction "in"', async () => {
    await sender.invoke(receiver.address, 'receive-message', [TextPart('hi')]);
    const msgs = store.get(sender.pubKey);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].direction).toBe('in');
  });

  it('stores the correct text from a TextPart', async () => {
    await sender.invoke(receiver.address, 'receive-message', [TextPart('ping')]);
    expect(store.get(sender.pubKey)[0].text).toBe('ping');
  });

  it('JSON-stringifies a DataPart when no TextPart is present', async () => {
    await sender.invoke(receiver.address, 'receive-message', [DataPart({ x: 1 })]);
    const text = store.get(sender.pubKey)[0].text;
    expect(text).toContain('x');
    expect(text).toContain('1');
  });

  it('stores the message under the sender pubKey', async () => {
    await sender.invoke(receiver.address, 'receive-message', [TextPart('test')]);
    // Messages are keyed by sender.pubKey (the `from` field)
    expect(store.get(sender.pubKey)).toHaveLength(1);
    // No messages for any other key
    expect(store.get(receiver.pubKey)).toHaveLength(0);
  });

  it('accumulates multiple messages from the same sender in order', async () => {
    await sender.invoke(receiver.address, 'receive-message', [TextPart('first')]);
    await sender.invoke(receiver.address, 'receive-message', [TextPart('second')]);
    await sender.invoke(receiver.address, 'receive-message', [TextPart('third')]);
    const texts = store.get(sender.pubKey).map(m => m.text);
    expect(texts).toEqual(['first', 'second', 'third']);
  });

  it('emits a "message" event on the store', async () => {
    let received = null;
    store.on('message', evt => { received = evt; });
    await sender.invoke(receiver.address, 'receive-message', [TextPart('event-test')]);
    expect(received).not.toBeNull();
    expect(received.peerPubKey).toBe(sender.pubKey);
    expect(received.message.text).toBe('event-test');
  });

  it('records originVerified=false and relayedBy=null for direct messages', async () => {
    await sender.invoke(receiver.address, 'receive-message', [TextPart('direct')]);
    const entry = store.get(sender.pubKey)[0];
    expect(entry.originVerified).toBe(false);
    expect(entry.relayedBy).toBeNull();
  });
});

// ── Forwarded path — originVerified + relayedBy ──────────────────────────────

describe('receive-message with originFrom / originVerified', () => {
  it('attributes to originFrom and marks verified when ctx.originVerified is true', async () => {
    // Simulate a forwarded invocation by calling the registered handler
    // directly with a ctx that includes originFrom + originVerified.
    const def    = receiver.skills.get('receive-message');
    const bridge = 'bridge-pubkey-xyz';
    const origin = 'origin-pubkey-abc';

    await def.handler({
      parts:          [TextPart('via bridge')],
      from:           bridge,
      originFrom:     origin,
      originVerified: true,
    });

    const msgs = store.get(origin);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toBe('via bridge');
    expect(msgs[0].originVerified).toBe(true);
    expect(msgs[0].relayedBy).toBe(bridge);
  });

  it('leaves relayedBy=null when originFrom === from', async () => {
    const def    = receiver.skills.get('receive-message');
    const caller = 'direct-pubkey';

    await def.handler({
      parts:          [TextPart('direct signed')],
      from:           caller,
      originFrom:     caller,
      originVerified: true,
    });

    const msgs = store.get(caller);
    expect(msgs[0].relayedBy).toBeNull();
    expect(msgs[0].originVerified).toBe(true);
  });
});
