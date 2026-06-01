/**
 * Deprecated — moved to `./node/path.js` as part of the node:* shim
 * consolidation.  Kept as a thin re-export to avoid breaking any out-of-
 * tree reference (e.g. older vite.config.js copies in worktree branches).
 *
 * New code should import from `./node/path.js` directly, or — better —
 * rely on the vite.config.js `resolve.alias` for `node:path`.
 */
export * from './node/path.js';
export { default } from './node/path.js';
