import { describe, it, expect, beforeEach } from 'vitest';
import { TrustRegistry }    from '../src/permissions/TrustRegistry.js';
import { PolicyEngine, PolicyDeniedError } from '../src/permissions/PolicyEngine.js';
import { CapabilityToken }  from '../src/permissions/CapabilityToken.js';
import { TokenRegistry }    from '../src/permissions/TokenRegistry.js';
import { GroupManager }     from '../src/permissions/GroupManager.js';
import { SkillRegistry }    from '../src/skills/SkillRegistry.js';
import { defineSkill }      from '../src/skills/defineSkill.js';
import { AgentIdentity }    from '../src/identity/AgentIdentity.js';
import { VaultMemory }      from '../src/identity/VaultMemory.js';

const noop = async () => [];

// ── TrustRegistry ─────────────────────────────────────────────────────────────

describe('TrustRegistry', () => {
  it('defaults unknown peer to authenticated', async () => {
    const tr = new TrustRegistry(new VaultMemory());
    expect(await tr.getTier('unknown-pubkey')).toBe('authenticated');
  });

  it('set and get tier', async () => {
    const tr = new TrustRegistry(new VaultMemory());
    await tr.setTier('alice', 'trusted');
    expect(await tr.getTier('alice')).toBe('trusted');
  });

  it('addGroup / removeGroup persist', async () => {
    const tr = new TrustRegistry(new VaultMemory());
    await tr.addGroup('alice', 'home');
    const rec = await tr.getRecord('alice');
    expect(rec.groups).toContain('home');
    await tr.removeGroup('alice', 'home');
    const rec2 = await tr.getRecord('alice');
    expect(rec2.groups).not.toContain('home');
  });

  it('all() returns every persisted peer', async () => {
    const tr = new TrustRegistry(new VaultMemory());
    await tr.setTier('a', 'trusted');
    await tr.setTier('b', 'public');
    const all = await tr.all();
    expect(Object.keys(all).sort()).toEqual(['a', 'b']);
  });
});

// ── PolicyEngine ──────────────────────────────────────────────────────────────

