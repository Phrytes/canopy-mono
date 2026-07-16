/**
 * Mobile per-circle pod producers + content-seal strategy (RN parity with web). Drives the
 * REAL sealing substrate (pure-JS tweetnacl/@noble — RN-safe) over an in-memory pseudo-pod
 * + an injected mock AsyncStorage vault. Proves a p2 circle resolves a working seal/open
 * strategy and a p0 circle resolves none (cleartext).
 */
import { describe, it, expect, vi } from 'vitest';
import { initCirclePods, getCircleSealStrategy, setCirclePodSession, getActiveRealPodRouting } from '../src/core/circlePods.js';

function mockAsyncStorage() {
  const m = new Map();
  return {
    getItem: async (k) => (m.has(k) ? m.get(k) : null),
    setItem: async (k, v) => { m.set(k, String(v)); },
    removeItem: async (k) => { m.delete(k); },
  };
}

describe('mobile circlePods', () => {
  it('p2 circle resolves a content seal/open strategy that round-trips', async () => {
    initCirclePods(mockAsyncStorage());
    const strat = await getCircleSealStrategy('mob-p2', { storagePosture: 'p2' });
    expect(strat).toBeTruthy();
    expect(strat.open(strat.seal('hoi kring'))).toBe('hoi kring');
  });

  it('p0 circle → null strategy (cleartext, no sealing)', async () => {
    initCirclePods(mockAsyncStorage());
    const strat = await getCircleSealStrategy('mob-p0', { storagePosture: 'p0' });
    expect(strat).toBeNull();
  });

  it('caches the strategy per circle (stable across calls)', async () => {
    initCirclePods(mockAsyncStorage());
    const a = await getCircleSealStrategy('mob-cache', { storagePosture: 'p2' });
    const b = await getCircleSealStrategy('mob-cache', { storagePosture: 'p2' });
    expect(a).toBe(b);
  });

  // RN authenticated-fetch unblock: a signed-in OidcSessionRN routes sealed circles to the real pod.
  it('no session → no real-pod routing (pseudo-pod path)', () => {
    setCirclePodSession(null);
    expect(getActiveRealPodRouting()).toBeNull();
  });

  it('authenticated OidcSessionRN → real-pod routing using the session\'s authenticated fetch', () => {
    const fetch = vi.fn();
    const session = {
      isAuthenticated: () => true,
      webid: 'https://me.pod/profile/card#me',
      getAuthenticatedFetch: () => fetch,
    };
    setCirclePodSession({ current: session });           // App-owned ref shape
    const r = getActiveRealPodRouting();
    expect(r).toBeTruthy();
    expect(r.podRoot).toBe('https://me.pod/');
    expect(r.circleRootUri('c1')).toBe('https://me.pod/circles/c1');
    // the producer's pod client is built over the session's fetch (not the pseudo-pod)
    expect(r.makePodClient('c1')).toBeTruthy();
    setCirclePodSession(null);                            // reset for other tests
  });

  it('not-authenticated session → null (falls back to pseudo-pod)', () => {
    setCirclePodSession({ current: { isAuthenticated: () => false, webid: null, getAuthenticatedFetch: () => {} } });
    expect(getActiveRealPodRouting()).toBeNull();
    setCirclePodSession(null);
  });
});
