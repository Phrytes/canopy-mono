# Folio sync — findings & desired-state notes (2026-05-05)

> Snapshot of a design conversation, not a coding plan. Captures what the
> current sync engine actually does, what we'd like it to do, and a
> rough sense of what each gap costs.

## Where the engine is today (verified against code)

| Claim | Verdict | Evidence |
|---|---|---|
| Local edits propagate | ✅ true | `packages/sync-engine/src/diff.js:92-104` (sha mismatch → `toUpload`); `SyncEngine.js:363-377` (upload path); chokidar/poll watcher already runs |
| Files "live forever" — local rename or delete causes resurrection | ✅ true | `diff.js:120-126`: locally-missing-but-known files are flagged `toDownload` and pulled back. No rename detection: chokidar fires `unlink + add`, engine treats it as "delete + new", so renames duplicate. `deleteCompletely()` (`SyncEngine.js:790-821`) is the only true hard delete and is API-only |
| Conflict management is limited | ✅ true | Detection works (`diff.js:54-67`); resolution is git-style `<<<<<<<` markers (`apps/folio/src/applyConflict.js:39-64`). Folio CLI/desktop has a `/conflicts` route + side-picker UI (`apps/folio/src/server/routes.js:227-330`). Mobile (`folio-mobile`) has only a plain TextInput |

## Desired state — decisions + effort

### Conflicts shown/resolved in-app, in a portable interface

- Desktop already has it. Mobile is the gap.
- **Effort: small** — port the side-picker UI to folio-mobile; route plumbing already exists.
- **Caveat: format-dependent.** Markdown / .txt: existing markers + side-picker work. **ODT (and other binary-ish formats): textual merge corrupts the file.** ODT path needs "keep mine / keep theirs / keep both as `Foo.odt` + `Foo (conflict 2026-05-05).odt`". Strategy chosen by extension. DOCX is out of scope.

### Rename understood as "still the same file"

- Stable per-file ID is needed; current `knownState` is path → sha.
- Rename detection heuristic: same content-hash appearing at a new path within a short window after `unlink` at the old path = rename, not delete+add.
- **Effort: medium.** Schema change to `knownState` (add stable ID, content-hash → ID index) + diff logic overhaul. Contained to the sync engine.

### Background sync

- **Effort: zero — already exists.** `SyncEngine.start()` already runs chokidar + a 60 s poll (`SyncEngine.js:673`).
- **But (decision below):** new default is foreground-only.

### "Use any editor" support

- Desktop: already works. Files are a normal folder; any editor sees them.
- Mobile: blocked by the OS sandbox. See "RN / mobile filesystem" below.

### Filesystem-delete semantics — revised flow

Earlier proposal ("FS delete = hard delete, separate Folio action to unsync") had an irreversible-action risk. Revised flow:

- FS delete locally → engine **does not** re-download, **does not** delete from pod.
- Entry is parked in a "locally deleted" pending list.
- Folio shows a tab/badge: *"X files were deleted locally. Also delete from the pod, or just stop syncing here?"*
- "Stop syncing" → move entry to an `unsynced` set; engine ignores that path forever (until user re-adds).
- "Delete from pod too" → call existing `deleteCompletely()`.
- Either choice clears the entry from the pending list.

**Effort: medium, contained.**
- `knownState` gains two buckets: `pendingDecision` and `unsynced`.
- `diff.js:120-126` flips: instead of `toDownload` when local-missing-but-known, push to `pendingDecision`.
- New UI tab in folio-CLI and folio-mobile (mirrors the existing `/conflicts` shape — list + per-item action).
- No data-loss risk → no need for trash/undo plumbing.

## Cross-cutting design decisions

### Foreground-only sync, by default

- Sync runs when the app is open, on app foreground / on user demand.
- Kills the entire background-sync problem space (BGTaskScheduler / WorkManager / Doze).
- Cadence is just "user opened the app".

### Edit-lock during the check

- Top-of-app banner: *"Checking for changes…"* with editing disabled while it runs.
- Kills concurrent-write races. The existing grace-window heuristic in the engine becomes nice-to-have rather than load-bearing.
- Cost: well under a second on desktop for hundreds of markdown files; 1–3 s on Android with SAF (list+stat is the bottleneck).

