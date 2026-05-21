# L1a (sync-engine) — substrate-vs-SDK refactor plan

| | |
|---|---|
| **Severity** | high |
| **Audited** | 2026-05-04 |
| **Audited by** | substrate audit pass |

## Executive summary

`@canopy/sync-engine` is **two substrates wearing one package**. There is
the V0 *substrate-shaped* `SyncEngine` (`src/SyncEngine.js`, 217 LOC) which
talks to a custom `Backend` interface and an `IngestQueueSource`/`LocalFolderSource`,
and there is the V0.3 *Folio-lifted* `BidirectionalSyncEngine` (`src/BidirectionalSyncEngine.js`,
1335 LOC) which talks directly to a `PodClient` and walks the FS itself.
The two share nothing — different events, different lifecycles, different
backend contracts, different `Emitter` base classes. No code path runs both.
The README's "V0 ingest-only, V1+ Folio migration" story is fictional: Folio
already migrated, but onto `BidirectionalSyncEngine` while `SyncEngine`
sits next to it serving import-bridge-v0 only.

The headline finding is **not** that `SyncEngine` reinvents an SDK primitive —
it's that the substrate reinvents *the SDK's storage layer wholesale*.
`Backend` (`put/get/delete/list`) is a near-clone of `@canopy/core`'s
`DataSource` (`read/write/delete/list/query`). `InMemoryBackend` is a
near-clone of `MemorySource`. `storageConvention.js` (`classifyStorage` +
`buildReferenceManifest`) is a smaller, weaker re-implementation of
`@canopy/core/storage/PodStorageConvention.js`'s `writeWithConvention` /
`readWithConvention` + the `ExternalStore` adapter interface. The substrate
documents itself as "wrap pod-client in a Backend with the same shape" —
i.e. it's *asking every consumer to write a wrapper* against a custom shape,
instead of just consuming `PodClient` directly (which `BidirectionalSyncEngine`
already does).

Severity is **high**, not **critical**. `BidirectionalSyncEngine` is
correctly composed against `PodClient` and `Emitter`-from-core; `PathMap`,
`diff`, `scanLocal`, `scanPod`, `versions` are honest pure-ish helpers
that pull their weight. The skill-match catastrophe (rewriting `Transport`)
isn't here. But the V0 `SyncEngine` + `Backend` tier is dead weight: it
duplicates SDK primitives, splits the substrate's own emitter base class,
and is only kept alive by import-bridge-v0 + InMemoryBackend tests. The
refactor is "delete the V0 tier; everything graduates onto core's
DataSource/PodStorageConvention/PodClient surface; one BidirectionalSyncEngine
becomes the only public class."

## Findings

### Finding 1 — `Backend` interface duplicates `DataSource` + `PodClient` [severity: high]

**File(s):** `packages/sync-engine/src/SyncEngine.js:55-61`,
`packages/sync-engine/src/backends/InMemoryBackend.js:1-27`,
`packages/sync-engine/README.md:117-128`.

**SDK primitive that should serve this:**
- `@canopy/core/storage/DataSource` — `DataSource` (per SDK surface map: "abstract storage backend… `read/write/delete/list/query`. All async.")
- `@canopy/core/storage/MemorySource` — `MemorySource` (per SDK surface map: "in-memory.")
- `@canopy/pod-client/PodClient` — `PodClient` (per SDK surface map: "high-level pod read/write/list/append/patch/delete on top of `SolidPodSource` and an `Auth` impl.")

**What's duplicated/reinvented:** The substrate invents its own `Backend`
contract (`put(uri, record) / get(uri) / delete(uri) / list()`) which is
shape-isomorphic to `DataSource` (`write / read / delete / list`). It then
ships `InMemoryBackend` as the only concrete impl, telling consumers that
they should "wrap @canopy/pod-client (Track A) in a Backend with the same
shape for production." This is the exact substrate↔SDK anti-pattern: a
custom interface that *re-shapes what the SDK already exposes*, forcing
consumers to write an adapter for the substrate to use a primitive they
could otherwise consume directly.

**Evidence (substrate):**

```js
// packages/sync-engine/src/SyncEngine.js:55-66
if (!source || typeof source.start !== 'function') {
  throw new TypeError('SyncEngine: source with start() required');
}
if (!backend || typeof backend.put !== 'function') {
  throw new TypeError('SyncEngine: backend with put() required');
}
...
this.#source        = source;
this.#backend       = backend;
```

```js
// packages/sync-engine/src/backends/InMemoryBackend.js:7-27
export class InMemoryBackend {
  /** @type {Map<string, object>} */
  #records = new Map();

  async put(uri, record) {
    this.#records.set(uri, JSON.parse(JSON.stringify(record)));
  }
  async get(uri) {
    const r = this.#records.get(uri);
    return r ? JSON.parse(JSON.stringify(r)) : null;
  }
  async delete(uri) {
    this.#records.delete(uri);
  }
  async list() {
    return [...this.#records.keys()];
  }
}
```

**Evidence (SDK):**

```js
// packages/core/src/storage/MemorySource.js (SDK surface map: storage/MemorySource.js:7)
export class MemorySource extends DataSource {
  #store = new Map();
  async read(path)  { return this.#store.has(path) ? this.#store.get(path) : null; }
  async write(path, data) { this.#store.set(path, data); }
  async delete(path) { this.#store.delete(path); }
  async list(prefix = '') {
    return [...this.#store.keys()].filter(k => k.startsWith(prefix)).sort();
  }
  ...
}
```

```js
// packages/pod-client/src/PodClient.js  (per SDK surface map):
//   read(uri, { decode? }) → {content, contentType, lastModified, etag, size}
//   write(uri, content, { contentType?, ifMatch?, force?, conflictPolicy? })
//   list(containerUri, { recursive?, filter?, includeTombstoned? })
//   delete(uri, opts?) / deleteCompletely(uri, opts?)
//   createContainer(uri)
```

**Impact:**
- Consumers (import-bridge-v0) rely on `InMemoryBackend` for tests but
  have **no production partner** — the README says "wrap pod-client in a
  Backend" but nobody has, and nobody will (`BidirectionalSyncEngine`
  bypassed `Backend` entirely).
- The custom record format (`{kind:'direct'|'reference', content, contentType, …}`)
  is a leakage of the storage convention into the *backend* layer — `PodClient`
  + `writeWithConvention` already encode this on the wire.
