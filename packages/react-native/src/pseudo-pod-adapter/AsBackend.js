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
 * @typedef {import('@onderling/pseudo-pod').StorageBackend} StorageBackend
 * @typedef {import('@onderling/pseudo-pod').BackendEvent} BackendEvent
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
  // Phase 51.5: persistent dirty-set under a dedicated sub-namespace.
  // Surviving restarts lets pseudo-pod V1's write-through queue
  // re-discover pending entries on agent boot.
  const _dirtyPrefix = `${_scopePrefix}__dirty__:`;
  const nextEtag = makeEtagCounter(etagPrefix);

  const generalSubscribers = new Set();
  const prefixSubscribers  = new Map();   // string → Set<cb>
  const dirtySubscribers   = new Set();

  function _scopeKey(key)  { return _scopePrefix + key; }
  function _dirtyKey(key)  { return _dirtyPrefix + key; }
  function _stripScope(k)  { return k.startsWith(_scopePrefix) ? k.slice(_scopePrefix.length) : k; }
  function _isDirtyKey(k)  { return k.startsWith(_dirtyPrefix); }
  function _stripDirty(k)  { return k.slice(_dirtyPrefix.length); }

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
        return {
          bytes: rec.bytes,
          ...(rec.etag != null ? { etag: rec.etag } : {}),
          ...(typeof rec._v === 'number' ? { _v: rec._v } : {}),
        };
      }
      // Older string-only writes (compat).
      return { bytes: raw };
    } catch {
      return { bytes: raw };
    }
  }

  /**
   * Phase 52.14 (Q-D 2026-05-14) — Lamport-style per-key version
   * counter for replication-ring conflict resolution. When the caller
   * pins a specific `_v` we honour it (the "accept peer's write"
   * path); otherwise we increment by 1 (new key starts at 1).
   */
  async function put(key, bytes, etag, _v) {
    const finalEtag = etag ?? nextEtag();
    let finalV;
    if (typeof _v === 'number') {
      finalV = _v;
    } else {
      const prevRaw = await AsyncStorage.getItem(_scopeKey(key));
      let prevV = 0;
      if (prevRaw != null) {
        try {
          const prev = JSON.parse(prevRaw);
          if (prev && typeof prev._v === 'number') prevV = prev._v;
        } catch { /* ignore */ }
      }
      finalV = prevV + 1;
    }
    const record = { bytes, etag: finalEtag, _v: finalV };
    await AsyncStorage.setItem(_scopeKey(key), JSON.stringify(record));
    _fanOut({ op: 'put', key, etag: finalEtag, _v: finalV });
    return { etag: finalEtag, _v: finalV };
  }

  async function del(key) {
    await AsyncStorage.removeItem(_scopeKey(key));
    _fanOut({ op: 'delete', key });
    // Best-effort clean of any associated dirty marker.
    const dirtyKey = _dirtyKey(key);
    const dirtyRaw = await AsyncStorage.getItem(dirtyKey);
    if (dirtyRaw != null) {
      await AsyncStorage.removeItem(dirtyKey);
      _fanOutDirty({ op: 'clean', key });
    }
  }

  async function list(prefix) {
    const all = await AsyncStorage.getAllKeys();
    const out = [];
    for (const k of all) {
      if (!k.startsWith(_scopePrefix)) continue;
      if (_isDirtyKey(k))               continue;   // hide the __dirty__ namespace
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
    const all = await AsyncStorage.getAllKeys();
    const out = [];
    for (const k of all) {
      if (_isDirtyKey(k)) out.push(_stripDirty(k));
    }
    out.sort();
    return out;
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

  /**
   * Mark a key dirty. Persistent: survives backend recreation.
   * Idempotent — re-marking a dirty key is a no-op (no second event).
   */
  async function _markDirty(key) {
    const dirtyKey = _dirtyKey(key);
    const existing = await AsyncStorage.getItem(dirtyKey);
    if (existing != null) return;
    await AsyncStorage.setItem(dirtyKey, '1');
    _fanOutDirty({ op: 'dirty', key });
  }

  /** Clear the dirty flag for a key. Idempotent. */
  async function _markClean(key) {
    const dirtyKey = _dirtyKey(key);
    const existing = await AsyncStorage.getItem(dirtyKey);
    if (existing == null) return;
    await AsyncStorage.removeItem(dirtyKey);
    _fanOutDirty({ op: 'clean', key });
  }

  return {
    get,
    put,
    delete: del,
    list,
    subscribe,
    listDirty,
    subscribeDirty,

    _markDirty,
    _markClean,

    get _scope() { return scope; },
    get _kind()  { return 'AsBackend'; },
  };
}
