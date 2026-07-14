// Identity step 3 — per-circle addresses: deterministic (recoverable) yet distinct per circle.
import { describe, it, expect } from 'vitest';
import { Bootstrap } from '../../src/identity/Bootstrap.js';
import { AgentIdentity } from '../../src/identity/AgentIdentity.js';
import { deriveCircleSeed, deriveCircleAddress } from '../../src/identity/circleAddress.js';

const aProfileSeed = () => Bootstrap.create().bootstrap.deriveAgentSeed('default');

describe('per-circle addresses (step 3)', () => {
  it('is deterministic: same profile seed + circleId → same address (recovery)', () => {
    const s = aProfileSeed();
    expect(deriveCircleAddress(s, 'buurt-42')).toBe(deriveCircleAddress(s, 'buurt-42'));
    expect(typeof deriveCircleAddress(s, 'buurt-42')).toBe('string');
  });

  it('a DIFFERENT circle → a different address (unlinkable across circles)', () => {
    const s = aProfileSeed();
    expect(deriveCircleAddress(s, 'buurt-42')).not.toBe(deriveCircleAddress(s, 'werk-7'));
  });

  it('a different profile → a different address in the same circle', () => {
    expect(deriveCircleAddress(aProfileSeed(), 'buurt-42')).not.toBe(deriveCircleAddress(aProfileSeed(), 'buurt-42'));
  });

  it('a device with ONLY the profile seed (no owner root) derives the SAME address', () => {
    const { mnemonic } = Bootstrap.create();
    const seedHere  = Bootstrap.fromMnemonic(mnemonic).deriveAgentSeed('home');
    const seedThere = Bootstrap.fromMnemonic(mnemonic).deriveAgentSeed('home');   // re-derived on another device
    expect(deriveCircleAddress(seedHere, 'buurt-42')).toBe(deriveCircleAddress(seedThere, 'buurt-42'));
  });

  it('the address is a valid AgentIdentity pubKey of the per-circle seed', () => {
    const s = aProfileSeed();
    expect(deriveCircleAddress(s, 'buurt-42')).toBe(AgentIdentity.pubKeyFromSeed(deriveCircleSeed(s, 'buurt-42')));
  });

  it('the per-circle address differs from the profile pubKey itself', () => {
    const s = aProfileSeed();
    expect(deriveCircleAddress(s, 'buurt-42')).not.toBe(AgentIdentity.pubKeyFromSeed(s));
  });

  it('validates inputs', () => {
    expect(() => deriveCircleSeed(new Uint8Array(16), 'c')).toThrow('32-byte');
    expect(() => deriveCircleSeed(aProfileSeed(), '')).toThrow('circleId');
  });
});
