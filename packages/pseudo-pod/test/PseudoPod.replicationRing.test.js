/**
 * PseudoPod — replication-ring mode.
 *
 * Two pseudo-pods bound to a fake bus replicate writes between each
 * other. The fake bus implements just enough of Transport's
 * envelope-publishing surface for the test.
 *
 * Covers:
 *   - write fans out to peers via transport.publishEnvelope.
 *   - writeFromPeer on the receiver path stores the resource.
 *   - End-to-end: writer's write becomes readable on the peer.
 *   - Fan-out is best-effort (transport errors don't propagate).
 *   - Empty peer set: writes succeed without publishing.
 */

import { describe, it, expect } from 'vitest';
import { createPseudoPod, createMemoryBackend } from '../index.js';

/**
 * Minimal in-memory bus that mimics Transport.publishEnvelope and
 * dispatches inbound envelopes to subscribed pseudo-pods. The bus
 * doesn't do crypto / hello / dedupe — just routing.
 */
function createFakeBus() {
  /** @type {Map<string, (env: any) => void>} */
  const inboxes = new Map();
  return {
    /** Register a pseudo-pod by address. */
    bind(address, inboundCb) {
      inboxes.set(address, inboundCb);
    },
    /** Transport-shaped publishEnvelope. */
    async publishEnvelope({ kind, ref, etag, _v, fromActor, recipients, payload, timestamp } = {}) {
      const wire = {
        v: 1,
        kind,
        timestamp: timestamp ?? new Date().toISOString(),
        ...(ref       !== undefined ? { ref } : {}),
        ...(etag      !== undefined ? { etag } : {}),
        ...(_v        !== undefined ? { _v } : {}),
        ...(fromActor !== undefined ? { fromActor } : {}),
        ...(payload   !== undefined ? { payload } : {}),
      };
      for (const to of recipients) {
        const cb = inboxes.get(to);
        if (cb) await cb(wire);
      }
    },
  };
}

function makePair() {
  const bus = createFakeBus();

  const anneBackend = createMemoryBackend();
  const bobBackend  = createMemoryBackend();

  // Glue: peer addresses are device ids, getPeers returns the other.
  const anne = createPseudoPod({
    backend:  anneBackend,
    mode:     'replication-ring',
    deviceId: 'anne',
    transport: { publishEnvelope: (...args) => bus.publishEnvelope(...args) },
    getPeers: () => ['bob'],
    fromActor: 'agent://anne/laptop',
  });

  const bob = createPseudoPod({
    backend:  bobBackend,
    mode:     'replication-ring',
    deviceId: 'bob',
    transport: { publishEnvelope: (...args) => bus.publishEnvelope(...args) },
    getPeers: () => ['anne'],
    fromActor: 'agent://bob/phone',
  });

  // Inbound dispatch — when an envelope arrives at Bob (or Anne),
  // route it to writeFromPeer.
  bus.bind('bob', async (wire) => {
    if (wire.kind === 'pseudo-pod.write' && wire.payload) {
      await bob.writeFromPeer(
        wire.payload.uri,
        wire.payload.bytes,
        wire.payload.etag,
        wire.payload._v,
        wire.fromActor != null ? { fromActor: wire.fromActor } : undefined,
      );
    }
  });
  bus.bind('anne', async (wire) => {
    if (wire.kind === 'pseudo-pod.write' && wire.payload) {
      await anne.writeFromPeer(
        wire.payload.uri,
        wire.payload.bytes,
        wire.payload.etag,
        wire.payload._v,
        wire.fromActor != null ? { fromActor: wire.fromActor } : undefined,
      );
    }
  });

  return { anne, bob, bus };
}

