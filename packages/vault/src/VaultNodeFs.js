/**
 * VaultNodeFs — AES-256-GCM encrypted JSON file vault for Node.js.
 *
 * File layout (JSON):
 *   { version: 1, salt: "<base64>", entries: { "<key>": "<iv:tag:ciphertext base64>" } }
 *
 * If no passphrase is provided the vault falls back to plaintext JSON
 * (useful for dev/CI where secrets are ephemeral anyway).
 *
 * Node.js only — throws a clear error if used in a browser.
 *
 * Node modules are imported lazily (inside the first async method call) so
 * this file can be loaded in a browser without crashing the module loader.
 */
import { Vault } from './Vault.js';

const VERSION  = 1;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN  = 32;
const IV_LEN   = 12;
const TAG_LEN  = 16;
const ALG      = 'aes-256-gcm';

export class VaultNodeFs extends Vault {
  #filePath;
  #passphrase;

  // Populated by #load() on first use.
  #loaded = false;
  #key    = null;  // Buffer | null
  #salt   = null;  // Buffer | null
  #data   = null;  // Map<string, string>
  #fns    = null;  // { writeFileSync, mkdirSync, dirname, randomBytes, createCipheriv, createDecipheriv }

  /**
   * @param {string}  filePath     — path to the JSON file
   * @param {string}  [passphrase] — omit for plaintext (dev only)
   */
  constructor(filePath, passphrase) {
    super();
    this.#filePath   = filePath;
    this.#passphrase = passphrase ?? null;
  }

  async get(key) {
    await this.#load();
    const raw = this.#data.get(key) ?? null;
    if (raw === null || !this.#key) return raw;
    return this.#decrypt(raw);
  }

  async set(key, value) {
    await this.#load();
    const stored = this.#key ? this.#encrypt(String(value)) : String(value);
    this.#data.set(key, stored);
    this.#flush();
  }

  async delete(key) {
    await this.#load();
    this.#data.delete(key);
    this.#flush();
  }

  async has(key) {
    await this.#load();
    return this.#data.has(key);
  }

  async list() {
    await this.#load();
    return [...this.#data.keys()];
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  async #load() {
    if (this.#loaded) return;
    this.#loaded = true;

    let fsM, pathM, cryptoM;
    try {
      [fsM, pathM, cryptoM] = await Promise.all([
        import('node:fs'),
        import('node:path'),
        import('node:crypto'),
      ]);
    } catch {
      throw new Error('VaultNodeFs is Node.js only — use VaultMemory or VaultLocalStorage in browsers');
    }

    const { readFileSync, writeFileSync, existsSync, mkdirSync } = fsM;
    const { dirname }                                             = pathM;
    const { randomBytes, scryptSync, createCipheriv, createDecipheriv } = cryptoM;

    // Keep write-side functions for #flush() / #encrypt() / #decrypt().
    this.#fns = { writeFileSync, mkdirSync, dirname,
                  randomBytes, createCipheriv, createDecipheriv };

    let raw = { version: VERSION, entries: {} };
    if (existsSync(this.#filePath)) {
      raw = JSON.parse(readFileSync(this.#filePath, 'utf8'));
    }

    if (this.#passphrase) {
      this.#salt = raw.salt
        ? Buffer.from(raw.salt, 'base64')
        : randomBytes(32);
      this.#key = scryptSync(
        this.#passphrase, this.#salt, KEY_LEN,
        { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      );
    }

    this.#data = new Map(Object.entries(raw.entries ?? {}));
  }

  #encrypt(plaintext) {
    const { randomBytes, createCipheriv } = this.#fns;
    const iv     = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALG, this.#key, iv);
    const ct     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag    = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ct]).toString('base64');
  }

  #decrypt(encoded) {
    const { createDecipheriv } = this.#fns;
    const buf     = Buffer.from(encoded, 'base64');
    const iv      = buf.subarray(0, IV_LEN);
    const tag     = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct      = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALG, this.#key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }

  #flush() {
    const { writeFileSync, mkdirSync, dirname } = this.#fns;
    const dir = dirname(this.#filePath);
    if (dir && dir !== '.') mkdirSync(dir, { recursive: true });
    const payload = { version: VERSION, entries: Object.fromEntries(this.#data) };
    if (this.#salt) payload.salt = this.#salt.toString('base64');
    writeFileSync(this.#filePath, JSON.stringify(payload, null, 2), 'utf8');
  }
}
