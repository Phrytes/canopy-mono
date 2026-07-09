/**
 * PseudoPod — versioning seam (PLAN-pod-versioning-history-recovery P2).
 *
 * Covers:
 *   - Constructor validation of the `versioning` option.
 *   - write: first write captures nothing; overwrite snapshots the
 *     DISPLACED prior bytes; the snapshot restores.
 *   - delete: prior bytes snapshotted before the hard delete (recoverable).
 *   - writeFromPeer: peer-update snapshots displaced local; concurrent-write
 *     snapshots the DROPPED PEER FORK; stale-peer + idempotent capture nothing.
 *   - Best-effort: a throwing version store never breaks the write path.
 *   - Version records never leak into pseudoPod.list of live containers.
 *   - Without `versioning`, behaviour is unchanged (no capture calls).
 *
 * The version store is `@canopy/versioning`'s createVersionStore (imported
 * relatively — the seam is duck-typed, so pseudo-pod takes no package dep)
 * sharing the SAME MemoryBackend under the `versions/` root: live keys are
 * `pseudo-pod://…` URIs, version keys are `versions/…` — disjoint prefixes.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

import { createPseudoPod, createMemoryBackend } from '../index.js';
import { createVersionStore } from '../../versioning/src/versionStore.js';

/** sha256 over the JSON form — pseudo-pod `bytes` are opaque (objects/strings). */
const hashJson = async (content) => {
  const h = createHash('sha256');
  h.update(typeof content === 'string' ? content : JSON.stringify(content) ?? 'undefined', 'utf8');
  return h.digest('hex');
};

function mkVersionedPod({ mode = 'standalone', deviceId = 'dev-A', backend, ...podOpts } = {}) {
  const be = backend ?? createMemoryBackend();
  const store = createVersionStore({
    backend: be,
    hash: hashJson,
    writerId: deviceId,
    retention: { debounceMs: 0 }, // deterministic captures in tests
  });
  const pod = createPseudoPod({
    backend: be,
    mode,
    deviceId,
    versioning: store,
    ...podOpts,
  });
  return { pod, store, backend: be };
}

const URI = 'pseudo-pod://dev-A/private/note.json';

describe('PseudoPod versioning — constructor', () => {
  it('rejects a versioning option without capture()', () => {
    expect(() => createPseudoPod({
      backend: createMemoryBackend(),
      mode: 'standalone',
      deviceId: 'x',
      versioning: {},
    })).toThrow(/capture/);
  });

  it('accepts a duck-typed store', () => {
    expect(() => createPseudoPod({
      backend: createMemoryBackend(),
      mode: 'standalone',
      deviceId: 'x',
      versioning: { capture: async () => {} },
    })).not.toThrow();
  });
});

describe('PseudoPod versioning — write path', () => {
  it('first write displaces nothing → no version; overwrite snapshots the prior bytes', async () => {
    const { pod, store } = mkVersionedPod();

    await pod.write(URI, { v: 1, text: 'first' });
    expect(await store.list(URI)).toHaveLength(0); // nothing displaced yet

    await pod.write(URI, { v: 2, text: 'second' });
    const versions = await store.list(URI);
    expect(versions).toHaveLength(1);

    const snap = await store.read(URI, versions[0].id);
    expect(snap).toEqual({ v: 1, text: 'first' }); // the DISPLACED content, not the incoming
  });

  it('a run of overwrites retains the full displaced history, newest-first', async () => {
    const { pod, store } = mkVersionedPod();
    for (let i = 1; i <= 4; i++) await pod.write(URI, `content-${i}`);
    const versions = await store.list(URI, { withContent: true });
    expect(versions.map((v) => v.content)).toEqual(['content-3', 'content-2', 'content-1']);
  });

  it('delete snapshots the prior bytes before the hard delete (recoverable)', async () => {
    const { pod, store } = mkVersionedPod();
    await pod.write(URI, 'precious');
    await pod.delete(URI);

    expect(await pod.read(URI)).toBeNull(); // gone from the live store…
    const versions = await store.list(URI);
    expect(versions).toHaveLength(1);       // …but the bytes survive in history
    expect(await store.read(URI, versions[0].id)).toBe('precious');
  });

  it('a throwing version store never breaks write or delete', async () => {
    const be = createMemoryBackend();
    const pod = createPseudoPod({
      backend: be,
      mode: 'standalone',
      deviceId: 'dev-A',
      versioning: { capture: async () => { throw new Error('store down'); } },
    });
    await pod.write(URI, 'a');
    await expect(pod.write(URI, 'b')).resolves.toMatchObject({ uri: URI });
    expect((await pod.read(URI)).bytes).toBe('b');
    await expect(pod.delete(URI)).resolves.toBeUndefined();
  });

  it('version records never leak into pseudoPod.list of a live container', async () => {
    const { pod } = mkVersionedPod();
    await pod.write(URI, 'v1');
    await pod.write(URI, 'v2'); // creates a version record
    const listed = await pod.list('pseudo-pod://dev-A/private');
    expect(listed).toEqual([URI]); // no versions/… keys
  });

  it('without `versioning`, no capture happens (behaviour unchanged)', async () => {
    const be = createMemoryBackend();
    const pod = createPseudoPod({ backend: be, mode: 'standalone', deviceId: 'dev-A' });
    await pod.write(URI, 'a');
    await pod.write(URI, 'b');
    expect(await be.list('versions/')).toEqual([]);
  });
});

