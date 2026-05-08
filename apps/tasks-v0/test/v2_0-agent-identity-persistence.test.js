/**
 * V2.0 — tasks-agent identity persistence.
 *
 * Asserts:
 *   - createCrewAgent persists the tasks agent's vault under
 *     mem://tasks/crews/<crewId>/agent/identity-vault.json on first boot.
 *   - A second createCrewAgent against the same local-store cache
 *     restores the vault → same pubKey, deviceId, stableId.
 *   - Multi-crew: two crews on the same shared store get DIFFERENT
 *     identities (per-crew path scheme prevents collisions).
 *   - When `identity` is supplied externally (tests + CLI override),
 *     the persistence path is skipped.
 */

import { describe, it, expect } from 'vitest';

import { AgentIdentity, VaultMemory } from '@canopy/core';

import { buildBundle } from '../src/storage/buildBundle.js';
import { createCrewAgent } from '../src/Crew.js';

const CREW_A = {
  crewId:  'crew-a',
  name:    'Crew A',
  kind:    'project',
  members: [{ webid: 'https://id.example/anne', displayName: 'Anne', role: 'admin' }],
};
const CREW_B = {
  crewId:  'crew-b',
  name:    'Crew B',
  kind:    'project',
  members: [{ webid: 'https://id.example/anne', displayName: 'Anne', role: 'admin' }],
};

describe('V2.0 — tasks-agent identity persistence', () => {
  it('persists vault on first boot; restores it on the second', async () => {
    const sharedStore = new Map();

    // Boot 1.
    const bundle1 = buildBundle({ localStore: sharedStore });
    const crew1 = await createCrewAgent({
      crewConfig:           CREW_A,
      localStoreBundle:     bundle1,
      wireOnboardingSkills: false,
    });
    const pubKey1   = crew1.agent.pubKey;
    const deviceId1 = crew1.agent.identity.deviceId;
    const stableId1 = crew1.agent.identity.stableId;
    await crew1.close();

    // Persistent blob lives at the convention path.
    expect(sharedStore.has('mem://tasks/crews/crew-a/agent/identity-vault.json')).toBe(true);

    // Boot 2 — same store.
    const bundle2 = buildBundle({ localStore: sharedStore });
    const crew2 = await createCrewAgent({
      crewConfig:           CREW_A,
      localStoreBundle:     bundle2,
      wireOnboardingSkills: false,
    });
    expect(crew2.agent.pubKey).toBe(pubKey1);
    expect(crew2.agent.identity.deviceId).toBe(deviceId1);
    expect(crew2.agent.identity.stableId).toBe(stableId1);
    await crew2.close();
  });

  it('multi-crew on same store keeps identities isolated', async () => {
    const sharedStore = new Map();

    const bundleA = buildBundle({ localStore: sharedStore });
    const crewA   = await createCrewAgent({
      crewConfig:           CREW_A,
      localStoreBundle:     bundleA,
      wireOnboardingSkills: false,
    });
    const bundleB = buildBundle({ localStore: sharedStore });
    const crewB   = await createCrewAgent({
      crewConfig:           CREW_B,
      localStoreBundle:     bundleB,
      wireOnboardingSkills: false,
    });

    expect(crewA.agent.pubKey).not.toBe(crewB.agent.pubKey);
    expect(sharedStore.has('mem://tasks/crews/crew-a/agent/identity-vault.json')).toBe(true);
    expect(sharedStore.has('mem://tasks/crews/crew-b/agent/identity-vault.json')).toBe(true);

    await crewA.close();
    await crewB.close();
  });

  it('external identity override skips the persistence path', async () => {
    const sharedStore = new Map();
    const v   = new VaultMemory();
    const id  = await AgentIdentity.generate(v);

    const bundle = buildBundle({ localStore: sharedStore });
    const crew   = await createCrewAgent({
      crewConfig:           CREW_A,
      localStoreBundle:     bundle,
      identity:             id,
      vault:                v,
      wireOnboardingSkills: false,
    });
    expect(crew.agent.pubKey).toBe(id.pubKey);
    // Did NOT persist a snapshot because identity was supplied.
    expect(sharedStore.has('mem://tasks/crews/crew-a/agent/identity-vault.json')).toBe(false);
    await crew.close();
  });
});
