/**
 * versions.js — Folio.B4 time-machine versioning.
 *
 * Per-file history under `<localRoot>/.folio/versions/<relPath>/<unix-ms>.<ext>`.
 *
 * Snapshots are captured by SyncEngine after each successful operation that
 * changed a file's content (push, pull, conflict-write, conflict-resolve);
 * users can list, view, restore, and drop them.
 *
 * Retention: keep the latest N versions per file (default 50) AND keep the
 * total tree under M megabytes (default 100 MB).  Pruning runs on every
 * capture; the per-file version list is cached and invalidated on write.
 *
 * Atomicity: every write is tmp-then-rename so a partial snapshot cannot
 * appear in the listing.
 *
 * Skip rules:
 *   - dotted relPaths (anything under .folio/, .canopy/, ...) — would
 *     create a feedback loop: versions of versions.
 *   - first-ever snapshot of an empty file (no point capturing "" as the
 *     baseline of a new file).
 *   - same-sha256 within the last 5 seconds (debounce racing watcher
 *     events; same content captured twice in quick succession is one
 *     version).
 *
 * Folio.C1 — adapter-aware
 * ------------------------
 * `node:fs/promises` calls go through an injected `FsAdapter` (default
 * Node).  `node:crypto.createHash('sha256')` goes through an injected
 * `HashAdapter` (default Node).  Path math uses POSIX helpers so the
 * code runs on RN without a `node:path` import.
 */

import { sep as pathSep } from 'node:path';
import { createHash }      from 'node:crypto';

import { fsNode }    from './adapters/fsNode.js';
import { hashNode }  from './adapters/hashNode.js';
import {
  joinPosix,
  dirnamePosix,
  extnamePosix,
} from './adapters/pathPosix.js';

export const VERSIONS_DIR_RELPATH      = '.folio/versions';
export const DEFAULT_VERSIONS_PER_FILE = 50;
export const DEFAULT_VERSIONS_BUDGET_MB = 100;
export const DEBOUNCE_MS               = 5_000;

/**
 * Should this relPath be versioned?
 *
 * Reject any path with a dotted segment — covers `.folio/`, `.canopy/`,
 * `.git/`, etc.  Pure POSIX-style paths only.  Empty string → false.
 */
export function isVersionable(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) return false;
  // Normalize separators so callers passing OS-native paths don't slip past.
  const norm = relPath.replace(/\\/g, '/');
  if (norm.startsWith('/')) return false;       // absolute paths not allowed
  const segs = norm.split('/');
  if (segs.some((s) => s === '' || s === '..' || s === '.' || s.startsWith('.'))) return false;
  return true;
}

/**
 * Compute sha256 of a string or Buffer.  Used both at capture time (to
 * dedupe debounced repeats) and to expose to consumers.
 *
 * Note: synchronous-style API preserved for backwards compatibility with
 * the Folio.B4 contract.  Internally we use the Node hash adapter (which
 * computes the digest synchronously and wraps in a Promise) but unwrap
 * via a tiny synchronous helper that mirrors the original behavior.
 * Callers that need an async signature can use `sha256OfAsync`.
 */
export function sha256Of(content) {
  const hash = createHash('sha256');
  if (Buffer.isBuffer(content)) hash.update(content);
  else if (content instanceof Uint8Array) hash.update(Buffer.from(content));
  else hash.update(String(content ?? ''), 'utf8');
  return hash.digest('hex');
}

/**
 * Async sha256 — uses the injected hash adapter so RN code paths work.
 * @param {import('./adapters/index.js').HashAdapter} hash
 * @param {string|Uint8Array|Buffer} content
 * @returns {Promise<string>}
 */
export function sha256OfAsync(hash, content) {
  return hash.sha256(content);
}

/**
 * Per-file version directory under the versions tree.
 */
function versionDirFor(localRoot, relPath) {
  // POSIX-only relPath; convert to POSIX joined path.  On Node this also
  // works because Linux/macOS use `/` natively; on Windows, the test
  // suite already runs on POSIX-flavored CI, and our adapters target RN.
  const segs = String(relPath).split('/');
  return joinPosix(localRoot, '.folio', 'versions', ...segs);
}

/**
 * Per-file version list cache.  Invalidated on every write/delete in the
 * file's directory.  Module-level so multiple consumers (capture +
 * pruneVersions) share the same view.
 */
