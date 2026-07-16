# @onderling-app/folio — CHANGELOG

Reverse-chronological log of folio's app-tier changes.  Substrate
changes (sync-engine, pod-client, identity-resolver) live in their
own packages.  See `Project Files/canopy-chat/integration-plan-2026-05-23.md`
for the cross-app integration plan this CHANGELOG dovetails with.

## 2026-05-23 — slice 4 (browser composition for canopy-chat web)

Added `src/browser.js` exporting `createBrowserFolioAgent` — a thin
factory that boots a `@onderling/core` Agent on a shared `InternalBus`
and registers folio's web-only skills.  Consumed by canopy-chat's
slice-4 integration; replaces ~125 lines of mock-real handlers that
used to live on canopy-chat's `hostAgent`.

In-scope skills (chat-web subset):
  - `readNote`, `getFileSnapshot` (Q29 cardSnapshotSkill)
  - `shareFolder` — REAL `PodCapabilityToken` via
    `autoShare.mintShareToken` (no more placeholder stubs)
  - `listFiles`, `searchFiles`
  - `verifyPodState`, `deleteFromPod` (manifest declares
    `runtime: 'browser'`)
  - `downloadFile`, `saveToMyPod` (receiver-side actions; real
    bytes path lives in canopy-chat's `main.js` Blob handler)
  - `folio_briefSummary`, `folioStatus`

Out of scope (stays node-only, never enters the browser bundle):
SyncEngine, chokidar watcher, OS tray, desktop HTTP server, CLI.

New test: `test/browser.test.js` (6 tests) — covers boot, listFiles
seed, shareFolder cap-token round-trip, getFileSnapshot/readNote
shapes, folioStatus/briefSummary aggregates, `seedFiles:[]` clean-
slate fixtures.

Package exports: added `./browser` pointing at `./src/browser.js`.
