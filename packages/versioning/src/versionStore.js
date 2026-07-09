/**
 * versionStore.js — backend-agnostic snapshot versioning (option A).
 *
 * Preserves the *policy* proven in Folio's `sync-engine/versions.js`
 * (versionable predicate · debounce · empty-first-skip · per-series retention
 * cap · newest-first ordering · restore-is-undoable) but stores each snapshot
 * as one record in an injected `StorageBackend` (get/put/delete/list) instead
 * of a filesystem tree. So ONE store serves Folio-files, kring-objects, AND
 * pod-resources — the anti-drift consolidation in
 * plans/PLAN-pod-versioning-history-recovery.md.
 *
 * Why not lift versions.js as-is: its adapter is a *filesystem* (dirs, stat,
 * sidecars, tmp-then-rename) — the wrong shape for a pod, which is a flat KV
 * with prefix-list. We keep the good, tested policy and swap the storage half.
 * A pod points a KV backend at this store. NOTE: Folio's *browsable* `.md`
 * version files are NOT preserved by the existing `NodeFsBackend` (it stores
 * opaque hashed records); a dedicated browsable-FS backend + a cross-series
 * byte-budget are prerequisites before Folio can move onto this store without a
 * regression. See plans/PLAN-pod-versioning-history-recovery.md.
 *
 * Storage layout: one record per version at key
 *   `<versionsRoot><encodeURIComponent(uri)>/<ts>`
 * value (the backend's opaque `bytes`) = `{ ts, sha256, size, content }`.
 * A series is enumerated via `backend.list(seriesPrefix)`. `ts` is the version
 * id AND is kept strictly increasing per series (same-millisecond tiebreak),
 * so `list`/`read`/`restore` can address a version by `ts` without collisions.
 *
 * The store is storage-pure: it never reads or writes the *live* resource
 * itself. Restore's undoable pre-snapshot uses the injected `readLive`, and the
 * write-back uses `writeLive` — so Folio writes the working file, the pod
 * writes the pod resource, and this module stays backend-agnostic.
 */

export const DEFAULT_VERSIONS_PER_SERIES = 50;
export const DEFAULT_DEBOUNCE_MS = 5_000;
export const DEFAULT_VERSIONS_ROOT = 'versions/';

const encodeUri = (uri) => encodeURIComponent(String(uri));
const textBytes = (s) => new TextEncoder().encode(s).length;

/** Byte length of string | Uint8Array | typed-array content (RN-safe: no Buffer). */
function byteLength(content) {
  if (content == null) return 0;
  if (typeof content === 'string') return textBytes(content);
  if (content instanceof Uint8Array || ArrayBuffer.isView(content)) return content.byteLength;
  return textBytes(String(content));
}

function isEmptyContent(content) {
  if (content == null) return true;
  if (typeof content === 'string') return content.length === 0;
  if (content instanceof Uint8Array || ArrayBuffer.isView(content)) return content.byteLength === 0;
  return false;
}

/**
 * @param {object} cfg
 * @param {{get,put,delete,list}} cfg.backend  StorageBackend (a superset is fine).
 * @param {(content:string|Uint8Array)=>Promise<string>} cfg.hash  async sha256→hex (injected; no crypto import here).
 * @param {()=>number} [cfg.now]  clock seam (default Date.now).
 * @param {(uri:string)=>Promise<string|Uint8Array>} [cfg.readLive]  read current live content (for undoable restore).
 * @param {(uri:string, content:*)=>Promise<void>} [cfg.writeLive]  write restored content back to the live resource.
 * @param {{perSeries?:number, debounceMs?:number, shouldVersion?:(uri:string)=>boolean}} [cfg.retention]
 * @param {string} [cfg.versionsRoot]  key prefix for the version store (default 'versions/').
 */