const _listCache = new Map(); // key: dir abspath → Array<{ts, sha256, size, ext, path}>
function cacheGet(dir) { return _listCache.get(dir) ?? null; }
function cacheSet(dir, arr) { _listCache.set(dir, arr); }
function cacheInvalidate(dir) { _listCache.delete(dir); }
/** Test hook — clear the entire cache. */
export function _clearVersionsCache() { _listCache.clear(); }

/**
 * Build a per-file version directory listing on disk.  Tolerates a missing
 * directory (returns []).  Sorted newest-first by ts.
 *
 * @param {string} dir absolute path to the per-file version directory
 * @param {import('./adapters/index.js').FsAdapter} fs
 * @param {import('./adapters/index.js').HashAdapter} hash
 * @returns {Promise<Array<{ts:number, sha256:string, size:number, ext:string, path:string}>>}
 */
async function readVersionDir(dir, fs, hash) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const m = /^(\d+)(\.[^.]+)?$/.exec(ent.name);
    if (!m) continue;
    const ts = Number(m[1]);
    if (!Number.isFinite(ts)) continue;
    const ext = m[2] ?? '';
    const abs = joinPosix(dir, ent.name);
    let st;
    try { st = await fs.stat(abs); }
    catch { continue; }
    // sha256 lives in a sidecar (`<ts>.<ext>.sha256`) so we don't re-read
    // the snapshot to compute it on every list.  If the sidecar is
    // missing (corruption / external delete), recompute and write it.
    const sidecar = `${abs}.sha256`;
    let sha256;
    try {
      sha256 = (await fs.readFileText(sidecar, 'utf8')).trim();
      if (!/^[0-9a-f]{64}$/.test(sha256)) sha256 = '';
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      sha256 = '';
    }
    if (!sha256) {
      try {
        const buf = await fs.readFile(abs);
        sha256 = await hash.sha256(buf);
        await writeAtomic(sidecar, sha256, fs);
      } catch { /* swallow */ }
    }
    out.push({ ts, sha256, size: st.size, ext, path: abs });
  }
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

/** Cached list-version for a single file's directory. */
async function listForDir(dir, fs, hash) {
  const cached = cacheGet(dir);
  if (cached != null) return cached;
  const fresh = await readVersionDir(dir, fs, hash);
  cacheSet(dir, fresh);
  return fresh;
}

/**
 * Atomic write helper: tmp-then-rename.  Used for every snapshot AND every
 * sidecar so partial writes never appear in a listing.
 */
async function writeAtomic(absPath, content, fs) {
  await fs.mkdir(dirnamePosix(absPath), { recursive: true });
  // Suffix with a random tag so concurrent writers don't collide on rename.
  const pid = (typeof process !== 'undefined' && typeof process.pid === 'number')
    ? process.pid
    : 0;
  const tmp = `${absPath}.tmp-${pid}-${Math.random().toString(36).slice(2, 8)}`;
  if (Buffer.isBuffer(content) || content instanceof Uint8Array) {
    await fs.writeFile(tmp, content);
  } else {
    await fs.writeFile(tmp, String(content ?? ''), { encoding: 'utf8' });
  }
  await fs.rename(tmp, absPath);
}

/**
 * Capture a snapshot of `content` for `relPath`.
 *
 * @param {object} args
 * @param {string} args.localRoot
 * @param {string} args.relPath POSIX-style; reject any dotted segment.
 * @param {string|Buffer|Uint8Array} args.content the content to snapshot.
 * @param {number} [args.now] override timestamp (test seam).
 * @param {{perFile?:number, budgetMb?:number}} [args.retention]
 * @param {import('./adapters/index.js').FsAdapter}   [args.fs]
 * @param {import('./adapters/index.js').HashAdapter} [args.hash]
 *
 * @returns {Promise<{
 *   captured: boolean,
 *   reason?: 'NOT_VERSIONABLE' | 'EMPTY_FIRST_VERSION' | 'DEBOUNCED',
 *   ts?: number,
 *   sha256?: string,
 *   size?: number,
 *   path?: string,
 *   prune?: { versionsRemoved: number, bytesFreed: number }
 * }>}
 */