### Watcher: off by default, opt-in

- The continuous chokidar/poll watcher stays in the codebase but is opt-in via setting.
- Useful for power users / large file sets where re-scanning the whole tree on every foreground sweep is expensive (incremental updates avoid that cost).
- Mostly a desktop-only switch — Android (SAF) has no real OS folder watcher, only polling, so the toggle is largely moot there.

### One directory, hierarchy below

- The engine already does this. No change.
- Trade-off accepted: users adapt to "Folio's folder is the root", subfolder hierarchy is preserved as-is.

### Scope: markdown + ODT

- Plain markdown / .txt is the primary target — all the in-place merge work assumes this.
- ODT is a secondary format, conflict UX uses pick-mine / pick-theirs / keep-both (no in-place merge).
- DOCX is out of scope.

## RN / mobile filesystem (Android-first)

iOS is out of scope at this stage. Detailed iOS notes live at
`apps/folio-mobile/docs/IOS-FILESYSTEM-NOTES.md` so the design work
isn't lost if/when iOS comes back.

### Why mobile is hard at all

The OS sandbox is real and not an RN limitation:
- Each Android app has a private container at `/data/data/<pkg>/`.
- Scoped Storage (Android 10+) restricts arbitrary external-storage paths.
- Going native (Kotlin) doesn't unlock the filesystem — same OS rules.
- Only desktop (Tauri/Electron/native) has full FS access for free.

### SAF (Storage Access Framework) — the realistic path on Android

User picks a folder once via `ACTION_OPEN_DOCUMENT_TREE`. App gets a
persistent grant via `takePersistableUriPermission`. Folio reads/writes
that folder via `DocumentFile` / `ContentResolver`.

Caveats:

- **Content URIs, not paths.** Path-based code (chokidar, fs.readFile by string path) does not work. Sync engine's adapter pattern handles this in principle — write a `safAdapter` — but anywhere code assumes "string path" needs auditing.
- **No real folder watching.** No inotify; `ContentResolver.registerContentObserver` exists but is unreliable on the primary local provider. Polling is the realistic plan — which lines up perfectly with the foreground-only decision above.
- **Listing is slow.** Each `listFiles()` is an IPC query. A few hundred files = 1–3 s. Cache by `lastModified` + size; only re-hash on change.
- **Permission persistence.** Cap ~128 grants per app; user can revoke from Settings; need a graceful "permission lost, re-pick" path.
- **Filename collisions.** `createFile` of an existing name often produces `name (1).ext` rather than overwriting — always lookup-then-overwrite, or delete-then-create.
- **No inode / stable filesystem ID.** Rename detection still has to be content-hash based — SAF doesn't help here.
- **No advisory locking.** Editor + Folio concurrent writes = last writer wins. Edit-lock-during-check + the engine's grace window cover most of this.
- **External-editor write-back is editor-dependent.** Most modern editors save through the same SAF URI in place; some older ones save a copy in their own sandbox. Will need a "known good" list in practice.
- **Other doc providers.** SAF works with Google Drive / Dropbox / etc. as document providers — much slower, weird semantics. Probably restrict to local-storage authorities.

### RN tooling for SAF

- `react-native-saf-x` and similar libraries exist; quality is uneven, some abandoned.
- Realistic plan: pick one, expect to fork or write a thin native module (~200–400 lines of Kotlin) for tree listing / read / write / delete / rename-within-tree.

## Effort summary

| Item | Effort |
|---|---|
| Foreground-only default + edit-lock banner | small |
| Watcher off by default (toggle in settings) | small |
| Mobile conflict side-picker UI | small |
| ODT conflict path (pick-mine / pick-theirs / keep-both) | small–medium |
| FS-delete → pending decision flow + tab UI | medium |
| Rename detection (stable ID + content-hash heuristic) | medium |
| SAF adapter for Android (sync-engine + RN bridge) | medium–large |
| iOS filesystem support | (out of scope) |
