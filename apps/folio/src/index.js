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
// P3 Phase B/C — platform-neutral cache-mode pseudo-pod wiring, shared
// by the desktop CLI and the folio-mobile platform-shell.
export { wrapWithPseudoPod, guessContentType } from './podCache.js';
export { PathMap, joinRel }              from './PathMap.js';
export { scanLocal }                     from './scanLocal.js';
export { scanPod }                       from './scanPod.js';
// N5 — Drive tree (folder nav + rich rows), source-agnostic over
// scanLocal / scanPod / the in-process listFiles index.
export {
  folioLevel, breadcrumbs, parentPath, rowPath, rowName,
  formatFileSize, fileKind, glyphForFile, FILE_KIND_GLYPH,
} from './folioTree.js';
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
// Folio.B4 — time-machine versioning (Q-Folio.4).
export {
  captureVersion,
  listVersions,
  restoreVersion,
  dropVersions,
  pruneVersions,
  listFilesWithVersions,
  readVersionContent,
  isVersionable,
  sha256Of,
  VERSIONS_DIR_RELPATH,
  DEFAULT_VERSIONS_PER_FILE,
  DEFAULT_VERSIONS_BUDGET_MB,
} from './versions.js';
