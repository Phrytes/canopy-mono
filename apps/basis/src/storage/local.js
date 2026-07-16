/**
 * basis — IndexedDB thread persistence.
 *
 * Local-first storage for the multi-thread workspace.  Browser
 * environments persist threads + messages across reloads; the
 * substrate works in any environment exposing the standard
 * `indexedDB` global (browser, happy-dom, fake-indexeddb).
 *
 * Schema (v1):
 *   db:    'basis'
 *   store: 'threads', keyPath: 'id'
 *   value: { id, name, createdAt, filter, permissions, messages,
 *            _listings: Array<[opId, listing]> }
 *
 * The `_listings` Map is serialised as an array of entries (Maps
 * don't survive structured-clone in older browsers reliably).
 *
 * Phase v0.2 sub-slice 2.8 per `/Project Files/basis/coding-plan.md`.
 * Pod sync (per OQ-3 user resolution: yes via the user's pod) lands
 * in v0.6 via the sibling `podSync.js`.
 */

import { Thread } from '../thread.js';

const DB_NAME    = 'basis';
// v0.7.1 — schema bumped to v3:
//   v1: threads
//   v2: + in-flight-flows  (external-flow primitive, J6 framework)
//   v3: + events           (network-events log, D.1; ts-indexed)
// All upgrades additive; existing data unchanged.
const DB_VERSION = 3;
const STORE          = 'threads';
const STORE_INFLIGHT = 'in-flight-flows';
const STORE_EVENTS   = 'events';
const STORE_MUTED    = 'event-mutes';   // keyless: single 'set' entry
// Single fixed key for the in-flight list (one row holding all
// pending flows, simpler than a multi-row keyPath).
const INFLIGHT_KEY = 'flows';
const MUTED_KEY    = 'set';

/* ─── low-level open/get/put/delete ─────────────────────── */

