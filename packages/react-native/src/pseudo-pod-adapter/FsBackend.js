/**
 * FsBackend — Expo-FileSystem-backed `StorageBackend`.
 *
 * Suited for large payloads (item bodies, attachments). One file per
 * key under `<rootDir>/<scope>/<encoded-key>`. Atomic writes via
 * `<path>.tmp` + `moveAsync`. Etag is monotonic per backend instance.
 *
 * Subscribe semantics: in-memory emitter that fires when THIS
 * process writes. Optional polling for cross-process changes via
 * `getInfoAsync` at `pollIntervalMs` (default 500 ms). Polling is
 * off by default — replication-ring writes use the inbound envelope
 * callback path, which is more reliable than FS polling.
 *
 * Standardisation Phase 51.2.
 *
 * @typedef {import('@canopy/pseudo-pod').StorageBackend} StorageBackend
 * @typedef {import('@canopy/pseudo-pod').BackendEvent} BackendEvent
 */

import { encodeKey, decodeKey, makeEtagCounter } from './_utils.js';

/**
 * @param {object} opts
 * @param {object} opts.FileSystem            — namespace import (`expo-file-system`)
 * @param {string} opts.rootDir               — base URI (e.g. `${FileSystem.documentDirectory}pseudo-pod/`)
 * @param {string} [opts.scope='default']     — sub-directory under rootDir
 * @param {number} [opts.pollIntervalMs=0]    — 0 disables polling (recommended)
 * @param {string} [opts.etagPrefix='fs']
 */