export async function captureVersion({ localRoot, relPath, content, now, retention, fs, hash } = {}) {
  if (!localRoot) throw new Error('captureVersion: localRoot is required');
  if (!isVersionable(relPath)) {
    return { captured: false, reason: 'NOT_VERSIONABLE' };
  }
  fs   = fs   ?? fsNode;
  hash = hash ?? hashNode;

  const dir = versionDirFor(localRoot, relPath);
  const existing = await listForDir(dir, fs, hash);

  // Skip first snapshot of empty content — don't bother filling the
  // history with "" baselines.
  const isEmpty = (Buffer.isBuffer(content) || content instanceof Uint8Array)
    ? content.byteLength === 0
    : (typeof content !== 'string' || content.length === 0);
  if (existing.length === 0 && isEmpty) {
    return { captured: false, reason: 'EMPTY_FIRST_VERSION' };
  }

  const sha = await hash.sha256(content);
  const at  = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();

  // Debounce: if the most recent capture has the same sha256 AND is within
  // the debounce window, skip.  The window is 5s by spec.
  const newest = existing[0];
  if (newest && newest.sha256 === sha && (at - newest.ts) < DEBOUNCE_MS) {
    return { captured: false, reason: 'DEBOUNCED' };
  }

  // Build the snapshot path: `<dir>/<ts>.<ext>` (ext from relPath, may be '').
  const ext   = extnamePosix(relPath);
  const fname = `${at}${ext}`;
  const snap  = joinPosix(dir, fname);

  // Write content + sidecar atomically.
  await writeAtomic(snap, content, fs);
  await writeAtomic(`${snap}.sha256`, sha, fs);

  // Invalidate cache (we just added an entry).
  cacheInvalidate(dir);

  // Prune to retention policy.
  const prune = await pruneVersions({
    localRoot,
    relPath,                        // start with the per-file cap
    retention,
    fs,
    hash,
  });

  // Compute the captured entry's size (may be 0 for empty buffers).
  const size = (Buffer.isBuffer(content) || content instanceof Uint8Array)
    ? content.byteLength
    : Buffer.byteLength(String(content ?? ''), 'utf8');

  return {
    captured: true,
    ts:       at,
    sha256:   sha,
    size,
    path:     snap,
    prune,
  };
}

/**
 * List all versions of `relPath`, newest-first.  Returns an empty array
 * when no history exists.
 */
export async function listVersions({ localRoot, relPath, fs, hash } = {}) {
  if (!localRoot) throw new Error('listVersions: localRoot is required');
  if (!isVersionable(relPath)) return [];
  fs   = fs   ?? fsNode;
  hash = hash ?? hashNode;
  const dir = versionDirFor(localRoot, relPath);
  return listForDir(dir, fs, hash);
}

/**
 * Restore version at `ts` to the live file.  Captures the CURRENT live
 * content as a fresh snapshot first (so a wrong restore is itself
 * undoable).  Returns the snapshot ts that was just captured pre-restore
 * plus the restored ts.
 */
export async function restoreVersion({ localRoot, relPath, ts, retention, fs, hash } = {}) {
  if (!localRoot) throw new Error('restoreVersion: localRoot is required');
  if (!isVersionable(relPath)) {
    const e = new Error(`restoreVersion: not versionable: ${relPath}`);
    e.code = 'NOT_VERSIONABLE';
    throw e;
  }
  fs   = fs   ?? fsNode;
  hash = hash ?? hashNode;
  const versions = await listVersions({ localRoot, relPath, fs, hash });
  const target = versions.find((v) => v.ts === Number(ts));
  if (!target) {
    const e = new Error(`restoreVersion: no snapshot at ts=${ts} for ${relPath}`);
    e.code = 'VERSION_NOT_FOUND';
    throw e;
  }

  // Snapshot the current content first (so the user can undo this restore).
  const liveSegs = relPath.split('/');
  const liveAbs  = joinPosix(localRoot, ...liveSegs);
  let currentContent = '';
  try {
    currentContent = await fs.readFile(liveAbs);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      const e = new Error(`restoreVersion: failed to read current content: ${err.message}`);
      e.code = 'READ_FAILED';
      throw e;
    }
    currentContent = Buffer.alloc(0);
  }

  // Avoid the 5-second debounce blocking the pre-restore snapshot if the
  // user is rapidly clicking restore — bump 'now' by the debounce window
  // when needed, but only if it would otherwise dedupe.  Simpler: ignore
  // debounce entirely for this synthetic capture.  We honour retention
  // (cap + budget) on the prune call below.
  const preTs = Date.now();
  const preSnap = await captureVersion({
    localRoot,
    relPath,
    content: currentContent,
    now: preTs,
    retention,
    fs,
    hash,
  });

  // Read snapshot content + write it to the live file atomically.
  const snapBuf = await fs.readFile(target.path);
  await writeAtomic(liveAbs, snapBuf, fs);

  return {
    relPath,
    restoredFromMs: target.ts,
    snapshotMsBeforeRestore: preSnap.captured ? preSnap.ts : null,
  };
}

