import { describe, it, expect } from 'vitest';
import {
  generateMnemonic,
  mnemonicToSeed,
  seedToMnemonic,
  validateMnemonic,
} from '../src/identity/Mnemonic.js';

describe('generateMnemonic', () => {
  it('returns a 24-word string', () => {
    const m = generateMnemonic();
    expect(typeof m).toBe('string');
    expect(m.trim().split(/\s+/).length).toBe(24);
  });

  it('generates unique mnemonics', () => {
    const set = new Set(Array.from({ length: 10 }, generateMnemonic));
    expect(set.size).toBe(10);
  });
});

describe('mnemonicToSeed', () => {
  it('returns a 32-byte Uint8Array', () => {
    const seed = mnemonicToSeed(generateMnemonic());
    expect(seed).toBeInstanceOf(Uint8Array);
    expect(seed.length).toBe(32);
  });

  it('is deterministic', () => {
    const m = generateMnemonic();
    const s1 = mnemonicToSeed(m);
    const s2 = mnemonicToSeed(m);
    expect(s1).toEqual(s2);
  });

  it('trims whitespace', () => {
    const m = generateMnemonic();
    expect(mnemonicToSeed('  ' + m + '  ')).toEqual(mnemonicToSeed(m));
  });
});

describe('seedToMnemonic', () => {
  it('round-trips: seed → mnemonic → seed', () => {
    const original = mnemonicToSeed(generateMnemonic());
    const recovered = mnemonicToSeed(seedToMnemonic(original));
    expect(recovered).toEqual(original);
  });

  it('round-trips: mnemonic → seed → mnemonic', () => {
    const original = generateMnemonic();
    const recovered = seedToMnemonic(mnemonicToSeed(original));
    expect(recovered).toBe(original);
  });
});

describe('validateMnemonic', () => {
  it('accepts a freshly generated mnemonic', () => {
    expect(validateMnemonic(generateMnemonic())).toBe(true);
  });

  it('rejects garbage', () => {
    expect(validateMnemonic('foo bar baz')).toBe(false);
    expect(validateMnemonic('')).toBe(false);
  });
});
