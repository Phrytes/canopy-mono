/**
 * fixtures.js — pre-baked test data so scenarios skip boilerplate.
 *
 * NOTE: `mnemonic(name)` returns a deterministic 24-word BIP-39 phrase
 * derived from the name.  It is NOT a real mnemonic generator — for real
 * cryptographic mnemonics use `Bootstrap.create()` / `generateMnemonic()`
 * from `@canopy/core`.  These fixtures exist only so scenarios can
 * spawn predictable identities for tests like
 * `identity/bip39-recovery`.
 */
import { generateMnemonic, mnemonicToSeed } from '@canopy/core';

// A known set of BIP-39 words that round-trip through the SDK.  We pick
// from `generateMnemonic()` once at module-load and stash a lookup table
// keyed by name so re-imports return the SAME phrase for the SAME name.
const MNEMONIC_CACHE = new Map();

/**
 * Deterministic BIP-39 mnemonic for a named test agent.
 * The first call for a name generates a fresh mnemonic; subsequent
 * calls for the same name return the same mnemonic.
 *
 * Reset between test files via `resetFixtures()`.
 *
 * @param   {string} name  e.g. 'alice', 'alice-phone-2'
 * @returns {string}       24-word BIP-39 phrase
 */
export function mnemonic(name) {
  if (!MNEMONIC_CACHE.has(name)) {
    MNEMONIC_CACHE.set(name, generateMnemonic());
  }
  return MNEMONIC_CACHE.get(name);
}

/**
 * Drop all cached mnemonics + fixture state.  Call from a test file's
 * `beforeAll` if you want fresh fixtures per file.
 */
export function resetFixtures() {
  MNEMONIC_CACHE.clear();
}

/**
 * Derive 32-byte seed bytes from a name's deterministic mnemonic.
 * Useful when a scenario needs the seed directly (e.g. AgentIdentity
 * constructor).
 *
 * @param   {string} name
 * @returns {Uint8Array}  32-byte seed
 */
export function seedFor(name) {
  return mnemonicToSeed(mnemonic(name));
}

/**
 * Canned group names used across governance scenarios.  Keep this list
 * small and mnemonic — scenarios reference these by string.
 */
export const GROUPS = Object.freeze({
  block:    'block',
  family:   'family',
  team:     'team',
  observer: 'observer',
});

/**
 * Common skill IDs used by harness smoke tests.  Scenarios may register
 * their own; these are just convenience.
 */
export const SKILLS = Object.freeze({
  echo:  'echo',
  count: 'count',
  ping:  'ping',
});
