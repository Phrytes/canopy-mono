/**
 * VaultLocalStorage — browser localStorage vault.
 *
 * Keys are namespaced under `prefix` (default "dwag:").
 * Values are stored as plaintext strings. For production use, combine
 * with an encryption layer or use VaultIndexedDB with a passphrase.
 *
 * This class is browser-only. It references `window.localStorage` which
 * does not exist in Node.js. Import it only in browser entry points.
 */
import { Vault } from './Vault.js';

export class VaultLocalStorage extends Vault {
  #prefix;
  #storage;

  /**
   * @param {object}  [opts]
   * @param {string}  [opts.prefix='dwag:'] — key namespace
   * @param {Storage} [opts.storage]        — injectable (e.g. sessionStorage or mock)
   */
  constructor({ prefix = 'dwag:', storage } = {}) {
    super();
    this.#prefix = prefix;
    /* Allow injecting a custom storage object for tests running in jsdom. */
    this.#storage = storage ?? globalThis.localStorage;
    if (!this.#storage) {
      throw new Error('VaultLocalStorage requires window.localStorage (browser only)');
    }
  }

  async get(key)        { return this.#storage.getItem(this.#prefix + key); }
  async set(key, value) { this.#storage.setItem(this.#prefix + key, String(value)); }
  async delete(key)     { this.#storage.removeItem(this.#prefix + key); }
  async has(key)        { return this.#storage.getItem(this.#prefix + key) !== null; }

  async list() {
    const keys = [];
    for (let i = 0; i < this.#storage.length; i++) {
      const k = this.#storage.key(i);
      if (k?.startsWith(this.#prefix)) {
        keys.push(k.slice(this.#prefix.length));
      }
    }
    return keys;
  }
}
