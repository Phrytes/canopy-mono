/**
 * Group-visible skills (Group X).
 *
 * Covers:
 *   • defineSkill validation of the new visibility shape
 *   • SkillRegistry.forCaller filtering (tier + group paths)
 *   • Agent.export() caller-aware filter
 *   • handleTaskRequest: non-members get `Unknown skill`, not `not-authorised`
 *   • skillDiscovery filters per caller
 *   • Backward-compat: scalar visibility still works
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { defineSkill, normaliseVisibility }  from '../src/skills/defineSkill.js';
import { SkillRegistry }                     from '../src/skills/SkillRegistry.js';
import { Agent }                             from '../src/Agent.js';
import { AgentIdentity }                     from '../src/identity/AgentIdentity.js';
import { VaultMemory }                       from '../src/identity/VaultMemory.js';
import { SecurityLayer }                     from '../src/security/SecurityLayer.js';
import { InternalBus, InternalTransport }    from '../src/transport/InternalTransport.js';
import { requestSkills }                     from '../src/protocol/skillDiscovery.js';

// ── defineSkill shape validation ─────────────────────────────────────────────

describe('defineSkill — visibility validation', () => {
  it('accepts legacy tier strings', () => {
    const s = defineSkill('a', async () => {}, { visibility: 'public' });
    expect(s.visibility).toBe('public');
  });

  it('accepts { groups, default } objects', () => {
    const s = defineSkill('a', async () => {}, {
      visibility: { groups: ['ops'], default: 'visible' },
    });
    expect(s.visibility).toEqual({ groups: ['ops'], default: 'visible' });
  });

  it('defaults default-mode to hidden', () => {
    const s = defineSkill('a', async () => {}, {
      visibility: { groups: ['ops'] },
    });
    expect(s.visibility).toEqual({ groups: ['ops'], default: 'hidden' });
  });

  it('rejects unknown tiers', () => {
    expect(() => defineSkill('a', async () => {}, { visibility: 'cosmic' }))
      .toThrow(/unknown visibility tier/);
  });

  it('rejects empty groups array', () => {
    expect(() => defineSkill('a', async () => {}, { visibility: { groups: [] } }))
      .toThrow(/visibility\.groups must be non-empty/);
  });

  it('rejects bad default-mode', () => {
    expect(() => defineSkill('a', async () => {}, {
      visibility: { groups: ['x'], default: 'maybe' },
    })).toThrow(/visibility\.default must be/);
  });
});

describe('normaliseVisibility', () => {
  it('returns tier form for strings', () => {
    expect(normaliseVisibility('public')).toEqual({ kind: 'tier', tier: 'public' });
  });

  it('defaults undefined to authenticated', () => {
    expect(normaliseVisibility(undefined)).toEqual({ kind: 'tier', tier: 'authenticated' });
  });

  it('returns group form for objects', () => {
    expect(normaliseVisibility({ groups: ['a', 'b'] }))
      .toEqual({ kind: 'groups', groups: ['a', 'b'], default: 'hidden' });
  });
});

// ── SkillRegistry.forCaller ──────────────────────────────────────────────────

describe('SkillRegistry.forCaller', () => {
  let registry;

  beforeEach(() => {
    registry = new SkillRegistry();
    registry.register('public-skill',        async () => {}, { visibility: 'public' });
    registry.register('auth-skill',          async () => {}, { visibility: 'authenticated' });
    registry.register('private-skill',       async () => {}, { visibility: 'private' });
    registry.register('ops-hidden',          async () => {}, { visibility: { groups: ['ops'], default: 'hidden' } });
    registry.register('ops-visible',         async () => {}, { visibility: { groups: ['ops'], default: 'visible' } });
  });

  it('returns tier-allowed skills when no group check is provided', async () => {
    const skills = await registry.forCaller({ tier: 'authenticated' });
    const ids = skills.map(s => s.id).sort();
    // public + auth + ops-visible (default). Hidden group skill excluded.
    expect(ids).toEqual(['auth-skill', 'ops-visible', 'public-skill']);
  });

  it('includes group-hidden skills for valid members', async () => {
    const checkGroup = async (_pk, gid) => gid === 'ops';
    const skills = await registry.forCaller({
      tier:         'authenticated',
      callerPubKey: 'alice',
      checkGroup,
    });
    const ids = skills.map(s => s.id).sort();
    expect(ids).toEqual(['auth-skill', 'ops-hidden', 'ops-visible', 'public-skill']);
  });

  it('excludes group-hidden skills for non-members', async () => {
    const checkGroup = async () => false;
    const skills = await registry.forCaller({
      tier:         'authenticated',
      callerPubKey: 'bob',
      checkGroup,
    });
    expect(skills.map(s => s.id)).not.toContain('ops-hidden');
    expect(skills.map(s => s.id)).toContain('ops-visible');
  });

  it('fails closed when checkGroup throws', async () => {
    const checkGroup = async () => { throw new Error('boom'); };
    const skills = await registry.forCaller({
      tier:         'authenticated',
      callerPubKey: 'bob',
      checkGroup,
    });
    expect(skills.map(s => s.id)).not.toContain('ops-hidden');
  });
});

// ── Agent + GroupManager end-to-end ─────────────────────────────────────────

async function makeAgents() {
  const bus      = new InternalBus();
  const aliceId  = await AgentIdentity.generate(new VaultMemory());
  const bobId    = await AgentIdentity.generate(new VaultMemory());
  const adminId  = await AgentIdentity.generate(new VaultMemory());

  // Alice hosts the group. Bob will (or won't) hold a proof.
  const aliceVault = new VaultMemory();
  const aliceIdent = await AgentIdentity.generate(aliceVault);

  const { GroupManager } = await import('../src/permissions/GroupManager.js');
  const aliceGm = new GroupManager({ identity: aliceIdent, vault: aliceVault });

  // Alice (security) is aware of the group manager. Normally SecurityLayer
  // is created with identity + optional groupManager; we attach it by hand.
  const aliceSec = new SecurityLayer({ identity: aliceIdent });
  aliceSec.groupManager = aliceGm;

  const alice = new Agent({
    identity:  aliceIdent,
    transport: new InternalTransport(bus, aliceIdent.pubKey, { identity: aliceIdent }),
    security:  aliceSec,
  });
  const bob = new Agent({
    identity:  bobId,
    transport: new InternalTransport(bus, bobId.pubKey, { identity: bobId }),
  });

  alice.addPeer(bob.address,   bob.pubKey);
  bob.addPeer  (alice.address, alice.pubKey);

  await alice.start(); await bob.start();

  return { alice, bob, aliceGm };
}

describe('handleTaskRequest — group-visible skill', () => {
  it('lets a member invoke and returns the skill result', async () => {
    const { alice, bob, aliceGm } = await makeAgents();

    alice.register('ops-call', async () => ['ok'], {
      visibility: { groups: ['ops'], default: 'hidden' },
    });

    // Admin-issue a proof to Bob (alice is admin in this scenario)
    await aliceGm.issueProof(bob.pubKey, 'ops');

    const result = await bob.invoke(alice.address, 'ops-call', []);
    expect(result).toEqual(['ok']);

    await alice.stop(); await bob.stop();
  });

  it('non-member receives `Unknown skill`, NOT `not authorised`', async () => {
    const { alice, bob } = await makeAgents();

    alice.register('ops-call', async () => ['ok'], {
      visibility: { groups: ['ops'], default: 'hidden' },
    });

    await expect(bob.invoke(alice.address, 'ops-call', []))
      .rejects.toThrow(/Unknown skill/);

    await alice.stop(); await bob.stop();
  });

  it('expired proof is treated as non-member', async () => {
    const { alice, bob, aliceGm } = await makeAgents();
    alice.register('ops-call', async () => ['ok'], {
      visibility: { groups: ['ops'], default: 'hidden' },
    });

    // Proof that expires immediately.
    await aliceGm.issueProof(bob.pubKey, 'ops', 10);
    await new Promise(r => setTimeout(r, 20));

    await expect(bob.invoke(alice.address, 'ops-call', []))
      .rejects.toThrow(/Unknown skill/);

    await alice.stop(); await bob.stop();
  });

  it('scalar visibility still works unchanged', async () => {
    const { alice, bob } = await makeAgents();
    alice.register('public-call', async () => ['pong'], { visibility: 'public' });

    const result = await bob.invoke(alice.address, 'public-call', []);
    expect(result).toEqual(['pong']);

    await alice.stop(); await bob.stop();
  });
});

describe('Agent.export — caller-aware filter', () => {
  it('self-view shows all non-private skills including hidden groups', async () => {
    const { alice } = await makeAgents();
    alice.register('ops-hidden', async () => {}, {
      visibility: { groups: ['ops'], default: 'hidden' },
    });

    const own = await alice.export();
    expect(own.skills.map(s => s.id)).toContain('ops-hidden');
    await alice.stop();
  });

  it('caller-view hides group-hidden skills from non-members', async () => {
    const { alice, bob } = await makeAgents();
    alice.register('ops-hidden', async () => {}, {
      visibility: { groups: ['ops'], default: 'hidden' },
    });

    const card = await alice.export({ callerPubKey: bob.pubKey });
    expect(card.skills.map(s => s.id)).not.toContain('ops-hidden');
    await alice.stop(); await bob.stop();
  });

  it('caller-view reveals group skills to valid members', async () => {
    const { alice, bob, aliceGm } = await makeAgents();
    alice.register('ops-hidden', async () => {}, {
      visibility: { groups: ['ops'], default: 'hidden' },
    });
    await aliceGm.issueProof(bob.pubKey, 'ops');

    const card = await alice.export({ callerPubKey: bob.pubKey });
    expect(card.skills.map(s => s.id)).toContain('ops-hidden');
    await alice.stop(); await bob.stop();
  });
});

describe('skillDiscovery — filters per caller', () => {
  it('non-member does not see hidden group skills in the discovery response', async () => {
    const { alice, bob } = await makeAgents();
    alice.register('public-one',  async () => {}, { visibility: 'public' });
    alice.register('ops-hidden',  async () => {}, {
      visibility: { groups: ['ops'], default: 'hidden' },
    });

    const skills = await requestSkills(bob, alice.address);
    const ids    = skills.map(s => s.id);
    expect(ids).toContain('public-one');
    expect(ids).not.toContain('ops-hidden');

    await alice.stop(); await bob.stop();
  });

  it('member sees hidden group skills in the discovery response', async () => {
    const { alice, bob, aliceGm } = await makeAgents();
    alice.register('ops-hidden', async () => {}, {
      visibility: { groups: ['ops'], default: 'hidden' },
    });
    await aliceGm.issueProof(bob.pubKey, 'ops');

    const skills = await requestSkills(bob, alice.address);
    expect(skills.map(s => s.id)).toContain('ops-hidden');

    await alice.stop(); await bob.stop();
  });
});