- Removing the abstraction lets us delete `InMemoryBackend` (use
  `MemorySource`) and the V0 `SyncEngine` (consumers compose
  `PodClient` directly, the way `BidirectionalSyncEngine` already does
  in production).

---

### Finding 2 — `storageConvention.js` reinvents `PodStorageConvention` [severity: high]

**File(s):** `packages/sync-engine/src/storageConvention.js:1-60`.

**SDK primitive that should serve this:**
- `@canopy/core/storage/PodStorageConvention` — `writeWithConvention(podSource, externalStore, uri, content, opts?)` / `readWithConvention(podSource, externalStore, uri)`.
- `@canopy/core/storage/external-stores/index.js` — duck-typed `ExternalStore` interface (`put / get / delete / exists`).
- `@canopy/core/storage/external-stores/NoneStore.js` — `NoneStore` default that throws `EXTERNAL_STORE_NOT_CONFIGURED`.

**What's duplicated/reinvented:** Substrate ships its own
small/big classification (`classifyStorage`) + manifest builder
(`buildReferenceManifest`) and inlines them into `SyncEngine.#applyOne`.
Core has the same logic, *threaded through `PodClient` writes*, with
proper `ExternalStore` adapters and a typed `ConventionError`. The
substrate version doesn't actually upload anything — it expects the
caller to pre-set `referenceUri` and just persists a manifest. The SDK
version takes content + an `ExternalStore` and does the upload itself.

**Evidence (substrate):**

```js
// packages/sync-engine/src/storageConvention.js:9-33
export const DEFAULT_SMALL_THRESHOLD_BYTES = 1_000_000;

export function classifyStorage({ size, content, smallThresholdBytes = DEFAULT_SMALL_THRESHOLD_BYTES } = {}) {
  let resolvedSize = size;
  if (resolvedSize === undefined && content !== undefined) {
    if (typeof content === 'string') resolvedSize = Buffer.byteLength(content, 'utf8');
    else if (content instanceof Uint8Array) resolvedSize = content.byteLength;
    else if (Buffer.isBuffer?.(content)) resolvedSize = content.byteLength;
    else resolvedSize = 0;
  }
  return (resolvedSize ?? 0) <= smallThresholdBytes ? 'direct' : 'reference';
}
```

```js
// packages/sync-engine/src/SyncEngine.js:158-176
} else {
  // Reference — substrate doesn't transport bytes; consumer must
  // upload to external storage and pass us the resulting URI.
  if (!item.referenceUri) {
    throw new Error(
      `SyncEngine: item too big for direct storage (size=${item.size}); ` +
      `provide item.referenceUri (where bytes live) to use the reference path.`,
    );
  }
  await this.#backend.put(target, {
    kind: 'reference', uri: item.referenceUri, size: item.size,
    ...(item.contentType ? { contentType: item.contentType } : {}),
    ...(item.hash ? { hash: item.hash } : {}),
  });
}
```

**Evidence (SDK):** per the SDK surface map (`SDK-surface-map.md:234`):

> `PodStorageConvention` (not directly re-exported; consumed by pod-client).
> `writeWithConvention(podSource, externalStore, uri, content, opts?)` /
> `readWithConvention(podSource, externalStore, uri)`. Default threshold
> 1 MB; small writes inline, big writes upload to `externalStore` + write
> a reference manifest. Default `externalStore = NoneStore` throws
> `EXTERNAL_STORE_NOT_CONFIGURED`. Adapter interface documented in
> `external-stores/index.js` (`put`, `get`, `delete`, `exists`).

**Impact:**
- The substrate's V0 reference path is *worse* than the SDK's: it punts
  the upload to the caller, while `writeWithConvention` does the upload
  inline given an `ExternalStore`.
- Different threshold default constant (`DEFAULT_SMALL_THRESHOLD_BYTES = 1_000_000`)
  duplicates the SDK's value — drift risk.
- A consumer that wants big-blob support today has to invent both an
  uploader and a reference URI; with the SDK they pass an `ExternalStore`
  impl (S3, IPFS, etc.) and `writeWithConvention` does the rest.

---

### Finding 3 — `SyncEngine` extends Node's `EventEmitter` instead of `@canopy/core`'s `Emitter` [severity: medium]

**File(s):** `packages/sync-engine/src/SyncEngine.js:21,27`.

**SDK primitive that should serve this:**
- `@canopy/core/Emitter` — "tiny in-house EventEmitter, no deps. **Substrates should use this, not Node's `events`.**" (per SDK surface map). Already used by `BidirectionalSyncEngine` in the same package (`src/BidirectionalSyncEngine.js:22,77`).

**What's duplicated/reinvented:** Pulling `node:events` into the substrate
breaks RN bundling unless polyfilled. The SDK explicitly calls this out
("Node's `events` does NOT, on RN-Hermes minus polyfill" per SDK surface
map composition table). The same package's `BidirectionalSyncEngine`
already imports `Emitter` from `@canopy/core` correctly — the V0 engine
forgot the lesson.

**Evidence (substrate, V0 SyncEngine — wrong):**

```js
// packages/sync-engine/src/SyncEngine.js:21
import { EventEmitter } from 'node:events';
...
// :27
export class SyncEngine extends EventEmitter {
```

**Evidence (substrate, BidirectionalSyncEngine — right):**

```js
// packages/sync-engine/src/BidirectionalSyncEngine.js:22
import { Emitter } from '@canopy/core';
...
// :77
export class BidirectionalSyncEngine extends Emitter {
```

**Impact:** Mechanical — two-line fix. Material because (a) the substrate
is *advertised* as having an RN variant (per `L1a-sync-engine.md`) and
(b) the inconsistency-within-one-package is exactly the kind of thing
that makes substrates feel un-stewarded.

---

### Finding 4 — Custom `Backend` + `Source` contract is a parallel universe to `LiveSyncSkill` [severity: high]

**File(s):** `packages/sync-engine/src/SyncEngine.js:1-216`,
`packages/sync-engine/src/sources/IngestQueueSource.js:1-77`.