function openDb(idbFactory) {
  return new Promise((resolve, reject) => {
    const req = idbFactory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
      // v0.6.2 — in-flight-flows store for external-flow primitive.
      if (!db.objectStoreNames.contains(STORE_INFLIGHT)) {
        // No keyPath — we use the fixed string INFLIGHT_KEY.
        db.createObjectStore(STORE_INFLIGHT);
      }
      // v0.7.1 — events log + event-mutes store.
      if (!db.objectStoreNames.contains(STORE_EVENTS)) {
        const events = db.createObjectStore(STORE_EVENTS, { keyPath: 'id' });
        // Index on ts so 14-day prune is fast on cold boot.
        events.createIndex('ts', 'ts', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_MUTED)) {
        db.createObjectStore(STORE_MUTED);
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
    // 2026-05-24 — strip DOM-bearing fields ('form'-kind messages
    // carry a live HTMLElement that IDB.structuredClone can't
    // serialise).  Replace with a placeholder text so the message
    // history shape stays consistent across reloads; the live UI
    // (forms, responder cards) is ephemeral by design.
    messages:    thread.messages.map(stripDomFields),
    _listings:   [...thread._listings.entries()],
    ...(thread.origin ? { origin: thread.origin } : {}),
  };
}

function stripDomFields(msg) {
  if (!msg || typeof msg !== 'object') return msg;
  // Detect any field that's a DOM Node (HTMLElement / Element).
  let out = msg;
  for (const k of Object.keys(msg)) {
    const v = msg[k];
    if (v && typeof v === 'object' && typeof v.nodeType === 'number') {
      if (out === msg) out = { ...msg };
      delete out[k];
    }
  }
  // The same can hide inside rendered.formElement.
  if (out.rendered && typeof out.rendered === 'object' && out.rendered.formElement) {
    out = { ...out, rendered: { ...out.rendered } };
    delete out.rendered.formElement;
  }
  return out;
}

function recordToThread(rec, now) {
  const t = new Thread({
    id:          rec.id,
    name:        rec.name,
    createdAt:   rec.createdAt,
    filter:      rec.filter,
    permissions: rec.permissions,
    origin:      rec.origin,
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
   * v0.6.2 — load the in-flight-flows list (external-flow primitive
   * persistence).  Returns an empty array when never written.
   *
   * @returns {Promise<Array<object>>}
   */
  async loadInFlight() {
    const db = await this.#db();
    const tx = db.transaction(STORE_INFLIGHT, 'readonly');
    const result = await reqAsPromise(
      tx.objectStore(STORE_INFLIGHT).get(INFLIGHT_KEY),
    );
    await txDone(tx);
    return Array.isArray(result) ? result : [];
  }

  /**
   * v0.6.2 — overwrite the in-flight-flows list.  Caller is
   * responsible for the read-modify-write race window; the
   * external-flow module passes a fresh array each call.
   *
   * @param {Array<object>} flows
   * @returns {Promise<void>}
   */
  async saveInFlight(flows) {
    const db = await this.#db();
    const tx = db.transaction(STORE_INFLIGHT, 'readwrite');
    tx.objectStore(STORE_INFLIGHT).put(Array.isArray(flows) ? flows : [], INFLIGHT_KEY);
    await txDone(tx);
  }

  /* ─── v0.7.1 events log persistence ─────────────────────── */

  /**
   * Load every event from the log (oldest-first by ts index).
   * Returns most-recent-first to match EventLog's internal ordering.
   *
   * @returns {Promise<Array<object>>}
   */
  async loadEvents() {
    const db = await this.#db();
    const tx = db.transaction(STORE_EVENTS, 'readonly');
    const result = await reqAsPromise(tx.objectStore(STORE_EVENTS).getAll());
    await txDone(tx);
    if (!Array.isArray(result)) return [];
    return result.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  }

  /**
   * Overwrite the entire event log.  Called after EventLog prune.
   *
   * @param {Array<object>} events
   * @returns {Promise<void>}
   */
  async saveEvents(events) {
    const db = await this.#db();
    const tx = db.transaction(STORE_EVENTS, 'readwrite');
    const store = tx.objectStore(STORE_EVENTS);
    store.clear();
    for (const e of (Array.isArray(events) ? events : [])) {
      if (e && typeof e.id === 'string') store.put(e);
    }
    await txDone(tx);
  }

  /**
   * Append a single event without touching the rest of the log.
   * Faster than saveEvents() for the common-case single-append path.
   *
   * @param {object} event
   * @returns {Promise<void>}
   */
  async appendEvent(event) {
    if (!event || typeof event.id !== 'string') return;
    const db = await this.#db();
    const tx = db.transaction(STORE_EVENTS, 'readwrite');
    tx.objectStore(STORE_EVENTS).put(event);
    await txDone(tx);
  }

  /**
   * Delete every event with ts < cutoff.  Used by the 14-day prune
   * on boot — avoids loading + filtering + re-saving the whole log.
   *
   * @param {number} cutoff   epoch ms
   * @returns {Promise<number>}  number pruned
   */
  async pruneEventsBefore(cutoff) {
    const db = await this.#db();
    const tx = db.transaction(STORE_EVENTS, 'readwrite');
    const idx = tx.objectStore(STORE_EVENTS).index('ts');
    const range = IDBKeyRange.upperBound(cutoff, true);
    let count = 0;
    await new Promise((resolve, reject) => {
      const req = idx.openCursor(range);
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) { cursor.delete(); count++; cursor.continue(); }
        else        { resolve(); }
      };
      req.onerror = () => reject(req.error);
    });
    await txDone(tx);
    return count;
  }

  /** v0.7.1 — load the muted-keys set. */
  async loadMutedEvents() {
    const db = await this.#db();
    const tx = db.transaction(STORE_MUTED, 'readonly');
    const r  = await reqAsPromise(tx.objectStore(STORE_MUTED).get(MUTED_KEY));
    await txDone(tx);
    return Array.isArray(r) ? r : [];
  }

  /** v0.7.1 — overwrite the muted-keys set. */
  async saveMutedEvents(muted) {
    const db = await this.#db();
    const tx = db.transaction(STORE_MUTED, 'readwrite');
    tx.objectStore(STORE_MUTED).put(Array.isArray(muted) ? muted : [], MUTED_KEY);
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
    const tx = db.transaction([STORE, STORE_INFLIGHT, STORE_EVENTS, STORE_MUTED], 'readwrite');
    tx.objectStore(STORE).clear();
    tx.objectStore(STORE_INFLIGHT).clear();
    tx.objectStore(STORE_EVENTS).clear();
    tx.objectStore(STORE_MUTED).clear();
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
    if (typeof console !== 'undefined') console.error('[basis persistence]', err);
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
