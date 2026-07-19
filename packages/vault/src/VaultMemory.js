import { Vault } from './Vault.js';

/**
 * In-memory vault. Secrets are lost when the process exits.
 * Use for tests and ephemeral server agents.
 *
 * `snapshot` + `VaultMemory.fromSnapshot`
 * support callers that want to persist a vault's contents to a
 * regular DataSource (e.g. Tasks's cap-token-bound bot agents
 * serialise their vault under the local-store cache so cap-token
 * bindings survive a CLI restart). Snapshots are plain JSON-safe
 * objects (`{key: string-value}`) — encryption-at-rest, if needed,
 * is the caller's responsibility.
 */
export class VaultMemory extends Vault {
  #store = new Map();

  async get(key)        { return this.#store.get(key) ?? null; }
  async set(key, value) { this.#store.set(key, String(value)); }
  async delete(key)     { this.#store.delete(key); }
  async has(key)        { return this.#store.has(key); }
  async list()          { return [...this.#store.keys()]; }

  /** Plain `{key: value}` dump of every entry. Sync. */
  snapshot() {
    return Object.fromEntries(this.#store);
  }

  /** Build a fresh vault pre-populated from a snapshot. */
  static fromSnapshot(obj) {
    const v = new VaultMemory();
    if (obj && typeof obj === 'object') {
      for (const [k, val] of Object.entries(obj)) v.#store.set(k, String(val));
    }
    return v;
  }
}
