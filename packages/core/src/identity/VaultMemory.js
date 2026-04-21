import { Vault } from './Vault.js';

/**
 * In-memory vault. Secrets are lost when the process exits.
 * Use for tests and ephemeral server agents.
 */
export class VaultMemory extends Vault {
  #store = new Map();

  async get(key)        { return this.#store.get(key) ?? null; }
  async set(key, value) { this.#store.set(key, String(value)); }
  async delete(key)     { this.#store.delete(key); }
  async has(key)        { return this.#store.has(key); }
  async list()          { return [...this.#store.keys()]; }
}
