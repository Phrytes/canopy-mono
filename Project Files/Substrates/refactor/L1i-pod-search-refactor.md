# L1i (pod-search) — substrate-vs-SDK refactor plan

| | |
|---|---|
| **Severity** | low (with one medium gap) |
| **Audited** | 2026-05-04 |
| **Auditor** | substrate-vs-SDK pass |
| **Package** | `@canopy/pod-search` v0.1.0 |
| **Files reviewed** | `packages/pod-search/src/{PodSearch.js,index.js}`, `packages/pod-search/test/PodSearch.test.js`, `packages/pod-search/{package.json,README.md,CHANGELOG.md}` |

## Executive summary

L1i is the *opposite* problem from L1e. Where skill-match reinvented an
abstraction the SDK already had, **L1i V0 does almost nothing yet** — it
is a 228-line in-memory keyword index that does not currently touch the
SDK at all. The constructor accepts `podClient` and `rootContainer`
parameters, but they are commented out
(`packages/pod-search/src/PodSearch.js:37`) and unused. There is no pod
walker, no tombstone tracking, no SQLite, no `*.rn.js` shim, no
`service-factory` import — the substrate is a pure
`Map<id, item>` keyed by a primary field. Apps must hand-feed it via
`indexBatch(items)` (the README says so explicitly:
`packages/pod-search/README.md:111`).

So there is **no current SDK duplication or bypass to flag** in V0.
The risk is *forward-looking*: when the V1 work begins (FTS5 backend,
pod read-back, incremental updates per the L1i sketch), the package
will need to read pods, list containers, and react to deletes. If that
work is done without consulting the SDK surface map, it will reinvent
`PodClient.list({recursive})`, `PodClient.read()`, and the
`TombstoneStore` family. The V1 design needs to be locked in *now*,
before the FTS5 backend lands, so the package picks up the SDK
primitives by composition rather than reproducing them.

A secondary concern is platform-shim plumbing. The README and the L1i
sketch both promise an RN variant (`expo-sqlite` vs `better-sqlite3`),
but the package has no `*.rn.js` file and no `selectPlatform` call. A
future PR adding the FTS5 backend must use the SDK's existing
`@canopy/react-native/platform/service-factory` pattern; otherwise
this is the spot where pod-search would diverge from the rest of the
suite.

This doc therefore reads as a **forward contract**, not a salvage
plan: it specifies how V1 must compose with `@canopy/pod-client`,
`@canopy/core/FederatedReader`, and `@canopy/react-native`, plus
two small tweaks to V0 to remove a cargo-culted dead parameter.

## Findings

### Finding 1 — `podClient` / `rootContainer` declared but unused [low]

**File(s):** `packages/pod-search/src/PodSearch.js:32-37`

**SDK primitive that should serve this:** `@canopy/pod-client` `PodClient` (read / list / tombstones).

**Evidence (substrate, 6 lines):**
```js
   * @param {object} args
   * @param {object} args.schema
   * @param {object} [args.podClient]    optional — V1 will use this to read items from the pod
   * @param {string} [args.rootContainer] optional — V1
   */
  constructor({ schema /* , podClient, rootContainer */ }) {
```

**Evidence (SDK, 4 lines from SDK-surface-map.md:329-331):**
```
PodClient — high-level pod read/write/list/append/patch/delete on top of SolidPodSource and an Auth impl.
Constructor ({ podRoot, auth, options?, tombstoneStore?, podSourceFactory? }).
read(uri, { decode? }) → {content, contentType, lastModified, etag, size}
list(containerUri, { recursive?, filter?, includeTombstoned? })
```

**Impact:** The dead parameters in the constructor signature signal an
intent to integrate the SDK that has not yet been carried out. The
public-API doc-comment promises pod-read in V1 but doesn't pin which
contract — readers might reasonably assume the substrate will accept
*any* duck-typed pod client. Lock the contract to `@canopy/pod-client`
`PodClient` (or the structural subset it relies on) before V1 work
starts; otherwise V1 will end up either reaching into Solid/Inrupt
directly or growing a private `PodReader` interface.

