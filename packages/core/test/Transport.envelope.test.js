/**
 * Transport — publishEnvelope + subscribeEnvelopes (Phase 50.7).
 *
 * Standardisation Phase 50.7 — verifies the notification-envelope
 * surface that core ships for the `@canopy/notify-envelope`
 * substrate to call.
 *
 * Covers:
 *   - publishEnvelope produces one OW per recipient with the
 *     standardisation wire shape `{v, kind, ref, etag, fromActor,
 *     timestamp, payload?}`
 *   - topic is `envelope:<kind>`
 *   - subscribeEnvelopes fires on inbound envelopes whose _topic
 *     starts with `envelope:`
 *   - subscribeEnvelopes returns an unsubscribe function
 *   - subscribers fire alongside the Agent's receive handler (don't
 *     suppress)
 *   - timestamp defaults to now() but accepts an explicit value
 *   - input validation (INVALID_ARGUMENT)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';

/* ────────────────────────────────────────────────────────────────────────── */

describe('Transport.publishEnvelope — wire shape', () => {
  let bus, alice, bob;

  beforeEach(async () => {
    bus   = new InternalBus();
    alice = new InternalTransport(bus, 'alice-pub');
    bob   = new InternalTransport(bus, 'bob-pub');
    await alice.connect();
    await bob.connect();
  });

  it('publishes one envelope per recipient with the v1 wire shape', async () => {
    const received = [];
    bob.subscribeEnvelopes((payload, raw) => received.push({ payload, topic: raw._topic, from: raw._from }));

    await alice.publishEnvelope({
      kind:       'task',
      ref:        'https://alice.pod/tasks/abc.ttl',
      etag:       '"abc123"',
      fromActor:  'https://alice.pod/profile#me/agent/laptop',
      recipients: ['bob-pub'],
    });
    // Yield so the bus delivers.
    await new Promise(r => setTimeout(r, 0));

    expect(received).toHaveLength(1);
    expect(received[0].topic).toBe('envelope:task');
    expect(received[0].from).toBe('alice-pub');
    expect(received[0].payload).toMatchObject({
      v: 1,
      kind: 'task',
      ref: 'https://alice.pod/tasks/abc.ttl',
      etag: '"abc123"',
      fromActor: 'https://alice.pod/profile#me/agent/laptop',
    });
    expect(typeof received[0].payload.timestamp).toBe('string');  // default: now()
  });

  it('uses the explicit timestamp when provided', async () => {
    const fixed = '2026-05-11T10:00:00Z';
    const received = [];
    bob.subscribeEnvelopes((payload) => received.push(payload));

    await alice.publishEnvelope({
      kind:       'task',
      recipients: ['bob-pub'],
      timestamp:  fixed,
    });
    await new Promise(r => setTimeout(r, 0));

    expect(received[0].timestamp).toBe(fixed);
  });

  it('includes the payload field when supplied (pseudo-pod-replicated mode)', async () => {
    const received = [];
    bob.subscribeEnvelopes((payload) => received.push(payload));

    await alice.publishEnvelope({
      kind:       'task',
      recipients: ['bob-pub'],
      payload:    { text: 'paint the fence', status: 'open' },
    });
    await new Promise(r => setTimeout(r, 0));

    expect(received[0].payload).toEqual({ text: 'paint the fence', status: 'open' });
  });

  it('omits payload field when not supplied (pod-primary mode)', async () => {
    const received = [];
    bob.subscribeEnvelopes((payload) => received.push(payload));

    await alice.publishEnvelope({
      kind:       'task',
      ref:        'https://alice.pod/tasks/abc.ttl',
      recipients: ['bob-pub'],
    });
    await new Promise(r => setTimeout(r, 0));

    expect(received[0]).not.toHaveProperty('payload');
  });

  it('fan-outs to multiple recipients (one envelope each)', async () => {
    const carol = new InternalTransport(bus, 'carol-pub');
    await carol.connect();
    const bobSeen = [], carolSeen = [];
    bob.subscribeEnvelopes((p) => bobSeen.push(p));
    carol.subscribeEnvelopes((p) => carolSeen.push(p));

    await alice.publishEnvelope({
      kind: 'task',
      ref:  'https://alice.pod/tasks/x',
      recipients: ['bob-pub', 'carol-pub'],
    });
    await new Promise(r => setTimeout(r, 0));

    expect(bobSeen).toHaveLength(1);
    expect(carolSeen).toHaveLength(1);
    expect(bobSeen[0].ref).toBe('https://alice.pod/tasks/x');
    expect(carolSeen[0].ref).toBe('https://alice.pod/tasks/x');
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('Transport.publishEnvelope — validation', () => {
  let alice, bus;
  beforeEach(async () => {
    bus = new InternalBus();
    alice = new InternalTransport(bus, 'alice-pub');
    await alice.connect();
  });

  it('throws INVALID_ARGUMENT when kind is missing', async () => {
    await expect(alice.publishEnvelope({ recipients: ['x'] }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('throws INVALID_ARGUMENT when recipients is missing/empty', async () => {
    await expect(alice.publishEnvelope({ kind: 'task' }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(alice.publishEnvelope({ kind: 'task', recipients: [] }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('Transport.subscribeEnvelopes — registration', () => {
  let bus, alice, bob;
  beforeEach(async () => {
    bus   = new InternalBus();
    alice = new InternalTransport(bus, 'alice-pub');
    bob   = new InternalTransport(bus, 'bob-pub');
    await alice.connect();
    await bob.connect();
  });

  it('returns an unsubscribe function', async () => {
    const received = [];
    const unsub = bob.subscribeEnvelopes((p) => received.push(p));

    await alice.publishEnvelope({ kind: 'task', recipients: ['bob-pub'] });
    await new Promise(r => setTimeout(r, 0));
    expect(received).toHaveLength(1);

    unsub();
    await alice.publishEnvelope({ kind: 'task', recipients: ['bob-pub'] });
    await new Promise(r => setTimeout(r, 0));
    expect(received).toHaveLength(1);   // no new entry
  });

  it('throws INVALID_ARGUMENT when callback is not a function', () => {
    expect(() => bob.subscribeEnvelopes(null))
      .toThrow(/callback/i);
  });

  it('multiple subscribers all fire', async () => {
    const a = [], b = [];
    bob.subscribeEnvelopes((p) => a.push(p.kind));
    bob.subscribeEnvelopes((p) => b.push(p.kind));

    await alice.publishEnvelope({ kind: 'task', recipients: ['bob-pub'] });
    await new Promise(r => setTimeout(r, 0));

    expect(a).toEqual(['task']);
    expect(b).toEqual(['task']);
  });

  it('does not fire for non-envelope OW traffic', async () => {
    const received = [];
    bob.subscribeEnvelopes((p) => received.push(p));

    // regular publishOneWay with a different topic
    await alice.publishOneWay('bob-pub', 'something-else', { hello: 'world' });
    await new Promise(r => setTimeout(r, 0));
    expect(received).toHaveLength(0);

    // sendOneWay (no topic at all)
    await alice.sendOneWay('bob-pub', { plain: 'message' });
    await new Promise(r => setTimeout(r, 0));
    expect(received).toHaveLength(0);
  });

  it('fires alongside the Agent receive handler (parallel observation)', async () => {
    const subscribed = [];
    const handled    = [];
    bob.subscribeEnvelopes((p) => subscribed.push(p.kind));
    bob.setReceiveHandler((env) => handled.push({ topic: env._topic, payload: env.payload }));

    await alice.publishEnvelope({ kind: 'task', ref: 'x', recipients: ['bob-pub'] });
    await new Promise(r => setTimeout(r, 0));

    expect(subscribed).toEqual(['task']);
    expect(handled).toHaveLength(1);
    expect(handled[0].topic).toBe('envelope:task');
  });
});