**SDK primitive that should serve this:**
- `@canopy/core/protocol/LiveSyncSkill` — "one-way source → target sync engine with onConflict callback + idempotent applied-ids state in vault." (per SDK surface map). Constructor `new LiveSyncSkill({name, source, target, vault, onChange?, onConflict?, pollIntervalMs?})`. Adapter shapes: source has `listChanges({cursor, limit}) → {events, nextCursor}` + `fetchPayload(eventId)`; target has `write/read/exists/delete?`. Use case: "Google Docs → Solid pod migration" — *literally the H6 import-bridge consumer of the substrate's V0 SyncEngine*.

**What's duplicated/reinvented:** The substrate's V0 `SyncEngine` (one-way,
ingest-queue → backend, conflict events) is functionally equivalent to
`LiveSyncSkill`. Both are one-way source→target with a polling/queue
front-end and conflict callbacks. The SDK version uses `Vault` for
applied-ids idempotency. The substrate version doesn't — it can re-apply
a queue item if the consumer mis-uses `syncOnce`. The substrate is the
weaker primitive.

**Evidence (substrate):**

```js
// packages/sync-engine/src/SyncEngine.js:74-92
async start() {
  if (this.#running) return;
  this.#running = true;
  this.#source.onItem(async (item) => {
    try {
      await this.#applyOne(item);
    } catch (err) {
      this.emit('error', { path: item?.relPath ?? null, error: err });
    }
  });
  await this.#source.start();
}
```

```js
// packages/sync-engine/src/sources/IngestQueueSource.js:13-34
export class IngestQueueSource {
  #queue = [];
  #handler = null;
  #started = false;

  async start() { this.#started = true; await this.#flush(); }
  async stop()  { this.#started = false; }
  onItem(handler) { this.#handler = handler; }
```

**Evidence (SDK):**

```js
// packages/core/src/protocol/LiveSyncSkill.js:58-100
export class LiveSyncSkill {
  ...
  constructor({ name, source, target, vault, onChange, onConflict, pollIntervalMs = 60_000 } = {}) {
    if (!name)   throw new Error('LiveSyncSkill: name is required');
    if (!source) throw new Error('LiveSyncSkill: source is required');
    if (!target) throw new Error('LiveSyncSkill: target is required');
    if (!vault)  throw new Error('LiveSyncSkill: vault is required');
    ...
    this.#pollIntervalMs = pollIntervalMs;
  }
```

**Impact:**
- Two ingest-queue → target sync engines exist in the codebase (one in
  core, one in this substrate). H6 import-bridge picked the substrate's;
  it should be on `LiveSyncSkill`.
- Removing the V0 `SyncEngine` collapses the substrate to a single
  exported class (`BidirectionalSyncEngine`) and turns import-bridge-v0
  into a `LiveSyncSkill` consumer.
- This is the substrate's largest pile of dead-by-comparison code.

---

### Finding 5 — `LocalFolderSource` rolls a watcher that duplicates `adapters/watcherNode` [severity: medium]

**File(s):** `packages/sync-engine/src/sources/LocalFolderSource.js:18-21,221-231`,
`packages/sync-engine/src/adapters/watcherNode.js:1-58`.

**SDK primitive that should serve this:** N/A directly — the SDK does not
ship a generic FS watcher. But the substrate already has *its own*
correct watcher abstraction (`WatcherAdapter` + `watcherNode` +
`watcherRN`) used by `BidirectionalSyncEngine`. `LocalFolderSource`
ignores it and inlines a direct `node:fs.watch` call.

**What's duplicated/reinvented:** Two parallel watcher abstractions inside
one substrate. `LocalFolderSource` accepts a `watcherFactory` arg with a
*different shape* (`(root, onChange) → {close}`) than the substrate's
canonical `WatcherAdapter` (`{start: ({root, onEvent, onError}) → {stop}}`).

**Evidence (substrate, LocalFolderSource — bespoke shape):**

```js
// packages/sync-engine/src/sources/LocalFolderSource.js:18-21,221-231
import { watch as nodeWatch } from 'node:fs';
...
function defaultWatcherFactory(root, onChange) {
  const watcher = nodeWatch(root, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    onChange(nodePath.join(root, filename));
  });
  return { close: () => watcher.close() };
}
```

**Evidence (substrate, watcherNode — canonical shape):**

```js
// packages/sync-engine/src/adapters/watcherNode.js:23-54
export function createWatcherNode() {
  return {
    async start({ root, ignored, onEvent, onError }) {
      const watcher = chokidar.watch(root, { ... });
      watcher.on('all', (event, absPath) => {
        if (event === 'add' || event === 'change' || event === 'unlink') {
          try { onEvent({ event, absPath }); }
          catch (err) { if (typeof onError === 'function') onError(err); }
        }
      });
      ...
      return { async stop() { try { await watcher.close(); } catch {} } };
    },
  };
}
```

**Impact:** A consumer using `LocalFolderSource` ships *two* watcher
implementations: `node:fs.watch` (one of the most flake-prone APIs in
Node) inside `LocalFolderSource`, and chokidar (via `watcherNode`) if
they also use `BidirectionalSyncEngine`. Cross-platform recursion bugs
(`{recursive:true}` is Linux-flake) live in `LocalFolderSource` and not
in `watcherNode`.

---

### Finding 6 — `LocalFolderSource` reinvents `scanLocal` for its initial-scan path [severity: low]

**File(s):** `packages/sync-engine/src/sources/LocalFolderSource.js:132-180`,
`packages/sync-engine/src/scanLocal.js:38-114`.

**What's duplicated/reinvented:** `LocalFolderSource.#scanAndEmit` walks
the tree, applies `shouldInclude`, reads + sha256 + emits. `scanLocal.js`
walks the tree, applies `pathMap.shouldSync`, reads + sha256 + emits.
Same algorithm, two implementations. `scanLocal` is adapter-aware
(takes `fs`, `hash`); `LocalFolderSource` re-rolls it inline against
`node:crypto`+`node:fs/promises`.

**Evidence:**

```js
// packages/sync-engine/src/sources/LocalFolderSource.js:181-200 (excerpt)
async #emitFile(relPath) {
  const absPath = nodePath.join(this.#root, relPath);
  let stat; try { stat = await this.#fs.stat(absPath); } catch { return; }
  if (!stat || !stat.isFile()) return;
  let content; try { content = await this.#fs.readFile(absPath); } catch { return; }
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  ...
}
```