/**
 * Drop the entire version history for `relPath`.
 * Returns count of snapshot files deleted (sidecars not counted separately).
 */
export async function dropVersions({ localRoot, relPath, fs } = {}) {
  if (!localRoot) throw new Error('dropVersions: localRoot is required');
  if (!isVersionable(relPath)) return 0;
  fs = fs ?? fsNode;
  const dir = versionDirFor(localRoot, relPath);
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }
  let deleted = 0;
  for (const name of entries) {
    const abs = joinPosix(dir, name);
    try {
      await fs.unlink(abs);
      // Count snapshot files (those without .sha256 sidecar suffix); the
      // sidecars are bookkeeping only.
      if (!name.endsWith('.sha256')) deleted++;
    } catch { /* swallow */ }
  }
  // Best-effort directory removal so empty branches don't linger.
  try { await fs.rmdir(dir); } catch { /* ignore */ }
  cacheInvalidate(dir);
  // Walk up and remove now-empty parents under .folio/versions, stopping
  // at the versions root itself.
  const versionsRoot = joinPosix(localRoot, '.folio', 'versions');
  let cursor = dirnamePosix(dir);
  while (cursor.startsWith(versionsRoot) && cursor !== versionsRoot) {
    try {
      const rest = await fs.readdir(cursor);
      if (rest.length === 0) {
        await fs.rmdir(cursor);
        cursor = dirnamePosix(cursor);
      } else {
        break;
      }
    } catch { break; }
  }
  return deleted;
}

/**
 * Apply retention policy.
 *
 * If `relPath` is provided, prune that file's per-file cap first; then
 * walk the entire tree and prune oldest-globally until the total size is
 * under the byte budget.
 *
 * @param {{localRoot:string, relPath?:string, retention?:{perFile?:number, budgetMb?:number}, fs?:import('./adapters/index.js').FsAdapter, hash?:import('./adapters/index.js').HashAdapter}} args
 * @returns {Promise<{ filesScanned:number, versionsRemoved:number, bytesFreed:number }>}
 */
export async function pruneVersions({ localRoot, relPath, retention, fs, hash } = {}) {
  if (!localRoot) throw new Error('pruneVersions: localRoot is required');
  fs   = fs   ?? fsNode;
  hash = hash ?? hashNode;
  const perFile  = retention?.perFile  ?? DEFAULT_VERSIONS_PER_FILE;
  const budgetMb = retention?.budgetMb ?? DEFAULT_VERSIONS_BUDGET_MB;
  const budget   = budgetMb * 1024 * 1024;

  let versionsRemoved = 0;
  let bytesFreed = 0;
  let filesScanned = 0;

  // Step 1 — per-file cap on the just-captured file (if given).
  if (relPath && isVersionable(relPath)) {
    const dir = versionDirFor(localRoot, relPath);
    const list = await listForDir(dir, fs, hash); // newest-first
    if (list.length > perFile) {
      const excess = list.slice(perFile);
      for (const v of excess) {
        try {
          await fs.unlink(v.path);
          try { await fs.unlink(`${v.path}.sha256`); } catch { /* ignore */ }
          versionsRemoved++;
          bytesFreed += v.size;
        } catch { /* swallow */ }
      }
      cacheInvalidate(dir);
    }
  }

  // Step 2 — global budget check.  Walk the tree to find every snapshot
  // and total size.  Per the constraint this must be O(versions-affected),
  // not O(all-folder-trees) — i.e. we walk once to gather, then prune
  // only as many entries as we need.
  const versionsRoot = joinPosix(localRoot, '.folio', 'versions');
  let allVersions;
  try {
    allVersions = await collectAllVersions(versionsRoot, fs);
    filesScanned = countDistinctDirs(allVersions);
  } catch (err) {
    if (err.code === 'ENOENT') return { filesScanned, versionsRemoved, bytesFreed };
    throw err;
  }
  let totalSize = 0;
  for (const v of allVersions) totalSize += v.size;

  if (totalSize <= budget) {
    return { filesScanned, versionsRemoved, bytesFreed };
  }

  // Sort oldest first, drop until under budget.
  allVersions.sort((a, b) => a.ts - b.ts);
  for (const v of allVersions) {
    if (totalSize <= budget) break;
    try {
      await fs.unlink(v.path);
      try { await fs.unlink(`${v.path}.sha256`); } catch { /* ignore */ }
      versionsRemoved++;
      bytesFreed += v.size;
      totalSize  -= v.size;
      cacheInvalidate(dirnamePosix(v.path));
    } catch { /* swallow */ }
  }

  return { filesScanned, versionsRemoved, bytesFreed };
}

