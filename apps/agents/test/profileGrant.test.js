// Identity step 2.3 — grantAgent can NAME a profile (delegate profile X to device D), riding
// the same token-first + registry-mirror path as a skill grant.
import { describe, it, expect, beforeEach } from 'vitest';
import { createPseudoPod, createMemoryBackend } from '@canopy/pseudo-pod';
import { createAgentRegistry } from '@canopy/agent-registry';
import { grantAgent } from '../src/cores.js';

const mkReg = () => createAgentRegistry({
  pseudoPod: createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId: 'd' }),
  deviceId: 'd',
});

describe('grantAgent — profile-scoped delegation (step 2.3)', () => {
  let registry; let issued;
  const tokens = { async issue(opts) { issued.push(opts); return { id: `tok-${issued.length}`, expiresAt: '2026-12-31T00:00:00.000Z' }; } };

  beforeEach(async () => {
    issued = [];
    registry = mkReg();
    await registry.register({ agentId: 'home-gadget', pubKey: 'pub-gadget', agentUri: 'uri:gadget', role: 'device' });
  });

  it('delegates a PROFILE to a device: token carries the profile constraint + grant records it', async () => {
    const res = await grantAgent({ registry, tokens }, { agentId: 'home-gadget', profile: 'home' });
    expect(res.granted).toBe(true);
    expect(issued[0].constraints).toEqual({ profile: 'home' });   // the token is scoped by the profile
    expect(issued[0].skill).toBe('*');                            // any skill, gated by the profile scope
    const grant = (await registry.lookup('home-gadget')).grants.find((g) => g.tokenId === res.tokenId);
    expect(grant.profile).toBe('home');
  });

  it('a plain skill grant still works unchanged (no profile → no constraint)', async () => {
    await grantAgent({ registry, tokens }, { agentId: 'home-gadget', skill: 'tasks.addTask' });
    expect(issued[0].skill).toBe('tasks.addTask');
    expect(issued[0].constraints).toBeUndefined();
    const g = (await registry.lookup('home-gadget')).grants[0];
    expect(g.skill).toBe('tasks.addTask');
    expect(g.profile).toBeNull();
  });

  it('rejects a grant with NEITHER skill nor profile', async () => {
    const res = await grantAgent({ registry, tokens }, { agentId: 'home-gadget' });
    expect(res.granted).toBe(false);
    expect(issued).toHaveLength(0);
  });

  it('the profile grant is revocable through the same registry path', async () => {
    const res = await grantAgent({ registry, tokens }, { agentId: 'home-gadget', profile: 'home' });
    await registry.revokeGrant('home-gadget', res.tokenId);
    const entry = await registry.lookup('home-gadget');
    expect(entry.grants.find((g) => g.tokenId === res.tokenId)).toBeUndefined();
  });
});
