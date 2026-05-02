# Changelog — @canopy/sync-engine

## [0.2.0] — 2026-05-01

Substrate-side prereq for the long-deferred Folio L1a migration.

- Add `LocalFolderSource` — watches a local directory, emits one item
  per file (`relPath`, `content`, `size`, `sha256`, `contentType`,
  `lastModified`).  Honours a pluggable `shouldInclude` filter
  (default skips dotfiles/dotdirs) and `contentTypeFor`.  Per-relPath
  debounce coalesces multi-write editor saves.
- V0 ships Node defaults (`node:fs/promises` + `node:fs.watch`).
  RN consumers inject custom `fs` + `watcherFactory`; Folio's existing
  `adapters/fsRN.js` + `adapters/watcherRN.js` are the reference shape
  for the substrate-side RN variant when it earns lift.
- Source/handler discipline matches `IngestQueueSource`: when a handler
  is registered, items flow directly through it (queue stays empty);
  without a handler, items accumulate for `drain()`.  Prevents
  double-application when SyncEngine consumes both `onItem` + `syncOnce`.
- Storage hardening NOT in V0: sha-stable debounce, copy-rename grace,
  and version snapshots remain Folio-app glue (substrate stays lean).
- 14 new Vitest tests + 1 SyncEngine integration test (29 total).

## [0.1.0] — 2026-05-02

L1a substrate — initial release.

- `SyncEngine` core with start/stop/syncOnce/push/pull.
- `IngestQueueSource` — H6/H7 use case.
- `InMemoryBackend` for tests.
- Storage convention helpers: `classifyStorage`, `buildReferenceManifest`.
- Conflict policies: `last-write-wins`, `event-only`, custom function.
- Events: `synced`, `conflict`, `error`.
- 15 Vitest tests.

V0 scope: ingest-queue → backend (one-way). V1+ extends to:
- LocalFolderSource (Folio migration; Folio's existing SyncEngine keeps shipping unchanged).
- Bidirectional sync.
- Sha-stable debounce, copy-rename grace, version snapshots (Folio hardening as app-glue when Folio migrates).
- Pod-backed Backend wrapping @canopy/pod-client.