Concretely: drop the commented-out fragments, or accept the params and
stash them for V1 (no behaviour change). Either way, document the
shape: "`podClient` MUST satisfy the `@canopy/pod-client` PodClient
contract (specifically `list(uri, {recursive, includeTombstoned})`,
`read(uri)` and the `'delete-local'` event)."

### Finding 2 — V1 pod walker risks reinventing `PodClient.list({recursive})` [medium, forward-looking]

**File(s):** none yet — this is a forward-looking concern. Watch
`packages/pod-search/src/PodSearch.js` when V1 lands.

**SDK primitive that should serve this:**
- `PodClient.list(containerUri, { recursive, filter, includeTombstoned })` — `packages/pod-client/src/PodClient.js:254`
- `FederatedReader` for the V1+ "cross-pod federated search" follow-up — `packages/core/src/storage/FederatedReader.js:73`

**Evidence (sketch, 3 lines from `Project Files/Substrates/L1i-pod-search.md:91-94`):**
```
## Dependencies
- L0 (`@canopy/pod-client`) — for reading items to index.
- `@canopy/react-native` (RN platform layer) — for `expo-sqlite` adapter.
```

**Evidence (SDK, `packages/pod-client/src/PodClient.js:241-275`):**
```js
   * List a container.  By default, URIs marked deleted-locally (via
   * `deleteLocal`) are filtered out.  Pass `opts.includeTombstoned: true`
   * to surface them...
   * @param {boolean} [opts.recursive=false]
   * @param {(uri: string) => boolean} [opts.filter]
   * @param {boolean} [opts.includeTombstoned=false]
  async list(containerUri, opts = {}) {
    ...
    const res = await this.#podSource.list(containerUri, sourceOpts);
    let entries = res.entries;
    if (opts.filter) entries = entries.filter((e) => opts.filter(e.uri));
    if (!opts.includeTombstoned) {
      ...
      let isTombstoned = false;
      try { isTombstoned = await this.#tombstoneStore.has(e.uri); }
```

**Impact:** A natural way to add "scan a pod and re-index everything"
is to write a recursive container walker inside `PodSearch`. The SDK
already exposes one as `PodClient.list({recursive: true})`, plus
optional URI filtering, and it transparently hides tombstoned URIs.
**If V1 writes its own walker, every tombstoned item will leak into
the index** — exactly the bug the prompt warned about. The lift is
trivial as long as it's done at design time:

```js
const { entries } = await podClient.list(rootContainer, { recursive: true });
for (const { uri } of entries) {
  const { content } = await podClient.read(uri);
  /* parse → indexable record → indexBatch */
}
```

**Caveat — known SDK gap:** `SolidPodSource.list()` ignores its `_opts`
(`packages/core/src/storage/SolidPodSource.js:387`), so
`PodClient.list({recursive: true})` currently flattens to a single-level
list. Recursion is documented in the pod-client surface but not
implemented at the source. **Fix this in pod-client, not in
pod-search.** The L1i refactor plan should file a parallel issue
against `@canopy/core/SolidPodSource` to honour `recursive` (BFS over
container entries, terminating on `type: 'resource'`). pod-search then
gets the recursive walker for free, and every other consumer benefits.

### Finding 3 — V1 tombstone-aware reindex must compose `PodClient.tombstoneStore`, not invent its own [medium, forward-looking]

**File(s):** none yet — forward-looking. The current `deleteById(id)` on
`PodSearch.js:75` is a hand-driven hook; V1 needs to bind it to the
authoritative tombstone source.

