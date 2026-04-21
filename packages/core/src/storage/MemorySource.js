/**
 * MemorySource — in-memory DataSource backed by a plain Map.
 * No persistence. Useful for tests and ephemeral agent state.
 */
import { DataSource } from './DataSource.js';

export class MemorySource extends DataSource {
  #store = new Map();

  async read(path) {
    return this.#store.get(path) ?? null;
  }

  async write(path, data) {
    this.#store.set(path, data);
  }

  async delete(path) {
    this.#store.delete(path);
  }

  async list(prefix = '') {
    const out = [];
    for (const key of this.#store.keys()) {
      if (key.startsWith(prefix)) out.push(key);
    }
    return out.sort();
  }

  async query(filter = {}) {
    const results = [];
    for (const [path, value] of this.#store) {
      let parsed;
      try {
        parsed = typeof value === 'string' ? JSON.parse(value) : value;
      } catch {
        continue;
      }
      if (typeof parsed !== 'object' || parsed === null) continue;
      if (_matches(parsed, filter)) results.push({ path, ...parsed });
    }
    return results;
  }

  /** Number of stored entries (for testing). */
  get size() { return this.#store.size; }
}

function _matches(obj, filter) {
  for (const [k, v] of Object.entries(filter)) {
    if (obj[k] !== v) return false;
  }
  return true;
}
