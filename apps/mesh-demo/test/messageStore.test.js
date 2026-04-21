/**
 * Tests for Group D — MessageStore.
 *
 * MessageStore is a pure-JS in-memory log (no React Native deps) so it
 * runs without any mocking.  Tests cover the add/get/clear API and the
 * event emitter surface used by MessageScreen.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MessageStore }                      from '../src/store/messages.js';

// Use a fresh instance per test so state doesn't leak between tests.
let store;
beforeEach(() => { store = new MessageStore(); });

const PEER_A = 'pubkey-aaa';
const PEER_B = 'pubkey-bbb';

// ── add() ─────────────────────────────────────────────────────────────────────

describe('MessageStore.add()', () => {
  it('stores a message and returns an entry with id + ts', () => {
    const entry = store.add(PEER_A, { direction: 'out', text: 'hello' });
    expect(typeof entry.id).toBe('string');
    expect(entry.id.length).toBeGreaterThan(0);
    expect(typeof entry.ts).toBe('number');
    expect(entry.ts).toBeGreaterThan(0);
  });

  it('stores direction and text verbatim', () => {
    store.add(PEER_A, { direction: 'in',  text: 'from peer' });
    store.add(PEER_A, { direction: 'out', text: 'my reply' });
    const msgs = store.get(PEER_A);
    expect(msgs[0].direction).toBe('in');
    expect(msgs[0].text).toBe('from peer');
    expect(msgs[1].direction).toBe('out');
    expect(msgs[1].text).toBe('my reply');
  });

  it('defaults hops to 0, via to null, status to "ok"', () => {
    const entry = store.add(PEER_A, { direction: 'out', text: 'hi' });
    expect(entry.hops).toBe(0);
    expect(entry.via).toBeNull();
    expect(entry.status).toBe('ok');
  });

  it('stores explicit hops, via, and status', () => {
    const entry = store.add(PEER_A, {
      direction: 'out', text: 'relayed',
      hops: 1, via: PEER_B, status: 'sending',
    });
    expect(entry.hops).toBe(1);
    expect(entry.via).toBe(PEER_B);
    expect(entry.status).toBe('sending');
  });

  it('keeps messages for different peers separate', () => {
    store.add(PEER_A, { direction: 'out', text: 'to A' });
    store.add(PEER_B, { direction: 'out', text: 'to B' });
    expect(store.get(PEER_A)).toHaveLength(1);
    expect(store.get(PEER_B)).toHaveLength(1);
    expect(store.get(PEER_A)[0].text).toBe('to A');
    expect(store.get(PEER_B)[0].text).toBe('to B');
  });

  it('emits a "message" event with peerPubKey and the entry', () => {
    let received = null;
    store.on('message', evt => { received = evt; });
    const entry = store.add(PEER_A, { direction: 'in', text: 'ping' });
    expect(received).not.toBeNull();
    expect(received.peerPubKey).toBe(PEER_A);
    expect(received.message).toBe(entry);
  });

  it('accumulates multiple messages in order', () => {
    store.add(PEER_A, { direction: 'out', text: 'first' });
    store.add(PEER_A, { direction: 'in',  text: 'second' });
    store.add(PEER_A, { direction: 'out', text: 'third' });
    const msgs = store.get(PEER_A);
    expect(msgs).toHaveLength(3);
    expect(msgs.map(m => m.text)).toEqual(['first', 'second', 'third']);
  });
});

// ── get() ─────────────────────────────────────────────────────────────────────

describe('MessageStore.get()', () => {
  it('returns an empty array for an unknown peer', () => {
    expect(store.get('unknown-peer')).toEqual([]);
  });

  it('returns messages in insertion order', () => {
    for (let i = 0; i < 5; i++) {
      store.add(PEER_A, { direction: 'out', text: `msg${i}` });
    }
    const texts = store.get(PEER_A).map(m => m.text);
    expect(texts).toEqual(['msg0', 'msg1', 'msg2', 'msg3', 'msg4']);
  });
});

// ── clear() ───────────────────────────────────────────────────────────────────

describe('MessageStore.clear()', () => {
  it('removes all messages for a peer', () => {
    store.add(PEER_A, { direction: 'out', text: 'bye' });
    store.clear(PEER_A);
    expect(store.get(PEER_A)).toEqual([]);
  });

  it('does not affect messages for other peers', () => {
    store.add(PEER_A, { direction: 'out', text: 'for A' });
    store.add(PEER_B, { direction: 'out', text: 'for B' });
    store.clear(PEER_A);
    expect(store.get(PEER_B)).toHaveLength(1);
  });

  it('emits a "cleared" event with peerPubKey', () => {
    let received = null;
    store.on('cleared', evt => { received = evt; });
    store.clear(PEER_A);
    expect(received).not.toBeNull();
    expect(received.peerPubKey).toBe(PEER_A);
  });

  it('is safe to call on a peer with no messages', () => {
    expect(() => store.clear('nonexistent')).not.toThrow();
    expect(store.get('nonexistent')).toEqual([]);
  });
});
