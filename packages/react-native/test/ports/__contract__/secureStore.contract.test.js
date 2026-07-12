/**
 * SecureStore port contract.
 *
 * Runs against the Mock (MemorySecureStore) AND the Expo concrete (with an
 * injected fake `expo-secure-store`, so no native dep is needed).
 */
import { describe, it, expect, vi } from 'vitest';
import { MemorySecureStore } from '../../../src/ports/mocks/MemorySecureStore.js';
import { ExpoSecureStore }   from '../../../src/ports/secureStores/ExpoSecureStore.js';

function fakeExpoStore() {
  const map = new Map();
  return {
    getItemAsync:    vi.fn(async (k) => (map.has(k) ? map.get(k) : null)),
    setItemAsync:    vi.fn(async (k, v) => { map.set(k, v); }),
    deleteItemAsync: vi.fn(async (k) => { map.delete(k); }),
  };
}

function runSecureStoreContract(name, make) {
  describe(`SecureStore contract — ${name}`, () => {
    it('get() returns null for an absent key', async () => {
      expect(await make().get('missing')).toBeNull();
    });

    it('set() then get() round-trips', async () => {
      const s = make();
      await s.set('k', 'v');
      expect(await s.get('k')).toBe('v');
    });

    it('delete() removes (idempotent)', async () => {
      const s = make();
      await s.set('k', 'v');
      await s.delete('k');
      await s.delete('k');            // idempotent
      expect(await s.get('k')).toBeNull();
    });

    it('asOidcStore() exposes the expo-secure-store shape over the same data', async () => {
      const s = make();
      const oidc = s.asOidcStore();
      expect(typeof oidc.getItemAsync).toBe('function');
      expect(typeof oidc.setItemAsync).toBe('function');
      expect(typeof oidc.deleteItemAsync).toBe('function');
      await oidc.setItemAsync('tok', 'abc');
      expect(await oidc.getItemAsync('tok')).toBe('abc');
      expect(await s.get('tok')).toBe('abc');   // same backing store
      await oidc.deleteItemAsync('tok');
      expect(await oidc.getItemAsync('tok')).toBeNull();
    });
  });
}

runSecureStoreContract('MemorySecureStore', () => new MemorySecureStore());
runSecureStoreContract('ExpoSecureStore', () => new ExpoSecureStore({ store: fakeExpoStore() }));

describe('ExpoSecureStore — forwards 1:1 to expo-secure-store', () => {
  it('get/set/delete call the underlying *ItemAsync methods', async () => {
    const store = fakeExpoStore();
    const s = new ExpoSecureStore({ store });
    await s.set('k', 'v');
    await s.get('k');
    await s.delete('k');
    expect(store.setItemAsync).toHaveBeenCalledWith('k', 'v');
    expect(store.getItemAsync).toHaveBeenCalledWith('k');
    expect(store.deleteItemAsync).toHaveBeenCalledWith('k');
  });
});
