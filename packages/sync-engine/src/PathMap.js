/**
 * PathMap — bidirectional mapping between local FS paths and pod URIs,
 * with ACL hints derived from folder-name conventions.
 *
 * Lifted from Folio (apps/folio/src/PathMap.js) into @canopy/sync-engine.
 *
 * Decoupling note (substrate-side change vs Folio's original):
 *   The original PathMap imported `parsePath` from autoShare.js (a
 *   Folio-app concept).  In the substrate, share-folder parsing is an
 *   *injected* hook: `new PathMap({localRoot, podRoot, parseSharePath})`.
 *   When `parseSharePath` is omitted, `shareFolderFor()` returns null
 *   for every input — substrate consumers that don't care about
 *   share folders pay no attention to them.  Folio re-exports a
 *   subclass that pre-injects its own parser.
 *
 * Conventions (from H1 sketch):
 *   /<root>/shared/...               → public-readable on pod  (aclFor: 'public')
 *   /<root>/with-<webid>/...         → auto-share with <webid> (when parseSharePath is injected)
 *   /<root>/<anything-else>/...      → private (default)
 *
 * Path semantics (POSIX-style internal representation; we normalize
 * Windows backslashes to forward slashes in the relPath, but absolute
 * local paths preserve their platform shape):
 *
 *   localToPod('/Users/alice/notes/recipes/cake.md')
 *     → 'https://alice.example/notes/recipes/cake.md'
 *   podToLocal('https://alice.example/notes/recipes/cake.md')
 *     → '/Users/alice/notes/recipes/cake.md'
 *   aclFor('shared/blog.md')   → 'public'
 *   aclFor('tax/receipts.md')  → 'private'
 *
 * Skip rules: dotfiles (segment starts with `.`), common OS noise
 * (`.DS_Store`, `Thumbs.db`).  Size-threshold conventions are enforced
 * at the SyncEngine layer.
 */

import { sep as pathSep, posix } from 'node:path';

const SKIP_NAMES = new Set([
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
]);

function normalizeRel(relPath) {
  return relPath.split(pathSep).join('/');
}

function encodeRelForPod(rel) {
  return rel.split('/').map((seg) => encodeURIComponent(seg)).join('/');
}

function decodeRelFromPod(rel) {
  return rel.split('/').map((seg) => decodeURIComponent(seg)).join('/');
}

export class PathMap {
  #localRoot;
  #podRoot;       // always ends with '/'
  #podRootNoSlash;
  /** @type {((rootRel: string) => {webid: string, sharePath: string, rest: string} | null) | null} */
  #parseSharePath;

  /**
   * @param {object} opts
   * @param {string} opts.localRoot                  absolute local path, no trailing slash required
   * @param {string} opts.podRoot                    pod URI root, e.g. 'https://alice.example/notes/'
   * @param {Function} [opts.parseSharePath]
   *   Optional hook for the share-folder convention.  If provided, it's
   *   called from `shareFolderFor(relPath)` and should return either
   *   `{webid, sharePath, rest}` or `null` (or throw with `code:
   *   'AUTO_SHARE_BAD_PATH'` for malformed segments).  When omitted,
   *   `shareFolderFor()` always returns null.
   */
  constructor({ localRoot, podRoot, parseSharePath = null } = {}) {
    if (!localRoot) throw new Error('PathMap: localRoot is required');
    if (!podRoot)   throw new Error('PathMap: podRoot is required');
    this.#localRoot       = String(localRoot).replace(/[\/\\]+$/, '');
    this.#podRoot         = String(podRoot).endsWith('/') ? String(podRoot) : `${podRoot}/`;
    this.#podRootNoSlash  = this.#podRoot.replace(/\/+$/, '');
    this.#parseSharePath  = typeof parseSharePath === 'function' ? parseSharePath : null;
  }

  get localRoot() { return this.#localRoot; }
  get podRoot()   { return this.#podRoot; }

  localToPod(localAbsPath) {
    const normalized = String(localAbsPath).split(pathSep).join('/');
    const rootNorm   = this.#localRoot.split(pathSep).join('/');
    if (normalized !== rootNorm && !normalized.startsWith(`${rootNorm}/`)) {
      throw new Error(`PathMap.localToPod: path not under root: ${localAbsPath}`);
    }
    const rel = normalized === rootNorm
      ? ''
      : normalized.slice(rootNorm.length + 1);
    return rel === ''
      ? this.#podRoot
      : `${this.#podRoot}${encodeRelForPod(rel)}`;
  }

  podToLocal(podUri) {
    const u = String(podUri);
    if (u !== this.#podRoot && u !== this.#podRootNoSlash && !u.startsWith(this.#podRoot)) {
      throw new Error(`PathMap.podToLocal: URI not under pod root: ${podUri}`);
    }
    if (u === this.#podRoot || u === this.#podRootNoSlash) {
      return this.#localRoot;
    }
    const rel = decodeRelFromPod(u.slice(this.#podRoot.length));
    const localTail = rel.split('/').join(pathSep);
    return `${this.#localRoot}${pathSep}${localTail}`;
  }

  podToRel(podUri) {
    const u = String(podUri);
    if (!u.startsWith(this.#podRoot)) {
      throw new Error(`PathMap.podToRel: URI not under pod root: ${podUri}`);
    }
    return decodeRelFromPod(u.slice(this.#podRoot.length));
  }

  localToRel(localAbsPath) {
    const normalized = String(localAbsPath).split(pathSep).join('/');
    const rootNorm   = this.#localRoot.split(pathSep).join('/');
    if (normalized === rootNorm) return '';
    if (!normalized.startsWith(`${rootNorm}/`)) {
      throw new Error(`PathMap.localToRel: path not under root: ${localAbsPath}`);
    }
    return normalized.slice(rootNorm.length + 1);
  }

  /**
   * @param {string} relPath
   * @returns {'public' | 'private'}
   */
  aclFor(relPath) {
    const r = normalizeRel(String(relPath ?? ''));
    if (r === '') return 'private';
    const segs = r.split('/');
    if (segs[0] === 'shared') return 'public';
    return 'private';
  }

  /**
   * Should this relative path participate in sync?
   *
   * Skips: empty / root, hidden segments (starts with '.'), well-known OS junk.
   *
   * @param {string} relPath
   * @returns {boolean}
   */
  shouldSync(relPath) {
    const r = normalizeRel(String(relPath ?? ''));
    if (r === '') return false;
    const segs = r.split('/');
    for (const seg of segs) {
      if (seg.startsWith('.')) return false;
      if (SKIP_NAMES.has(seg)) return false;
    }
    return true;
  }

  /**
   * Detect a share-folder convention (only when parseSharePath was injected).
   *
   * @param {string} relPath  POSIX-style relative path
   * @returns {{ webid: string, sharePath: string } | null}
   */
  shareFolderFor(relPath) {
    if (!this.#parseSharePath) return null;
    const r = normalizeRel(String(relPath ?? ''));
    if (r === '') return null;
    const parsed = this.#parseSharePath(r);
    if (!parsed) return null;
    return { webid: parsed.webid, sharePath: parsed.sharePath };
  }

  /**
   * Skip rule for directories during a recursive scan.
   *
   * @param {string} dirRelPath
   * @returns {boolean}
   */
  shouldSkipDir(dirRelPath) {
    const r = normalizeRel(String(dirRelPath ?? ''));
    if (r === '') return false;
    const segs = r.split('/');
    for (const seg of segs) {
      if (seg.startsWith('.')) return true;
      if (SKIP_NAMES.has(seg)) return true;
    }
    return false;
  }
}

// Re-export posix join for convenience.
export const joinRel = posix.join;
