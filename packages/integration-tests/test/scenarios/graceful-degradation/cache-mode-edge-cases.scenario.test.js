/**
 * Scenario: graceful-degradation/cache-mode-edge-cases
 *
 * Phase 52.9.4 (partial) + P3 graceful-degradation test matrix
 * — the third axis of the substrates-v2 integration harness.
 *
 * The pod-having + no-pod matrices live in
 * `substrates-v2/substrate-pipeline.scenario.test.js` (happy paths).
 * This scenario adds the EDGE CASES around online/offline
 * transitions:
 *
 *   1. Sequential offline writes — multiple queue entries; order
 *      preserved during drain.
 *   2. Pending-queue persistence — substrate restarts from the same
 *      backend; queued writes survive.
 *   3. Partial drain failure — uploader fails on one entry mid-drain;
 *      remaining entries stay queued; retry on next drain.
 *   4. Online → offline mid-batch — multiple writes while reachable
 *      flap unreachable mid-batch; later writes queue cleanly.
 *   5. Notify-envelope re-emit on drain — pod-having full-payload
 *      write while offline → envelope queued → reconnect drain →
 *      envelope-only re-emit so peers can promote cached copies.
 *
 * The substrate primitives under test are real; only the pod-server
 * surrogate (read/write) and the transport are mocked.
 *
 * Phase 52.9.4 (2026-05-14).
 */

import { describe, it, expect } from 'vitest';

import { createPseudoPod, createMemoryBackend } from '@canopy/pseudo-pod';
import { createPodRouting }                     from '@canopy/pod-routing';
import { createNotifyEnvelope }                 from '@canopy/notify-envelope';

const ANNE_POD   = 'https://anne.pod';
const DEVICE_ID  = 'laptop-anne';
const ANNE_AGENT = 'agent://anne/laptop';

/** Fake "real pod" surrogate. Each operation is logged so tests
 *  can assert ordering + counts. Can fail on demand:
 *    failAfter(n)  — succeed for n calls, then fail the next, then succeed again.
 */
function fakeRealPod() {
  /** @type {Map<string, {bytes: *, etag: string}>} */
  const store = new Map();
  let etagCounter = 0;
  const calls = [];
  let succeedRemaining = Infinity;   // calls that succeed before the next failure
  let pendingFailures  = 0;          // how many failures to inject after succeedRemaining
  return {
    store, calls,
    /** Pass `n` successes through, then fail once, then succeed again. */
    failAfter(n) { succeedRemaining = n; pendingFailures = 1; },
    async fetcher(uri) {
      calls.push({ op: 'read', uri });
      return store.has(uri) ? { bytes: store.get(uri).bytes, etag: store.get(uri).etag } : null;
    },
    async uploader(uri, bytes) {
      if (succeedRemaining > 0) {
        succeedRemaining--;
      } else if (pendingFailures > 0) {
        pendingFailures--;
        succeedRemaining = Infinity;
        calls.push({ op: 'write-failed', uri });
        throw Object.assign(new Error('mock pod 503'), { code: 'SERVER_ERROR' });
      }
      calls.push({ op: 'write', uri });
      const etag = `"pod-${++etagCounter}"`;
      store.set(uri, { bytes, etag });
      return { etag };
    },
  };
}

/** Build a cache-mode pseudo-pod against a fakeRealPod, gated by
 *  pod-routing reachability. */
function buildCachePod({ backend, realPod, podRouting }) {
  return createPseudoPod({
    backend,
    mode:           'cache',
    deviceId:       DEVICE_ID,
    podFetcher:     realPod.fetcher,
    podUploader:    realPod.uploader,
    isPodReachable: (uri) => podRouting.isPodReachable(uri),
  });
}