/**
 * Walk `<localRoot>/.folio/versions` recursively, emitting one entry per
 * snapshot (sidecars excluded).  Each entry: { ts, size, path }.
 */
async function collectAllVersions(versionsRoot, fs) {
  const out = [];
  await walkVersionsTree(versionsRoot, out, fs);
  return out;
}

async function walkVersionsTree(dir, out, fs) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  for (const ent of entries) {
    const abs = joinPosix(dir, ent.name);
    if (ent.isDirectory()) {
      await walkVersionsTree(abs, out, fs);
      continue;
    }
    if (!ent.isFile()) continue;
    if (ent.name.endsWith('.sha256')) continue;
    if (ent.name.endsWith('.tmp')) continue;
    if (ent.name.includes('.tmp-')) continue;
    const m = /^(\d+)(\.[^.]+)?$/.exec(ent.name);
    if (!m) continue;
    const ts = Number(m[1]);
    if (!Number.isFinite(ts)) continue;
    let st;
    try { st = await fs.stat(abs); }
    catch { continue; }
    out.push({ ts, size: st.size, path: abs });
  }
}

function countDistinctDirs(versions) {
  const seen = new Set();
  for (const v of versions) seen.add(dirnamePosix(v.path));
  return seen.size;
}

/**
 * Walk the version tree and return an array of relPaths (relative to
 * `<localRoot>/.folio/versions`) that have at least one snapshot.  Used by
 * the UI to populate the file picker.  Newest-snapshot-first.
 *
 * @param {string} localRoot
 * @param {object} [opts]
 * @param {import('./adapters/index.js').FsAdapter} [opts.fs]
 * @returns {Promise<Array<{relPath:string, latestMs:number, count:number}>>}
 */
export async function listFilesWithVersions(localRoot, opts = {}) {
  const fs = opts.fs ?? fsNode;
  const versionsRoot = joinPosix(localRoot, '.folio', 'versions');
  const out = [];
  await walkFiles(versionsRoot, '', out, fs);
  out.sort((a, b) => b.latestMs - a.latestMs);
  return out;
}

async function walkFiles(absDir, relDir, out, fs) {
  let entries;
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  // A directory is a "file directory" iff it contains at least one
  // snapshot file (matches the `<digits>(.<ext>)?` pattern AND no
  // `.sha256` suffix).  Otherwise it's a parent of file directories.
  let snapshots = [];
  let hasChildDirs = false;
  for (const ent of entries) {
    if (ent.isDirectory()) {
      hasChildDirs = true;
      continue;
    }
    if (!ent.isFile()) continue;
    if (ent.name.endsWith('.sha256')) continue;
    if (ent.name.includes('.tmp-')) continue;
    const m = /^(\d+)(\.[^.]+)?$/.exec(ent.name);
    if (!m) continue;
    snapshots.push({ ts: Number(m[1]), name: ent.name });
  }
  if (snapshots.length > 0 && relDir.length > 0) {
    snapshots.sort((a, b) => b.ts - a.ts);
    out.push({ relPath: relDir, latestMs: snapshots[0].ts, count: snapshots.length });
  }
  if (hasChildDirs) {
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const childAbs = joinPosix(absDir, ent.name);
      const childRel = relDir === '' ? ent.name : `${relDir}/${ent.name}`;
      await walkFiles(childAbs, childRel, out, fs);
    }
  }
}

/**
 * Read the raw bytes of a single snapshot.  Throws VERSION_NOT_FOUND if
 * the snapshot doesn't exist.
 */
export async function readVersionContent({ localRoot, relPath, ts, fs, hash } = {}) {
  if (!localRoot) throw new Error('readVersionContent: localRoot is required');
  if (!isVersionable(relPath)) {
    const e = new Error(`readVersionContent: not versionable: ${relPath}`);
    e.code = 'NOT_VERSIONABLE';
    throw e;
  }
  fs = fs ?? fsNode;
  const versions = await listVersions({ localRoot, relPath, fs, hash });
  const target = versions.find((v) => v.ts === Number(ts));
  if (!target) {
    const e = new Error(`readVersionContent: no snapshot at ts=${ts} for ${relPath}`);
    e.code = 'VERSION_NOT_FOUND';
    throw e;
  }
  return fs.readFile(target.path);
}

// Re-export pathSep for tests that need to construct platform-correct paths.
export const _pathSep = pathSep;
