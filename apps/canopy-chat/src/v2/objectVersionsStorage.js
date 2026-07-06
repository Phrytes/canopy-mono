/**
 * objectVersionsStorage — COMPAT RE-EXPORT (repo-split W4, objective F).
 *
 * The concrete `versions` adapters for the kring stores moved into the platform-neutral substrate
 * `@canopy/kring-host` once its lone deep-import of `packages/sync-engine/src/objectVersions.js` was
 * repointed onto the public `@canopy/sync-engine/objectVersions` subpath (removing the raw cross-package
 * `src/` reach that blocked extraction). This thin shim keeps the historical
 * `apps/canopy-chat/src/v2/objectVersionsStorage.js` import path working so downstream importers (web
 * `circleApp.js`, mobile `objectVersionsStorageRN.js`) stay untouched. New code should import from
 * `@canopy/kring-host` (or the `./objectVersionsStorage` sub-path) directly.
 */
export * from '@canopy/kring-host/objectVersionsStorage';
