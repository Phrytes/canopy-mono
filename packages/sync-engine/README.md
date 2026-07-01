# @canopy/sync-engine

> **Layer: substrate.** Composes the `@canopy/core` SDK. Substrates MUST NOT reinvent SDK primitives (transports, vaults, auth, merge contracts, push, skill registries, identity, emitters, ULID); when the SDK *almost* fits, extend it additively rather than forking. See [`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md). **Post-Phase 5.1 contract:** the substrate is bidirectional-only. One-shot ingest patterns must write directly through any `core.DataSource`; one-way live sync from a remote peer must compose `core.protocol.LiveSyncSkill` directly — neither shape composes this substrate.

Pod ↔ external-source sync engine with pluggable source adapters
+ storage convention enforcement (small=direct / big=reference).

This is **L1a** in the substrate-first plan
(`Project Files/Substrates/L1a-sync-engine.md`).

## V0 scope

V0 ships the **ingest-queue → backend** pattern (H6 import bridge,
H7 archive ingest).  Bidirectional folder ↔ pod sync (Folio's
case) is V1+; Folio's existing 1300-LOC `apps/folio/src/SyncEngine.js`
keeps running unchanged.  When Folio migrates to consume this
substrate, its hardening (sha-stable debounce, copy-rename grace,
version snapshots) layers on as app-glue.

## Quick start

```js
import {
  SyncEngine,
  IngestQueueSource,
  InMemoryBackend,
} from '@canopy/sync-engine';

const source  = new IngestQueueSource();
const backend = new InMemoryBackend();           // swap for a pod-backed backend in production
const engine  = new SyncEngine({
  source,
  backend,
  podRoot: 'https://test.example/archive',
  storageConvention: { smallThresholdBytes: 1_000_000 },
  conflictPolicy: 'last-write-wins',
});

engine.on('synced',   ({path}) => console.log('synced', path));
engine.on('conflict', ({path, local, remote, resolve}) => { /* event-only */ });
engine.on('error',    ({path, error}) => console.error('sync error', error));

await engine.start();

// A connector agent (e.g. an H6 Google Docs connector) pushes items:
await source.ingest({
  relPath:     'gmail/msg-abc.md',
  content:     '# Subject\n…',
  contentType: 'text/markdown',
  lastModified: Date.now(),
});

// Big content lives at an external URI; substrate stores a manifest.
await source.ingest({
  relPath:      'photos/big.jpg',
  size:         8_000_000,
  referenceUri: 'https://blob.example/abc.jpg',
  hash:         'sha256:...',
  contentType:  'image/jpeg',
});
```

## API surface

```ts
new SyncEngine({
  source:    Source,                 // {start, stop, onItem, drain?}
  backend:   Backend,                // {put, get, delete, list}
  podRoot:   string,
  storageConvention?: { smallThresholdBytes?: number },
  bidirectional?: boolean,           // V0 default false
  conflictPolicy?: 'last-write-wins' | 'event-only' | (args) => resolved,
})

await engine.start() / engine.stop()
await engine.syncOnce()              // drain source's queue
await engine.push(item)              // explicit injection
await engine.pull(uri)               // V1+ — bidirectional only
```

### Source interface

```ts
interface Source {
  start():           Promise<void>;
  stop():            Promise<void>;
  onItem(handler):   void;
  drain?():          Promise<Item[]>;
}
```

V0 ships:

- `IngestQueueSource` — H6/H7 use case (connector agents push items).
- `LocalFolderSource` (v0.2) — watches a local directory, emits one
  item per file.  Node-default fs + `node:fs.watch`; RN consumers
  inject custom `fs` + `watcherFactory` (Folio's existing
  `adapters/fsRN.js` is the reference shape).  Skips dotfiles by
  default; per-relPath debounce.

Future: `OAuthRemoteSource` (per-source connectors), bidirectional
LocalFolderSource (when Folio's full migration lands).

```js
import { LocalFolderSource } from '@canopy/sync-engine';

const src = new LocalFolderSource({
  root: '/path/to/folder',
  // Optional: filter files by relPath (default skips dotfiles/dotdirs).
  shouldInclude: (rel) => !rel.endsWith('.bak'),
  // Optional: map relPath → contentType (default uses extension).
  contentTypeFor: (rel) => 'text/markdown',
  // Optional: pluggable adapters for RN.
  // fs: expoFsAdapter, watcherFactory: rnWatcherFactory,
});
```

### Backend interface

```ts
interface Backend {
  put(uri, record): Promise<void>;
  get(uri):         Promise<record | null>;
  delete(uri):      Promise<void>;
  list():           Promise<string[]>;
}
```

V0 ships `InMemoryBackend`.  Apps wrap `@canopy/pod-client` (Track A)
in a Backend with the same shape for production.

### Item shape (in source.ingest)

```ts
{
  relPath?:     string,         // pod-root-relative path
  targetUri?:   string,         // OR explicit URI

  content?:     string|Uint8Array|Buffer,    // for direct storage
  size?:        number,                       // for storage classification

  referenceUri?: string,                      // for reference storage (big content)
  hash?:        string,                       // sha256 hex (optional)

  contentType?: string,
  metadata?:    object,                       // free-form sidecar

  lastModified?: number,                      // for conflict detection
}
```

## Storage convention

Enforced by `classifyStorage()`:
- `size <= smallThresholdBytes` (default 1 MB) → **direct** (record persisted in pod with `kind: 'direct'`).
- `size > smallThresholdBytes` → **reference** (manifest with `{kind, uri, size, hash, contentType}` persisted; bytes live at the external URI).

Apps that already know the storage shape can pre-set `referenceUri`
so the substrate doesn't try to read content.  Apps with mid-size
items can override the threshold.

## Conflict policies

| Policy | Behaviour |
|---|---|
| `'last-write-wins'` (default) | Incoming wins.  Emits `conflict` event for observability. |
| `'event-only'` | Emits `conflict` with a `resolve()` callback; the consumer chooses.  Substrate skips the write if `resolve` isn't called with a resolution. |
| `function` | Custom resolver `({path, local, remote}) => resolved`.  Return value is what gets persisted. |

Conflict detection is via `lastModified` mismatch.  Apps wanting
sha-based detection layer their own check on top.

## Pattern source

Substrate sketch from `apps/folio/src/SyncEngine.js` (1300 LOC) +
`apps/folio/src/versions.js`.  V0 keeps the substrate small; Folio's
hardening is V1+ when Folio migrates.

## See also

- `Project Files/Substrates/L1a-sync-engine.md` — sketch.
- `Project Files/Substrates/apps/{H1-folio.md, H6-import-bridge.md, H7-archive.md}` — consumers.