describe('PolicyEngine', () => {
  let tr, sr, pe;

  beforeEach(async () => {
    tr = new TrustRegistry(new VaultMemory());
    sr = new SkillRegistry();
    pe = new PolicyEngine({ trustRegistry: tr, skillRegistry: sr });
  });

  it('allows authenticated peer to call authenticated skill', async () => {
    sr.register(defineSkill('greet', noop, { visibility: 'authenticated' }));
    const res = await pe.checkInbound({ peerPubKey: 'any', skillId: 'greet' });
    expect(res.allowed).toBe(true);
  });

  it('denies authenticated peer from calling trusted skill', async () => {
    sr.register(defineSkill('admin', noop, { visibility: 'trusted' }));
    await expect(pe.checkInbound({ peerPubKey: 'any', skillId: 'admin' }))
      .rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it('allows trusted peer to call trusted skill', async () => {
    await tr.setTier('trusted-key', 'trusted');
    sr.register(defineSkill('admin', noop, { visibility: 'trusted' }));
    const res = await pe.checkInbound({ peerPubKey: 'trusted-key', skillId: 'admin' });
    expect(res.tier).toBe('trusted');
  });

  it('allows any peer for public skill', async () => {
    sr.register(defineSkill('status', noop, { visibility: 'public' }));
    const res = await pe.checkInbound({ peerPubKey: 'anybody', skillId: 'status' });
    expect(res.allowed).toBe(true);
  });

  it('throws NOT_FOUND for unknown skill', async () => {
    await expect(pe.checkInbound({ peerPubKey: 'x', skillId: 'unknown' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws DISABLED for disabled skill', async () => {
    sr.register(defineSkill('off', noop, { enabled: false }));
    await expect(pe.checkInbound({ peerPubKey: 'x', skillId: 'off' }))
      .rejects.toMatchObject({ code: 'DISABLED' });
  });
});

// ── PolicyEngine requires-token ───────────────────────────────────────────────

describe('PolicyEngine — requires-token', () => {
  it('NO_TOKEN when no token provided', async () => {
    const tr  = new TrustRegistry(new VaultMemory());
    const sr  = new SkillRegistry();
    const pe  = new PolicyEngine({ trustRegistry: tr, skillRegistry: sr });
    sr.register(defineSkill('secret', noop, { policy: 'requires-token' }));
    await expect(pe.checkInbound({ peerPubKey: 'x', skillId: 'secret' }))
      .rejects.toMatchObject({ code: 'NO_TOKEN' });
  });

  it('INVALID_TOKEN for malformed JSON', async () => {
    const tr  = new TrustRegistry(new VaultMemory());
    const sr  = new SkillRegistry();
    const pe  = new PolicyEngine({ trustRegistry: tr, skillRegistry: sr });
    sr.register(defineSkill('secret', noop, { policy: 'requires-token' }));
    await expect(pe.checkInbound({ peerPubKey: 'x', skillId: 'secret', token: { bad: true } }))
      .rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('INVALID_TOKEN for expired token', async () => {
    const tr     = new TrustRegistry(new VaultMemory());
    const sr     = new SkillRegistry();
    const issuer = await AgentIdentity.generate(new VaultMemory());
    const pe     = new PolicyEngine({ trustRegistry: tr, skillRegistry: sr, agentPubKey: 'myAgent' });
    sr.register(defineSkill('secret', noop, { policy: 'requires-token' }));
    const tok = await CapabilityToken.issue(issuer, {
      subject: 'caller', agentId: 'myAgent', skill: 'secret', expiresIn: -1_000,
    });
    await expect(pe.checkInbound({ peerPubKey: 'caller', skillId: 'secret', token: tok.toJSON() }))
      .rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('INVALID_TOKEN when token skill does not match', async () => {
    const tr     = new TrustRegistry(new VaultMemory());
    const sr     = new SkillRegistry();
    const issuer = await AgentIdentity.generate(new VaultMemory());
    await tr.setTier(issuer.pubKey, 'trusted');
    const pe = new PolicyEngine({ trustRegistry: tr, skillRegistry: sr, agentPubKey: 'myAgent' });
    sr.register(defineSkill('secret', noop, { policy: 'requires-token' }));
    const tok = await CapabilityToken.issue(issuer, {
      subject: 'caller', agentId: 'myAgent', skill: 'other-skill', expiresIn: 60_000,
    });
    await expect(pe.checkInbound({ peerPubKey: 'caller', skillId: 'secret', token: tok.toJSON() }))
      .rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('INVALID_TOKEN when token subject does not match caller', async () => {
    const tr     = new TrustRegistry(new VaultMemory());
    const sr     = new SkillRegistry();
    const issuer = await AgentIdentity.generate(new VaultMemory());
    await tr.setTier(issuer.pubKey, 'trusted');
    const pe = new PolicyEngine({ trustRegistry: tr, skillRegistry: sr, agentPubKey: 'myAgent' });
    sr.register(defineSkill('secret', noop, { policy: 'requires-token' }));
    const tok = await CapabilityToken.issue(issuer, {
      subject: 'other-caller', agentId: 'myAgent', skill: 'secret', expiresIn: 60_000,
    });
    await expect(pe.checkInbound({ peerPubKey: 'actual-caller', skillId: 'secret', token: tok.toJSON() }))
      .rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('INVALID_TOKEN when issuer is not trusted', async () => {
    const tr      = new TrustRegistry(new VaultMemory());
    const sr      = new SkillRegistry();
    const issuer  = await AgentIdentity.generate(new VaultMemory());
    // issuer NOT added to trustRegistry
    const pe = new PolicyEngine({ trustRegistry: tr, skillRegistry: sr, agentPubKey: 'myAgent' });
    sr.register(defineSkill('secret', noop, { policy: 'requires-token' }));
    const tok = await CapabilityToken.issue(issuer, {
      subject: 'caller', agentId: 'myAgent', skill: 'secret', expiresIn: 60_000,
    });
    await expect(pe.checkInbound({ peerPubKey: 'caller', skillId: 'secret', token: tok.toJSON() }))
      .rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('allows valid token from trusted issuer', async () => {
    const tr     = new TrustRegistry(new VaultMemory());
    const sr     = new SkillRegistry();
    const issuer = await AgentIdentity.generate(new VaultMemory());
    await tr.setTier(issuer.pubKey, 'trusted');
    const pe = new PolicyEngine({ trustRegistry: tr, skillRegistry: sr, agentPubKey: 'myAgent' });
    sr.register(defineSkill('secret', noop, { policy: 'requires-token' }));
    const tok = await CapabilityToken.issue(issuer, {
      subject: 'caller', agentId: 'myAgent', skill: 'secret', expiresIn: 60_000,
    });
    const res = await pe.checkInbound({ peerPubKey: 'caller', skillId: 'secret', token: tok.toJSON() });
    expect(res.allowed).toBe(true);
  });
});

// ── CapabilityToken ───────────────────────────────────────────────────────────

describe('CapabilityToken', () => {
  it('issues and verifies', async () => {
    const id  = await AgentIdentity.generate(new VaultMemory());
    const tok = await CapabilityToken.issue(id, {
      subject:  'bob-pubkey',
      agentId:  'my-agent',
      skill:    'echo',
    });
    expect(CapabilityToken.verify(tok, 'my-agent')).toBe(true);
  });

  it('rejects wrong agentId', async () => {
    const id  = await AgentIdentity.generate(new VaultMemory());
    const tok = await CapabilityToken.issue(id, { subject: 'x', agentId: 'mine', skill: '*' });
    expect(CapabilityToken.verify(tok, 'other')).toBe(false);
  });

  it('rejects expired token', async () => {
    const id  = await AgentIdentity.generate(new VaultMemory());
    const tok = await CapabilityToken.issue(id, {
      subject:   'x',
      agentId:   'a',
      skill:     '*',
      expiresIn: -1,  // already expired
    });
    expect(CapabilityToken.verify(tok)).toBe(false);
  });

  it('round-trips through JSON', async () => {
    const id  = await AgentIdentity.generate(new VaultMemory());
    const tok = await CapabilityToken.issue(id, { subject: 'x', agentId: 'a', skill: '*' });
    const rt  = CapabilityToken.fromJSON(tok.toJSON());
    expect(CapabilityToken.verify(rt)).toBe(true);
  });
});

// ── TokenRegistry ─────────────────────────────────────────────────────────────

describe('TokenRegistry', () => {
  it('stores and retrieves a token', async () => {
    const id   = await AgentIdentity.generate(new VaultMemory());
    const tok  = await CapabilityToken.issue(id, { subject: 'bob', agentId: 'my-agent', skill: 'echo' });
    const reg  = new TokenRegistry(new VaultMemory());
    await reg.store(tok);
    const got  = await reg.get('my-agent', 'echo');
    expect(got.id).toBe(tok.id);
  });

  it('returns null if no matching token', async () => {
    const reg = new TokenRegistry(new VaultMemory());
    expect(await reg.get('nobody', 'echo')).toBeNull();
  });

  it('revoke prevents retrieval', async () => {
    const id  = await AgentIdentity.generate(new VaultMemory());
    const tok = await CapabilityToken.issue(id, { subject: 'b', agentId: 'a', skill: '*' });
    const reg = new TokenRegistry(new VaultMemory());
    await reg.store(tok);
    await reg.revoke(tok.id);
    expect(await reg.get('a', '*')).toBeNull();
  });
});

// ── GroupManager ──────────────────────────────────────────────────────────────

describe('GroupManager', () => {
  it('admin issues proof and member verifies it', async () => {
    const adminId  = await AgentIdentity.generate(new VaultMemory());
    const memberId = await AgentIdentity.generate(new VaultMemory());
    const admin    = new GroupManager({ identity: adminId,  vault: new VaultMemory() });
    const member   = new GroupManager({ identity: memberId, vault: new VaultMemory() });

    const proof = await admin.issueProof(memberId.pubKey, 'home-group');
    expect(await admin.verifyProof(proof)).toBe(true);

    await member.storeProof(proof);
    expect(await member.listGroups()).toContain('home-group');
  });

  it('rejects expired proof', async () => {
    const adminId  = await AgentIdentity.generate(new VaultMemory());
    const memberId = await AgentIdentity.generate(new VaultMemory());
    const admin    = new GroupManager({ identity: adminId, vault: new VaultMemory() });

    const proof = await admin.issueProof(memberId.pubKey, 'g', -1); // already expired
    expect(await admin.verifyProof(proof)).toBe(false);
  });

  it('hasValidProof works for self', async () => {
    const adminId  = await AgentIdentity.generate(new VaultMemory());
    const memberId = await AgentIdentity.generate(new VaultMemory());
    const admin    = new GroupManager({ identity: adminId,  vault: new VaultMemory() });
    const member   = new GroupManager({ identity: memberId, vault: new VaultMemory() });

    const proof = await admin.issueProof(memberId.pubKey, 'team');
    await member.storeProof(proof);
    expect(await member.hasValidProof(memberId.pubKey, 'team')).toBe(true);
  });
});