describe('PseudoPod.replication-ring — end-to-end', () => {
  it("Anne's write becomes readable on Bob", async () => {
    const { anne, bob } = makePair();
    const uri = 'pseudo-pod://anne/tasks/abc';
    await anne.write(uri, { text: 'paint the fence' });
    const rec = await bob.read(uri);
    expect(rec).toBeTruthy();
    expect(rec.bytes).toEqual({ text: 'paint the fence' });
    expect(typeof rec.etag).toBe('string');
  });

  it("Bob's write becomes readable on Anne", async () => {
    const { anne, bob } = makePair();
    const uri = 'pseudo-pod://bob/notes/1';
    await bob.write(uri, 'hi from bob');
    const rec = await anne.read(uri);
    expect(rec?.bytes).toBe('hi from bob');
  });

  it('subscribers on the receiving side fire when peer write lands', async () => {
    const { anne, bob } = makePair();
    const events = [];
    bob.subscribe('pseudo-pod://anne/tasks/', (e) => events.push(e));
    await anne.write('pseudo-pod://anne/tasks/x', 1);
    expect(events.map(e => e.key)).toEqual(['pseudo-pod://anne/tasks/x']);
  });

  it('writes succeed even with no peers (replication is best-effort)', async () => {
    const backend = createMemoryBackend();
    const pod = createPseudoPod({
      backend,
      mode:     'replication-ring',
      deviceId: 'solo',
      transport: { publishEnvelope: async () => { throw new Error('no peers'); } },
      getPeers: () => [],   // empty → no recipients, no publish call
    });
    await expect(pod.write('pseudo-pod://solo/x', 1)).resolves.toBeTruthy();
    expect((await pod.read('pseudo-pod://solo/x'))?.bytes).toBe(1);
  });

  it('transport errors do not break the write (best-effort fan-out)', async () => {
    const backend = createMemoryBackend();
    const pod = createPseudoPod({
      backend,
      mode:     'replication-ring',
      deviceId: 'a',
      transport: { publishEnvelope: async () => { throw new Error('bus down'); } },
      getPeers: () => ['b'],
    });
    await expect(pod.write('pseudo-pod://a/x', 1)).resolves.toBeTruthy();
    expect((await pod.read('pseudo-pod://a/x'))?.bytes).toBe(1);
  });
});

describe('PseudoPod.replication-ring — Q-D version compare (Phase 52.14)', () => {
  it('peer-update: inbound _v > local _v adopts and fires peer-update', async () => {
    const { anne, bob } = makePair();
    const uri = 'pseudo-pod://anne/notes/x';
    const events = [];
    bob.on('peer-update', (e) => events.push(e));
    await anne.write(uri, 'v1');
    await anne.write(uri, 'v2');
    expect((await bob.read(uri))?.bytes).toBe('v2');
    expect((await bob.read(uri))?._v).toBe(2);
    // The first envelope produces a peer-update (no local copy yet);
    // the second another peer-update (newer version).
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.at(-1)).toMatchObject({ uri, peerV: 2, fromActor: 'agent://anne/laptop' });
  });

  it('stale-peer: inbound _v < local _v is ignored and fires stale-peer', async () => {
    const { anne, bob } = makePair();
    const uri = 'pseudo-pod://shared/x';
    // Seed: Bob writes locally to bump his _v past 0.
    await bob.writeFromPeer(uri, 'newer', '"e2"', 5);
    const stale = [];
    bob.on('stale-peer', (e) => stale.push(e));
    const status = await bob.writeFromPeer(uri, 'older', '"e1"', 3, { fromActor: 'agent://anne' });
    expect(status.status).toBe('stale-peer');
    expect((await bob.read(uri))?.bytes).toBe('newer');
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({
      uri,
      peerV: 3,
      localV: 5,
      localBytes: 'newer',
      fromActor: 'agent://anne',
    });
  });

  it('concurrent-write: same _v + different etag fires concurrent-write', async () => {
    const backend = createMemoryBackend();
    const pod = createPseudoPod({
      backend,
      mode: 'standalone',
      deviceId: 'x',
    });
    await pod.write('pseudo-pod://x/r', 'local-bytes');     // _v=1, etag=mem-1
    const events = [];
    pod.on('concurrent-write', (e) => events.push(e));
    const status = await pod.writeFromPeer(
      'pseudo-pod://x/r', 'peer-bytes', '"different"', 1,
      { fromActor: 'agent://other' },
    );
    expect(status.status).toBe('concurrent-write');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      uri: 'pseudo-pod://x/r',
      peerV: 1,
      localV: 1,
      peerBytes: 'peer-bytes',
      localBytes: 'local-bytes',
      fromActor: 'agent://other',
    });
  });

  it('idempotent: same _v + same etag returns idempotent (no event)', async () => {
    const pod = createPseudoPod({
      backend: createMemoryBackend(),
      mode: 'standalone',
      deviceId: 'x',
    });
    const { etag, _v } = await pod.write('pseudo-pod://x/r', 'hi');
    const ev = [];
    pod.on('concurrent-write', (e) => ev.push(e));
    pod.on('peer-update',      (e) => ev.push(e));
    const status = await pod.writeFromPeer('pseudo-pod://x/r', 'hi', etag, _v);
    expect(status.status).toBe('idempotent');
    expect(ev).toHaveLength(0);
  });

  it('legacy peer (no _v): falls back to last-write-wins', async () => {
    const { anne, bob } = makePair();
    const uri = 'pseudo-pod://anne/x';
    await anne.write(uri, 'v1');
    // Pretend a legacy sender omits _v entirely.
    const status = await bob.writeFromPeer(uri, 'legacy', '"e"');
    expect(status.status).toBe('written-no-version');
    expect((await bob.read(uri))?.bytes).toBe('legacy');
  });

  it('stale-peer reply round-trip: divergent peers converge in one round', async () => {
    const { anne, bob } = makePair();
    // Replication-ring writes have to be to the WRITER's namespace
    // (the deviceId guard); each pod's copy lives under the same URI.
    const uri = 'pseudo-pod://anne/r';
    // Anne writes v1, replicates to Bob.
    await anne.write(uri, 'v1');
    expect((await bob.read(uri))?._v).toBe(1);
    // Simulate Bob's "out-of-band" override that bumps his _v past 1
    // (e.g. an app-level merge surfaced through writeFromPeer).
    await bob.writeFromPeer(uri, 'bob-v2', '"b2"', 2, { fromActor: 'agent://bob' });
    // Anne attempts to ship her stale v1 again (simulate a re-publish).
    const stale = [];
    bob.on('stale-peer', (e) => stale.push(e));
    await bob.writeFromPeer(uri, 'v1', '"a1"', 1, { fromActor: 'agent://anne' });
    expect(stale).toHaveLength(1);
    // Bob's local copy is still v2.
    expect((await bob.read(uri))?.bytes).toBe('bob-v2');
    // App-level "reply" step: caller would publish the local copy
    // back. Here we just simulate that Anne adopts it.
    await anne.writeFromPeer(uri, stale[0].localBytes, stale[0].localEtag, stale[0].localV);
    expect((await anne.read(uri))?.bytes).toBe('bob-v2');
    expect((await anne.read(uri))?._v).toBe(2);
  });
});

