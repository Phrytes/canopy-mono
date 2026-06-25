// Mobile feedback activation → verify-summary pods (parity with web's buildFeedbackVerifyPods wiring).
import { describe, it, expect } from 'vitest';
import { getOrCreateRecoveryHashRN, sessionShim, activateMobileFeedback } from '../src/v2/feedbackActivation.js';
import { PodRoundControl } from '../../feedback-pipeline/src/verify/round-control.js';

function memStorage() {
  const m = new Map();
  return { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => { m.set(k, String(v)); } };
}
const activation = async () => ({ ok: true, json: async () => ({ ok: true, podRef: 'http://h:3000/project/central/alice/' }) });
const liveSession = () => ({ isAuthenticated: () => true, webid: 'http://h:3000/alice/profile/card#me', getAuthenticatedFetch: () => (async () => ({ ok: true })) });

describe('feedbackActivation (mobile)', () => {
  it('getOrCreateRecoveryHashRN is a stable 64-hex digest that persists its secret', async () => {
    const s = memStorage();
    const h1 = await getOrCreateRecoveryHashRN(s);
    const h2 = await getOrCreateRecoveryHashRN(s);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);                                  // same stored secret → same hash
    expect(await s.getItem('fp.recovery')).toBeTruthy();  // secret kept on device
  });

  it('sessionShim: null when not logged in, a {fetch,webid} shim when authenticated', () => {
    expect(sessionShim(null)).toBe(null);
    expect(sessionShim({ isAuthenticated: () => false, webid: 'x' })).toBe(null);
    const fetchFn = async () => {};
    const shim = sessionShim({ isAuthenticated: () => true, webid: 'http://h/alice/profile/card#me', getAuthenticatedFetch: () => fetchFn });
    expect(shim).toEqual({ fetch: fetchFn, webid: 'http://h/alice/profile/card#me' });
  });

  it('activateMobileFeedback throws not-logged-in without a pod session', async () => {
    await expect(activateMobileFeedback({ session: null, activationUrl: 'http://h/activate', projectId: 'demo', code: 'c', storage: memStorage() }))
      .rejects.toThrow('not-logged-in');
  });

  it('activateMobileFeedback returns own/central/control pods from the session', async () => {
    const pods = await activateMobileFeedback({
      session: liveSession(), activationUrl: 'http://h:3000/activate', projectId: 'demo', code: 'c',
      storage: memStorage(), fetchImpl: activation,
    });
    expect(pods.ownPod).toBeTruthy();
    expect(pods.centralPod).toBeTruthy();
    expect(pods.ownPod).not.toBe(pods.centralPod);        // own ≠ central — own-pod-first
    expect(pods.controlStore).toBeInstanceOf(PodRoundControl);
  });
});
