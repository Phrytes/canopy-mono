/**
 * MockBridge.test.js — unit tests for the in-memory test seam.
 *
 * Covers:
 *   - lifecycle (start/stop) is a benign no-op
 *   - sendReply records FIFO; pop / peek / size / clear work
 *   - onMessage registers + replaces; emit dispatches; emit-without-
 *     -handler throws; handler errors propagate
 *   - bridgeId is the literal 'mock'
 *   - structural conformance to the MessagingBridge surface
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockBridge } from '../../src/bridges/MockBridge.js';

/**
 * Build a minimal IncomingMessage for tests.
 * @param {Partial<import('../../src/types.js').IncomingMessage>} [over]
 * @returns {import('../../src/types.js').IncomingMessage}
 */
function makeMsg(over = {}) {
  return {
    bridgeId:    'mock',
    chatId:      'chat-1',
    messageId:   'm-1',
    sender: {
      displayName: 'alice',
      bridgeUid:   'mock:alice',
      webid:       null,
    },
    text:        'hello',
    replyTo:     null,
    isAddressed: true,
    ...over,
  };
}

describe('MockBridge', () => {
  /** @type {MockBridge} */
  let bridge;

  beforeEach(() => {
    bridge = new MockBridge();
  });

  // ---------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------

  it('start() resolves (no-op)', async () => {
    await expect(bridge.start()).resolves.toBeUndefined();
  });

  it('stop() resolves (no-op)', async () => {
    await expect(bridge.stop()).resolves.toBeUndefined();
  });

  it('start() is idempotent (call twice without throwing)', async () => {
    await bridge.start();
    await expect(bridge.start()).resolves.toBeUndefined();
  });

  // ---------------------------------------------------------------
  // sendReply / pop / peek / size / clear
  // ---------------------------------------------------------------

  it('sendReply records the args; pop retrieves them in FIFO order', async () => {
    await bridge.sendReply({ chatId: 'c1', text: 'first' });
    await bridge.sendReply({ chatId: 'c1', text: 'second' });
    await bridge.sendReply({ chatId: 'c2', text: 'third' });

    expect(bridge.pop()).toEqual({ chatId: 'c1', text: 'first' });
    expect(bridge.pop()).toEqual({ chatId: 'c1', text: 'second' });
    expect(bridge.pop()).toEqual({ chatId: 'c2', text: 'third' });
    expect(bridge.pop()).toBeNull();
  });

  it('pop returns null when nothing has been recorded', () => {
    expect(bridge.pop()).toBeNull();
  });

  it('peek returns the next args without removing it; size is unchanged', async () => {
    await bridge.sendReply({ chatId: 'c1', text: 'a' });
    await bridge.sendReply({ chatId: 'c1', text: 'b' });

    expect(bridge.size()).toBe(2);
    expect(bridge.peek()).toEqual({ chatId: 'c1', text: 'a' });
    expect(bridge.size()).toBe(2);
    // peek again — still the same item
    expect(bridge.peek()).toEqual({ chatId: 'c1', text: 'a' });
    expect(bridge.size()).toBe(2);
  });

  it('peek returns null when empty', () => {
    expect(bridge.peek()).toBeNull();
  });

  it('size reflects the number of recorded replies', async () => {
    expect(bridge.size()).toBe(0);
    await bridge.sendReply({ chatId: 'c1', text: 'a' });
    expect(bridge.size()).toBe(1);
    await bridge.sendReply({ chatId: 'c1', text: 'b' });
    expect(bridge.size()).toBe(2);
    bridge.pop();
    expect(bridge.size()).toBe(1);
  });

  it('clear empties the recorded queue', async () => {
    await bridge.sendReply({ chatId: 'c1', text: 'a' });
    await bridge.sendReply({ chatId: 'c1', text: 'b' });
    expect(bridge.size()).toBe(2);

    bridge.clear();

    expect(bridge.size()).toBe(0);
    expect(bridge.pop()).toBeNull();
    expect(bridge.peek()).toBeNull();
  });

  it('sendReply preserves rich args — buttons + replyTo', async () => {
    /** @type {import('../../src/bridges/MessagingBridge.js').SendReplyArgs} */
    const args = {
      chatId:  'c1',
      replyTo: 'm-42',
      text:    'pick one',
      buttons: [
        { id: 'yes', label: 'Yes' },
        { id: 'no',  label: 'No'  },
      ],
    };

    await bridge.sendReply(args);

    const popped = bridge.pop();
    expect(popped).toEqual(args);
    // and it should be the same reference object we put in (no clone)
    expect(popped).toBe(args);
  });

  // ---------------------------------------------------------------
  // onMessage / emit
  // ---------------------------------------------------------------

  it('onMessage registers a handler; emit invokes it with the message', async () => {
    const seen = [];
    bridge.onMessage(async (msg) => {
      seen.push(msg);
      return { replies: [], stateUpdates: [] };
    });

    const msg = makeMsg({ text: 'first' });
    const reply = await bridge.emit(msg);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(msg);
    expect(reply).toEqual({ replies: [], stateUpdates: [] });
  });

  it('emit returns whatever the handler returns', async () => {
    /** @type {import('../../src/types.js').Reply} */
    const out = {
      replies: [{ text: 'pong' }],
      stateUpdates: [],
    };
    bridge.onMessage(async () => out);

    const reply = await bridge.emit(makeMsg());
    expect(reply).toBe(out);
  });

  it('emit awaits async handlers', async () => {
    bridge.onMessage(async (_msg) => {
      await new Promise((r) => setTimeout(r, 5));
      return { replies: [{ text: 'done' }], stateUpdates: [] };
    });

    const reply = await bridge.emit(makeMsg());
    expect(reply.replies[0].text).toBe('done');
  });

  it('onMessage called twice REPLACES the handler', async () => {
    const seenA = [];
    const seenB = [];

    bridge.onMessage(async (msg) => {
      seenA.push(msg);
      return { replies: [{ text: 'A' }], stateUpdates: [] };
    });

    bridge.onMessage(async (msg) => {
      seenB.push(msg);
      return { replies: [{ text: 'B' }], stateUpdates: [] };
    });

    const reply = await bridge.emit(makeMsg());

    expect(seenA).toHaveLength(0);
    expect(seenB).toHaveLength(1);
    expect(reply.replies[0].text).toBe('B');
  });

  it('emit without a registered handler throws a clear error', async () => {
    await expect(bridge.emit(makeMsg())).rejects.toThrow(
      /no handler registered/i,
    );
  });

  it('emit propagates handler errors (async rejection)', async () => {
    bridge.onMessage(async () => {
      throw new Error('boom');
    });

    await expect(bridge.emit(makeMsg())).rejects.toThrow('boom');
  });

  it('emit propagates handler errors (sync throw)', async () => {
    bridge.onMessage(/** @type {any} */ (() => {
      throw new Error('sync-boom');
    }));

    await expect(bridge.emit(makeMsg())).rejects.toThrow('sync-boom');
  });

  it('handler can call sendReply on the bridge; emit + pop interleave correctly', async () => {
    bridge.onMessage(async (msg) => {
      await bridge.sendReply({
        chatId:  msg.chatId,
        replyTo: msg.messageId,
        text:    `echo: ${msg.text}`,
      });
      return { replies: [], stateUpdates: [] };
    });

    await bridge.emit(makeMsg({ chatId: 'c9', messageId: 'm-9', text: 'hi' }));

    expect(bridge.size()).toBe(1);
    expect(bridge.pop()).toEqual({
      chatId:  'c9',
      replyTo: 'm-9',
      text:    'echo: hi',
    });
  });

  // ---------------------------------------------------------------
  // bridgeId + structural conformance
  // ---------------------------------------------------------------

  it("bridgeId is the literal string 'mock'", () => {
    expect(bridge.bridgeId).toBe('mock');
  });

  it('implements the MessagingBridge surface (structural conformance)', () => {
    // Required methods + getter on the contract.
    expect(typeof bridge.start).toBe('function');
    expect(typeof bridge.stop).toBe('function');
    expect(typeof bridge.sendReply).toBe('function');
    expect(typeof bridge.onMessage).toBe('function');
    expect(typeof bridge.bridgeId).toBe('string');
  });
});