describe('PseudoPod.replication-ring — peer fetch via skill', () => {
  it("peer can read locally-replicated resource via Bob's fetch-resource skill", async () => {
    const { anne, bob } = makePair();
    const uri = 'pseudo-pod://anne/tasks/xyz';
    await anne.write(uri, { text: 'hello' });

    const skill = bob.fetchResourceSkill();
    const parts = await skill.handler({
      parts: [{ type: 'DataPart', data: { uri } }],
    });
    expect(parts[0].data.bytes).toEqual({ text: 'hello' });
  });
});

describe('PseudoPod.replication-ring — envelope shape', () => {
  it('uses kind=pseudo-pod.write + ref + etag + payload', async () => {
    const captured = [];
    const pod = createPseudoPod({
      backend:  createMemoryBackend(),
      mode:     'replication-ring',
      deviceId: 'sender',
      transport: {
        publishEnvelope: async (env) => { captured.push(env); },
      },
      getPeers:  () => ['peer-1', 'peer-2'],
      fromActor: 'agent://sender/laptop',
    });
    await pod.write('pseudo-pod://sender/x', { a: 1 });
    expect(captured).toHaveLength(1);
    expect(captured[0].kind).toBe('pseudo-pod.write');
    expect(captured[0].ref).toBe('pseudo-pod://sender/x');
    expect(typeof captured[0].etag).toBe('string');
    expect(captured[0].fromActor).toBe('agent://sender/laptop');
    expect(captured[0].recipients).toEqual(['peer-1', 'peer-2']);
    expect(captured[0].payload).toMatchObject({
      uri:   'pseudo-pod://sender/x',
      bytes: { a: 1 },
    });
  });

  it('includes _v in the envelope (top-level + payload)', async () => {
    const captured = [];
    const pod = createPseudoPod({
      backend:  createMemoryBackend(),
      mode:     'replication-ring',
      deviceId: 'sender',
      transport: { publishEnvelope: async (env) => { captured.push(env); } },
      getPeers:  () => ['peer-1'],
    });
    await pod.write('pseudo-pod://sender/x', { a: 1 });
    await pod.write('pseudo-pod://sender/x', { a: 2 });
    expect(captured[0]._v).toBe(1);
    expect(captured[0].payload._v).toBe(1);
    expect(captured[1]._v).toBe(2);
    expect(captured[1].payload._v).toBe(2);
  });

  it('filters out empty / non-string recipients', async () => {
    const captured = [];
    const pod = createPseudoPod({
      backend:  createMemoryBackend(),
      mode:     'replication-ring',
      deviceId: 's',
      transport: { publishEnvelope: async (env) => { captured.push(env); } },
      getPeers:  () => ['p1', '', null, 'p2'],
    });
    await pod.write('pseudo-pod://s/x', 1);
    expect(captured[0].recipients).toEqual(['p1', 'p2']);
  });
});
