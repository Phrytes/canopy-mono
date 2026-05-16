/**
 * podCache — the platform-neutral cache-mode wrapping shared by the
 * Folio desktop CLI (Phase B) and folio-mobile (Phase C).
 *
 * RN-agnostic: uses MemoryBackend so the *shared logic* (podUploader /
 * podFetcher / adapter wiring, offline queue + drain, pod-truth list
 * delegation) is verified independently of which platform backend a
 * caller injects. The Node FS backend's restart-durability is covered
 * separately in `@canopy/pseudo-pod`'s NodeFsBackend test; the RN
 * backend's in `@canopy/react-native`'s pseudo-pod-adapter tests.
 */
import { describe, it, expect } from 'vitest';
import { createMemoryBackend } from '@canopy/pseudo-pod';
import { wrapWithPseudoPod, guessContentType } from '../src/podCache.js';

const ROOT = 'https://pod.example/notes/';
const enc = (s) => new TextEncoder().encode(s);

/** A fake Folio PodClient: Map-backed, reachability toggle, NOT_FOUND throw. */
function fakePodClient() {
  const store = new Map();
  let reachable = true;
  let n = 0;
  return {
    store,
    setReachable(v) { reachable = v; },
    async read(uri) {
      const r = store.get(uri);
      if (!r) { const e = new Error(`404 ${uri}`); e.code = 'NOT_FOUND'; throw e; }
      return { content: r.content, contentType: r.contentType, etag: r.etag, size: r.content.length };
    },
    async write(uri, content, opts = {}) {
      if (!reachable) throw new Error('pod unreachable');
      const etag = `"e${++n}"`;
      store.set(uri, { content, contentType: opts.contentType, etag });
      return { uri, etag };
    },
    async list(containerUri) {
      return {
        container: containerUri,
        entries: [...store.keys()]
          .filter((k) => k.startsWith(containerUri))
          .map((uri) => ({ uri, type: 'resource' })),
      };
    },
    async deleteCompletely(uri) { store.delete(uri); },
  };
}

describe('podCache.guessContentType', () => {
  it('maps the extensions Folio v1 cares about', () => {
    expect(guessContentType(`${ROOT}a.md`)).toBe('text/markdown');
    expect(guessContentType(`${ROOT}a.json`)).toBe('application/json');
    expect(guessContentType(`${ROOT}a.bin`)).toBe('application/octet-stream');
  });
});

describe('podCache.wrapWithPseudoPod', () => {
  it('validates required args', () => {
    expect(() => wrapWithPseudoPod({ backend: createMemoryBackend() })).toThrow(/realPodClient/);
    expect(() => wrapWithPseudoPod({ realPodClient: {} })).toThrow(/backend/);
  });

  it('write-through reaches the pod with an inferred content-type', async () => {
    const real = fakePodClient();
    const c = wrapWithPseudoPod({ realPodClient: real, backend: createMemoryBackend() });
    await c.write(`${ROOT}a.md`, enc('hello'), { contentType: 'ignored-by-adapter' });
    expect(real.store.get(`${ROOT}a.md`).contentType).toBe('text/markdown');
    const r = await c.read(`${ROOT}a.md`, { decode: 'string' });
    expect(r.content).toBe('hello');
  });

  it('offline write queues, drains on reconnect', async () => {
    const real = fakePodClient();
    const backend = createMemoryBackend();
    const c = wrapWithPseudoPod({ realPodClient: real, backend });
    real.setReachable(false);
    const res = await c.write(`${ROOT}q.md`, enc('queued'));
    expect(res.queued).toBe(true);
    expect(real.store.has(`${ROOT}q.md`)).toBe(false);
    // Still locally readable while queued (cache).
    expect((await c.read(`${ROOT}q.md`, { decode: 'string' })).content).toBe('queued');
    real.setReachable(true);
    const { drained } = await c._pseudoPod.drainWriteThroughQueue();
    expect(drained).toBe(1);
    expect(new TextDecoder().decode(real.store.get(`${ROOT}q.md`).content)).toBe('queued');
  });

  it('list returns pod truth (delegates to the real client) so scanPod sees pod-only files', async () => {
    const real = fakePodClient();
    real.store.set(`${ROOT}only-on-pod.md`, { content: 'P', etag: '"e0"' });
    const c = wrapWithPseudoPod({ realPodClient: real, backend: createMemoryBackend() });
    // Local cache has nothing; list must still surface the pod-only file.
    const res = await c.list(ROOT, { recursive: false });
    expect(res.entries.map((e) => e.uri)).toContain(`${ROOT}only-on-pod.md`);
  });

  it('read falls through to the pod on a cold cache, then serves from cache', async () => {
    const real = fakePodClient();
    real.store.set(`${ROOT}remote.md`, { content: 'from-pod', etag: '"e0"' });
    const c = wrapWithPseudoPod({ realPodClient: real, backend: createMemoryBackend() });
    expect((await c.read(`${ROOT}remote.md`, { decode: 'string' })).content).toBe('from-pod');
    real.store.delete(`${ROOT}remote.md`);                 // pod forgets it
    expect((await c.read(`${ROOT}remote.md`, { decode: 'string' })).content).toBe('from-pod'); // cached
  });
});
