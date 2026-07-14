// Step-1 identity substrate: owner root (Bootstrap) → per-profile agent seed
// (deriveAgentSeed) → AgentIdentity.fromSeed. Locks in the property that makes ONE
// owner-root phrase recover every profile deterministically on any device.
import { describe, it, expect } from 'vitest';
import { Bootstrap }     from '../../src/identity/Bootstrap.js';
import { AgentIdentity } from '../../src/identity/AgentIdentity.js';
import { VaultMemory }   from '@canopy/vault';

describe('Bootstrap.deriveAgentSeed', () => {
  it('is deterministic: same secret + label → same 32-byte seed', () => {
    const b = Bootstrap.fromMnemonic(Bootstrap.create().mnemonic); // any root
    const s1 = b.deriveAgentSeed('default');
    const s2 = b.deriveAgentSeed('default');
    expect(s1).toEqual(s2);
    expect(s1).toBeInstanceOf(Uint8Array);
    expect(s1.length).toBe(32);
  });

  it('different labels → different seeds (per-profile separation)', () => {
    const b = Bootstrap.create().bootstrap;
    expect(b.deriveAgentSeed('default')).not.toEqual(b.deriveAgentSeed('home-device'));
  });

  it('different roots → different seeds for the same label', () => {
    const a = Bootstrap.create().bootstrap;
    const c = Bootstrap.create().bootstrap;
    expect(a.deriveAgentSeed('default')).not.toEqual(c.deriveAgentSeed('default'));
  });

  it('reproduces the SAME seed from the same phrase (cross-device recovery)', () => {
    const { mnemonic } = Bootstrap.create();
    const s1 = Bootstrap.fromMnemonic(mnemonic).deriveAgentSeed('default');
    const s2 = Bootstrap.fromMnemonic(mnemonic).deriveAgentSeed('default'); // "another device"
    expect(s1).toEqual(s2);
  });

  it('rejects an empty label', () => {
    expect(() => Bootstrap.create().bootstrap.deriveAgentSeed('')).toThrow();
  });
});

describe('AgentIdentity.fromSeed', () => {
  it('same seed → same pubKey across independent vaults (the pseudonym recovery property)', async () => {
    const b = Bootstrap.create().bootstrap;
    const seed = b.deriveAgentSeed('default');
    const idA = await AgentIdentity.fromSeed(seed, new VaultMemory());
    const idB = await AgentIdentity.fromSeed(seed, new VaultMemory());
    expect(idA.pubKey).toBe(idB.pubKey);
  });

  it('same seed → same (HKDF-derived) stableId across vaults', async () => {
    const seed = Bootstrap.create().bootstrap.deriveAgentSeed('default');
    const idA = await AgentIdentity.fromSeed(seed, new VaultMemory());
    const idB = await AgentIdentity.fromSeed(seed, new VaultMemory());
    expect(idA.stableId).toBe(idB.stableId);
  });

  it('persists agent-privkey so a later restore() re-loads the same identity', async () => {
    const vault = new VaultMemory();
    const seed = Bootstrap.create().bootstrap.deriveAgentSeed('default');
    const made = await AgentIdentity.fromSeed(seed, vault);
    expect(await vault.get('agent-privkey')).toBeTruthy();
    const restored = await AgentIdentity.restore(vault);
    expect(restored.pubKey).toBe(made.pubKey);
  });

  it('rejects a non-32-byte seed', async () => {
    await expect(AgentIdentity.fromSeed(new Uint8Array(16), new VaultMemory())).rejects.toThrow('32-byte');
  });

  it('end-to-end: one phrase → default profile pubKey, reproducible (feedback pseudonym recovery)', async () => {
    const { mnemonic } = Bootstrap.create();
    const pub = async () =>
      (await AgentIdentity.fromSeed(Bootstrap.fromMnemonic(mnemonic).deriveAgentSeed('default'), new VaultMemory())).pubKey;
    expect(await pub()).toBe(await pub());   // phrase alone re-derives the same pseudonym
  });
});
