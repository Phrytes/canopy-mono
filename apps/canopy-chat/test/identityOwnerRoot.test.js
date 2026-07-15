// Step-1 identity substrate (create path): createRealHouseholdAgent stands up ONE
// owner root and derives the default-profile (chat) identity from it — the identity
// the feedback no-login pseudonym uses. Proves the phrase alone re-derives the
// pseudonym on a fresh device. See plans/NOTE-identity-profiles-and-portability.md.
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@canopy/vault';
import { Bootstrap, AgentIdentity } from '@canopy/core';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

const derivedDefaultPubKey = async (phrase) =>
  (await AgentIdentity.fromSeed(Bootstrap.fromMnemonic(phrase).deriveAgentSeed('default'), new VaultMemory())).pubKey;

describe('identity step-1 — owner root → default-profile chat identity', () => {
  it('persists an owner-root phrase and derives the chat identity from it', async () => {
    const ownerRootVault = new VaultMemory();
    const chatVault = new VaultMemory();
    const a = await createRealHouseholdAgent({ ownerRootVault, chatVault });

    const phrase = await ownerRootVault.get('owner-phrase');
    expect(typeof phrase).toBe('string');
    expect(phrase.trim().split(/\s+/).length).toBe(24);           // a 24-word BIP-39 phrase

    // the chat agent's identity (= the feedback pseudonym) is the default-profile derivation
    expect(a.sa.agent.identity.pubKey).toBe(await derivedDefaultPubKey(phrase));
  });

  it('is stable across a reboot with the same vaults', async () => {
    const ownerRootVault = new VaultMemory();
    const chatVault = new VaultMemory();
    const a1 = await createRealHouseholdAgent({ ownerRootVault, chatVault });
    const a2 = await createRealHouseholdAgent({ ownerRootVault, chatVault });   // "reboot"
    expect(a2.sa.agent.identity.pubKey).toBe(a1.sa.agent.identity.pubKey);
  });

  it('the phrase ALONE re-derives the same pseudonym on a fresh device (recovery)', async () => {
    const first = new VaultMemory();
    const a1 = await createRealHouseholdAgent({ ownerRootVault: first, chatVault: new VaultMemory() });
    const phrase = await first.get('owner-phrase');

    // new device: install the phrase into a fresh owner-root vault + a fresh (empty) chat vault
    const restoredRoot = new VaultMemory();
    await restoredRoot.set('owner-phrase', phrase);
    const a2 = await createRealHouseholdAgent({ ownerRootVault: restoredRoot, chatVault: new VaultMemory() });

    expect(a2.sa.agent.identity.pubKey).toBe(a1.sa.agent.identity.pubKey);
  });
});

describe('identity step-1b — owner-root reveal/restore host skills', () => {
  it('revealOwnerPhrase returns the persisted owner-root phrase', async () => {
    const ownerRootVault = new VaultMemory();
    const a = await createRealHouseholdAgent({ ownerRootVault, chatVault: new VaultMemory() });
    const res = await a.callSkill('household', 'revealOwnerPhrase', {});
    expect(res.mnemonic).toBe(await ownerRootVault.get('owner-phrase'));
  });

  it('restoreOwnerPhrase installs a new phrase + re-derives the default profile into the chat vault', async () => {
    const ownerRootVault = new VaultMemory();
    const chatVault = new VaultMemory();
    const a = await createRealHouseholdAgent({ ownerRootVault, chatVault });

    const { mnemonic } = Bootstrap.create();                       // a DIFFERENT phrase to restore
    const res = await a.callSkill('household', 'restoreOwnerPhrase', { mnemonic });
    expect(res).toMatchObject({ ok: true, reloadRequired: true });

    // owner root now holds the restored phrase; the chat vault holds the derived seed
    expect(await ownerRootVault.get('owner-phrase')).toBe(mnemonic);
    const expected = (await AgentIdentity.fromSeed(
      Bootstrap.fromMnemonic(mnemonic).deriveAgentSeed('default'), new VaultMemory())).pubKey;
    const rebooted = await createRealHouseholdAgent({ ownerRootVault, chatVault });   // reboot picks it up
    expect(rebooted.sa.agent.identity.pubKey).toBe(expected);
  });

  it('restoreOwnerPhrase rejects an invalid phrase', async () => {
    const a = await createRealHouseholdAgent({ ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() });
    const res = await a.callSkill('household', 'restoreOwnerPhrase', { mnemonic: 'not a real phrase' });
    expect(res).toMatchObject({ ok: false, error: 'invalid-phrase' });
  });
});