```js
// packages/sync-engine/src/scanLocal.js:94-110
async function fileMeta(absPath, fs, hash) {
  let st; try { st = await fs.stat(absPath); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  let buf; try { buf = await fs.readFile(absPath); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  const sha256 = await hash.sha256(buf);
  return { mtimeMs: Math.floor(st.mtimeMs), sha256, size: st.size };
}
```

**Impact:** One implementation drifts from the other. `scanLocal` skips
symlinks at line 80; `LocalFolderSource` doesn't. `scanLocal` honours
`PathMap.shouldSync` (which knows about `.DS_Store`/`Thumbs.db`);
`LocalFolderSource` only filters dotfiles.

---

### Finding 7 — `BidirectionalSyncEngine` does its own scan/sha conflict detection instead of using `PodClient`'s `'conflict'` event [severity: medium]

**File(s):** `packages/sync-engine/src/BidirectionalSyncEngine.js:309-449,407-428`,
`packages/sync-engine/src/diff.js:79-105`.

**SDK primitive that should serve this:**
- `@canopy/pod-client/PodClient.write(uri, content, {ifMatch?, force?, conflictPolicy?})` + `'conflict'` event with `ConflictResolver` payload.
- `@canopy/pod-client/ConflictResolver` — "payload helper for `'conflict'` event. Listener calls `event.resolveWith(content)` (re-write `force:true` with merged content) or `event.cancelWrite()` (throw `ConflictError`)." (per SDK surface map).

**What's duplicated/reinvented:** `BidirectionalSyncEngine` runs a full
scan-both-sides + sha-diff pass on every `runOnce`, and emits its own
`'conflict'` event with `{relPath, absPath, podUri}`. `PodClient` already
auto-attaches `If-Match` headers (per SDK surface map: "`_etagMap` (per-resource
`etag, lastModified` cache; auto-attached as `If-Match` on writes)") and
emits a *richer* `'conflict'` event with a `ConflictResolver` that lets
the listener resolve or cancel.

This duplication is the natural consequence of Folio shipping a sync
engine before `PodClient`'s conflict story matured — it's defensible
historically. But it does mean the substrate has *two layers* doing
conflict detection (engine-side via `diff` + `knownState`; pod-side via
`PodClient.write` etag handshake) and they don't coordinate. The
engine's `conflicts.push(makeConflict(l, p))` fires only when both sides
diverged from `knownState`; `PodClient`'s 412-driven conflict can fire
on a *single* upload when `_etagMap` is stale. The two collide quietly.

**Evidence (substrate — engine-side conflict detection):**

```js
// packages/sync-engine/src/diff.js:79-105
for (const rel of allRels) {
  const l = localByRel[rel];
  const p = podByRel[rel];
  const k = knownState?.[rel];

  // Both present.
  if (l && p) {
    if (l.sha256 === p.sha256) continue;
    if (!k) {
      conflicts.push(makeConflict(l, p));
      continue;
    }
    const localChanged  = l.sha256 !== k.sha256;
    const remoteChanged = p.sha256 !== k.sha256;
    ...
    // Both changed (or neither, but content differs from each other —
    // shouldn't happen if k is consistent; treat as conflict for safety).
    conflicts.push(makeConflict(l, p));
```

```js
// packages/sync-engine/src/BidirectionalSyncEngine.js:407-428
for (const f of d.conflicts) {
  try {
    const localText = await this.#fs.readFileText(f.absPath, 'utf8');
    const remote    = await podClient.read(f.podUri, { decode: 'string' });
    await this.#applyConflictHook(f.absPath, localText, String(remote.content ?? ''), {...});
    ...
    conflicts++;
    this.emit('conflict', { relPath: f.relPath, absPath: f.absPath, podUri: f.podUri });
```

**Evidence (SDK — PodClient conflict path):**

```
// packages/pod-client/src/PodClient.js (per SDK surface map):
//   write(uri, content, { contentType?, ifMatch?, force?, conflictPolicy? })
//     — emits 'conflict' event on 412 with a ConflictResolver
//   Events: 'conflict' (with ConflictResolver payload).
//   _etagMap (per-resource `etag, lastModified` cache; auto-attached as If-Match)
//
// packages/pod-client/src/ConflictResolver.js:27
//   Listener calls event.resolveWith(content) (re-write force:true with merged
//   content) or event.cancelWrite() (throw ConflictError). No listener / no
//   decision within options.conflictListenerTimeout (default 30s) → fall
//   through to opts.conflictPolicy ('reject' | 'lww' | 'remote-wins').
```

**Impact:**
- Subtle duplication that costs scan time (`scanPod` reads every file
  every run to compute sha; `_etagMap` already knows what changed).
- The two layers' conflict events have different shapes; downstream UIs
  bind to one or the other but never both consistently.
- A future Inrupt-stack migration (per `project_capability_tokens_to_inrupt.md`)
  needs the conflict story to be PodClient-driven.

This is `medium`, not `high`, because the engine-side diff *also* serves
the offline-changes-while-pod-was-edited story which `PodClient`'s
per-write etag handshake doesn't see. A real fix is to *combine* — use
`PodClient`'s `'conflict'` for write-time detection and reduce
`BidirectionalSyncEngine`'s diff to "what's new locally / what's new on
the pod since last sync" without the conflict path.

---

### Finding 8 — `versions.js` ships its own atomic-write + sha primitives instead of composing on `DataSource` [severity: low]

**File(s):** `packages/sync-engine/src/versions.js:34-198`.

**SDK primitive that should serve this:**
- `@canopy/core/storage/DataSource` — version-store could be a `DataSource` instance (`<localRoot>/.folio/versions/...` is just a sub-tree).
- `@canopy/core/storage/FileSystemSource:54-62` already does atomic-ish writes (`mkdir-recursive` then `writeFile`); the substrate's `writeAtomic` (tmp-then-rename with random tag) is a more careful version that *could* live in core as `FileSystemSource.writeAtomic` since the same pattern reappears in `BidirectionalSyncEngine.#saveState`.

**What's duplicated/reinvented:** `versions.js` is a self-contained
file-tree key-value store with sha256 sidecars + retention policy. It
manually walks `node:path`-style paths via `joinPosix`, manages a
module-level cache, and re-implements atomic write. None of it depends
on `SyncEngine` state — it's an orthogonal primitive. The substrate's
`fs` adapter abstraction *almost* gets it to "could be on top of any
DataSource", but the listing logic (`readVersionDir`, `walkVersionsTree`)
and atomic-write logic (`writeAtomic`) are specific to a `node:fs`-shaped
adapter.

