/**
 * canopy-chat — IndexedDB thread persistence.
 *
 * Local-first storage for the multi-thread workspace.  Browser
 * environments persist threads + messages across reloads; the
 * substrate works in any environment exposing the standard
 * `indexedDB` global (browser, happy-dom, fake-indexeddb).
 *
 * Schema (v1):
 *   db:    'canopy-chat'
 *   store: 'threads', keyPath: 'id'
 *   value: { id, name, createdAt, filter, permissions, messages,
 *            _listings: Array<[opId, listing]> }
 *
 * The `_listings` Map is serialised as an array of entries (Maps
 * don't survive structured-clone in older browsers reliably).
 *
 * Phase v0.2 sub-slice 2.8 per `/Project Files/canopy-chat/coding-plan.md`.
 * Pod sync (per OQ-3 user resolution: yes via the user's pod) lands
 * in v0.6 via the sibling `podSync.js`.
 */

import { Thread } from '../thread.js';

const DB_NAME    = 'canopy-chat';
const DB_VERSION = 1;
const STORE      = 'threads';

/* ─── low-level open/get/put/delete ─────────────────────── */

function openDb(idbFactory) {
  return new Promise((resolve, reject) => {
    const req = idbFactory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function reqAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort    = () => reject(tx.error);
    tx.onerror    = () => reject(tx.error);
  });
}

/* ─── serialisation ────────────────────────────────────── */

function threadToRecord(thread) {
  return {
    id:          thread.id,
    name:        thread.name,
    createdAt:   thread.createdAt,
    filter:      thread.filter,
    permissions: thread.permissions,
    messages:    thread.messages,
    _listings:   [...thread._listings.entries()],
  };
}

function recordToThread(rec, now) {
  const t = new Thread({
    id:          rec.id,
    name:        rec.name,
    createdAt:   rec.createdAt,
    filter:      rec.filter,
    permissions: rec.permissions,
    now,
  });
  t.messages = Array.isArray(rec.messages) ? rec.messages : [];
  if (Array.isArray(rec._listings)) {
    for (const [opId, listing] of rec._listings) {
      t._listings.set(opId, listing);
    }
  }
  return t;
}

/* ─── public API ────────────────────────────────────────── */

export class IndexedDBStore {
  /** @type {IDBFactory|undefined} */
  #idb;
  /** @type {Promise<IDBDatabase>|null} */
  #dbPromise;
  /** @type {() => number} */
  #now;

  /**
   * @param {object}      [opts]
   * @param {IDBFactory}  [opts.idb]       defaults to globalThis.indexedDB
   * @param {() => number}[opts.now=Date.now]
   */
  constructor(opts = {}) {
    this.#idb = opts.idb ?? (typeof indexedDB !== 'undefined' ? indexedDB : undefined);
    this.#dbPromise = null;
    this.#now = typeof opts.now === 'function' ? opts.now : Date.now;
  }

  #db() {
    if (!this.#idb) {
      return Promise.reject(new Error(
        'IndexedDBStore: no indexedDB available in this environment',
      ));
    }
    if (!this.#dbPromise) this.#dbPromise = openDb(this.#idb);
    return this.#dbPromise;
  }

  /**
   * Load every persisted thread.  Returns an array of `Thread`
   * instances (deserialised from records).  Empty when the store
   * is empty — caller seeds defaults in that case.
   *
   * @returns {Promise<Thread[]>}
   */
  async loadAll() {
    const db = await this.#db();
    const tx = db.transaction(STORE, 'readonly');
    const recs = await reqAsPromise(tx.objectStore(STORE).getAll());
    await txDone(tx);
    return (recs ?? []).map((rec) => recordToThread(rec, this.#now));
  }

  /**
   * Persist a single thread (insert-or-replace).
   *
   * @param {Thread} thread
   * @returns {Promise<void>}
   */
  async saveThread(thread) {
    if (!thread || !thread.id) {
      throw new TypeError('IndexedDBStore.saveThread: thread.id required');
    }
    const db = await this.#db();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(threadToRecord(thread));
    await txDone(tx);
  }

  /**
   * Remove a thread by id.
   *
   * @param {string} id
   * @returns {Promise<void>}
   */
  async deleteThread(id) {
    const db = await this.#db();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await txDone(tx);
  }

  /**
   * Wipe everything.  Useful for tests + a future "factory reset"
   * UX.
   *
   * @returns {Promise<void>}
   */
  async clear() {
    const db = await this.#db();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await txDone(tx);
  }

  /**
   * Close the underlying IDBDatabase + drop the cached promise so a
   * subsequent open re-runs.  Tests use this between fixtures.
   */
  async close() {
    if (!this.#dbPromise) return;
    const db = await this.#dbPromise;
    db.close();
    this.#dbPromise = null;
  }
}

/* ─── ThreadStore integration helper ─────────────────────── */

/**
 * Wire an IndexedDBStore to a ThreadStore so every store mutation
 * persists asynchronously.  Returns an unsubscribe function.
 *
 * Save semantics:
 *   - thread-created / thread-updated → saveThread(id)
 *   - thread-deleted                  → deleteThread(id)
 *   - active-changed                  → ignored (active is UI state)
 *
 * @param {object}                                          opts
 * @param {import('../threadStore.js').ThreadStore}         opts.threadStore
 * @param {IndexedDBStore}                                  opts.idb
 * @param {(err: Error) => void}                            [opts.onError]
 *   Called when an async save / delete rejects.  Defaults to
 *   console.error.
 * @returns {() => void}
 */
export function attachPersistence({ threadStore, idb, onError }) {
  const errHandler = onError ?? ((err) => {
    if (typeof console !== 'undefined') console.error('[canopy-chat persistence]', err);
  });

  return threadStore.subscribe((event) => {
    try {
      if (event.kind === 'thread-deleted') {
        Promise.resolve(idb.deleteThread(event.threadId)).catch(errHandler);
        return;
      }
      if (event.kind === 'thread-created' || event.kind === 'thread-updated') {
        const thread = threadStore.getThread(event.threadId);
        if (!thread) return;
        Promise.resolve(idb.saveThread(thread)).catch(errHandler);
        return;
      }
      // active-changed → not persisted (UI state, not durable).
    } catch (err) {
      errHandler(err);
    }
  });
}
