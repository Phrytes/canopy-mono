/**
 * MemoryTombstones — Map-backed `TombstoneStore` for tests + as a default
 * fallback when no platform adapter is configured.
 *
 * NOT persistent.  Production apps should pass a platform-appropriate
 * adapter (`IndexedDBTombstones` / `AsyncStorageTombstones` /
 * `FileTombstones`) on the `PodClient` constructor.
 *
 * Multiple `PodClient` instances can share a single `MemoryTombstones`
 * instance to verify cross-client visibility within a single process.
 */
import { TombstoneStore } from '../TombstoneStore.js';

export class MemoryTombstones extends TombstoneStore {
  #map = new Map();

  async add(uri, { at } = {}) {
    this.#map.set(uri, { at: at ?? Date.now() });
  }

  async has(uri) {
    return this.#map.has(uri);
  }

  async remove(uri) {
    this.#map.delete(uri);
  }

  async list() {
    return Array.from(this.#map.entries()).map(([uri, v]) => ({ uri, at: v.at }));
  }

  async close() {
    // No-op; in-memory only.  We deliberately do NOT clear on close so
    // tests can re-construct a PodClient against the same store and
    // observe persisted tombstones.
  }
}