export function createVersionStore({
  backend,
  hash,
  now,
  readLive,
  writeLive,
  retention = {},
  versionsRoot = DEFAULT_VERSIONS_ROOT,
} = {}) {
  if (!backend
    || typeof backend.get !== 'function' || typeof backend.put !== 'function'
    || typeof backend.delete !== 'function' || typeof backend.list !== 'function') {
    throw new TypeError('createVersionStore: backend must implement { get, put, delete, list }');
  }
  if (typeof hash !== 'function') {
    throw new TypeError('createVersionStore: hash must be a function (content) => Promise<hex>');
  }

  const perSeries = Number.isFinite(retention.perSeries) && retention.perSeries > 0
    ? Math.floor(retention.perSeries)
    : DEFAULT_VERSIONS_PER_SERIES;
  const debounceMs = Number.isFinite(retention.debounceMs) ? retention.debounceMs : DEFAULT_DEBOUNCE_MS;
  const shouldVersion = typeof retention.shouldVersion === 'function' ? retention.shouldVersion : () => true;
  const root = String(versionsRoot);
  const clock = typeof now === 'function' ? now : () => Date.now();

  const seriesPrefix = (uri) => `${root}${encodeUri(uri)}/`;
  const versionKey = (uri, ts) => `${seriesPrefix(uri)}${ts}`;

  /** Versionable = caller opt-out + never version the version store itself (no versions-of-versions). */
  function versionable(uri) {
    if (typeof uri !== 'string' || uri.length === 0) return false;
    if (uri.startsWith(root)) return false;
    return shouldVersion(uri) !== false;
  }

  /** Series entries newest-first: [{ key, ts }]. Cheap — parses ts from the key, no record reads. */
  async function seriesEntries(uri) {
    const prefix = seriesPrefix(uri);
    const keys = await backend.list(prefix);
    const out = [];
    for (const k of keys) {
      const ts = Number(k.slice(prefix.length));
      if (Number.isFinite(ts)) out.push({ key: k, ts });
    }
    out.sort((a, b) => b.ts - a.ts);
    return out;
  }

  /** Unwrap the stored record from the backend's opaque `{ bytes }` envelope. */
  async function readRecord(key) {
    const rec = await backend.get(key);
    return rec ? rec.bytes : null;
  }

  async function capture(uri, contentIn, opts = {}) {
    if (!versionable(uri)) return { captured: false, reason: 'NOT_VERSIONABLE' };
    const content = contentIn == null ? '' : contentIn;

    const entries = await seriesEntries(uri);
    if (entries.length === 0 && isEmptyContent(content)) {
      return { captured: false, reason: 'EMPTY_FIRST_VERSION' };
    }

    const sha = await hash(content);
    const requested = Number.isFinite(opts.now) ? opts.now : clock();

    const newest = entries[0] ? await readRecord(entries[0].key) : null;
    if (newest && newest.sha256 === sha && (requested - newest.ts) < debounceMs) {
      return { captured: false, reason: 'DEBOUNCED' };
    }

    // Strictly-increasing ts per series (same-millisecond collision tiebreak).
    const ts = entries[0] && requested <= entries[0].ts ? entries[0].ts + 1 : requested;
    const size = byteLength(content);
    await backend.put(versionKey(uri, ts), { ts, sha256: sha, size, content });

    const prune = await pruneSeries(uri);
    return { captured: true, ts, sha256: sha, size, prune };
  }

  /** Enforce the per-series retention cap (oldest-first eviction). */
  async function pruneSeries(uri) {
    const entries = await seriesEntries(uri); // newest-first
    let versionsRemoved = 0;
    let bytesFreed = 0;
    if (entries.length > perSeries) {
      for (const e of entries.slice(perSeries)) {
        const rec = await readRecord(e.key);
        try {
          await backend.delete(e.key);
          versionsRemoved += 1;
          if (rec && Number.isFinite(rec.size)) bytesFreed += rec.size;
        } catch { /* best-effort — never break the write path */ }
      }
    }
    return { versionsRemoved, bytesFreed };
  }

  /** All versions of `uri`, newest-first: [{ ts, sha256, size }] (no content). */
  async function list(uri) {
    if (!versionable(uri)) return [];
    const entries = await seriesEntries(uri);
    const out = [];
    for (const e of entries) {
      const rec = await readRecord(e.key);
      out.push(rec
        ? { ts: rec.ts, sha256: rec.sha256, size: rec.size }
        : { ts: e.ts, sha256: '', size: 0 });
    }
    return out;
  }

  /** Raw content of one snapshot. Throws VERSION_NOT_FOUND when absent. */
  async function read(uri, ts) {
    const rec = await readRecord(versionKey(uri, Number(ts)));
    if (!rec) {
      const e = new Error(`versionStore.read: no snapshot at ts=${ts} for ${uri}`);
      e.code = 'VERSION_NOT_FOUND';
      throw e;
    }
    return rec.content;
  }

  /**
   * Restore the snapshot at `ts` to the live resource. Captures the CURRENT
   * live content first (via readLive) so a wrong restore is itself undoable,
   * then writes the target content back (via writeLive).
   */
  async function restore(uri, ts) {
    if (!versionable(uri)) {
      const e = new Error(`versionStore.restore: not versionable: ${uri}`);
      e.code = 'NOT_VERSIONABLE';
      throw e;
    }
    const target = await readRecord(versionKey(uri, Number(ts)));
    if (!target) {
      const e = new Error(`versionStore.restore: no snapshot at ts=${ts} for ${uri}`);
      e.code = 'VERSION_NOT_FOUND';
      throw e;
    }

    let snapshotMsBeforeRestore = null;
    if (typeof readLive === 'function') {
      let current;
      try {
        current = await readLive(uri);
      } catch (err) {
        const e = new Error(`versionStore.restore: failed to read current content: ${err.message}`);
        e.code = 'READ_FAILED';
        throw e;
      }
      const pre = await capture(uri, current ?? '', { now: clock() });
      snapshotMsBeforeRestore = pre.captured ? pre.ts : null;
    }
    if (typeof writeLive === 'function') {
      await writeLive(uri, target.content);
    }
    return { uri, restoredFromMs: target.ts, snapshotMsBeforeRestore };
  }

  /** Drop the whole history for `uri`. Returns the count of snapshots removed. */
  async function drop(uri) {
    const entries = await seriesEntries(uri);
    let deleted = 0;
    for (const e of entries) {
      try { await backend.delete(e.key); deleted += 1; } catch { /* best-effort */ }
    }
    return deleted;
  }

  /** Every series with at least one snapshot, newest-first: [{ uri, latestMs, count }]. */
  async function listSeries() {
    const keys = await backend.list(root);
    const byUri = new Map();
    for (const k of keys) {
      const rest = k.slice(root.length);
      const slash = rest.indexOf('/'); // encodeURIComponent(uri) contains no literal '/'
      if (slash < 0) continue;
      const uri = decodeURIComponent(rest.slice(0, slash));
      const ts = Number(rest.slice(slash + 1));
      if (!Number.isFinite(ts)) continue;
      const cur = byUri.get(uri) ?? { uri, latestMs: 0, count: 0 };
      cur.count += 1;
      if (ts > cur.latestMs) cur.latestMs = ts;
      byUri.set(uri, cur);
    }
    return [...byUri.values()].sort((a, b) => b.latestMs - a.latestMs);
  }

  return {
    capture,
    list,
    read,
    restore,
    drop,
    prune: ({ uri } = {}) => pruneSeries(uri),
    listSeries,
    isVersionable: versionable,
  };
}
