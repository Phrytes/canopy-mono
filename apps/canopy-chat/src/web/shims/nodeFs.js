/**
 * Deprecated — moved to `./node/fs.js` as part of the node:* shim
 * consolidation.  Kept as a thin re-export to avoid breaking any out-of-
 * tree reference (e.g. older vite.config.js copies in worktree branches).
 *
 * New code should import from `./node/fs.js` directly, or — better — rely
 * on the vite.config.js `resolve.alias` for `node:fs` / `node:fs/promises`.
 */
export * from './node/fs.js';
export { default } from './node/fs.js';
