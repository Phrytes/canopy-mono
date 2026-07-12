/**
 * MemorySecureStore — in-memory {@link SecureStore} for tests.
 *
 * Backs get/set/delete with a Map.  `asOidcStore()` (inherited) yields the
 * `expo-secure-store`-shaped adapter, so it can stand in for a real device
 * store when unit-testing `OidcSessionRN`.
 */
import { SecureStore } from '../SecureStore.js';

export class MemorySecureStore extends SecureStore {
  #map = new Map();

  async get(key) {
    return this.#map.has(key) ? this.#map.get(key) : null;
  }

  async set(key, value) {
    this.#map.set(key, String(value));
  }

  async delete(key) {
    this.#map.delete(key);
  }

  /** Test helper — snapshot of stored keys. */
  get _keys() { return [...this.#map.keys()]; }
}