describe('PseudoPod versioning — writeFromPeer', () => {
  const ring = () => mkVersionedPod({
    mode: 'replication-ring',
    transport: { publishEnvelope: async () => {} },
    getPeers: () => [],
  });

  it('peer-update (_v newer) snapshots the DISPLACED local bytes', async () => {
    const { pod, store } = ring();
    await pod.write(URI, 'local-truth');       // local _v = 1
    const r = await pod.writeFromPeer(URI, 'peer-newer', '"e2"', 5);
    expect(r.status).toBe('peer-update');

    const versions = await store.list(URI, { withContent: true });
    expect(versions[0].content).toBe('local-truth'); // displaced local retained
    expect((await pod.read(URI)).bytes).toBe('peer-newer');
  });

  it('concurrent-write keeps local AND snapshots the dropped peer fork', async () => {
    const { pod, store } = ring();
    await pod.write(URI, 'local-fork');        // local _v = 1
    const r = await pod.writeFromPeer(URI, 'peer-fork', '"other-etag"', 1); // same _v, different etag
    expect(r.status).toBe('concurrent-write');

    expect((await pod.read(URI)).bytes).toBe('local-fork'); // LWW keeps local
    const versions = await store.list(URI, { withContent: true });
    expect(versions[0].content).toBe('peer-fork'); // the loser lands in history, not /dev/null
  });

  it('stale-peer and idempotent re-deliveries capture NOTHING (noise)', async () => {
    const { pod, store } = ring();
    await pod.write(URI, 'v1');
    await pod.write(URI, 'v2'); // one displaced version exists (v1); local _v = 2
    const before = (await store.list(URI)).length;

    const stale = await pod.writeFromPeer(URI, 'old-peer-copy', '"e"', 1);
    expect(stale.status).toBe('stale-peer');

    const local = await pod.read(URI);
    const idem = await pod.writeFromPeer(URI, 'v2', local.etag, local._v);
    expect(idem.status).toBe('idempotent');

    expect((await store.list(URI)).length).toBe(before); // no new snapshots
  });

  it('legacy peer write (no _v, LWW) snapshots the displaced local bytes', async () => {
    const { pod, store } = ring();
    await pod.write(URI, 'local-old');
    const r = await pod.writeFromPeer(URI, 'legacy-peer', '"e"'); // no _v
    expect(r.status).toBe('written-no-version');

    const versions = await store.list(URI, { withContent: true });
    expect(versions[0].content).toBe('local-old');
  });
});

describe('PseudoPod versioning — 4b: the history layer is IMMUTABLE through the pod', () => {
  it('write/delete of a history key throw HISTORY_IMMUTABLE (standalone)', async () => {
    const { pod } = mkVersionedPod();
    await expect(pod.write('versions/x/1', 'forged')).rejects.toMatchObject({ code: 'HISTORY_IMMUTABLE' });
    await expect(pod.delete('versions/x/1')).rejects.toMatchObject({ code: 'HISTORY_IMMUTABLE' });
  });

  it('cache mode is guarded too (it skips _assertLocalWrite — the hole this closes)', async () => {
    const { backend, store } = (() => {
      const be = createMemoryBackend();
      return { backend: be, store: createVersionStore({ backend: be, hash: hashJson, writerId: 'dev-A' }) };
    })();
    const pod = createPseudoPod({
      backend, mode: 'cache', deviceId: 'dev-A', versioning: store,
      podUploader: async () => ({}), podFetcher: async () => null,
    });
    await expect(pod.write('versions/x/1', 'forged')).rejects.toMatchObject({ code: 'HISTORY_IMMUTABLE' });
    await expect(pod.delete('versions/x/1')).rejects.toMatchObject({ code: 'HISTORY_IMMUTABLE' });
  });

  it('a peer can NEVER rewrite history: writeFromPeer rejects with a status (no throw, no write)', async () => {
    const { pod, store, backend } = mkVersionedPod({
      mode: 'replication-ring',
      transport: { publishEnvelope: async () => {} },
      getPeers: () => [],
    });
    // Seed real history via displacement, then assault the actual record.
    await pod.write(URI, 'v1');
    await pod.write(URI, 'v2');
    const [snap] = await store.list(URI);
    const historyKey = `versions/${encodeURIComponent(URI)}/${snap.id}`;

    const r = await pod.writeFromPeer(historyKey, 'forged-history', '"e"', 999);
    expect(r).toEqual({ status: 'rejected-history-immutable' });

    // History byte-identical after the assault.
    expect(await store.read(URI, snap.id)).toBe('v1');
    expect((await backend.get(historyKey)).bytes.content).toBe('v1');
  });

  it('honours a custom versionsRoot (guards that prefix, not the default)', async () => {
    const backend = createMemoryBackend();
    const store = createVersionStore({
      backend, hash: hashJson, writerId: 'dev-A', versionsRoot: 'history/',
    });
    const pod = createPseudoPod({
      backend, mode: 'replication-ring', deviceId: 'dev-A', versioning: store,
      transport: { publishEnvelope: async () => {} }, getPeers: () => [],
    });
    expect((await pod.writeFromPeer('history/x/1', 'forged', '"e"', 1)).status)
      .toBe('rejected-history-immutable');
    // 'versions/…' is NOT this store's history — treated as a normal key.
    expect((await pod.writeFromPeer('versions/x/1', 'ok', '"e"', 1)).status)
      .not.toBe('rejected-history-immutable');
  });

  it('without versioning there is no history layer — legacy behaviour unchanged', async () => {
    const pod = createPseudoPod({ backend: createMemoryBackend(), mode: 'replication-ring', deviceId: 'dev-A', transport: { publishEnvelope: async () => {} }, getPeers: () => [] });
    expect((await pod.writeFromPeer('versions/x/1', 'data', '"e"', 1)).status).toBe('peer-update');
  });
});
