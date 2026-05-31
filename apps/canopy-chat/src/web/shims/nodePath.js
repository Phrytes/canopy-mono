/**
 * Browser-safe shim for `node:path`.
 *
 * Stoop's `FilePersist` (a Node-only persist adapter) statically
 * imports `{ dirname } from 'node:path'`.  In the browser FilePersist
 * is never instantiated (canopy-chat injects IndexedDBPersist via
 * `apps/stoop/src/lib/IndexedDBPersist.js` as the adapter), so this
 * shim's methods just need to exist for Rollup's static-import
 * resolution.  Calls throw if reached at runtime, surfacing the bug
 * instead of silently returning ''.
 *
 * Same pattern as `nodeFs.js` — see #303.
 */

const browserOnly = () => {
  throw new Error('node:path is not available in the browser — bundle is missing an injected platform adapter');
};

export const dirname    = browserOnly;
export const basename   = browserOnly;
export const extname    = browserOnly;
export const join       = browserOnly;
export const resolve    = browserOnly;
export const relative   = browserOnly;
export const normalize  = browserOnly;
export const isAbsolute = browserOnly;
export const parse      = browserOnly;
export const format     = browserOnly;
export const sep        = '/';
export const delimiter  = ':';

export default {
  dirname, basename, extname, join, resolve, relative,
  normalize, isAbsolute, parse, format, sep, delimiter,
};
