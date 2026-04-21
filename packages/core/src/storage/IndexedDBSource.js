/**
 * IndexedDBSource — browser IndexedDB DataSource.
 *
 * Each path is a string key in a single object store.
 * Values are stored as strings (write converts Buffer/Uint8Array → base64).
 *
 * Not available in Node.js — will throw if IndexedDB is absent.
 */
import { DataSource } from './DataSource.js';

export class IndexedDBSource extends DataSource {
  #dbName;
  #storeName;
  #db = null;

  /**
   * @param {object} opts
   * @param {string} opts.dbName
   * @param {string} [opts.storeName='data']
   */
  constructor({ dbName, storeName = 'data' }) {
    super();
    this.#dbName    = dbName;
    this.#storeName = storeName;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  async open() {
    if (this.#db) return;
    this.#db = await this.#openDB();
  }

  // ── DataSource API ──────────────────────────────────────────────────────────

  async read(path) {
    await this.open();
    return this.#tx('readonly', store => store.get(path));
  }

  async write(path, data) {
    await this.open();
    const value = _serialize(data);
    return this.#tx('readwrite', store => store.put(value, path));
  }

  async delete(path) {
    await this.open();
    return this.#tx('readwrite', store => store.delete(path));
  }

  async list(prefix = '') {
    await this.open();
    const keys = await this.#tx('readonly', store => store.getAllKeys());
    return keys.filter(k => k.startsWith(prefix)).sort();
  }

  async query(filter = {}) {
    await this.open();
    const keys   = await this.list();
    const results = [];
    for (const path of keys) {
      const raw = await this.read(path);
      let parsed;
      try { parsed = JSON.parse(raw); } catch { continue; }
      if (typeof parsed !== 'object' || parsed === null) continue;
      if (_matches(parsed, filter)) results.push({ path, ...parsed });
    }
    return results;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  #openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.#dbName, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(this.#storeName);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  #tx(mode, fn) {
    return new Promise((resolve, reject) => {
      const tx  = this.#db.transaction(this.#storeName, mode);
      const req = fn(tx.objectStore(this.#storeName));
      if (req) {
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror   = () => reject(req.error);
      } else {
        tx.oncomplete = () => resolve(null);
        tx.onerror    = () => reject(tx.error);
      }
    });
  }
}

function _serialize(data) {
  if (data instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(data))) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    return btoa(String.fromCharCode(...bytes));
  }
  return data;
}

function _matches(obj, filter) {
  for (const [k, v] of Object.entries(filter)) {
    if (obj[k] !== v) return false;
  }
  return true;
}