describe('graceful-degradation — cache-mode edge cases', () => {
  it('1. Sequential offline writes drain in queue-order', async () => {
    const backend    = createMemoryBackend();
    const pseudoPod  = createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId: DEVICE_ID });
    const podRouting = createPodRouting({ pseudoPod, deviceId: DEVICE_ID, anchorPodUri: ANNE_POD });
    await podRouting.reload();
    const realPod    = fakeRealPod();
    const cachePod   = buildCachePod({ backend, realPod, podRouting });

    const uris = [
      'https://anne.pod/sharing/tasks/1.ttl',
      'https://anne.pod/sharing/tasks/2.ttl',
      'https://anne.pod/sharing/tasks/3.ttl',
    ];

    // Mark each URI unreachable up-front (pod-routing keys
    // reachability per-URI).
    for (const uri of uris) podRouting.markPodUnreachable(uri);

    // Three sequential writes while offline → all queue.
    for (const uri of uris) {
      const w = await cachePod.write(uri, { id: uri, addedBy: ANNE_AGENT });
      expect(w.queued).toBe(true);
    }
    expect(await cachePod.writeThroughPendingCount()).toBe(3);
    // No uploads attempted yet.
    expect(realPod.calls.filter(c => c.op === 'write')).toHaveLength(0);

    // Reconnect + drain. All three should upload, in queue order.
    for (const uri of uris) podRouting.markPodReachable(uri);
    const drain = await cachePod.drainWriteThroughQueue();
    expect(drain.drained).toBe(3);
    expect(await cachePod.writeThroughPendingCount()).toBe(0);

    const writeOps = realPod.calls.filter(c => c.op === 'write').map(c => c.uri);
    expect(writeOps).toEqual(uris);   // order preserved
  });

  it('2. Pending queue persists across substrate restart', async () => {
    const backend    = createMemoryBackend();
    const pseudoPod  = createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId: DEVICE_ID });
    const podRouting = createPodRouting({ pseudoPod, deviceId: DEVICE_ID, anchorPodUri: ANNE_POD });
    await podRouting.reload();
    const realPod    = fakeRealPod();
    let cachePod     = buildCachePod({ backend, realPod, podRouting });

    const uri = 'https://anne.pod/sharing/tasks/persistent.ttl';
    podRouting.markPodUnreachable(uri);
    await cachePod.write(uri, { id: 'persistent', addedBy: ANNE_AGENT });
    expect(await cachePod.writeThroughPendingCount()).toBe(1);

    // "Restart" — discard the cachePod instance but keep the backend.
    // A fresh substrate against the same backend must see the
    // pending entry.
    cachePod = buildCachePod({ backend, realPod, podRouting });
    expect(await cachePod.writeThroughPendingCount()).toBe(1);

    // Reconnect + drain after restart.
    podRouting.markPodReachable(uri);
    const drain = await cachePod.drainWriteThroughQueue();
    expect(drain.drained).toBe(1);
    expect(realPod.store.has(uri)).toBe(true);
  });

  it('3. Partial drain failure: surviving entries stay queued, retry succeeds', async () => {
    const backend    = createMemoryBackend();
    const pseudoPod  = createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId: DEVICE_ID });
    const podRouting = createPodRouting({ pseudoPod, deviceId: DEVICE_ID, anchorPodUri: ANNE_POD });
    await podRouting.reload();
    const realPod    = fakeRealPod();
    const cachePod   = buildCachePod({ backend, realPod, podRouting });

    const uris = [
      'https://anne.pod/sharing/tasks/a.ttl',
      'https://anne.pod/sharing/tasks/b.ttl',
      'https://anne.pod/sharing/tasks/c.ttl',
    ];
    for (const uri of uris) podRouting.markPodUnreachable(uri);
    for (const uri of uris) {
      await cachePod.write(uri, { id: uri, addedBy: ANNE_AGENT });
    }
    expect(await cachePod.writeThroughPendingCount()).toBe(3);

    // First drain: succeed once (a), fail second (b), drain stops.
    for (const uri of uris) podRouting.markPodReachable(uri);
    realPod.failAfter(1);            // a succeeds, b fails, c not attempted
    realPod.calls.length = 0;

    const drain1 = await cachePod.drainWriteThroughQueue();
    expect(realPod.calls.filter(c => c.op === 'write')).toHaveLength(1);
    expect(realPod.calls.filter(c => c.op === 'write-failed')).toHaveLength(1);
    expect(drain1.drained).toBe(1);
    expect(await cachePod.writeThroughPendingCount()).toBe(2);

    // Second drain: no failures injected. b + c both upload.
    realPod.calls.length = 0;
    const drain2 = await cachePod.drainWriteThroughQueue();
    expect(drain2.drained).toBe(2);
    expect(await cachePod.writeThroughPendingCount()).toBe(0);
    expect(realPod.calls.filter(c => c.op === 'write').map(c => c.uri))
      .toEqual([uris[1], uris[2]]);   // b then c, in original order
  });

  it('4. Online → offline mid-batch: later writes queue cleanly', async () => {
    const backend    = createMemoryBackend();
    const pseudoPod  = createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId: DEVICE_ID });
    const podRouting = createPodRouting({ pseudoPod, deviceId: DEVICE_ID, anchorPodUri: ANNE_POD });
    await podRouting.reload();
    const realPod    = fakeRealPod();
    const cachePod   = buildCachePod({ backend, realPod, podRouting });

    const u1 = 'https://anne.pod/sharing/tasks/1.ttl';
    const u2 = 'https://anne.pod/sharing/tasks/2.ttl';
    const u3 = 'https://anne.pod/sharing/tasks/3.ttl';
    const u4 = 'https://anne.pod/sharing/tasks/4.ttl';

    // Start online — pod-routing's unknown-key default is
    // "reachable", so initial writes go through immediately.
    const w1 = await cachePod.write(u1, { id: '1', addedBy: ANNE_AGENT });
    const w2 = await cachePod.write(u2, { id: '2', addedBy: ANNE_AGENT });
    expect(w1.queued).toBeUndefined();
    expect(w2.queued).toBeUndefined();
    expect(realPod.calls.filter(c => c.op === 'write')).toHaveLength(2);

    // Pod goes unreachable for u3/u4. markUnreachable stamps
    // `lastFailure` with no `lastSuccess` → isReachable returns
    // false (freshFailure && !freshSuccess).
    podRouting.markPodUnreachable(u3);
    podRouting.markPodUnreachable(u4);
    const w3 = await cachePod.write(u3, { id: '3', addedBy: ANNE_AGENT });
    const w4 = await cachePod.write(u4, { id: '4', addedBy: ANNE_AGENT });
    expect(w3.queued).toBe(true);
    expect(w4.queued).toBe(true);
    expect(await cachePod.writeThroughPendingCount()).toBe(2);

    // Reconnect — markReachable now stamps `lastSuccess`, which
    // wins over `lastFailure` in pod-routing's isReachable.
    podRouting.markPodReachable(u3);
    podRouting.markPodReachable(u4);
    const drain = await cachePod.drainWriteThroughQueue();
    expect(drain.drained).toBe(2);
    expect(realPod.calls.filter(c => c.op === 'write')).toHaveLength(4);
  });

  it('5. Notify-envelope re-emits envelope-only on drain (peers can promote)', async () => {
    const backend    = createMemoryBackend();
    const pseudoPod  = createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId: DEVICE_ID });
    const podRouting = createPodRouting({ pseudoPod, deviceId: DEVICE_ID, anchorPodUri: ANNE_POD });
    await podRouting.reload();
    const realPod    = fakeRealPod();
    const cachePod   = buildCachePod({ backend, realPod, podRouting });

    // Notify-envelope sits over the cache pseudo-pod + a fake
    // transport. Apps would use this to publish writes; the
    // substrate decides envelope-only vs full-payload via the
    // pickMode logic (reachability gate).
    const sent = [];
    const fakeTransport = {
      async publishEnvelope(env) { sent.push(env); },
      subscribeEnvelopes(_cb)    { return () => {}; },
    };
    // notify-envelope.publish doesn't write through the cache pod
    // itself — the app calls cachePod.write separately. That's the
    // pattern from substrate-pipeline.scenario. We replicate it
    // here to exercise the full degradation path.
    const ne = createNotifyEnvelope({
      transport: fakeTransport,
      pseudoPod: cachePod,
      podRouting,
      uploadFn: async (entry) => {
        // entry shape: { uri, payload, etag, type, recipients, fromActor, crewId }
        // For this test, we delegate to realPod.uploader so we share
        // the same fake pod state.
        return realPod.uploader(entry.uri, entry.payload, entry.etag);
      },
    });
    ne.start();

    // Go offline. Write a resource locally + publish via notify-
    // envelope. Picker mode: full-payload (pod unreachable) → queued.
    const taskUri = 'https://anne.pod/sharing/tasks/foo.ttl';
    podRouting.markPodUnreachable(taskUri);
    const w = await cachePod.write(taskUri, { type: 'task', text: 'paint' });
    expect(w.queued).toBe(true);

    const result = await ne.publish({
      type:       'task',
      ref:        taskUri,
      payload:    { type: 'task', text: 'paint' },
      etag:       w.etag,
      recipients: ['agent://bob'],
      fromActor:  ANNE_AGENT,
    });
    expect(result.mode).toBe('full-payload');
    expect(result.queued).toBe(true);
    // The first envelope went out full-payload to peers (best-effort).
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toBeTruthy();

    // Reconnect. Drain notify-envelope's queue → uploads + re-emits
    // envelope-only so peers can promote their cached copy from
    // "ring-cached" to "pod-canonical."
    podRouting.markPodReachable(taskUri);
    const drained = await ne.drainQueue();
    expect(drained.drained).toBe(1);

    // Two envelopes total: the original full-payload + the
    // re-emit envelope-only.
    expect(sent).toHaveLength(2);
    expect(sent[1].payload).toBeUndefined();   // envelope-only
    expect(sent[1].ref).toBe(taskUri);
    expect(sent[1].kind).toBe('task');

    ne.stop();
  });
});
