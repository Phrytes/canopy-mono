/**
 * bootstrapBundle smoke — `_bootstrap` agent boots and exposes the
 * full Stoop skill bus, so onboarding screens have a working
 * `useSkill('createGroupV2' | 'redeemMembershipCode' |
 * 'restoreFromMnemonic')` before the user has a real group.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '@canopy/core';
import { VaultMemory } from '@canopy/vault';

import { buildBootstrapBundle, BOOTSTRAP_GROUP_ID } from '../src/lib/bootstrapBundle.js';
import { relabelBundleGroup } from '../src/lib/agentBundle.js';

describe('buildBootstrapBundle', () => {
  it('builds a working agent against the placeholder group', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const bundle = await buildBootstrapBundle({ identity });
    try {
      expect(bundle.isBootstrap).toBe(true);
      expect(bundle.agent).toBeTruthy();
      expect(typeof bundle.agent.invoke).toBe('function');
      expect(bundle.skillMatch).toBeTruthy();
      expect(bundle.itemStore).toBeTruthy();
      expect(bundle.members).toBeTruthy();
    } finally {
      await bundle.stop?.();
    }
  });

  it('createGroupV2 dispatches against the bootstrap agent', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const bundle   = await buildBootstrapBundle({ identity });
    try {
      const me = bundle.agent.address ?? bundle.agent.identity?.pubKey;
      const parts = await bundle.agent.invoke(me, 'createGroupV2', [{
        type: 'DataPart',
        data: {
          groupId: 'oosterpoort-test',
          name:    'Oosterpoort Test',
          rules:   {},
        },
      }]);
      const data = Array.isArray(parts) ? parts[0]?.data : parts;
      expect(data?.error).toBeUndefined();
      expect(data?.groupId).toBe('oosterpoort-test');
      expect(typeof data?.code).toBe('string');
    } finally {
      await bundle.stop?.();
    }
  });

  it('relabelBundleGroup swaps SkillMatch onto a new groupId in place', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const bundle   = await buildBootstrapBundle({ identity });
    try {
      const me = bundle.agent.address ?? bundle.agent.identity?.pubKey;
      // Write something first so we can prove state survives.
      await bundle.agent.invoke(me, 'createGroupV2', [{
        type: 'DataPart',
        data: { groupId: 'real-group', name: 'Real', rules: {} },
      }]);

      const originalSkillMatch = bundle.skillMatch;
      const same = await relabelBundleGroup({
        bundle,
        newGroupId: 'real-group',
        localActor: `webid:local:${identity.pubKey}`,
      });
      expect(same).toBe(bundle);
      expect(same.skillMatch).not.toBe(originalSkillMatch);
      expect(same.agent).toBe(bundle.agent);
    } finally {
      await bundle.stop?.();
    }
  });
});
