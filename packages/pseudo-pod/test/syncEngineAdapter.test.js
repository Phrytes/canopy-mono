/**
 * syncEngineAdapter — P3 Phase A.
 *
 * Verifies the adapter presents exactly the `podClient` surface
 * `@onderling/sync-engine`'s SyncEngine + scanPod consume (shapes asserted
 * here mirror `packages/sync-engine/src/{SyncEngine,scanPod}.js` — kept
 * dependency-free so Phase A stays substrate-only; the true end-to-end
 * SyncEngine integration is Phase B's parity harness).
 *
 * Contract under test:
 *   - read hit  → { content, etag?, size, lastModified } (string|bytes decode)
 *   - read miss → throws err.code === 'NOT_FOUND'
 *   - read falls through to the pod on local miss + caches
 *   - write rides the pseudo-pod (queued offline, drains on reconnect)
 *   - list → { container, entries: [{ uri, type:'resource' }] }, flat/deep
 *   - createContainer no-ops (no real podClient) / delegates (with one)
 *   - deleteLocal/deleteCompletely/delete evict cache + delegate
 */
import { describe, it, expect } from 'vitest';

import { createPseudoPod }            from '../src/PseudoPod.js';
import { createMemoryBackend }        from '../src/MemoryBackend.js';
import { createSyncEnginePodClient }  from '../src/syncEngineAdapter.js';

const ROOT = 'https://pod.example/notes/';
const enc  = (s) => new TextEncoder().encode(s);
const dec  = (b) => new TextDecoder().decode(b);

/** A fake real pod: a Map + reachability toggle, wired as podUploader/podFetcher. */
function makeFakePod() {
  const store = new Map(); // uri → { bytes, etag }
  let reachable = true;
  let etagN = 0;
  return {
    store,
    setReachable(v) { reachable = v; },
    isPodReachable: () => reachable,
    podUploader: async (uri, bytes) => {
      if (!reachable) throw new Error('pod unreachable');
      const etag = `"pod-${++etagN}"`;
      store.set(uri, { bytes, etag });
      return { etag };
    },
    podFetcher: async (uri) => {
      const rec = store.get(uri);
      return rec ? { bytes: rec.bytes, etag: rec.etag } : null;
    },
  };
}

function makeAdapter({ wirePodClient } = {}) {
  const pod = makeFakePod();
  const pseudoPod = createPseudoPod({
    backend:        createMemoryBackend(),
    mode:           'cache',
    deviceId:       'test-dev',
    podUploader:    pod.podUploader,
    podFetcher:     pod.podFetcher,
    isPodReachable: pod.isPodReachable,
  });
  // wirePodClient(pod) lets a test build a podClient that closes over the
  // same fake pod, so a delegated delete can simulate the real pod-side
  // removal a true PodClient performs.
  const podClient = typeof wirePodClient === 'function' ? wirePodClient(pod) : undefined;
  return { pod, pseudoPod, adapter: createSyncEnginePodClient({ pseudoPod, podClient }) };
}

describe('syncEngineAdapter — construction', () => {
  it('throws without a pseudoPod', () => {
    expect(() => createSyncEnginePodClient({})).toThrow(/pseudoPod/);
  });

  it('exposes the podClient surface SyncEngine consumes', () => {
    const { adapter } = makeAdapter();
    for (const m of ['read', 'write', 'list', 'createContainer',
                     'deleteLocal', 'deleteCompletely', 'delete']) {
      expect(typeof adapter[m]).toBe('function');
    }
    // Deliberately omitted so SyncEngine.verifyPodState uses its read() fallback.
    expect(adapter.exists).toBeUndefined();
    expect(adapter.head).toBeUndefined();
  });
});

