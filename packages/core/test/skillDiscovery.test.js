import { describe, it, expect } from 'vitest';
import { Agent }                  from '../src/Agent.js';
import { AgentIdentity }          from '../src/identity/AgentIdentity.js';
import { VaultMemory }            from '../src/identity/VaultMemory.js';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { TrustRegistry }          from '../src/permissions/TrustRegistry.js';
import { defineSkill }            from '../src/skills/defineSkill.js';

async function makePair(bobOpts = {}) {
  const bus   = new InternalBus();
  const aId   = await AgentIdentity.generate(new VaultMemory());
  const bId   = await AgentIdentity.generate(new VaultMemory());
  const alice = new Agent({ identity: aId, transport: new InternalTransport(bus, aId.pubKey) });
  const bob   = new Agent({ identity: bId, transport: new InternalTransport(bus, bId.pubKey), ...bobOpts });
  alice.addPeer(bob.address, bob.pubKey);
  bob.addPeer(alice.address, alice.pubKey);
  await alice.start();
  await bob.start();
  return { alice, bob, aId, bId };
}

describe('Agent.discoverSkills', () => {
  it('returns an empty list when no skills registered', async () => {
    const { alice, bob } = await makePair();
    const skills = await alice.discoverSkills(bob.address);
    expect(skills).toEqual([]);
  });

  it('returns registered skills', async () => {
    const { alice, bob } = await makePair();
    bob.register('echo',  async ({ parts }) => parts, { description: 'Echo skill' });
    bob.register('greet', async () => 'hi');

    const skills = await alice.discoverSkills(bob.address);
    const ids = skills.map(s => s.id);
    expect(ids).toContain('echo');
    expect(ids).toContain('greet');
  });

  it('returns skill card fields', async () => {
    const { alice, bob } = await makePair();
    bob.register('echo', async ({ parts }) => parts, {
      description: 'Echo a message',
      tags:        ['utility'],
    });

    const skills  = await alice.discoverSkills(bob.address);
    const echoCard = skills.find(s => s.id === 'echo');
    expect(echoCard).toBeDefined();
    expect(echoCard.description).toBe('Echo a message');
    expect(echoCard.tags).toContain('utility');
  });

  it('filters by trust tier — private skill hidden from authenticated peer', async () => {
    const bus   = new InternalBus();
    const aId   = await AgentIdentity.generate(new VaultMemory());
    const bId   = await AgentIdentity.generate(new VaultMemory());

    const bobVault    = new VaultMemory();
    const trustReg    = new TrustRegistry(bobVault);
    // alice is authenticated tier (default) at bob
    // bob has a private skill only visible to 'private' tier
    const alice = new Agent({ identity: aId, transport: new InternalTransport(bus, aId.pubKey) });
    const bob   = new Agent({ identity: bId, transport: new InternalTransport(bus, bId.pubKey), trustRegistry: trustReg });
    alice.addPeer(bob.address, bob.pubKey);
    bob.addPeer(alice.address, alice.pubKey);
    await alice.start();
    await bob.start();

    bob.skills.register(defineSkill('public-skill',  async () => [], { visibility: 'public' }));
    bob.skills.register(defineSkill('private-skill', async () => [], { visibility: 'private' }));

    const skills = await alice.discoverSkills(bob.address);
    const ids    = skills.map(s => s.id);
    expect(ids).toContain('public-skill');
    expect(ids).not.toContain('private-skill');
  });

  it('all skills visible when trusted tier', async () => {
    const bus   = new InternalBus();
    const aId   = await AgentIdentity.generate(new VaultMemory());
    const bId   = await AgentIdentity.generate(new VaultMemory());

    const bobVault = new VaultMemory();
    const trustReg = new TrustRegistry(bobVault);
    await trustReg.setTier(aId.pubKey, 'trusted');

    const alice = new Agent({ identity: aId, transport: new InternalTransport(bus, aId.pubKey) });
    const bob   = new Agent({ identity: bId, transport: new InternalTransport(bus, bId.pubKey), trustRegistry: trustReg });
    alice.addPeer(bob.address, bob.pubKey);
    bob.addPeer(alice.address, alice.pubKey);
    await alice.start();
    await bob.start();

    bob.skills.register(defineSkill('pub',     async () => [], { visibility: 'public' }));
    bob.skills.register(defineSkill('trusted', async () => [], { visibility: 'trusted' }));

    const skills = await alice.discoverSkills(bob.address);
    const ids    = skills.map(s => s.id);
    expect(ids).toContain('pub');
    expect(ids).toContain('trusted');
  });
});
