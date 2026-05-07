# iOS filesystem notes (future)

> **Not on the current roadmap.** Folio mobile is Android-only at this
> stage. This document captures the iOS-specific filesystem constraints
> we'd need to handle if/when iOS comes back into scope, so the design
> work isn't lost.

## The sandbox

Every iOS app gets a **container** with three writable subtrees:

- `Documents/` — user data, included in iCloud / iTunes backup
- `Library/` — app data (caches, prefs)
- `tmp/` — scratch, system may purge

Nothing outside the container is reachable. Other apps cannot see
Folio's files unless we explicitly opt in. Two opt-ins matter:

### 1. Expose `Documents/` to other apps

Set both flags in `Info.plist`:

- `UIFileSharingEnabled = YES`
- `LSSupportsOpeningDocumentsInPlace = YES`

Effect: Folio's `Documents/` shows up in the iOS **Files** app. Other
editors (iA Writer, Obsidian, Working Copy, Textastic) can open files
from there *in place* and save back to the same location. Closest
equivalent of "use any markdown editor".

Caveats:

- Editors must save through the original `URL`. Many do; some don't.
- No equivalent of "watch this folder" — see "No folder watching" below.

### 2. Pick a folder outside the container

Use `UIDocumentPickerViewController` with `.open` mode on a folder.
The user grants access once; we get a `URL` whose access is gated by
**security-scoped bookmarks**.

- Persist the bookmark data (`URL.bookmarkData(options: .withSecurityScope)`)
- Resolve before each batch (`URL(resolvingBookmarkData:options:.withSecurityScope...)`)
- Wrap each access in `startAccessingSecurityScopedResource()` /
  `stopAccessingSecurityScopedResource()`

This is the iOS analogue of Android SAF. Same conceptual shape,
different API.

## NSFileCoordinator

When the file might be edited by another app concurrently (the whole
point of the "open in place" model), reads and writes should go through
`NSFileCoordinator`. It serialises access between apps and handles
file presenters. Pure `Data(contentsOf:)` works but races with editor
saves.

For Folio's foreground-only + edit-lock-during-check model, this is
less critical: Folio holds the file briefly during the check, then
releases. Coordinator usage is still good practice for robustness.

## No folder watching

iOS has no inotify / FSEvents-style watcher inside the sandbox or for
external bookmarked folders. There is `NSFilePresenter`, but it
notifies *your* app of *your own* changes via the coordinator — not a
general folder watcher.

For Folio's foreground-only sync this is fine: poll on app open / on
user demand. Continuous watching wasn't a goal anyway.

## Background sync (not on roadmap)

If background sync ever comes back, the iOS primitive is
`BGTaskScheduler`:

- `BGAppRefreshTask` — short, frequent, ~30 s budget, best-effort cadence
- `BGProcessingTask` — long, charging+wifi, runs at OS discretion

Cadence is *opportunistic*. The OS decides when, based on user
behaviour, battery, network. You configure a *floor*, not a guarantee.
Apps that the user rarely opens get scheduled rarely or never.

## Asymmetry summary vs Android

| Concern | Android (SAF) | iOS |
|---|---|---|
| User picks folder | `ACTION_OPEN_DOCUMENT_TREE` | `UIDocumentPickerViewController` (folder mode) |
| Persistent permission | `takePersistableUriPermission` (cap ~128) | Security-scoped bookmark (persist `Data` blob) |
| Per-operation gating | None | `startAccessingSecurityScopedResource()` |
| Folder watching | None — poll | None — poll |
| Path semantics | `content://` URIs | `URL` (file:// or scoped) |
| Concurrency primitive | None (last writer wins) | `NSFileCoordinator` + `NSFilePresenter` |
| Background sync | `WorkManager` (reliable) | `BGTaskScheduler` (opportunistic) |
| Expose own dir to other apps | File provider declaration | `UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace` |

## What this means for the engine

If iOS support returns, the sync engine's adapter pattern (Node fs,
RN-Android fs, SAF-Android) gains a fourth implementation:
**iOS-bookmarked-folder fs**. Shape is closer to the SAF adapter
(URI-flavoured, no path semantics, no watcher) than to the Node fs
adapter.

The foreground-only + edit-lock-during-check design works on iOS
unchanged — that's the design's main robustness against iOS
constraints.
