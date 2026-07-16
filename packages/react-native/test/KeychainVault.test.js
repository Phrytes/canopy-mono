/**
 * KeychainVault tests — react-native-keychain is mocked so the tests run in Node.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock react-native-keychain before importing the module under test ─────────

const store = new Map();

vi.mock('react-native-keychain', () => ({
  getInternetCredentials: vi.fn(async key => {
    const v = store.get(key);
    return v ? { password: v } : false;
  }),
  setInternetCredentials: vi.fn(async (key, _username, value) => {
    store.set(key, value);
  }),
  resetInternetCredentials: vi.fn(async key => {
    store.delete(key);
  }),
}));

// Also mock @onderling/core's Vault base so we can extend it cleanly.
vi.mock('@onderling/core', async () => {
  const actual = await vi.importActual('@onderling/core');
  return actual;
});

import { KeychainVault } from '../src/identity/KeychainVault.js';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('KeychainVault', () => {
  let vault;

  beforeEach(() => {
    store.clear();
    vault = new KeychainVault({ service: 'test-svc' });
  });

  it('get returns null for missing key', async () => {
    expect(await vault.get('missing')).toBeNull();
  });

  it('set and get round-trip', async () => {
    await vault.set('mykey', 'myvalue');
    expect(await vault.get('mykey')).toBe('myvalue');
  });

  it('delete removes a key', async () => {
    await vault.set('k', 'v');
    await vault.delete('k');
    expect(await vault.get('k')).toBeNull();
  });

  it('has returns true for existing key, false for missing', async () => {
    await vault.set('x', '1');
    expect(await vault.has('x')).toBe(true);
    expect(await vault.has('nope')).toBe(false);
  });

  it('list returns keys tracked in the manifest', async () => {
    await vault.set('alpha', 'a');
    await vault.set('beta', 'b');
    const keys = await vault.list();
    expect(keys).toContain('alpha');
    expect(keys).toContain('beta');
  });

  it('list excludes deleted keys', async () => {
    await vault.set('gone', 'g');
    await vault.delete('gone');
    const keys = await vault.list();
    expect(keys).not.toContain('gone');
  });

  it('list returns empty array when vault is empty', async () => {
    expect(await vault.list()).toEqual([]);
  });

  it('set overwrites existing value', async () => {
    await vault.set('dup', 'first');
    await vault.set('dup', 'second');
    expect(await vault.get('dup')).toBe('second');
  });

  it('uses service prefix in keychain keys', async () => {
    const { setInternetCredentials } = await import('react-native-keychain');
    await vault.set('item', 'val');
    const call = setInternetCredentials.mock.calls.find(c => c[0].includes('item'));
    expect(call[0]).toContain('test-svc:');
  });
});
