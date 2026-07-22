/**
 * MemoryStorageBackend — in-memory reference adapter for the `StorageBackend`
 * port, backed by a plain Map.
 *
 * The minimal, non-persistent ciphertext store: put/get/list over opaque
 * strings. It is the reference against which `assertStorageBackendConformance`
 * runs, and the local/test backend for the seal-is-the-gate path — content
 * sealed above the port round-trips through it and, because the seal (not this
 * store) is the access gate, the SAME sealed content moves unchanged to any
 * other backend and still opens.
 *
 * This adapter is deliberately dumb: it stores whatever ciphertext it is handed
 * and never decodes it. It holds no plaintext of its own — plaintext only ever
 * exists ABOVE the port, before `put` and after `get` + open.
 */
import { StorageBackend } from './StorageBackend.js';

export class MemoryStorageBackend extends StorageBackend {
  #store = new Map();

  async put(ref, ciphertext) {
    this.#store.set(ref, ciphertext);
  }

  async get(ref) {
    return this.#store.get(ref) ?? null;
  }

  async list(prefix = '') {
    const out = [];
    for (const ref of this.#store.keys()) {
      if (ref.startsWith(prefix)) out.push(ref);
    }
    return out.sort();
  }

  /** Number of stored entries (for testing). */
  get size() { return this.#store.size; }
}
