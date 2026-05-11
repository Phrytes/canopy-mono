/**
 * PseudoPod — cache mode (V1, Phase 52.8).
 *
 * Covers:
 *   - Constructor validation for the new mode.
 *   - read miss-through (local → pod-fetcher → cache).
 *   - write write-through (online + offline path with queue).
 *   - Pod-assigned etags replace local-generated ones.
 *   - drainWriteThroughQueue: drains in order, stops on first error.
 *   - Per-URI mode override (setMode / mode).
 *   - Queue survives substrate restart (persistent on backend).
 *   - flush(uri).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createPseudoPod, createMemoryBackend } from '../index.js';

const POD_URI = 'https://anne.pod/sharing/tasks/abc.ttl';

function fakeUploader() {
  const calls = [];
  let nextEtag = 0;
  const fn = async (uri, bytes, etag) => {
    calls.push({ uri, bytes, etag });
    return { etag: `"pod-${++nextEtag}"` };
  };
  fn.calls = calls;
  return fn;
}

function fakeFetcher(remoteStore = new Map()) {
  const calls = [];
  const fn = async (uri) => {
    calls.push(uri);
    if (remoteStore.has(uri)) return remoteStore.get(uri);
    return null;
  };
  fn.calls = calls;
  fn.remoteStore = remoteStore;
  return fn;
}

describe('createPseudoPod — cache mode validation', () => {
  it('cache mode requires podUploader', () => {
    expect(() => createPseudoPod({
      backend: createMemoryBackend(),
      mode: 'cache',
      deviceId: 'd',
    })).toThrow(/podUploader/);
  });

  it('cache mode requires podFetcher', () => {
    expect(() => createPseudoPod({
      backend: createMemoryBackend(),
      mode: 'cache',
      deviceId: 'd',
      podUploader: fakeUploader(),
    })).toThrow(/podFetcher/);
  });

  it('rejects invalid mode strings', () => {
    expect(() => createPseudoPod({
      backend: createMemoryBackend(),
      mode: 'invalid',
      deviceId: 'd',
    })).toThrow(/mode/);
  });
});

describe('cache mode — write-through (online)', () => {
  let upload; let fetcher; let pod;
  beforeEach(() => {
    upload  = fakeUploader();
    fetcher = fakeFetcher();
    pod = createPseudoPod({
      backend:    createMemoryBackend(),
      mode:       'cache',
      deviceId:   'd',
      podUploader: upload,
      podFetcher:  fetcher,
    });
  });

  it('writes locally + uploads to pod + returns pod-assigned etag', async () => {
    const { etag, queued } = await pod.write(POD_URI, { text: 'paint' });
    expect(queued).toBeUndefined();
    expect(etag).toBe('"pod-1"');
    expect(upload.calls).toHaveLength(1);
    expect(upload.calls[0].uri).toBe(POD_URI);
    expect(upload.calls[0].bytes).toEqual({ text: 'paint' });
  });

  it('local read returns the pod-assigned etag', async () => {
    await pod.write(POD_URI, { text: 'x' });
    const rec = await pod.read(POD_URI);
    expect(rec?.bytes).toEqual({ text: 'x' });
    expect(rec?.etag).toBe('"pod-1"');
  });

  it('queues + does not throw when uploader fails transiently', async () => {
    const flaky = (async () => { throw new Error('network'); });
    const p = createPseudoPod({
      backend:    createMemoryBackend(),
      mode:       'cache',
      deviceId:   'd',
      podUploader: flaky,
      podFetcher:  fetcher,
    });
    const result = await p.write(POD_URI, { text: 'paint' });
    expect(result.queued).toBe(true);
    expect(await p.writeThroughPendingCount()).toBe(1);
  });
});

describe('cache mode — graceful degradation', () => {
  it('isPodReachable=false → queue immediately, skip upload', async () => {
    const upload = fakeUploader();
    const pod = createPseudoPod({
      backend:    createMemoryBackend(),
      mode:       'cache',
      deviceId:   'd',
      podUploader: upload,
      podFetcher:  fakeFetcher(),
      isPodReachable: () => false,
    });
    const result = await pod.write(POD_URI, { text: 'x' });
    expect(result.queued).toBe(true);
    expect(upload.calls).toHaveLength(0);
    expect(await pod.writeThroughPendingCount()).toBe(1);
  });

  it('isPodReachable=true → normal write-through', async () => {
    const upload = fakeUploader();
    const pod = createPseudoPod({
      backend:    createMemoryBackend(),
      mode:       'cache',
      deviceId:   'd',
      podUploader: upload,
      podFetcher:  fakeFetcher(),
      isPodReachable: () => true,
    });
    await pod.write(POD_URI, { text: 'x' });
    expect(upload.calls).toHaveLength(1);
    expect(await pod.writeThroughPendingCount()).toBe(0);
  });
});

describe('cache mode — drain queue', () => {
  it('drains pending entries in order; onSuccess fires per entry', async () => {
    const upload = fakeUploader();
    const pod = createPseudoPod({
      backend:    createMemoryBackend(),
      mode:       'cache',
      deviceId:   'd',
      podUploader: upload,
      podFetcher:  fakeFetcher(),
      isPodReachable: () => false,
    });
    await pod.write('https://anne.pod/x', 1);
    await pod.write('https://anne.pod/y', 2);
    expect(await pod.writeThroughPendingCount()).toBe(2);

    const seen = [];
    const r = await pod.drainWriteThroughQueue({
      onSuccess: async ({ uri, result }) => { seen.push({ uri, etag: result?.etag }); },
    });
    expect(r.drained).toBe(2);
    expect(r.remaining).toBe(0);
    expect(upload.calls.map(c => c.uri)).toEqual(['https://anne.pod/x', 'https://anne.pod/y']);
    expect(seen).toEqual([
      { uri: 'https://anne.pod/x', etag: '"pod-1"' },
      { uri: 'https://anne.pod/y', etag: '"pod-2"' },
    ]);
  });

  it('drain stops on first upload failure; preserves remaining', async () => {
    const upload = (() => {
      let n = 0;
      return async (uri) => {
        n++;
        if (n === 2) throw new Error('pod down');
        return { etag: `"pod-${n}"` };
      };
    })();
    const backend = createMemoryBackend();
    const pod = createPseudoPod({
      backend,
      mode:       'cache',
      deviceId:   'd',
      podUploader: upload,
      podFetcher:  fakeFetcher(),
      isPodReachable: () => false,
    });
    await pod.write('https://anne.pod/a', 1);
    await pod.write('https://anne.pod/b', 2);
    await pod.write('https://anne.pod/c', 3);

    const r = await pod.drainWriteThroughQueue();
    expect(r.drained).toBe(1);
    expect(r.remaining).toBe(2);
    expect(r.error?.message).toBe('pod down');
  });

  it('drained entries get the pod etag overwriting the local one', async () => {
    const upload = fakeUploader();
    const pod = createPseudoPod({
      backend:    createMemoryBackend(),
      mode:       'cache',
      deviceId:   'd',
      podUploader: upload,
      podFetcher:  fakeFetcher(),
      isPodReachable: () => false,
    });
    await pod.write(POD_URI, { v: 1 });
    expect((await pod.read(POD_URI))?.etag).not.toBe('"pod-1"');
    await pod.drainWriteThroughQueue();
    expect((await pod.read(POD_URI))?.etag).toBe('"pod-1"');
  });

  it('no-op when no uploader is configured', async () => {
    // Non-cache pod has no uploader; drain returns 0.
    const pod = createPseudoPod({
      backend: createMemoryBackend(),
      mode: 'standalone',
      deviceId: 'd',
    });
    const r = await pod.drainWriteThroughQueue();
    expect(r.drained).toBe(0);
  });
});

describe('cache mode — read miss-through', () => {
  it('local hit short-circuits — no fetcher call', async () => {
    const upload = fakeUploader();
    const fetcher = fakeFetcher();
    const pod = createPseudoPod({
      backend:    createMemoryBackend(),
      mode:       'cache',
      deviceId:   'd',
      podUploader: upload,
      podFetcher:  fetcher,
    });
    await pod.write(POD_URI, { x: 1 });
    fetcher.calls.length = 0;
    const rec = await pod.read(POD_URI);
    expect(rec?.bytes).toEqual({ x: 1 });
    expect(fetcher.calls).toHaveLength(0);
  });

  it('miss → fetch from pod + cache the result', async () => {
    const upload = fakeUploader();
    const remoteStore = new Map([
      [POD_URI, { bytes: { text: 'remote' }, etag: '"remote-v1"' }],
    ]);
    const fetcher = fakeFetcher(remoteStore);
    const pod = createPseudoPod({
      backend:    createMemoryBackend(),
      mode:       'cache',
      deviceId:   'd',
      podUploader: upload,
      podFetcher:  fetcher,
    });
    const rec = await pod.read(POD_URI);
    expect(rec?.bytes).toEqual({ text: 'remote' });
    expect(rec?.etag).toBe('"remote-v1"');
    expect(fetcher.calls).toEqual([POD_URI]);

    // Second read is cached — no second fetcher call.
    fetcher.calls.length = 0;
    await pod.read(POD_URI);
    expect(fetcher.calls).toHaveLength(0);
  });

  it('fetcher throws → read returns null (caller retries)', async () => {
    const flaky = async () => { throw new Error('net'); };
    const pod = createPseudoPod({
      backend:    createMemoryBackend(),
      mode:       'cache',
      deviceId:   'd',
      podUploader: fakeUploader(),
      podFetcher:  flaky,
    });
    expect(await pod.read('https://x.pod/missing')).toBe(null);
  });
});

describe('per-URI mode override', () => {
  it('mode() reports global by default', () => {
    const pod = createPseudoPod({
      backend: createMemoryBackend(), mode: 'standalone', deviceId: 'd',
    });
    expect(pod.mode('pseudo-pod://d/x')).toBe('standalone');
  });

  it('setMode pins a URI to a different mode', () => {
    const pod = createPseudoPod({
      backend: createMemoryBackend(), mode: 'standalone', deviceId: 'd',
    });
    pod.setMode('pseudo-pod://d/special', 'replication-ring');
    expect(pod.mode('pseudo-pod://d/special')).toBe('replication-ring');
    expect(pod.mode('pseudo-pod://d/other')).toBe('standalone');
  });

  it('setMode(null) clears the override', () => {
    const pod = createPseudoPod({
      backend: createMemoryBackend(), mode: 'standalone', deviceId: 'd',
    });
    pod.setMode('pseudo-pod://d/x', 'cache');
    pod.setMode('pseudo-pod://d/x', null);
    expect(pod.mode('pseudo-pod://d/x')).toBe('standalone');
  });

  it('rejects invalid modes', () => {
    const pod = createPseudoPod({
      backend: createMemoryBackend(), mode: 'standalone', deviceId: 'd',
    });
    expect(() => pod.setMode('pseudo-pod://d/x', 'wat')).toThrow(/mode/);
    expect(() => pod.setMode('', 'standalone')).toThrow(/uri/);
  });

  it('per-URI cache mode triggers write-through even when global is standalone', async () => {
    const upload = fakeUploader();
    const pod = createPseudoPod({
      backend:    createMemoryBackend(),
      mode:       'standalone',     // global default
      deviceId:   'd',
      podUploader: upload,
      podFetcher:  fakeFetcher(),
    });
    // Pin one URI to cache mode.
    pod.setMode('https://anne.pod/x', 'cache');
    await pod.write('https://anne.pod/x', { v: 1 });
    expect(upload.calls).toHaveLength(1);
  });
});

describe('cache mode — queue persistence', () => {
  it('a fresh substrate on the same backend sees prior pending entries', async () => {
    const backend = createMemoryBackend();
    const upload = fakeUploader();
    const pod1 = createPseudoPod({
      backend,
      mode:       'cache',
      deviceId:   'd',
      podUploader: upload,
      podFetcher:  fakeFetcher(),
      isPodReachable: () => false,
    });
    await pod1.write('https://anne.pod/x', 1);
    expect(await pod1.writeThroughPendingCount()).toBe(1);

    const pod2 = createPseudoPod({
      backend,
      mode:       'cache',
      deviceId:   'd',
      podUploader: upload,
      podFetcher:  fakeFetcher(),
    });
    expect(await pod2.writeThroughPendingCount()).toBe(1);
    const entries = await pod2.listWriteThroughPending();
    expect(entries[0].uri).toBe('https://anne.pod/x');
  });
});

describe('flush(uri)', () => {
  it('uploads a single resource on demand', async () => {
    const upload = fakeUploader();
    const pod = createPseudoPod({
      backend:    createMemoryBackend(),
      mode:       'cache',
      deviceId:   'd',
      podUploader: upload,
      podFetcher:  fakeFetcher(),
      isPodReachable: () => false,
    });
    await pod.write(POD_URI, { v: 1 });
    upload.calls.length = 0;
    // Now force-flush this URI specifically.
    await pod.flush(POD_URI);
    expect(upload.calls).toHaveLength(1);
  });

  it('no-op for non-cache URIs', async () => {
    const pod = createPseudoPod({
      backend: createMemoryBackend(), mode: 'standalone', deviceId: 'd',
    });
    await expect(pod.flush('pseudo-pod://d/x')).resolves.toBeUndefined();
  });
});