describe('syncEngineAdapter — read', () => {
  it('round-trips a write then reads it back as a string (decode:string)', async () => {
    const { adapter } = makeAdapter();
    await adapter.write(`${ROOT}a.md`, enc('hello'), { contentType: 'text/markdown' });
    const r = await adapter.read(`${ROOT}a.md`, { decode: 'string' });
    expect(r.content).toBe('hello');
    expect(typeof r.etag).toBe('string');
    expect(r.size).toBe(5);
  });

  it('returns raw bytes for decode:bytes (what scanPod needs)', async () => {
    const { adapter } = makeAdapter();
    await adapter.write(`${ROOT}b.md`, enc('xyz'));
    const r = await adapter.read(`${ROOT}b.md`, { decode: 'bytes' });
    expect(r.content).toBeInstanceOf(Uint8Array);
    expect(dec(r.content)).toBe('xyz');
    expect(r.size).toBe(3);
  });

  it('throws err.code === NOT_FOUND on a genuine miss', async () => {
    const { adapter } = makeAdapter();
    await expect(adapter.read(`${ROOT}nope.md`, { decode: 'string' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('falls through to the pod on local miss and caches the result', async () => {
    const { adapter, pod } = makeAdapter();
    // Seed the fake pod directly (as if another device wrote it).
    pod.store.set(`${ROOT}remote.md`, { bytes: enc('from-pod'), etag: '"pod-seed"' });
    const r = await adapter.read(`${ROOT}remote.md`, { decode: 'string' });
    expect(r.content).toBe('from-pod');
    // Now cached locally: a second read works even if the pod forgets it.
    pod.store.delete(`${ROOT}remote.md`);
    const again = await adapter.read(`${ROOT}remote.md`, { decode: 'string' });
    expect(again.content).toBe('from-pod');
  });
});

describe('syncEngineAdapter — write + offline queue', () => {
  it('queues the write when the pod is unreachable, drains on reconnect', async () => {
    const { adapter, pseudoPod, pod } = makeAdapter();
    pod.setReachable(false);
    const res = await adapter.write(`${ROOT}offline.md`, enc('queued-content'));
    expect(res.queued).toBe(true);
    // Still readable locally (cache) while queued.
    const local = await adapter.read(`${ROOT}offline.md`, { decode: 'string' });
    expect(local.content).toBe('queued-content');
    expect(pod.store.has(`${ROOT}offline.md`)).toBe(false);
    // Reconnect + drain → it reaches the real pod.
    pod.setReachable(true);
    const { drained } = await pseudoPod.drainWriteThroughQueue();
    expect(drained).toBe(1);
    expect(dec(pod.store.get(`${ROOT}offline.md`).bytes)).toBe('queued-content');
  });
});

describe('syncEngineAdapter — list (scanPod contract)', () => {
  it('returns { container, entries:[{uri,type:resource}] }, flat + deep', async () => {
    const { adapter } = makeAdapter();
    await adapter.write(`${ROOT}a.md`, enc('A'));
    await adapter.write(`${ROOT}sub/b.md`, enc('B'));
    const res = await adapter.list(ROOT, { recursive: false });
    expect(res.container).toBe(ROOT);
    const uris = res.entries.map((e) => e.uri).sort();
    expect(uris).toEqual([`${ROOT}a.md`, `${ROOT}sub/b.md`]);
    expect(res.entries.every((e) => e.type === 'resource')).toBe(true);
  });

  it('empty store → { entries: [] } (scanPod treats as empty pod)', async () => {
    const { adapter } = makeAdapter();
    const res = await adapter.list(ROOT, { recursive: false });
    expect(res.entries).toEqual([]);
  });

  it('delegates to the real podClient for pod-truth when one is present', async () => {
    // scanPod must see pod-only files (to compute downloads); the local
    // pseudoPod backend would miss them, so list() delegates to the real
    // podClient when present and passes its shape straight through.
    const podListing = {
      container: ROOT,
      entries: [{ uri: `${ROOT}only-on-pod.md`, type: 'resource' }],
    };
    let called = null;
    const { adapter } = makeAdapter({
      wirePodClient: () => ({ list: async (c, opts) => { called = { c, opts }; return podListing; } }),
    });
    // Write something locally; it must NOT shadow the pod truth.
    await adapter.write(`${ROOT}local-only.md`, enc('L'));
    const res = await adapter.list(ROOT, { recursive: false });
    expect(called).toEqual({ c: ROOT, opts: { recursive: false } });
    expect(res).toBe(podListing);                       // passed straight through
  });
});

describe('syncEngineAdapter — structural ops', () => {
  it('createContainer no-ops (resolves) with no real podClient', async () => {
    const { adapter } = makeAdapter();
    await expect(adapter.createContainer(`${ROOT}sub/`)).resolves.toBeUndefined();
  });

  it('createContainer delegates to a real podClient when present', async () => {
    const calls = [];
    const { adapter } = makeAdapter({
      wirePodClient: () => ({ createContainer: async (u) => { calls.push(u); } }),
    });
    await adapter.createContainer(`${ROOT}sub/`);
    expect(calls).toEqual([`${ROOT}sub/`]);
  });

  it('deleteCompletely delegates the tombstone AND evicts cache; once the pod-side resource is gone the read misses', async () => {
    const tomb = [];
    const { adapter, pod } = makeAdapter({
      // Simulate a real PodClient: deleteCompletely removes the pod-side
      // resource too (not just records the call).
      wirePodClient: (p) => ({
        deleteCompletely: async (u) => { tomb.push(u); p.store.delete(u); },
      }),
    });
    await adapter.write(`${ROOT}gone.md`, enc('bye'));
    expect(pod.store.has(`${ROOT}gone.md`)).toBe(true);
    await adapter.deleteCompletely(`${ROOT}gone.md`);
    expect(tomb).toEqual([`${ROOT}gone.md`]);
    expect(pod.store.has(`${ROOT}gone.md`)).toBe(false);
    // Local cache evicted AND pod-side gone → read is a genuine miss.
    await expect(adapter.read(`${ROOT}gone.md`, { decode: 'string' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('deleteLocal delegates the tombstone and evicts the local cache (not a pod delete)', async () => {
    const tomb = [];
    const { adapter, pseudoPod, pod } = makeAdapter({
      wirePodClient: () => ({ deleteLocal: async (u) => { tomb.push(u); } }),
    });
    await adapter.write(`${ROOT}local.md`, enc('x'));
    await adapter.deleteLocal(`${ROOT}local.md`);
    // Tombstone delegated to the real pod-client.
    expect(tomb).toEqual([`${ROOT}local.md`]);
    // Local cache entry evicted (asserted directly on the backend so the
    // cache-mode pod-fallthrough doesn't confound the check).
    expect(await pseudoPod.backend.get(`${ROOT}local.md`)).toBeNull();
    // deleteLocal is a tombstone, NOT a pod delete: the pod-side copy is
    // intentionally still there (real PodClient.deleteLocal behaves the
    // same — the diff skips the URI via the tombstone, it isn't removed).
    expect(pod.store.has(`${ROOT}local.md`)).toBe(true);
  });
});
