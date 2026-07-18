/**
 * tasks-agent identity persistence.
 *
 * Asserts:
 *   - createCircleAgent persists the tasks agent's vault under
 *     mem://tasks/circles/<circleId>/agent/identity-vault.json on first boot.
 *   - A second createCircleAgent against the same local-store cache
 *     restores the vault → same pubKey, deviceId, stableId.
 *   - Multi-circle: two circles on the same shared store get DIFFERENT
 *     identities (per-circle path scheme prevents collisions).
 *   - When `identity` is supplied externally (tests + CLI override),
 *     the persistence path is skipped.
 */

import { describe, it, expect } from 'vitest';

import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { buildBundle } from '../src/storage/buildBundle.js';
import { createCircleAgent } from '../src/Circle.js';

const CIRCLE_A = {
  circleId:  'circle-a',
  name:    'Circle A',
  kind:    'project',
  members: [{ webid: 'https://id.example/anne', displayName: 'Anne', role: 'admin' }],
};
const CIRCLE_B = {
  circleId:  'circle-b',
  name:    'Circle B',
  kind:    'project',
  members: [{ webid: 'https://id.example/anne', displayName: 'Anne', role: 'admin' }],
};

describe('V2.0 — tasks-agent identity persistence', () => {
  it('persists vault on first boot; restores it on the second', async () => {
    const sharedStore = new Map();

    // Boot 1.
    const bundle1 = buildBundle({ localStore: sharedStore });
    const circle1 = await createCircleAgent({
      circleConfig:           CIRCLE_A,
      localStoreBundle:     bundle1,
      wireOnboardingSkills: false,
    });
    const pubKey1   = circle1.agent.pubKey;
    const deviceId1 = circle1.agent.identity.deviceId;
    const stableId1 = circle1.agent.identity.stableId;
    await circle1.close();

    // Persistent blob lives at the convention path.
    expect(sharedStore.has('mem://tasks/circles/circle-a/agent/identity-vault.json')).toBe(true);

    // Boot 2 — same store.
    const bundle2 = buildBundle({ localStore: sharedStore });
    const circle2 = await createCircleAgent({
      circleConfig:           CIRCLE_A,
      localStoreBundle:     bundle2,
      wireOnboardingSkills: false,
    });
    expect(circle2.agent.pubKey).toBe(pubKey1);
    expect(circle2.agent.identity.deviceId).toBe(deviceId1);
    expect(circle2.agent.identity.stableId).toBe(stableId1);
    await circle2.close();
  });

  it('multi-circle on same store keeps identities isolated', async () => {
    const sharedStore = new Map();

    const bundleA = buildBundle({ localStore: sharedStore });
    const circleA   = await createCircleAgent({
      circleConfig:           CIRCLE_A,
      localStoreBundle:     bundleA,
      wireOnboardingSkills: false,
    });
    const bundleB = buildBundle({ localStore: sharedStore });
    const circleB   = await createCircleAgent({
      circleConfig:           CIRCLE_B,
      localStoreBundle:     bundleB,
      wireOnboardingSkills: false,
    });

    expect(circleA.agent.pubKey).not.toBe(circleB.agent.pubKey);
    expect(sharedStore.has('mem://tasks/circles/circle-a/agent/identity-vault.json')).toBe(true);
    expect(sharedStore.has('mem://tasks/circles/circle-b/agent/identity-vault.json')).toBe(true);

    await circleA.close();
    await circleB.close();
  });

  it('external identity override skips the persistence path', async () => {
    const sharedStore = new Map();
    const v   = new VaultMemory();
    const id  = await AgentIdentity.generate(v);

    const bundle = buildBundle({ localStore: sharedStore });
    const circle   = await createCircleAgent({
      circleConfig:           CIRCLE_A,
      localStoreBundle:     bundle,
      identity:             id,
      vault:                v,
      wireOnboardingSkills: false,
    });
    expect(circle.agent.pubKey).toBe(id.pubKey);
    // Did NOT persist a snapshot because identity was supplied.
    expect(sharedStore.has('mem://tasks/circles/circle-a/agent/identity-vault.json')).toBe(false);
    await circle.close();
  });
});
