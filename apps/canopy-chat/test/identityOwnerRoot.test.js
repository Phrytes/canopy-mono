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