**SDK primitive that should serve this:**
- `TombstoneStore` (`packages/pod-client/src/TombstoneStore.js:16`)
- `MemoryTombstones` / `IndexedDBTombstones` / `AsyncStorageTombstones` / `FileTombstones`
- `PodClient.list(uri, {includeTombstoned: true})` — auto-hides tombstoned URIs
- `PodClient.deleteLocal(uri)` / `'delete-local'` event (per surface map line 28)

**Evidence (substrate, 4 lines from `packages/pod-search/src/PodSearch.js:75-77`):**
```js
  async deleteById(id) {
    this.#items.delete(id);
  }
```

**Evidence (SDK, lines from SDK-surface-map.md:343-351):**
```
The TombstoneStore exists so that PodClient.list() can hide URIs the user marked
deleted-locally, and so any app-level sync can skip them...
TombstoneStore — abstract.    Methods: add(uri, {at?}), has(uri), remove(uri), list(), close().
MemoryTombstones — Map-backed.
IndexedDBTombstones — browser.
AsyncStorageTombstones — RN.
FileTombstones — Node.js.
```

**Impact:** The L1i sketch and the prompt both note that pod-search
needs to *delete from the FTS5 index when an item is tombstoned*. There
are two clean ways to compose this; both must be locked in before V1
implementation:

1. **Pull-mode (preferred):** When V1's pod walker runs, call
   `podClient.list(root, {recursive: true})` *without*
   `includeTombstoned: true` — `PodClient` filters tombstoned URIs
   out. Items still in the FTS5 index whose `id` no longer appears in
   the listing are evicted at the end of the pass. This keeps the
   tombstone state with `PodClient` (single source of truth) and
   pod-search becomes a derived materialisation of "live URIs in pod".

2. **Push-mode (incremental, V1+):** Subscribe to the `'delete-local'`
   event on `PodClient` (per `packages/pod-client/src/PodClient.js:28`)
   and call the existing `deleteById(uri)` from the listener. This is
   what `deleteById` already exists for; it just isn't wired up.

**Anti-pattern to avoid:** Adding a `__tombstones__` table inside the
FTS5 schema or maintaining a private `Set<string>` of removed URIs
inside `PodSearch`. The prompt's "L1e reinvented an abstraction the
SDK already provides" precedent is exactly this shape — a substrate
keeping its own deletion ledger when the SDK already owns one.

### Finding 4 — RN platform-shim is promised but not present [low, forward-looking]

**File(s):**
- `packages/pod-search/` (no `*.rn.js`, no `service-factory` import)
- `packages/pod-search/package.json` (single `.` export, no `./PodSearch.rn.js` subpath)

**SDK primitive that should serve this:**
- `@canopy/react-native/platform/service-factory` `selectPlatform({ rn, default })` — `packages/react-native/src/platform/service-factory.js:42`
- `@canopy/react-native/metro-preset` — `*.rn.js` auto-resolution

**Evidence (substrate, sketch line 100-108):**
```
RN: `expo-sqlite`.
Substrate uses service-factory pattern (per
`@canopy/react-native/platform/service-factory`) to select per
platform.  FTS5 itself is universal.
```

**Evidence (substrate, package.json):**
```json
{
  "main": "src/index.js",
  "exports": { ".": "./src/index.js" }
}
```

**Evidence (SDK, surface map line 411-412):**
```
./metro-preset subpath → metro-preset.cjs — Metro configuration helper that wires *.rn.js resolution + alias map for the platform shims.
./platform/service-factory subpath → selectPlatform({ rn, default }) + isReactNative() + _resetPlatformCache().
```

**Impact:** No code today, so no concrete bug; but this is the spot
where pod-search will most easily drift from the rest of the suite.
When V1 introduces the FTS5 backend it MUST split into
`Backend.js` (Node, `better-sqlite3`) and `Backend.rn.js` (RN,
`expo-sqlite`) and resolve via `selectPlatform`. The browser flavour
(`sql.js` / `wa-sqlite`) is a third backend, not a parameter to either
of the above. The package's `exports` map will need a subpath like
`"./backend": "./src/backends/index.js"` (or auto-resolution via the
metro-preset). Apps that consume `@canopy/pod-search` from RN must
have already adopted `@canopy/react-native/metro-preset`; pod-search
should NOT add `expo-sqlite` as a hard dep — it is a peer dep on the
RN side only.

