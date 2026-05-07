# L1a (sync-engine) — pod ↔ external-source sync

> **Refactored 2026-05-04 (Phase 5.1).** The pre-refactor V0
> `SyncEngine` + `IngestQueueSource` + `LocalFolderSource` +
> `InMemoryBackend` + `storageConvention` were all deleted as
> duplicates of `core.DataSource` / `core.PodStorageConvention`. The
> substrate now ships a single engine — the Folio-lifted
> `BidirectionalSyncEngine`, renamed to `SyncEngine` — plus the lifted
> helpers (`PathMap`, `scanLocal`, `scanPod`, `diff`, `versions`, RN
> adapters). One-shot ingest patterns (e.g. `apps/import-bridge-v0`)
> write directly through any `core.DataSource` and don't compose this
> substrate at all.

| | |
|---|---|
| **Package** | `@canopy/sync-engine` (v0.4.0 post-refactor) |
| **Status** | shipped — Phase 5.1 of substrate refactor |
| **Driven by** | H1 (Folio — already shipped, lifts the engine) primary; bidirectional sync only |
| **Pattern source** | `apps/folio/src/SyncEngine.js` (subclass of substrate's `SyncEngine`) + Folio's pod-client + `apps/folio/src/versions.js` |
| **RN variant?** | **Yes** — file-system adapter + 412-on-existing-container catch + version-dir mkdir-recursive |
| **One-shot ingest** | NOT served by this substrate. Apps write directly via `core.DataSource` (see `apps/import-bridge-v0/src/Agent.js` for the pattern). For true one-way live sync from a remote peer, use `core.protocol.LiveSyncSkill`. |

---

## What it is

A substrate for **bidirectional syncing between a local source and a
pod container**. Watches a source (local folder), keeps it in sync
with the pod via configurable conflict resolution, exposes change
events. Storage convention (small=direct, big=reference) is delegated
to `core.PodStorageConvention`.

Folio shipped this for local-folder ↔ pod sync, then it was lifted
into the substrate.

---

## Consumer specs driving the design

- **Primary: H1 (Folio) — already shipped.**  Local markdown folder ↔ pod container.  Conflict events surfaced to UI for resolution.  Storage convention enforced.
- **Other consumers do NOT compose this substrate.** Per Phase 5.1:
  - **H6 (import bridge)** writes directly via `core.DataSource` (`MemorySource` for tests; `pod-client.PodClient`-wrapped target in production). One-shot semantics; no need for the substrate's bidirectional engine.
  - **H7 (archive ingest)** uses similar one-shot writes; substrate not composed.
  - For one-way live sync from a remote peer (e.g. polling Google Drive), use `core.protocol.LiveSyncSkill` directly — it handles cursors / idempotency / per-record onConflict.

---

## Public API shape

```ts
import { SyncEngine } from '@canopy/sync-engine';

const engine = await SyncEngine.create({
  source:    sourceAdapter,       // pluggable: local-folder | oauth-remote | ingest-queue | custom
  podRoot:   'https://test.example/folio/notes/',
  podClient,
  storageConvention: {
    smallThresholdBytes: 1_000_000,    // configurable; default 1 MB
  },
  conflict:  'last-write-wins' | 'event-only' | customResolver,
  bidirectional: true | false,    // false = one-way (e.g. import bridge)
});

await engine.start();
await engine.stop();

// Events
engine.on('synced',     ({path, direction}) => { ... });
engine.on('conflict',   ({path, local, remote, resolve}) => { resolve(...); });
engine.on('error',      ({path, error}) => { ... });
engine.on('progress',   ({completed, total}) => { ... });

// Manual operations
await engine.syncOnce();
await engine.pull(path);
await engine.push(path);
```

### Source adapters

The substrate is **bidirectional only** post-Phase 5.1. Local-folder
adapters live in the Folio app (`apps/folio/src/adapters/`); the
substrate ships the `scanLocal` / `scanPod` / `diff` helpers + the
`PathMap` resolver, and Folio wires them to its file-system adapter.

What the substrate does NOT ship anymore (deleted Phase 5.1):

- `LocalFolderSource` — Folio uses its in-app adapter directly.
- `OAuthRemoteAdapter` — H6 doesn't compose this substrate at all (one-shot writes via DataSource).
- `IngestQueueAdapter` — same as above.

For OAuth-driven remote ingest, compose `core.OAuthVault` + a
connector + `core.DataSource` directly (see
`apps/import-bridge-v0/src/Agent.js` for the working pattern).

For one-way live sync from a peer (polling, cursors, idempotency),
compose `core.protocol.LiveSyncSkill` directly.

---

## Dependencies

- **`@canopy/pod-client`** — pod read/write/list primitive (Folio wraps this in its app-level `SyncEngine` subclass).
- **`@canopy/core/storage/PodStorageConvention`** — small/reference binding (post-Phase 5.1; the substrate's pre-refactor `storageConvention` is gone).
- **`@canopy/react-native`** — RN platform layer; supplies the file-system + `expo-file-system` adapters used by the RN `index.rn.js`.

### No dependency on

- **L1g (oauth-vault)** — moved out. Apps that need OAuth-driven remote ingest compose `core.OAuthVault` + connector + `core.DataSource` directly (see `apps/import-bridge-v0/src/Agent.js`); they don't compose this substrate.

---

## RN variant

**Yes — meaningful differences:**

- `expo-file-system` adapter for the local-folder source.
- 412-on-existing-container catch (Trap 14) — substrate handles
  this when creating containers.
- Version-dir mkdir-recursive for `<localRoot>/.folio/versions/<relPath>/`
  (the second post-validation trap) — substrate handles this on
  first version capture.

Folio's `apps/folio-mobile/docs/SOLID-RN-NOTES.md` documents the
exact issues; substrate absorbs the fixes.

---

## Open questions

1. **Conflict UX.**  Default is LWW; "event-only" emits the `conflict` event without resolving.  Apps wire UI to surface conflicts.  Folio currently does LWW + UI-surfaced banner; substrate preserves this.
2. **Cross-device-cycle merging.**  Two devices write the same file; pod gets two versions; substrate detects mismatch on next sync.  Lean: rely on Track A's `ConflictResolver` primitive (in flight).
3. **Storage convention threshold.**  Default 1 MB per topology-implementation §parked.  Configurable per-engine.  V0: 1 MB.
4. **Tombstone tracking for delete-locally.**  Already part of pod-client's `delete-scope` primitive (Track A); substrate consumes it directly.
5. **Sync mode timing.**  Real-time (file-watch) vs polling (every N seconds)?  Lean: file-watch when available; polling fallback when not (RN, OAuth-remote).

---

## Pattern sources

- **`apps/folio/src/SyncEngine.js`** — primary template.
- **`apps/folio/src/versions.js`** — version-snapshot logic.
- **`apps/folio/src/SyncEngine.js`** § ensure-container — the 412 handling pattern.
- **`apps/folio-mobile/docs/SOLID-RN-NOTES.md`** — Trap catalogue.

When implementing L1a: refactor Folio's existing code into the
substrate.  Folio becomes a substrate consumer; the H1 app sketch
wraps the substrate with markdown-specific glue.

---

## Out of scope for V0

- Real-time collab editing (V1 — H1's chosen OSS docs tool integration).
- CRDT-based merging (V0 = LWW + conflict events; CRDT is an app-level addon).
- Deletion-cascade semantics (substrate emits delete; app decides ramifications).
- Incremental indexing (substrate emits change events; index consumers — like L1i — react).