export function createFsBackend({
  FileSystem,
  rootDir,
  scope = 'default',
  pollIntervalMs = 0,
  etagPrefix = 'fs',
} = {}) {
  if (!FileSystem || typeof FileSystem.readAsStringAsync !== 'function') {
    throw Object.assign(
      new Error('createFsBackend: FileSystem namespace is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (typeof rootDir !== 'string' || rootDir.length === 0) {
    throw Object.assign(
      new Error('createFsBackend: rootDir is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

  const scopeDir = rootDir.endsWith('/')
    ? `${rootDir}${scope}/`
    : `${rootDir}/${scope}/`;
  // Phase 51.5: dirty markers persisted as empty files. Lives in a
  // sibling sub-directory so list() of the main scope doesn't see them.
  const dirtyDir = `${scopeDir}__dirty__/`;
  const nextEtag = makeEtagCounter(etagPrefix);

  const generalSubscribers = new Set();
  const prefixSubscribers  = new Map();
  const dirtySubscribers   = new Set();

  let pollHandle = null;
  /** @type {Set<string>} */
  const knownKeys = new Set();

  function _filePath(key)      { return scopeDir + encodeKey(key); }
  function _dirtyMarkerPath(k) { return dirtyDir + encodeKey(k); }

  async function _ensureScopeDir() {
    if (typeof FileSystem.makeDirectoryAsync !== 'function') return;
    try {
      await FileSystem.makeDirectoryAsync(scopeDir, { intermediates: true });
    } catch {
      // Already exists / not supported by mock — ignore.
    }
  }

  async function _ensureDirtyDir() {
    if (typeof FileSystem.makeDirectoryAsync !== 'function') return;
    try {
      await FileSystem.makeDirectoryAsync(dirtyDir, { intermediates: true });
    } catch { /* swallow */ }
  }

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
    const path = _filePath(key);
    const info = typeof FileSystem.getInfoAsync === 'function'
      ? await FileSystem.getInfoAsync(path)
      : null;
    if (info && info.exists === false) return null;
    let raw;
    try {
      raw = await FileSystem.readAsStringAsync(path, {
        encoding: FileSystem.EncodingType?.UTF8 ?? 'utf8',
      });
    } catch {
      return null;
    }
    try {
      const rec = JSON.parse(raw);
      if (rec && typeof rec === 'object' && 'bytes' in rec) {
        return {
          bytes: rec.bytes,
          ...(rec.etag != null ? { etag: rec.etag } : {}),
          ...(typeof rec._v === 'number' ? { _v: rec._v } : {}),
        };
      }
      return { bytes: raw };
    } catch {
      return { bytes: raw };
    }
  }

  async function _readVersion(path) {
    let raw;
    try {
      raw = await FileSystem.readAsStringAsync(path, {
        encoding: FileSystem.EncodingType?.UTF8 ?? 'utf8',
      });
    } catch { return 0; }
    try {
      const rec = JSON.parse(raw);
      if (rec && typeof rec === 'object' && typeof rec._v === 'number') return rec._v;
    } catch { /* ignore */ }
    return 0;
  }

  /**
   * Phase 52.14 (Q-D 2026-05-14) — Lamport-style per-key version
   * counter persisted alongside bytes + etag. Pin when caller supplies
   * `_v` (accept-peer-write); otherwise increment by 1.
   */
  async function put(key, bytes, etag, _v) {
    await _ensureScopeDir();
    const finalEtag = etag ?? nextEtag();
    const path = _filePath(key);
    let finalV;
    if (typeof _v === 'number') {
      finalV = _v;
    } else {
      const prevV = await _readVersion(path);
      finalV = prevV + 1;
    }
    const record = JSON.stringify({ bytes, etag: finalEtag, _v: finalV });
    const tmpPath = path + '.tmp';
    await FileSystem.writeAsStringAsync(tmpPath, record, {
      encoding: FileSystem.EncodingType?.UTF8 ?? 'utf8',
    });
    if (typeof FileSystem.moveAsync === 'function') {
      await FileSystem.moveAsync({ from: tmpPath, to: path });
    } else {
      // Fallback for mocks: write directly.
      await FileSystem.writeAsStringAsync(path, record, {
        encoding: FileSystem.EncodingType?.UTF8 ?? 'utf8',
      });
    }
    knownKeys.add(key);
    _fanOut({ op: 'put', key, etag: finalEtag, _v: finalV });
    return { etag: finalEtag, _v: finalV };
  }

  async function del(key) {
    const path = _filePath(key);
    if (typeof FileSystem.deleteAsync === 'function') {
      try { await FileSystem.deleteAsync(path, { idempotent: true }); }
      catch { /* swallow — idempotent */ }
    }
    knownKeys.delete(key);
    _fanOut({ op: 'delete', key });
    // Best-effort clean of any associated dirty marker.
    const dirtyPath = _dirtyMarkerPath(key);
    if (typeof FileSystem.getInfoAsync === 'function') {
      try {
        const info = await FileSystem.getInfoAsync(dirtyPath);
        if (info?.exists) {
          await FileSystem.deleteAsync(dirtyPath, { idempotent: true });
          _fanOutDirty({ op: 'clean', key });
        }
      } catch { /* swallow */ }
    }
  }

  async function list(prefix) {
    if (typeof FileSystem.readDirectoryAsync !== 'function') return [];
    let entries;
    try { entries = await FileSystem.readDirectoryAsync(scopeDir); }
    catch { return []; }
    const out = [];
    for (const name of entries) {
      if (name.endsWith('.tmp'))       continue;
      if (name === '__dirty__')        continue;   // sibling sub-dir, not a key
      const key = decodeKey(name);
      if (key.startsWith(prefix)) out.push(key);
      knownKeys.add(key);
    }
    out.sort();
    return out;
  }

  function subscribe(prefix, cb) {
    if (typeof prefix !== 'string') {
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
    if (pollIntervalMs > 0 && !pollHandle) _startPolling();
    return () => {
      subs.delete(cb);
      if (subs.size === 0) prefixSubscribers.delete(prefix);
      if (prefixSubscribers.size === 0 && generalSubscribers.size === 0 && pollHandle) {
        _stopPolling();
      }
    };
  }

  function _startPolling() {
    pollHandle = setInterval(async () => {
      // Best-effort detection of external writes.
      try {
        const current = new Set(await list(''));
        for (const key of current) {
          if (!knownKeys.has(key)) {
            knownKeys.add(key);
            _fanOut({ op: 'put', key });
          }
        }
        for (const key of [...knownKeys]) {
          if (!current.has(key)) {
            knownKeys.delete(key);
            _fanOut({ op: 'delete', key });
          }
        }
      } catch { /* swallow */ }
    }, pollIntervalMs);
    // Some hosts need .unref() so it doesn't keep the event loop alive.
    if (typeof pollHandle?.unref === 'function') pollHandle.unref();
  }

  function _stopPolling() {
    if (pollHandle) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
  }

  async function listDirty() {
    if (typeof FileSystem.readDirectoryAsync !== 'function') return [];
    let entries;
    try { entries = await FileSystem.readDirectoryAsync(dirtyDir); }
    catch { return []; }
    const out = [];
    for (const name of entries) out.push(decodeKey(name));
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

  /** Persist dirty flag. Idempotent. */
  async function _markDirty(key) {
    const path = _dirtyMarkerPath(key);
    if (typeof FileSystem.getInfoAsync === 'function') {
      const info = await FileSystem.getInfoAsync(path);
      if (info?.exists) return;
    }
    await _ensureDirtyDir();
    await FileSystem.writeAsStringAsync(path, '1', {
      encoding: FileSystem.EncodingType?.UTF8 ?? 'utf8',
    });
    _fanOutDirty({ op: 'dirty', key });
  }

  /** Clear dirty flag. Idempotent. */
  async function _markClean(key) {
    const path = _dirtyMarkerPath(key);
    let exists = false;
    if (typeof FileSystem.getInfoAsync === 'function') {
      const info = await FileSystem.getInfoAsync(path);
      exists = !!info?.exists;
    }
    if (!exists) return;
    if (typeof FileSystem.deleteAsync === 'function') {
      try { await FileSystem.deleteAsync(path, { idempotent: true }); }
      catch { /* swallow */ }
    }
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
    _close() { _stopPolling(); },
    get _scope()    { return scope; },
    get _kind()     { return 'FsBackend'; },
    get _scopeDir() { return scopeDir; },
    get _dirtyDir() { return dirtyDir; },
  };
}