**Evidence:**

```js
// packages/sync-engine/src/versions.js:184-198
async function writeAtomic(absPath, content, fs) {
  await fs.mkdir(dirnamePosix(absPath), { recursive: true });
  const pid = (typeof process !== 'undefined' && typeof process.pid === 'number') ? process.pid : 0;
  const tmp = `${absPath}.tmp-${pid}-${Math.random().toString(36).slice(2, 8)}`;
  if (Buffer.isBuffer(content) || content instanceof Uint8Array) {
    await fs.writeFile(tmp, content);
  } else {
    await fs.writeFile(tmp, String(content ?? ''), { encoding: 'utf8' });
  }
  await fs.rename(tmp, absPath);
}
```

```js
// packages/sync-engine/src/BidirectionalSyncEngine.js:1284-1295 (state file save —
// the SAME pattern, written separately)
async #saveState() {
  const dir = dirnamePosix(this.#stateFilePath);
  await this.#fs.mkdir(dir, { recursive: true });
  const tmp = `${this.#stateFilePath}.tmp`;
  const payload = JSON.stringify({...}, null, 2);
  await this.#fs.writeFile(tmp, payload, { encoding: 'utf8' });
  await this.#fs.rename(tmp, this.#stateFilePath);
}
```

**Impact:** Two `tmp-then-rename` implementations in one substrate (one
with a random tag, one without). A `DataSource.writeAtomic(path, content)`
on core would absorb both. Versioning is *useful* and worth keeping
as a substrate-level helper, but its FS coupling is gratuitous.

This is `low` because the duplication is internal-to-the-substrate and
there's no SDK primitive being bypassed *exactly* — it's a "could be
better" observation, not a "duplicates SDK" finding.

---

### Finding 9 — `BidirectionalSyncEngine` doesn't use `TombstoneStore`; `diff.js` explicitly punts on tombstones [severity: medium]

**File(s):** `packages/sync-engine/src/BidirectionalSyncEngine.js:748-820`,
`packages/sync-engine/src/diff.js:108-127`.

**SDK primitive that should serve this:**
- `@canopy/pod-client/TombstoneStore` + `MemoryTombstones`/`FileTombstones`/`AsyncStorageTombstones`/`IndexedDBTombstones` — "abstract. Methods: `add(uri, {at?})`, `has(uri)`, `remove(uri)`, `list()`, `close()`." (per SDK surface map).
- `@canopy/pod-client/PodClient.deleteLocal(uri)` + `PodClient.list({includeTombstoned: true})` — already does the right thing under the hood.

**What's duplicated/reinvented:** `BidirectionalSyncEngine.deleteLocal`
forwards to `podClient.deleteLocal` (good), but `diff.js` doesn't read
back tombstones from the `PodClient` — comments at line 108-127
explicitly say "v1 we re-upload" because there's no tombstone awareness.
The result: a user deletes a file locally, `deleteLocal` writes the
tombstone, the next `runOnce` does `scanLocal` (file is gone) +
`scanPod` (file is still there — `PodClient.list` filters tombstones by
default per SDK surface map "default tombstoned URIs hidden from
`list()`"), and the diff pulls the file back down from the pod.

Wait — actually, `PodClient.list` *does* filter tombstones by default,
so the pod scan will skip the tombstoned URI. But this is undocumented
in the substrate; the substrate's `scanPod.js` doesn't pass
`includeTombstoned: false` (it relies on the default), and `diff.js`'s
comment about "could mean another device deleted it (deleteCompletely)"
+ "v1 re-uploads" is *wrong* if `PodClient.list` is filtering correctly.
Either (a) there's a real bug here (re-upload after `deleteLocal`), or
(b) the substrate's diff comment is stale and the SDK is silently
saving us. Both states are bad.

**Evidence (substrate — diff is unaware of tombstones):**

```js
// packages/sync-engine/src/diff.js:108-127
// Local-only.
if (l && !p) {
  // If state says we synced this file before, then pod-side disappeared
  // → could mean another device deleted it (deleteCompletely).  v1 treats
  // local-only with prior state as toUpload (we don't have a delete intent
  // here without an explicit tombstone).  A future enhancement is to track
  // pod-side tombstones; for v1 we re-upload, which is the safer default
  // for note content (no silent loss of an edit).
  toUpload.push({ ...l });
  continue;
}

