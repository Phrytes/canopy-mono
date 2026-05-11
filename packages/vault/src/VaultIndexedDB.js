/**
 * VaultIndexedDB — browser Vault backed by IndexedDB.
 *
 * Values are stored as strings in a single object store.
 * Optional AES-GCM encryption: if encryptionKey is provided (a CryptoKey or
 * a passphrase string), values are encrypted before storage.
 *
 * Browser only — throws if IndexedDB is unavailable.
 */
import { Vault } from './Vault.js';

export class VaultIndexedDB extends Vault {
  #dbName;
  #storeName;
  #encKey;    // CryptoKey | null
  #db = null;

  /**
   * @param {object} [opts]
   * @param {string}          [opts.dbName='dwag-vault']
   * @param {string}          [opts.storeName='vault']
   * @param {string|CryptoKey} [opts.encryptionKey]  — passphrase string or CryptoKey
   */
  constructor({ dbName = 'dwag-vault', storeName = 'vault', encryptionKey } = {}) {
    super();
    if (typeof indexedDB === 'undefined') throw new Error('VaultIndexedDB requires IndexedDB (browser only)');
    this.#dbName    = dbName;
    this.#storeName = storeName;
    this.#encKey    = encryptionKey ?? null;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  async #open() {
    if (this.#db) return;

    // Resolve encryption key from passphrase if needed
    if (typeof this.#encKey === 'string') {
      this.#encKey = await _deriveKey(this.#encKey, this.#dbName);
    }

    this.#db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(this.#dbName, 1);
      req.onupgradeneeded = e => {
        e.target.result.createObjectStore(this.#storeName);
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  // ── Vault interface ─────────────────────────────────────────────────────────

  async get(key) {
    await this.#open();
    const raw = await this.#tx('readonly', store => store.get(key));
    if (raw == null) return null;
    return this.#encKey ? _decrypt(this.#encKey, raw) : raw;
  }

  async set(key, value) {
    await this.#open();
    const stored = this.#encKey ? await _encrypt(this.#encKey, value) : value;
    await this.#tx('readwrite', store => store.put(stored, key));
  }

  async delete(key) {
    await this.#open();
    await this.#tx('readwrite', store => store.delete(key));
  }

  async has(key) {
    await this.#open();
    const v = await this.#tx('readonly', store => store.get(key));
    return v != null;
  }

  async list() {
    await this.#open();
    return this.#tx('readonly', store => store.getAllKeys());
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  #tx(mode, fn) {
    return new Promise((resolve, reject) => {
      const tx  = this.#db.transaction(this.#storeName, mode);
      const req = fn(tx.objectStore(this.#storeName));
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }
}

// ── AES-GCM helpers ───────────────────────────────────────────────────────────

async function _deriveKey(passphrase, salt) {
  const enc      = new TextEncoder();
  const keyMat   = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100_000, hash: 'SHA-256' },
    keyMat,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function _encrypt(key, plaintext) {
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const enc  = new TextEncoder();
  const ct   = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  // Store as base64(iv):base64(ciphertext)
  const b64  = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  return `${b64(iv)}:${b64(ct)}`;
}

async function _decrypt(key, stored) {
  const [ivB64, ctB64] = stored.split(':');
  const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const iv   = b64d(ivB64);
  const ct   = b64d(ctB64);
  const pt   = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}
