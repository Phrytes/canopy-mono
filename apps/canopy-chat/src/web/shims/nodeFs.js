/**
 * Browser-safe shim for `node:fs`.
 *
 * @canopy/sync-engine's `adapters/fsNode.js` does:
 *   `import { promises as fs } from 'node:fs';`
 * That import is statically resolved by Rollup at build time, so the
 * default Vite "module externalized for browser" placeholder fails the
 * production build with `"promises" is not exported by …`.  In the
 * browser this code path is unreachable — folio's `autoShare` always
 * receives an `opts.fs` from the caller, so `fsNode` never runs.  But
 * the import is still in the graph, so we need NAMED exports to keep
 * Rollup happy.
 *
 * Each shimmed method throws if invoked, surfacing the actual bug
 * (a browser caller forgot to inject `opts.fs`) instead of silently
 * no-oping.
 */

const browserOnly = async () => {
  throw new Error('node:fs is not available in the browser — pass opts.fs to the folio helper');
};

// Named exports for `import { promises as fs } from 'node:fs'`.
export const promises = {
  readFile:  browserOnly,
  writeFile: browserOnly,
  unlink:    browserOnly,
  mkdir:     browserOnly,
  stat:      browserOnly,
  readdir:   browserOnly,
  access:    browserOnly,
  rm:        browserOnly,
  rmdir:     browserOnly,
  rename:    browserOnly,
  copyFile:  browserOnly,
};

// Same module is aliased to `node:fs/promises` too; that import form
// is `import { readFile, writeFile, ... } from 'node:fs/promises'` so
// the named exports need to sit at the module level as well.
export const readFile  = browserOnly;
export const writeFile = browserOnly;
export const unlink    = browserOnly;
export const mkdir     = browserOnly;
export const stat      = browserOnly;
export const readdir   = browserOnly;
export const access    = browserOnly;
export const rm        = browserOnly;
export const rmdir     = browserOnly;
export const rename    = browserOnly;
export const copyFile  = browserOnly;

export default { promises };
