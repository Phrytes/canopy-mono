/**
 * HubDelegateTransport — unit tests (Phase 50.11).
 *
 * Verifies the wire-I/O delegation: a duck-typed binder lets the
 * Transport's `_put` round-trip through whatever the Hub provides
 * (AIDL on Android in production; a fake JS object in tests).
 *
 * Covers:
 *   - constructor validation (`binder` must have `send` + `onIncoming`)
 *   - `connect()` wires the inbound callback
 *   - `_put(to, envelope)` calls `binder.send(to, envelope)`
 *   - inbound envelopes from the binder reach `_receive` and surface
 *     via the 'envelope' event (no SecurityLayer in these tests)
 *   - `disconnect()` unsubscribes + calls `binder.close()` when present
 *   - high-level `sendOneWay` / `publishOneWay` round-trip cleanly
 *     through the binder
 *   - the Phase 50.7 `publishEnvelope` + `subscribeEnvelopes` work
 *     unchanged on top of HubDelegateTransport (same Transport base)
 *
 * Strict layering: tests use a fake binder; no Hub package imported.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { HubDelegateTransport } from '../../src/transport/HubDelegateTransport.js';

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Create a pair of fake binders representing two bundles bound to the
 * same Hub. The Hub itself is the shared bus that routes `to` →
 * `binder[to]`.
 */
function makeFakeHubBus() {
  /** @type {Map<string, { recv: (env: object) => void }>} */
  const registry = new Map();

  function makeBinder(address) {
    return {
      async send(to, envelope) {
        // The Hub routes by address.
        const entry = registry.get(to);
        if (entry?.recv) {
          // Microtask delay mirrors InternalTransport.
          await Promise.resolve();
          entry.recv(envelope);
        }
      },
      onIncoming(callback) {
        registry.set(address, { recv: callback });
        return () => { registry.delete(address); };
      },
      async close() { registry.delete(address); },
      // ── test seam ──
      _address: address,
    };
  }

  return { makeBinder, registry };
}

/* ────────────────────────────────────────────────────────────────────────── */

describe('HubDelegateTransport — construction', () => {
  it('throws INVALID_ARGUMENT when binder is missing', () => {
    expect(() => new HubDelegateTransport({ address: 'a' }))
      .toThrow(/binder/i);
  });

  it('throws when binder lacks .send', () => {
    expect(() => new HubDelegateTransport({ address: 'a', binder: { onIncoming: () => () => {} } }))
      .toThrow(/binder/i);
  });

  it('throws when binder lacks .onIncoming', () => {
    expect(() => new HubDelegateTransport({ address: 'a', binder: { send: async () => {} } }))
      .toThrow(/binder/i);
  });

  it('exposes the supplied address + binder', () => {
    const binder = { send: async () => {}, onIncoming: () => () => {} };
    const t = new HubDelegateTransport({ address: 'alice', binder });
    expect(t.address).toBe('alice');
    expect(t.binder).toBe(binder);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('HubDelegateTransport — round-trip via fake Hub bus', () => {
  let bus, alice, bob;

  beforeEach(async () => {
    bus = makeFakeHubBus();
    alice = new HubDelegateTransport({ address: 'alice-pub', binder: bus.makeBinder('alice-pub') });
    bob   = new HubDelegateTransport({ address: 'bob-pub',   binder: bus.makeBinder('bob-pub') });
    await alice.connect();
    await bob.connect();
  });

  it('sendOneWay delivers via the binder', async () => {
    const received = [];
    bob.on('envelope', (env) => received.push(env));

    await alice.sendOneWay('bob-pub', { hello: 'from alice' });
    await new Promise(r => setTimeout(r, 0));
    // Microtask in fake bus + microtask in Transport
    await new Promise(r => setTimeout(r, 0));

    expect(received).toHaveLength(1);
    expect(received[0].payload).toEqual({ hello: 'from alice' });
    expect(received[0]._from).toBe('alice-pub');
    expect(received[0]._to).toBe('bob-pub');
  });

  it('publishOneWay carries the topic hint through', async () => {
    const received = [];
    bob.on('envelope', (env) => received.push(env));

    await alice.publishOneWay('bob-pub', 'envelope:task', { ref: 'x' });
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    expect(received[0]._topic).toBe('envelope:task');
    expect(received[0].payload).toEqual({ ref: 'x' });
  });

  it('disconnect unsubscribes from the binder', async () => {
    await alice.disconnect();

    // After alice.disconnect(), the fake bus drops alice's recv entry;
    // anything addressed to alice is now dropped. Alice can still call
    // send() (it goes through her binder regardless of her own
    // subscription); bob, still connected, can still receive.

    // alice → bob still works (outbound is just `binder.send`).
    const bobReceived = [];
    bob.on('envelope', (env) => bobReceived.push(env));
    await alice.sendOneWay('bob-pub', { still: 'works' });
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(bobReceived).toHaveLength(1);

    // bob → alice no longer reaches alice's _receive (alice unsubscribed).
    const aliceReceived = [];
    alice.on('envelope', (env) => aliceReceived.push(env));
    await bob.sendOneWay('alice-pub', { will: 'be dropped' });
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(aliceReceived).toHaveLength(0);
  });

  it('disconnect calls binder.close when present', async () => {
    let closed = false;
    const binder = {
      send:       async () => {},
      onIncoming: () => () => {},
      close:      async () => { closed = true; },
    };
    const t = new HubDelegateTransport({ address: 'x', binder });
    await t.connect();
    await t.disconnect();
    expect(closed).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('HubDelegateTransport — Phase 50.7 envelope API', () => {
  let bus, alice, bob;
  beforeEach(async () => {
    bus = makeFakeHubBus();
    alice = new HubDelegateTransport({ address: 'alice-pub', binder: bus.makeBinder('alice-pub') });
    bob   = new HubDelegateTransport({ address: 'bob-pub',   binder: bus.makeBinder('bob-pub') });
    await alice.connect();
    await bob.connect();
  });

  it('publishEnvelope + subscribeEnvelopes round-trip via the binder', async () => {
    const received = [];
    bob.subscribeEnvelopes((payload, raw) => received.push({ payload, topic: raw._topic }));

    await alice.publishEnvelope({
      kind:       'task',
      ref:        'https://anne.pod/tasks/abc.ttl',
      etag:       '"xyz"',
      fromActor:  'https://anne.pod/profile#me/agent/laptop',
      recipients: ['bob-pub'],
    });
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    expect(received).toHaveLength(1);
    expect(received[0].topic).toBe('envelope:task');
    expect(received[0].payload).toMatchObject({
      v: 1, kind: 'task', ref: 'https://anne.pod/tasks/abc.ttl',
    });
  });
});