// Pod-only.
if (p && !l) {
  // Same logic mirror: if known and previously synced, the user may have
  // deleted locally without `deleteLocal` (rm). v1 pulls it back — Phase B
  // can add an explicit "I deleted that, please tombstone" UX.
  toDownload.push({ ...p });
  continue;
}
```

**Evidence (SDK):** per SDK surface map line 347-351:

> The TombstoneStore exists so that `PodClient.list()` can hide URIs the
> user marked deleted-locally, and so any app-level sync can skip them.

**Impact:** The substrate's diff comment claims it's "the safer default"
to re-upload after a local delete, but `PodClient`'s tombstone GC may
already prevent this — undocumented dependence on SDK behaviour. Either
way, the substrate should *explicitly* read the tombstone store before
deciding "local-only file, re-upload."

---

### Finding 10 — `LocalFolderSource` filters dotfiles inline instead of using `PathMap.shouldSync` [severity: low]

**File(s):** `packages/sync-engine/src/sources/LocalFolderSource.js:34-38`.

**What's duplicated/reinvented:** `PathMap.shouldSync` already encodes
the substrate's full skip-rule set (dotfiles, dotdirs, `.DS_Store`,
`Thumbs.db`, `desktop.ini`). `LocalFolderSource` ships its own
`DEFAULT_SHOULD_INCLUDE` that only skips dotfiles + dotdirs.

**Evidence:**

```js
// packages/sync-engine/src/sources/LocalFolderSource.js:34-38
const DEFAULT_SHOULD_INCLUDE = (relPath) => {
  // Skip dotfiles + dotdirs (.git, .DS_Store, .canopy, etc.).
  const segs = relPath.split('/');
  return !segs.some((s) => s.startsWith('.'));
};
```

```js
// packages/sync-engine/src/PathMap.js:152-161
shouldSync(relPath) {
  const r = normalizeRel(String(relPath ?? ''));
  if (r === '') return false;
  const segs = r.split('/');
  for (const seg of segs) {
    if (seg.startsWith('.')) return false;
    if (SKIP_NAMES.has(seg)) return false;
  }
  return true;
}
```

**Impact:** `LocalFolderSource` accepts `Thumbs.db` files; `PathMap`
+ `BidirectionalSyncEngine` reject them. A file picked up by
`LocalFolderSource` and pushed through `SyncEngine` could land on the
pod and then be filtered out by `BidirectionalSyncEngine`'s scan on the
next sync (creating a phantom diff). Trivial fix; lists here for
completeness.

---

### Finding 11 — Composes correctly: `BidirectionalSyncEngine` ↔ `PodClient` [severity: low — explicit ack]

**File(s):** `packages/sync-engine/src/BidirectionalSyncEngine.js:191-241`,
`packages/sync-engine/src/scanPod.js:26-81`.

**Verified that** `BidirectionalSyncEngine` correctly composes against
`PodClient` *as an injected dependency, not a wrapper*. It calls
`podClient.read`, `podClient.write`, `podClient.list`, `podClient.exists`,
`podClient.head`, `podClient.deleteLocal`, `podClient.deleteCompletely`,
`podClient.createContainer` directly with the SDK's documented signatures.
It does NOT re-shape the `PodClient` API via a `Backend` wrapper — the
engine talks to `PodClient` (or a duck-typed mock) without an
intermediate. This is the **right** pattern; if anything it's the
SDK→substrate proof of concept and should be the model for a
post-refactor `SyncEngine`.

```js
// packages/sync-engine/src/BidirectionalSyncEngine.js:213
this.#podClient      = podClient;
...
// :330
const podScan   = await scanPod(podClient, this.#podRoot, { pathMap: this.#pathMap, hash: this.#hash });
...
// :368
await podClient.write(podUri, content, { contentType: ct });
...
// :383
const r = await podClient.read(f.podUri, { decode: 'string' });
```

This finding is the explicit "looks fine" callout the audit brief asks
for: `BidirectionalSyncEngine`'s relationship to `PodClient` is healthy
and is the load-bearing piece that prevents this substrate from being
**critical**.

---

### Finding 12 — `Source` adapters bypass core's `DataSource` even where it would fit [severity: low]

**File(s):** `packages/sync-engine/src/sources/IngestQueueSource.js`,
`packages/sync-engine/src/sources/LocalFolderSource.js`.

**SDK primitive that should serve this:** `@canopy/core/storage/DataSource` (`MemorySource`, `FileSystemSource`).

**What's duplicated/reinvented:** The substrate's "Source" interface
(`start/stop/onItem/drain`) is a push-shaped streaming source. `DataSource`
is a pull-shaped K/V store. They aren't the same shape, so the
duplication is *less* obvious than `Backend` vs `DataSource`. But
`LocalFolderSource` *is* essentially "watch a `FileSystemSource` for new
keys and emit each value." Re-rolling it as a `DataSource` watcher would
share infrastructure with `IndexedDBSource`/`MemorySource` watchers (if
those existed; they don't) and would let the substrate accept *any*
`DataSource` as a source.

This is **low** because the watcher use case isn't really served by
`DataSource` today (no `watch()` method on the abstract base). The
substrate's source abstraction is reasonable. The opportunity is for
core to grow `DataSource.watch?(prefix?, handler)` and then `LocalFolderSource`
can be a thin `FileSystemSource.watch()` wrapper. That's an SDK
enhancement, not a substrate refactor.

## Refactor plan

The plan deletes the V0 tier, renames `BidirectionalSyncEngine` to
`SyncEngine` (the bidirectional engine becomes the only public class),
and switches the Folio-style storage convention onto core's primitives.
Steps are ordered so each one ships independently green.

### Step 1 — Switch `SyncEngine` (V0) to `Emitter` from `@canopy/core`

- Files: `packages/sync-engine/src/SyncEngine.js:21,27`.
- Change: replace `import { EventEmitter } from 'node:events'` with
  `import { Emitter } from '@canopy/core'` and `extends EventEmitter` →
  `extends Emitter`. Mirrors `BidirectionalSyncEngine`.
- Public-API break? **No** — emitter API is a strict subset of Node's
  EventEmitter (on/off/once/emit/removeAllListeners).
- Tests affected: `test/SyncEngine.test.js` — should pass unchanged.

### Step 2 — Mark V0 `SyncEngine` + `Backend` as deprecated; document the migration

- Files: `packages/sync-engine/src/SyncEngine.js`, `packages/sync-engine/src/backends/InMemoryBackend.js`,
  `packages/sync-engine/README.md`, `packages/sync-engine/src/index.js`.
- Change: add `@deprecated` JSDoc + a CHANGELOG entry. Update
  `index.js` to mark `SyncEngine` and `InMemoryBackend` as deprecated
  re-exports with a `console.warn` (only in non-production) pointing
  at `LiveSyncSkill` (for one-way ingest) or `BidirectionalSyncEngine`
  (for full sync).
- Public-API break? **Yes — soft.** Consumers continue to work but get
  a deprecation warning.
- Tests affected: `test/SyncEngine.test.js` — keep passing during the
  deprecation period; the deprecation warning is gated by env so tests
  don't see it.

### Step 3 — Migrate `import-bridge-v0` to `@canopy/core/protocol/LiveSyncSkill`

- Files: `apps/import-bridge-v0/src/Agent.js`, `apps/import-bridge-v0/test/integration.test.js`.
- Change: replace `SyncEngine + IngestQueueSource + InMemoryBackend`
  with `LiveSyncSkill + {source: connectorSourceAdapter, target: podSourceWrapper, vault}`.
  The Connector → SyncEvent shape mapping is the consumer's job; tests
  use `MemorySource` as the target.
- Public-API break? **Yes — for the import-bridge package.** Acceptable
  because import-bridge is V0 and pre-stable.
- Tests affected: `apps/import-bridge-v0/test/integration.test.js` —
  full rewrite to use `LiveSyncSkill` + `MemorySource`.

### Step 4 — Replace `storageConvention.js` with re-exports from core's `PodStorageConvention`

- Files: `packages/sync-engine/src/storageConvention.js`,
  `packages/sync-engine/src/index.js`.
- Change: delete the inline `classifyStorage` + `buildReferenceManifest`
  + `DEFAULT_SMALL_THRESHOLD_BYTES`. Re-export from
  `@canopy/core/storage/PodStorageConvention.js` (likely needing
  core to first re-export `classifyStorage` if it doesn't already; the
  surface map shows `writeWithConvention` / `readWithConvention` are
  in core but doesn't list a separate `classifyStorage`). Either way,
  the substrate becomes a thin re-export, not a re-implementation.
- Public-API break? **No** — same exports, same shapes. Default threshold
  is the same constant.
- Tests affected: `test/SyncEngine.test.js` (storageConvention block at
  line 176-198) — adjust import path; behaviour identical.

### Step 5 — Delete `InMemoryBackend`; redirect to `@canopy/core/storage/MemorySource`

- Files: `packages/sync-engine/src/backends/InMemoryBackend.js` (delete),
  `packages/sync-engine/src/index.js` (remove export),
  `packages/sync-engine/package.json` (remove subpath export
  `./backends/in-memory`).
- Change: After Step 3, the only consumers of `InMemoryBackend` are
  internal tests + `apps/import-bridge-v0`. Migrate tests to
  `MemorySource` (the record format `{kind, content, contentType}` lives
  inline in the `SyncEngine` test fixtures rather than as a built-in
  shape).
- Public-API break? **Yes — hard.** Consumers must replace
  `new InMemoryBackend()` with `new MemorySource()` and adjust
  expectations for the record format (MemorySource stores raw values,
  not the substrate's `{kind:'direct', content, contentType, ...}`
  envelope).
- Tests affected: `test/SyncEngine.test.js` — full rewrite of the
  backend stub.

### Step 6 — Delete V0 `SyncEngine` + `IngestQueueSource` + `LocalFolderSource`

- Files (delete): `packages/sync-engine/src/SyncEngine.js`,
  `packages/sync-engine/src/sources/IngestQueueSource.js`,
  `packages/sync-engine/src/sources/LocalFolderSource.js`,
  `packages/sync-engine/test/SyncEngine.test.js`,
  `packages/sync-engine/test/LocalFolderSource.test.js`.
- Files (update): `packages/sync-engine/src/index.js`,
  `packages/sync-engine/package.json`, `packages/sync-engine/README.md`.
- Change: After Steps 3+5, V0 has no production consumers. Delete it.
  The substrate now ships only `BidirectionalSyncEngine` (renamed —
  see Step 7) and the Folio-lifted helpers (`PathMap`, `scanLocal`,
  `scanPod`, `diff`, `versions`, adapters).
- Public-API break? **Yes — hard.** Final removal. Coordinate with
  Step 2's deprecation period.
- Tests affected: deleted along with the source files.

### Step 7 — Rename `BidirectionalSyncEngine` → `SyncEngine` (the only engine)

- Files: `packages/sync-engine/src/BidirectionalSyncEngine.js` →
  `packages/sync-engine/src/SyncEngine.js`,
  `packages/sync-engine/src/index.js`,
  `packages/sync-engine/package.json` (subpath
  `./BidirectionalSyncEngine` → `./SyncEngine`),
  `apps/folio/src/SyncEngine.js`.
- Change: After Step 6 there's only one engine. Rename the class for
  clarity.
- Public-API break? **Yes — hard.** Folio's `apps/folio/src/SyncEngine.js`
  re-exports from the substrate; update the re-export. External-facing
  name change.
- Tests affected: imports in `apps/folio/test/*.test.js` plus the
  package's own tests.

### Step 8 — Inline `LocalFolderSource`'s scan path into the renamed `SyncEngine` via `scanLocal`

- (Done implicitly by Step 6 — the deleted `LocalFolderSource` had no
  user; `BidirectionalSyncEngine` always called `scanLocal` directly.
  This step is a cleanup pass to make sure no Folio code path imported
  `LocalFolderSource`.)
- Files: `apps/folio/src/SyncEngine.js`, `apps/folio/src/cli/*.js`.
- Change: Verify and remove any stray `LocalFolderSource` imports.
- Public-API break? No — `LocalFolderSource` was never used by Folio.
- Tests affected: none (already deleted).

### Step 9 — Tombstone-aware diff

- Files: `packages/sync-engine/src/diff.js`,
  `packages/sync-engine/src/SyncEngine.js` (renamed BidirectionalSyncEngine).
- Change: `diff(localScan, podScan, knownState, opts?)` accepts a
  `tombstoneStore?: TombstoneStore` option and treats local-only +
  prior-state files differently when a tombstone is present (drop
  rather than re-upload). The engine threads
  `podClient.tombstoneStore` (which the SDK already exposes per surface
  map line 334) into the diff call.
- Public-API break? **Diff signature additive.** Engine internal change.
- Tests affected: `test/diff.test.js` — add tombstone-aware test
  cases. Folio integration tests pass unchanged.

### Step 10 — Move `writeAtomic` (versions) to `FsAdapter` (or core's FileSystemSource)

- Files: `packages/sync-engine/src/versions.js:184-198`,
  `packages/sync-engine/src/SyncEngine.js:#saveState` (renamed engine).
- Change: Add a single `writeAtomic` helper (either in
  `packages/sync-engine/src/adapters/index.js` or — preferably —
  in `@canopy/core/storage/FileSystemSource` as a static helper).
  Replace both inline `tmp-then-rename` blocks. Optional, but worth
  doing alongside the bigger refactor.
- Public-API break? No.
- Tests affected: existing `test/versions.test.js` — unaffected.

### Step 11 — Audit `@canopy/sync-engine`'s peerDependency on `chokidar`

- Files: `packages/sync-engine/package.json:27`.
- Change: After Step 6 only `watcherNode.js` (chokidar) and
  `BidirectionalSyncEngine` use chokidar. Confirm chokidar stays as a
  direct dep (it does — the renamed `SyncEngine` is the watcher's only
  consumer). No action unless we also delete `LocalFolderSource`'s
  bespoke `node:fs.watch` factory (we did, in Step 6).

## Public API surface — before / after

```js
// before — packages/sync-engine/src/index.js (current)
export { SyncEngine } from './SyncEngine.js';                    // V0 ingest engine
export { BidirectionalSyncEngine } from './BidirectionalSyncEngine.js';
export { IngestQueueSource } from './sources/IngestQueueSource.js';
export { LocalFolderSource } from './sources/LocalFolderSource.js';
export { InMemoryBackend } from './backends/InMemoryBackend.js';
export {
  classifyStorage,
  buildReferenceManifest,
  DEFAULT_SMALL_THRESHOLD_BYTES,
} from './storageConvention.js';

export { PathMap, joinRel } from './PathMap.js';
export { scanLocal } from './scanLocal.js';
export { scanPod }   from './scanPod.js';
export { diff }      from './diff.js';
```

```js
// after — packages/sync-engine/src/index.js
// Bidirectional pod ↔ folder sync.  The substrate's only engine.
export { SyncEngine } from './SyncEngine.js';

// Folio-lifted helpers — pure functions over a PodClient + an FsAdapter.
export { PathMap, joinRel } from './PathMap.js';
export { scanLocal } from './scanLocal.js';
export { scanPod }   from './scanPod.js';
export { diff }      from './diff.js';

// FS / hash / watcher adapter contracts (shared with consumers' RN drivers).
export * from './adapters/index.js';

// Re-export from core so downstream apps can stop importing from two places:
export {
  writeWithConvention,
  readWithConvention,
  // (or classifyStorage / buildReferenceManifest if core exposes them
  // as top-level helpers post-refactor.)
} from '@canopy/core/storage/PodStorageConvention.js';
```

**Removed exports** (hard breaks): `BidirectionalSyncEngine`
(renamed to `SyncEngine`), the V0 `SyncEngine`, `IngestQueueSource`,
`LocalFolderSource`, `InMemoryBackend`, `classifyStorage`,
`buildReferenceManifest`, `DEFAULT_SMALL_THRESHOLD_BYTES` (re-exported
from core).

## Migration path for downstream consumers

| Consumer | Currently uses | Migrates to |
|---|---|---|
| `apps/folio/src/SyncEngine.js` | `BidirectionalSyncEngine` (re-export) | `SyncEngine` (renamed) — single import-name change. |
| `apps/folio/src/cli/{syncCmd,watchCmd,serveCmd,rmCmd}.js` | `new SyncEngine({...})` (the Folio-side re-export of `BidirectionalSyncEngine`) | Unchanged — they already construct with `podClient + localRoot + podRoot`, which matches the renamed `SyncEngine`. |
| `apps/folio-mobile/...` | RN driver via `apps/folio/src/rn/serviceFactory.js` | Unchanged. |
| `apps/import-bridge-v0/src/Agent.js` | V0 `SyncEngine` + `IngestQueueSource` + `InMemoryBackend` | `LiveSyncSkill` from `@canopy/core` + a `MemorySource` target. **This is the only non-trivial migration**; expect ~half a day. |
| `apps/import-bridge-v0/test/integration.test.js` | V0 `SyncEngine` + `InMemoryBackend` | `LiveSyncSkill` + `MemorySource`. |
| `packages/sync-engine/src/SyncEngine.js` (substrate's own V0 file) | self | Deleted (Step 6). |

No external substrate currently depends on the V0 `SyncEngine`'s record
format (`{kind:'direct', content, ...}`); only the substrate's own
tests + import-bridge-v0 does. Inrupt-stack migration considerations
(per `project_capability_tokens_to_inrupt.md`) are unaffected — the
auth seam stays at `PodClient`'s `Auth` adapter.

## Test changes

| Test file | Action |
|---|---|
| `test/SyncEngine.test.js` | **Delete** alongside Step 6. The renamed bidirectional engine has its own tests in Folio. |
| `test/LocalFolderSource.test.js` | **Delete** alongside Step 6. |
| `test/diff.test.js` | **Extend** with tombstone-aware test cases (Step 9). Existing cases unchanged. |
| `test/scanLocal.test.js` | **Keep** — unchanged. |
| `test/versions.test.js` | **Keep** — unchanged (Step 10 is internal). |
| `test/adapters/*.test.js` | **Keep** — unchanged. |
| **(new)** `test/SyncEngine.test.js` (replacement) | After Step 7's rename, lift the existing `apps/folio/test/SyncEngine.test.js` to the substrate. ~700 LOC (it's the engine's primary test suite). |

`apps/import-bridge-v0/test/integration.test.js` is rewritten from
scratch (Step 3) — five tests, one per `LiveSyncSkill` event flow.

## Estimated effort

- **Substrate refactor (Steps 1, 2, 4, 5, 6, 7, 9, 10, 11):** 3 days,
  most of it spent lifting the Folio-side engine test suite into the
  substrate (Step 7) and writing tombstone-aware diff tests (Step 9).
- **Downstream consumer migration:**
  - Folio + Folio-mobile: 0.5 days (rename + verify CI).
  - import-bridge-v0: 0.5 days (rewrite onto `LiveSyncSkill`).
- **Total: ~4 days** sequential, or ~2.5 days if Folio rename runs
  parallel to the substrate cleanup (Steps 1-6).

## Cross-substrate dependencies surfaced

- **L1g (`@canopy/oauth-vault`)** — mentioned in `L1a-sync-engine.md`
  as a future consumer (`OAuthRemoteAdapter`). Substrate doesn't
  currently depend on it; planned `LiveSyncSkill` adapter for OAuth
  remotes is best done as part of L1g's audit (since L1g's `OAuthVault`
  may itself reinvent core's `OAuthVault`).
- **Core — gap to fix:** `classifyStorage` is currently buried inside
  `PodStorageConvention.js` (per file head) but isn't a top-level
  re-export (per SDK surface map line 234). For Step 4 to land cleanly,
  core should re-export `classifyStorage` + the `ExternalStore`
  interface signature. This is a one-line core PR.
- **Core — `DataSource.watch?` enhancement (Finding 12).** Out of scope
  for this refactor, but a future SDK enhancement that would unify
  watcher patterns across `FileSystemSource`/`IndexedDBSource`/etc.
  Note for the SDK roadmap.
- **Pod-client — TombstoneStore exposure (Finding 9).** `PodClient`
  already exposes `tombstoneStore` getter (per SDK surface map line
  334). The substrate just needs to thread it into `diff`. No
  pod-client change required.
- **Core's `LiveSyncSkill` (Finding 4).** Audit pass for
  `LiveSyncSkill` adapter ergonomics may be useful — it's the V0
  ingest-engine's natural replacement, and import-bridge-v0 is the
  first non-trivial consumer.
