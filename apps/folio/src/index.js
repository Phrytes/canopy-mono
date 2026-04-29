/**
 * @canopy-app/folio — public barrel.
 *
 * The sync-engine library that all Folio drivers (CLI, web, mobile) build
 * on.  Pure JS, no UI, no platform deps beyond Node's `fs` + chokidar.
 *
 * See `coding-plans/track-H-app-folio.md` §Folio.A1 for the implementation
 * spec, and `coding-plans/track-H-design-sketches.md` §H1 for the user-
 * facing design.
 */

export { SyncEngine }                    from './SyncEngine.js';
export { PathMap, joinRel }              from './PathMap.js';
export { scanLocal }                     from './scanLocal.js';
export { scanPod }                       from './scanPod.js';
export { diff }                          from './diff.js';
export { applyConflict, hasConflictMarkers } from './applyConflict.js';
export {
  parsePath          as parseSharePath,
  shareFolderName,
  ensureShares,
  listShares,
  loadShares,
  saveShares,
  mintShareToken,
  shouldRenew,
  findShareFolders,
  SHARE_EXPIRY_MS,
  SHARE_RENEW_WINDOW_MS,
  SHARES_FILE_RELPATH,
} from './autoShare.js';
