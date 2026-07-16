// Verify-summary loop — wiring the surface's pods from the activation session (own-pod-first).
import { describe, it, expect } from 'vitest';
import { podRootFromWebId, buildFeedbackVerifyPods } from '../../src/feedback/feedbackPod.js';
import { PodRoundControl } from 'onderling-feedback/public';

const session = { webid: 'http://h:3000/alice/profile/card#me', fetch: async () => ({ ok: true }) };
const activation = async () => ({ ok: true, json: async () => ({ ok: true, podRef: 'http://h:3000/project/central/alice/' }) });

describe('feedback verify-pods wiring', () => {
  it('podRootFromWebId derives the pod root from a CSS WebID', () => {
    expect(podRootFromWebId('http://h:3000/alice/profile/card#me')).toBe('http://h:3000/alice/');
    expect(podRootFromWebId('https://pods.example/u123/profile/card#me')).toBe('https://pods.example/u123/');
  });

  it('returns own + central pods and a pod-backed control store from the session', async () => {
    const { ownPod, centralPod, controlStore } = await buildFeedbackVerifyPods({
      session, activationUrl: 'http://h:3000/activate', projectId: 'demo', code: 'c', recoveryHash: 'rh', fetchImpl: activation,
    });
    expect(ownPod).toBeTruthy();            // a container on the participant's OWN pod (raw stays)
    expect(centralPod).toBeTruthy();        // the activation container (verified summary lands here)
    expect(controlStore).toBeInstanceOf(PodRoundControl);
    expect(ownPod).not.toBe(centralPod);    // own ≠ central — the own-pod-first split
  });

  it('respects an explicit ownPodBase override', async () => {
    const { ownPod } = await buildFeedbackVerifyPods({
      session, activationUrl: 'http://h/activate', projectId: 'demo', code: 'c', recoveryHash: 'rh',
      fetchImpl: activation, ownPodBase: 'http://h:3000/alice/custom-own/',
    });
    expect(ownPod).toBeTruthy();
  });

  it('requires a logged-in session', async () => {
    await expect(buildFeedbackVerifyPods({ activationUrl: 'http://h/activate', projectId: 'demo', code: 'c' }))
      .rejects.toThrow(/logged-in session/);
  });
});