### Finding 5 — `JSON.parse(JSON.stringify(...))` deep-clone on every index/query [low, polish]

**File(s):** `packages/pod-search/src/PodSearch.js:71`, `:141`

**SDK primitive that should serve this:** none — this is a code-smell
flag, not an SDK-bypass.

**Evidence (substrate, 4 lines):**
```js
this.#items.set(id, JSON.parse(JSON.stringify(it)));
...
const page = candidates.slice(offset, offset + limit).map((it) => JSON.parse(JSON.stringify(it)));
```

**Impact:** Defensive deep-clone on the index path silently corrupts
`Date`, `Map`, `Set`, `BigInt`, `Uint8Array`, and `undefined` fields; it
also throws on cyclic objects. For V0 with the test schema (only
strings, numbers, arrays of strings) it's fine, but the moment H7 adds
a binary `content` field or a `Date` `timestamp` it will silently
corrupt them. Use `structuredClone()` (Node 17+, browser, RN's Hermes
all support it) or document that the index requires JSON-only values.
Not an SDK issue — flagged because it's the only place V0 might bite.

### Finding 6 — In-memory backend is intentionally a fake, not an SDK bypass [no action]

**File(s):** `packages/pod-search/src/PodSearch.js:25`

**Evidence:** `#items = new Map();` — the entire backend.

**Impact:** This is the V0 chosen-backend, not an InMemory test fake
shadowing a real SDK primitive. The README is explicit
(`packages/pod-search/README.md:10-15`): "V0 ships a pure-JS in-memory
backend with the public API the eventual FTS5-backed implementation
will provide." No SDK substitute exists for "FTS5 over pod content";
this isn't a duplication of `MemoryTombstones`-style fakes. **No
action.** Listed only so the reviewer can see it was considered.

## Refactor plan

The plan is split into "do now, V0 polish" and "lock in for V1".

### V0 polish (now, ~1 hour)

1. **Drop the commented-out parameters in the constructor signature.**
   `packages/pod-search/src/PodSearch.js:37`. Either delete them
   entirely or stash them on `this` for V1 — but stop carrying
   commented-out code in a public API.

2. **Replace `JSON.parse(JSON.stringify(...))` with `structuredClone()`**
   at lines 71 and 141, OR document the JSON-only constraint at the top
   of `PodSearch.js`. Recommend `structuredClone` since RN Hermes
   supports it as of mid-2024.

3. **Add a `CONTRACT.md`-style header comment (or section in the
   README)** pinning the V1 dependency on `@canopy/pod-client`
   `PodClient` and naming the methods consumed (`list({recursive,
   filter})`, `read({decode})`, `'delete-local'` event,
   `tombstoneStore`). This is the contract Findings 2-3 enforce.

### V1 design lock (before any FTS5 work starts)

4. **File issue against `@canopy/core/SolidPodSource.list`** to honour
   the `recursive` option (currently `_opts` is ignored —
   `packages/core/src/storage/SolidPodSource.js:387`). pod-search V1
   relies on `PodClient.list({recursive: true})` working end-to-end.
   Independent of pod-search; benefits every consumer.

5. **Specify the V1 pod-walk path** as a single `reindex(scope?)` call
   that delegates to `podClient.list(rootContainer, {recursive: true,
   filter})` and per-URI `podClient.read(uri, {decode: parser})`. No
   private container walker. Tombstoned URIs are filtered by
   `PodClient` automatically (Finding 3, pull mode).

