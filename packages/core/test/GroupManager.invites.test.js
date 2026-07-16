/**
 * GroupManager invite primitives — Phase 7 H5 onboarding.
 *
 * Wire shape + redemption semantics for `issueInvite` / `verifyInvite` /
 * `redeemInvite`: an unbound, time-limited, single-use token that any
 * holder can redeem within TTL for a real `GroupProof` bound to a
 * specific member pubKey.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentIdentity, GroupManager } from '../src/index.js';
import { VaultMemory } from '@onderling/vault';

describe('GroupManager — invite tokens', () => {
  let admin, member, gm;
  beforeEach(async () => {
    admin  = await AgentIdentity.generate(new VaultMemory());
    member = await AgentIdentity.generate(new VaultMemory());
    gm     = new GroupManager({ identity: admin, vault: new VaultMemory() });
  });

  it('issueInvite returns a signed unbound token with a nonce + expiry', async () => {
    const invite = await gm.issueInvite('block-42');
    expect(invite.kind).toBe('invite');
    expect(invite.groupId).toBe('block-42');
    expect(invite.adminPubKey).toBe(admin.pubKey);
    expect(invite.role).toBe('member');
    expect(invite.nonce).toBeTruthy();
    expect(invite.expiresAt).toBeGreaterThan(Date.now());
    expect(invite.sig).toBeTruthy();
    // Unbound: NO memberPubKey field on an invite (that's the whole point).
    expect(invite.memberPubKey).toBeUndefined();
  });

  it('verifyInvite accepts a valid invite and rejects a tampered one', async () => {
    const invite = await gm.issueInvite('block-42');
    expect(await gm.verifyInvite(invite)).toBe(true);

    const tampered = { ...invite, role: 'admin' };   // upgrade attempt without re-signing
    expect(await gm.verifyInvite(tampered)).toBe(false);

    const malformed = { ...invite, kind: 'proof' };  // wrong shape
    expect(await gm.verifyInvite(malformed)).toBe(false);
  });

  it('verifyInvite rejects an expired invite', async () => {
    const invite = await gm.issueInvite('block-42', { expiresIn: 1 });
    await new Promise(r => setTimeout(r, 5));
    expect(await gm.verifyInvite(invite)).toBe(false);
  });

  it('redeemInvite mints a real proof and marks the nonce consumed', async () => {
    const invite = await gm.issueInvite('block-42', { role: 'member' });
    const proof  = await gm.redeemInvite(invite, member.pubKey);

    expect(proof.kind).toBeUndefined();              // proofs don't carry `kind`
    expect(proof.groupId).toBe('block-42');
    expect(proof.adminPubKey).toBe(admin.pubKey);
    expect(proof.memberPubKey).toBe(member.pubKey);
    expect(proof.role).toBe('member');
    expect(await gm.verifyProof(proof)).toBe(true);

    // Second redemption with the same nonce throws.
    await expect(gm.redeemInvite(invite, member.pubKey))
      .rejects.toThrow(/already redeemed/);
  });

  it('redeemInvite rejects an invite signed by a different admin', async () => {
    const otherAdmin = await AgentIdentity.generate(new VaultMemory());
    const otherGm    = new GroupManager({ identity: otherAdmin, vault: new VaultMemory() });
    const foreign    = await otherGm.issueInvite('block-42');
    await expect(gm.redeemInvite(foreign, member.pubKey))
      .rejects.toThrow(/different admin/);
  });

  it('redeemInvite rejects a malformed memberPubKey', async () => {
    const invite = await gm.issueInvite('block-42');
    await expect(gm.redeemInvite(invite, ''))
      .rejects.toThrow(/memberPubKey required/);
    await expect(gm.redeemInvite(invite, null))
      .rejects.toThrow(/memberPubKey required/);
  });

  it('admin can issue an invite for a non-default role', async () => {
    const invite = await gm.issueInvite('block-42', { role: 'coordinator' });
    expect(invite.role).toBe('coordinator');
    const proof = await gm.redeemInvite(invite, member.pubKey);
    expect(proof.role).toBe('coordinator');
  });

  it('issueInvite throws on an unknown role', async () => {
    await expect(gm.issueInvite('block-42', { role: 'wizard' }))
      .rejects.toThrow(/unknown role/);
  });

  it('two different invites mint two distinct proofs, both retrievable via getRole', async () => {
    const member2 = await AgentIdentity.generate(new VaultMemory());
    const inv1 = await gm.issueInvite('block-42');
    const inv2 = await gm.issueInvite('block-42');
    await gm.redeemInvite(inv1, member.pubKey);
    await gm.redeemInvite(inv2, member2.pubKey);

    expect(await gm.getRole(member.pubKey,  'block-42')).toBe('member');
    expect(await gm.getRole(member2.pubKey, 'block-42')).toBe('member');
  });
});
