/**
 * MemoryBackend — in-memory `StorageBackend` for tests + V0 default.
 *
 * Stores records in a plain Map keyed by string. Etag is a
 * monotonic counter per backend instance (so the same value
 * written twice gets distinct etags — callers that want
 * content-hash etags can layer that themselves).
 *
 * Standardisation Phase 52.2 — see
 * `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md`.
 *
 * @typedef {import('./StorageBackend.js').StoredRecord} StoredRecord
 * @typedef {import('./StorageBackend.js').StorageBackend} StorageBackend
 * @typedef {import('./StorageBackend.js').BackendEvent} BackendEvent
 */

/**
 * Create a fresh in-memory backend.
 *
 * @returns {StorageBackend & { _size: () => number }}
 */
export function createMemoryBackend() {
  /** @type {Map<string, StoredRecord>} */
  const store = new Map();
  /** @type {Set<(e: BackendEvent) => void>} */
  const generalSubscribers = new Set();
  /** @type {Map<string, Set<(e: BackendEvent) => void>>} */
  const prefixSubscribers = new Map();
  /** @type {Set<(e: BackendEvent) => void>} */
  const dirtySubscribers = new Set();
  /** @type {Set<string>} */
  const dirty = new Set();

  let etagCounter = 0;
  const nextEtag = () => `"mem-${++etagCounter}"`;

  function _fanOut(event) {
    for (const cb of generalSubscribers) {
      try { cb(event); } catch (_err) { /* swallow — substrate-internal */ }
    }
    for (const [prefix, subs] of prefixSubscribers) {
      if (event.key.startsWith(prefix)) {
        for (const cb of subs) {
          try { cb(event); } catch (_err) { /* swallow */ }
        }
      }
    }
  }

  function _fanOutDirty(event) {
    for (const cb of dirtySubscribers) {
      try { cb(event); } catch (_err) { /* swallow */ }
    }
  }

  return {
    async get(key) {
      const rec = store.get(key);
      if (!rec) return null;
      return { bytes: rec.bytes, ...(rec.etag != null ? { etag: rec.etag } : {}) };
    },

    async put(key, bytes, etag) {
      const finalEtag = etag ?? nextEtag();
      store.set(key, { bytes, etag: finalEtag });
      _fanOut({ op: 'put', key, etag: finalEtag });
      return finalEtag;
    },

    async delete(key) {
      if (store.has(key)) {
        store.delete(key);
        _fanOut({ op: 'delete', key });
      }
      if (dirty.has(key)) {
        dirty.delete(key);
        _fanOutDirty({ op: 'clean', key });
      }
    },

    async list(prefix) {
      const out = [];
      for (const k of store.keys()) {
        if (k.startsWith(prefix)) out.push(k);
      }
      out.sort();
      return out;
    },

    subscribe(prefix, cb) {
      if (typeof prefix !== 'string') {
        // Treat as general subscriber (subscribe(cb) shorthand).
        generalSubscribers.add(prefix);
        return () => { generalSubscribers.delete(prefix); };
      }
      if (typeof cb !== 'function') {
        throw Object.assign(
          new Error('subscribe: callback must be a function'),
          { code: 'INVALID_ARGUMENT' },
        );
      }
      let subs = prefixSubscribers.get(prefix);
      if (!subs) {
        subs = new Set();
        prefixSubscribers.set(prefix, subs);
      }
      subs.add(cb);
      return () => {
        subs.delete(cb);
        if (subs.size === 0) prefixSubscribers.delete(prefix);
      };
    },

    async listDirty() {
      return [...dirty].sort();
    },

    subscribeDirty(cb) {
      if (typeof cb !== 'function') {
        throw Object.assign(
          new Error('subscribeDirty: callback must be a function'),
          { code: 'INVALID_ARGUMENT' },
        );
      }
      dirtySubscribers.add(cb);
      return () => { dirtySubscribers.delete(cb); };
    },

    // ── Test/internal helpers ──────────────────────────────
    _size: () => store.size,
    _markDirty(key) {
      if (!dirty.has(key)) {
        dirty.add(key);
        _fanOutDirty({ op: 'dirty', key });
      }
    },
    _markClean(key) {
      if (dirty.has(key)) {
        dirty.delete(key);
        _fanOutDirty({ op: 'clean', key });
      }
    },
  };
}