6. **Specify the V1 incremental path** as an event subscription to
   `podClient.on('delete-local', ({uri}) => podSearch.deleteById(uri))`.
   The substrate does NOT track tombstones itself; it consumes
   pod-client's tombstone events.

7. **Specify the V1 backend split** as
   `src/backends/SqliteBackend.js` (Node, `better-sqlite3`) +
   `src/backends/SqliteBackend.rn.js` (RN, `expo-sqlite`) +
   optional `src/backends/WasmBackend.js` (browser, `wa-sqlite`),
   selected via
   `selectPlatform({ rn: () => …rn.js…, default: () => …default… })`
   from `@canopy/react-native/platform/service-factory`. Keep
   `expo-sqlite` and `better-sqlite3` as `peerDependenciesMeta`
   (optional peer deps), never `dependencies`. Set
   `package.json#exports['./backends/sqlite']` so apps can import the
   backend explicitly when service-factory auto-detection isn't viable.

8. **Specify the V1 federated-search path (V1+ stretch)** as
   `new FederatedReader({pods: [...]})` with a custom `MergeContract`
   that merges per-URI search records. Out of V0 scope; mention only so
   the V1 design doesn't preclude it.

### Non-goals (explicitly out of scope for this refactor)

- Rewriting V0's in-memory backend. It is intentionally a parallel
  implementation, not a `MemoryFoo` SDK fake — there is no
  `@canopy/core` "FTS-over-pod" primitive to compose with.
- Adding vector / embedding search (V2 per H7 plan).
- Cross-pod federated search (V1+).
- Real-time index updates (V1+).

## Public API — before / after

### Before (V0, current)

```ts
new PodSearch({ schema /* , podClient, rootContainer */ })

await search.indexBatch(items[])
await search.deleteById(id)
await search.reindex(scope?)            // V0: clears the index
await search.query({ text?, filters?, rank?, limit?, offset? })
search.size
```

### After (V0 polish, ~zero behaviour change)

```ts
new PodSearch({ schema, podClient?, rootContainer? })   // params accepted, stashed for V1
                                                        // typed as @canopy/pod-client PodClient

await search.indexBatch(items[])
await search.deleteById(id)
await search.reindex(scope?)
await search.query({ text?, filters?, rank?, limit?, offset? })
search.size
```

### After (V1 target)

```ts
new PodSearch({
  schema,
  podClient,                             // required in V1; @canopy/pod-client PodClient
  rootContainer,                         // required in V1
  backend?: 'auto' | 'sqlite' | 'memory',// auto = service-factory
  parser?,                               // (uri, content, contentType) → indexable record | null
})

// V1 reindex actively walks the pod via pod-client:
await search.reindex(scope?)             // → uses podClient.list({recursive}) + read()

// V1 also subscribes internally:
//   podClient.on('delete-local', ({uri}) => this.deleteById(uri))
// and tears the listener down on close().

await search.indexBatch(items[])         // still supported for app-driven ingest
await search.deleteById(id)
await search.query({ ... })              // unchanged
await search.close()                     // V1 — tear down listeners + backend
```

## Migration path for downstream consumers

V0 consumers today: H7 archive (planned, not yet built). The V0 polish
items are non-breaking:

- Constructor signature change: V1 makes `podClient` and
  `rootContainer` *required*; V0 polish keeps them optional. Apps
  written against V0 polish only need to add a `podClient:` arg before
  upgrading to V1. **Breaking only at V0 → V1.**
- `JSON.parse(JSON.stringify)` → `structuredClone`: pure internal swap;
  detectable only if the app was relying on JSON-only stripping of
  `undefined` fields, which is undocumented and unsafe to depend on.
- The existing `indexBatch` push API stays. Apps that prefer to drive
  ingest themselves (the V0 pattern) can keep doing so under V1; the
  pod-walking `reindex(scope?)` is opt-in by passing `podClient`.

## Test changes

### V0 polish (now)

