/**
 * AsBackend — AsyncStorage-backed `StorageBackend`.
 *
 * Suited for small payloads + metadata. AsyncStorage is string-only,
 * so values are JSON-encoded on put + decoded on get. Subscribe
 * semantics: a pure in-memory event emitter that fires when this
 * process writes to the backend — cross-process subscriptions are
 * out of scope (not needed for the agent's lifetime).
 *
 * Standardisation Phase 51.3.
 *
 * @typedef {import('@canopy/pseudo-pod').StorageBackend} StorageBackend
 * @typedef {import('@canopy/pseudo-pod').BackendEvent} BackendEvent
 */

import { makeEtagCounter } from './_utils.js';

/**
 * @param {object} opts
 * @param {object} opts.AsyncStorage          — namespace import
 *   (`@react-native-async-storage/async-storage`); injectable for
 *   tests + non-RN runtimes.
 * @param {string} [opts.scope='pp']          — key prefix
 * @param {string} [opts.etagPrefix='as']     — prefix for generated etags
 */
export function createAsBackend({
  AsyncStorage,
  scope = 'pp',
  etagPrefix = 'as',
} = {}) {
  if (!AsyncStorage || typeof AsyncStorage.getItem !== 'function') {
    throw Object.assign(
      new Error('createAsBackend: AsyncStorage namespace is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  const _scopePrefix = scope.endsWith(':') ? scope : `${scope}:`;
  const nextEtag = makeEtagCounter(etagPrefix);

  const generalSubscribers = new Set();
  const prefixSubscribers  = new Map();   // string → Set<cb>
  const dirtySubscribers   = new Set();
  const dirty              = new Set();

  function _scopeKey(key)  { return _scopePrefix + key; }
  function _stripScope(k)  { return k.startsWith(_scopePrefix) ? k.slice(_scopePrefix.length) : k; }

  function _fanOut(event) {
    for (const cb of generalSubscribers) { try { cb(event); } catch { /* swallow */ } }
    for (const [prefix, subs] of prefixSubscribers) {
      if (event.key.startsWith(prefix)) {
        for (const cb of subs) { try { cb(event); } catch { /* swallow */ } }
      }
    }
  }

  function _fanOutDirty(event) {
    for (const cb of dirtySubscribers) { try { cb(event); } catch { /* swallow */ } }
  }

  async function get(key) {
    const raw = await AsyncStorage.getItem(_scopeKey(key));
    if (raw == null) return null;
    try {
      const rec = JSON.parse(raw);
      if (rec && typeof rec === 'object' && 'bytes' in rec) {
        return { bytes: rec.bytes, ...(rec.etag != null ? { etag: rec.etag } : {}) };
      }
      // Older string-only writes (compat).
      return { bytes: raw };
    } catch {
      return { bytes: raw };
    }
  }

  async function put(key, bytes, etag) {
    const finalEtag = etag ?? nextEtag();
    const record = { bytes, etag: finalEtag };
    await AsyncStorage.setItem(_scopeKey(key), JSON.stringify(record));
    _fanOut({ op: 'put', key, etag: finalEtag });
    return finalEtag;
  }

  async function del(key) {
    await AsyncStorage.removeItem(_scopeKey(key));
    _fanOut({ op: 'delete', key });
    if (dirty.has(key)) {
      dirty.delete(key);
      _fanOutDirty({ op: 'clean', key });
    }
  }

  async function list(prefix) {
    const all = await AsyncStorage.getAllKeys();
    const out = [];
    for (const k of all) {
      if (!k.startsWith(_scopePrefix)) continue;
      const unscoped = _stripScope(k);
      if (unscoped.startsWith(prefix)) out.push(unscoped);
    }
    out.sort();
    return out;
  }

  function subscribe(prefix, cb) {
    if (typeof prefix !== 'string') {
      // subscribe(cb) shorthand
      generalSubscribers.add(prefix);
      return () => { generalSubscribers.delete(prefix); };
    }
    if (typeof cb !== 'function') {
      throw Object.assign(
        new Error('subscribe: callback is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    let subs = prefixSubscribers.get(prefix);
    if (!subs) { subs = new Set(); prefixSubscribers.set(prefix, subs); }
    subs.add(cb);
    return () => {
      subs.delete(cb);
      if (subs.size === 0) prefixSubscribers.delete(prefix);
    };
  }

  async function listDirty() {
    return [...dirty].sort();
  }

  function subscribeDirty(cb) {
    if (typeof cb !== 'function') {
      throw Object.assign(
        new Error('subscribeDirty: callback is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    dirtySubscribers.add(cb);
    return () => { dirtySubscribers.delete(cb); };
  }

  return {
    get,
    put,
    delete: del,
    list,
    subscribe,
    listDirty,
    subscribeDirty,

    // Phase 51.5 V1-ready hooks (no-op in V0 — apps wire them later).
    _markDirty(key) {
      if (!dirty.has(key)) { dirty.add(key); _fanOutDirty({ op: 'dirty', key }); }
    },
    _markClean(key) {
      if (dirty.has(key)) { dirty.delete(key); _fanOutDirty({ op: 'clean', key }); }
    },
    get _scope() { return scope; },
    get _kind()  { return 'AsBackend'; },
  };
}
