/**
 * createPodOnboarding — facade-level wiring.
 */

import { describe, it, expect } from 'vitest';
import { generateMnemonic } from '@onderling/core';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createPodOnboarding } from '../src/PodOnboarding.js';

const ANNE_POD   = 'https://anne.pod';
const ANNE_WEBID = 'https://anne.pod/profile/card#me';

function minimalProvisioner() {
  const calls = [];
  return {
    calls,
    async createPod(args) { calls.push({ name: 'createPod', args }); return { podUri: ANNE_POD, webidUri: ANNE_WEBID, fetch: () => {} }; },
    async createContainer(args) { calls.push({ name: 'createContainer', args }); },
    async setAcp(args) { calls.push({ name: 'setAcp', args }); },
    async putResource(args) { calls.push({ name: 'putResource', args }); },
    async patchWebidProfile(args) { calls.push({ name: 'patchWebidProfile', args }); },
  };
}

describe('createPodOnboarding — facade', () => {
  it('threads injected deps into each operation', async () => {
    const pseudoPod = createPseudoPod({
      backend: createMemoryBackend(), mode: 'standalone', deviceId: 'laptop-anne',
    });
    const prov = minimalProvisioner();
    const ob = createPodOnboarding({
      pseudoPod,
      podProvisioner: prov,
      deviceId:       'laptop-anne',
    });

    const result = await ob.provisionDefault({
      mnemonic: generateMnemonic(),
      agentInfo: { deviceId: 'laptop-anne', agentUri: 'agent://anne/laptop' },
    });
    expect(result.podUri).toBe(ANNE_POD);
    expect(prov.calls.find(c => c.name === 'createPod')).toBeTruthy();
  });

  it('per-call opts override facade defaults', async () => {
    const facadePod = createPseudoPod({
      backend: createMemoryBackend(), mode: 'standalone', deviceId: 'facade',
    });
    const explicitPod = createPseudoPod({
      backend: createMemoryBackend(), mode: 'standalone', deviceId: 'explicit',
    });
    const ob = createPodOnboarding({
      pseudoPod:      facadePod,
      podProvisioner: minimalProvisioner(),
      deviceId:       'facade',
    });
    const result = await ob.provisionDefault({
      pseudoPod: explicitPod,
      mnemonic:  generateMnemonic(),
      agentInfo: { deviceId: 'explicit', agentUri: 'a' },
    });
    expect(result.podUri).toBe(ANNE_POD);
    // explicitPod should have the mirror entries; facadePod should not.
    expect((await explicitPod.read('pseudo-pod://explicit/private/storage-mapping'))?.bytes)
      .toBeTruthy();
    expect(await facadePod.read('pseudo-pod://facade/private/storage-mapping'))
      .toBe(null);
  });
});

describe('upgradeToTwoPods', () => {
  it('throws NOT_IMPLEMENTED in V0', async () => {
    const ob = createPodOnboarding({});
    await expect(ob.upgradeToTwoPods()).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });
});

describe('defaultAcpTemplates re-export', () => {
  it('builds templates from the facade', () => {
    const ob = createPodOnboarding({});
    const t = ob.defaultAcpTemplates({ agentWebid: ANNE_WEBID });
    expect(t.private.template).toBe('private');
  });
});