- No new tests required for finding 1 (parameter cleanup is
  signature-only).
- `structuredClone` swap is observable only on Date / Map / Set
  fields; if those aren't in the test schema (they aren't —
  `packages/pod-search/test/PodSearch.test.js:4-14`), no test change.
  Optionally add one round-trip test that puts a `Date` instance
  through `indexBatch → query` to lock the new behaviour.

### V1 (when FTS5 backend lands)

- New test file `test/PodSearch.podwalk.test.js` using a
  `MemoryPodSource` + a real `PodClient` (`MemoryTombstones`) — verify
  `reindex()` walks the container, indexes every leaf, and skips
  tombstoned URIs without the substrate touching `tombstoneStore`
  directly.
- New test for `'delete-local'` propagation: `podClient.deleteLocal(uri)`
  → `podSearch.query({})` no longer returns that record.
- New backend-parity test: same fixture, run against `memory` and
  `sqlite` (Node, `better-sqlite3`) backends — assert identical
  `total`, `items[].id` ordering, and `facets`.
- RN backend: snapshot test invoked via Jest under
  `@canopy/react-native/metro-preset` resolution to confirm the
  `*.rn.js` shim resolves and `expo-sqlite` lazy-loads. (Likely lives
  in `apps/integration-tests/` with the existing RN harness, not in
  `packages/pod-search/test/`.)

## Estimated effort

| Phase | Scope | Effort |
|---|---|---|
| V0 polish | Findings 1, 5 + README/contract note | **~1 hour** |
| `SolidPodSource.list({recursive})` | Issue + impl in `@canopy/core` | **~3-4 hours** (one BFS + tests) |
| V1 pod-walker integration | `reindex()` on top of `PodClient.list+read` | **~4-6 hours** including tests |
| V1 tombstone event wiring | `'delete-local'` listener + close() teardown | **~1-2 hours** |
| V1 SQLite backend (Node) | `better-sqlite3` + FTS5 schema gen from `schema.fields` | **~1-2 days** (existing CLI lib code is the pattern) |
| V1 RN backend split | `*.rn.js` shim + service-factory wiring + Metro check | **~0.5-1 day** |
| V1 backend-parity tests | One fixture run twice | **~3-4 hours** |
| **Total V1** | | **~3-4 days** of focused work |

## Cross-substrate dependencies surfaced

This audit surfaced two cross-substrate work items that aren't
strictly inside `@canopy/pod-search`:

1. **`@canopy/core` — `SolidPodSource.list()` ignores
   `recursive`** (`packages/core/src/storage/SolidPodSource.js:387`).
   `PodClient.list({recursive: true})` documents recursion but the
   underlying source doesn't honour it. Fix in core; benefits every
   consumer (pod-search, sync-engine, archive ingest, …). **Blocks
   pod-search V1.**

2. **`@canopy/react-native` — service-factory adoption.** The
   pod-search RN backend must pick `*.rn.js` via the SDK's existing
   `selectPlatform`/`metro-preset` rather than its own platform check.
   No fix needed in `@canopy/react-native`; this is a pod-search V1
   adoption requirement, surfaced here so it doesn't get reinvented.

3. **Forward note for L1a (`@canopy/sync-engine`)** and
   `@canopy/item-store` — both are likely candidates to *drive*
   pod-search's index. If sync-engine grows a "post-merge applied"
   event, pod-search can subscribe to that instead of running its own
   walker. Worth surfacing in their respective audits, not actioned
   here.

---

**TL;DR:** L1i V0 is clean — small, intentional, no SDK bypass. The
real risk is V1: the FTS5 backend, pod-walker, and tombstone wiring
need to compose `PodClient.list({recursive})`,
`PodClient.read()`, the `'delete-local'` event, and the
`@canopy/react-native/platform/service-factory` shim — not
reinvent any of them. One blocker for V1 lives in core
(`SolidPodSource.list` recursion).
