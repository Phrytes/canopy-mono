/**
 * PathMap — bidirectional mapping between local FS paths and pod URIs,
 * with ACL hints derived from folder-name conventions.
 *
 * Conventions (locked from H1 sketch):
 *   /notes/shared/...               → public-readable on pod  (aclFor: 'public')
 *   /notes/with-<webid>/...         → auto-share with <webid> (Q-Folio.3 / B3)
 *   /notes/<anything-else>/...      → private (default; ACL: self-only)
 *
 * Future Phase B conventions (NOT implemented here):
 *   /notes/private/...              → encrypted-by-ACL helper
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
 * Skip rules: dotfiles (segment starts with `.`), the `.canopy/` dir,
 * common OS noise (`.DS_Store`, `Thumbs.db`).  The 100 MB convention
 * threshold is enforced at the SyncEngine layer (PathMap is purely a
 * path-shape concern).
 */

import { sep as pathSep, posix } from 'node:path';

import { parsePath as parseSharePath } from './autoShare.js';

const SKIP_NAMES = new Set([
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
]);

/**
 * Normalize a relative path to POSIX-style forward slashes.  Returns
 * the input unchanged on POSIX systems.
 */
function normalizeRel(relPath) {
  return relPath.split(pathSep).join('/');
}

/**
 * Strip leading and trailing slashes; collapse duplicates.  Used to
 * make the localRoot / podRoot tail-shape uniform internally.
 */
function trim(s) {
  return String(s ?? '').replace(/\/+$/, '').replace(/^\/+/, '');
}

/**
 * Encode a relative path for a pod URI.  Each segment is `encodeURIComponent`'d
 * so spaces, unicode, etc. survive transit; the segment separator is preserved.
 */
function encodeRelForPod(rel) {
  return rel.split('/').map((seg) => encodeURIComponent(seg)).join('/');
}

/**
 * Decode a relative path back from a pod URI to a local path.  Inverse of
 * `encodeRelForPod`.
 */
function decodeRelFromPod(rel) {
  return rel.split('/').map((seg) => decodeURIComponent(seg)).join('/');
}

export class PathMap {
  #localRoot;
  #podRoot;       // always ends with '/'
  #podRootNoSlash;

  /**
   * @param {object} opts
   * @param {string} opts.localRoot — absolute local path, no trailing slash required
   * @param {string} opts.podRoot   — pod URI root, e.g. 'https://alice.example/notes/'
   */
  constructor({ localRoot, podRoot } = {}) {
    if (!localRoot) throw new Error('PathMap: localRoot is required');
    if (!podRoot)   throw new Error('PathMap: podRoot is required');
    // Normalize: strip trailing slash on local, ensure trailing slash on pod.
    this.#localRoot       = String(localRoot).replace(/[\/\\]+$/, '');
    this.#podRoot         = String(podRoot).endsWith('/') ? String(podRoot) : `${podRoot}/`;
    this.#podRootNoSlash  = this.#podRoot.replace(/\/+$/, '');
  }

  get localRoot() { return this.#localRoot; }
  get podRoot()   { return this.#podRoot; }

  /**
   * Map a local absolute path to a pod URI.  Throws if the path is not
   * under the local root.
   *
   * @param {string} localAbsPath
   * @returns {string}
   */
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

  /**
   * Map a pod URI back to a local absolute path.  Throws if the URI is
   * not under the pod root.
   *
   * @param {string} podUri
   * @returns {string}
   */
  podToLocal(podUri) {
    const u = String(podUri);
    if (u !== this.#podRoot && u !== this.#podRootNoSlash && !u.startsWith(this.#podRoot)) {
      throw new Error(`PathMap.podToLocal: URI not under pod root: ${podUri}`);
    }
    if (u === this.#podRoot || u === this.#podRootNoSlash) {
      return this.#localRoot;
    }
    const rel = decodeRelFromPod(u.slice(this.#podRoot.length));
    // Re-platformize: convert posix `/` to the local separator.
    const localTail = rel.split('/').join(pathSep);
    return `${this.#localRoot}${pathSep}${localTail}`;
  }

  /**
   * Compute the relative path (POSIX-style with `/`) of a pod URI from the
   * pod root.  Useful for diff keying.
   */
  podToRel(podUri) {
    const u = String(podUri);
    if (!u.startsWith(this.#podRoot)) {
      throw new Error(`PathMap.podToRel: URI not under pod root: ${podUri}`);
    }
    return decodeRelFromPod(u.slice(this.#podRoot.length));
  }

  /**
   * Compute the relative path (POSIX-style with `/`) of a local absolute
   * path from the local root.
   */
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
   * Map a relative path (POSIX-style) → ACL convention.  Folder-name driven.
   *
   * `shared/...`   → 'public'
   * everything else → 'private'
   *
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
   * Skips:
   *   - empty / root
   *   - any segment that begins with '.' (dotfiles + hidden dirs)
   *   - the `.canopy/` metadata directory (catches even non-leading)
   *   - well-known OS junk: .DS_Store, Thumbs.db, desktop.ini
   *
   * Note: file size is NOT checked here — that's a runtime concern handled
   * by the SyncEngine after `scanLocal` reports `size`.
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
   * Detect the `with-<urlencoded-webid>/` share-folder convention (Q-Folio.3).
   *
   * Returns `{ webid, sharePath }` when `relPath` falls under a top-level
   * `with-<webid>/` folder, where:
   *   - `webid`     is the URL-decoded WebID
   *   - `sharePath` is the top-level segment ("with-<webid>"), POSIX-style
   *
   * Returns `null` for paths outside a share folder.  Throws an Error with
   * `.code === 'AUTO_SHARE_BAD_PATH'` when the segment starts with `with-`
   * but the WebID is malformed.
   *
   * @param {string} relPath  POSIX-style relative path
   * @returns {{ webid: string, sharePath: string } | null}
   */
  shareFolderFor(relPath) {
    const r = normalizeRel(String(relPath ?? ''));
    if (r === '') return null;
    const parsed = parseSharePath(r);
    if (!parsed) return null;
    return { webid: parsed.webid, sharePath: parsed.sharePath };
  }

  /**
   * Skip rule for directories during a recursive scan.  Used by `scanLocal`
   * to avoid even descending into hidden / metadata directories.
   *
   * @param {string} dirRelPath
   * @returns {boolean}  true → skip (don't descend)
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

// Re-export posix join for convenience to consumers that want the
// canonical relPath shape.
export const joinRel = posix.join;