describe('identity step-2.4a — host enforcement gate attached', () => {
  it('createRealHouseholdAgent attaches a real PolicyEngine to the host agent (not silently swallowed)', async () => {
    const a = await createRealHouseholdAgent({ ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() });
    expect(a.hostPolicyEngine).toBeTruthy();                              // the gate is live
    expect(typeof a.hostPolicyEngine.checkInbound).toBe('function');     // and it's a real PolicyEngine
  });
});

describe('identity step-4 (app) — createProfile op', () => {
  it('mints a ROOT-DERIVED profile via callSkill (owner-root collaborator, through the trusted gate)', async () => {
    const ownerRootVault = new VaultMemory();
    const a = await createRealHouseholdAgent({ ownerRootVault, chatVault: new VaultMemory() });
    const res = await a.callSkill('agents', 'createProfile', { id: 'work', name: 'Work' });
    expect(res.created).toBe(true);
    expect(res.agent.role).toBe('profile');
    // the new profile's key is derived from THIS user's owner root (recoverable from the phrase)
    const phrase = await ownerRootVault.get('owner-phrase');
    const expected = (await AgentIdentity.fromSeed(
      Bootstrap.fromMnemonic(phrase).deriveAgentSeed('work'), new VaultMemory())).pubKey;
    expect(res.pubKey).toBe(expected);
  });
});

describe('identity step-5B/C — circleAddressFor bridge', () => {
  it('exposes the per-circle address for a circle (unlinkable across circles)', async () => {
    const { deriveCircleAddress } = await import('@canopy/core');
    const ownerRootVault = new VaultMemory();
    const a = await createRealHouseholdAgent({ ownerRootVault, chatVault: new VaultMemory() });
    const seed = Bootstrap.fromMnemonic(await ownerRootVault.get('owner-phrase')).deriveAgentSeed('default');
    expect(a.circleAddressFor('buurt-42')).toBe(deriveCircleAddress(seed, 'buurt-42'));
    expect(a.circleAddressFor('buurt-42')).not.toBe(a.circleAddressFor('werk-7'));   // unlinkable per circle
  });

  it('roster-recording wire: createGroupV2 through the agent records the admin per-circle address into the roster', async () => {
    // End-to-end: the callSkill seam injects circleAddress on the create/redeem
    // path → stoop records it on the MemberMap row → listGroupMembers surfaces it
    // → the chat-shell projection carries it. The recorded value is exactly the
    // deriveCircleAddress(defaultProfileSeed, groupId) this device presents.
    const { deriveCircleAddress } = await import('@canopy/core');
    const ownerRootVault = new VaultMemory();
    const a = await createRealHouseholdAgent({ ownerRootVault, chatVault: new VaultMemory() });
    const created = await a.callSkill('stoop', 'createGroupV2', {
      groupId: 'buurt-xy', name: 'X', rules: { purpose: 'buurt', houseRules: ['wees aardig'] },
    });
    expect(created.groupId).toBe('buurt-xy');
    const members = await a.callSkill('stoop', 'listGroupMembers', { groupId: 'buurt-xy' });
    const admin = (members.items ?? members.members ?? []).find((m) => m.role === 'admin');
    const seed = Bootstrap.fromMnemonic(await ownerRootVault.get('owner-phrase')).deriveAgentSeed('default');
    expect(admin.circleAddress).toBe(deriveCircleAddress(seed, 'buurt-xy'));
  });
});

describe('property layer — cross-app reuse (setProfileProperty / getProfileProperties)', () => {
  it('curates a coarse value ONCE on a profile and reads it back (any app can then reuse it)', async () => {
    const a = await createRealHouseholdAgent({ ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() });
    await a.callSkill('agents', 'createProfile', { id: 'work', name: 'Work' });
    const set = await a.callSkill('agents', 'setProfileProperty', { id: 'work', key: 'place', value: 'Groningen' });
    expect(set.ok).toBe(true);
    const got = await a.callSkill('agents', 'getProfileProperties', { id: 'work' });
    expect(got.ok).toBe(true);
    expect(got.properties.place).toEqual({ mode: 'own', value: 'Groningen' });   // own/inherit shape → reusable
    // a second property merges (doesn't clobber the first)
    await a.callSkill('agents', 'setProfileProperty', { id: 'work', key: 'ageBand', value: '35-54' });
    const both = await a.callSkill('agents', 'getProfileProperties', { id: 'work' });
    expect(Object.keys(both.properties).sort()).toEqual(['ageBand', 'place']);
  });
});
