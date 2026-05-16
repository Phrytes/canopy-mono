# P3 — sync-engine → pseudo-pod V1 absorption (implementation plan)

> **Status:** Phase A ✅ + B ✅ + C ✅ + D ✅ DONE (2026-05-16). P3
> substantively SHIPPED. **D notes:** (1) tombstone-aware diff is
> additive (`opts.isTombstoned` in `diff.js`; SyncEngine pre-lists
> tombstones into a sync predicate, best-effort/non-fatal) — sync-engine
> 100/100, folio 469/469 both legs. (2) **Desktop cache-mode default
> flipped ON** (reversible: opt out via `FOLIO_PSEUDO_POD=0` /
> `config.json {cacheMode:false}`); the direct-path fallback branch is
> deliberately **retained** — **DECIDED 2026-05-16 (risk-averse): keep
> it; do not remove until post-burn-in (OQ-5).** (3) **folio-mobile
> default kept opt-in** — **DECIDED 2026-05-16 (risk-averse): flip only
> as part of the Folio-mobile real-device pass (OQ-6)**, never blind (no
> vitest signal for RN bring-up). `test:parity` updated to
> `FOLIO_PSEUDO_POD=0 vitest run && vitest run`. OQ-1 RATIFIED. Phase C
> note: shared node:fs-free `apps/folio/src/podCache.js` (used by both
> desktop `_podFactory.js` and folio-mobile `ServiceContext`); RN wiring
> is flag-gated dynamic-import, off by default; folio-mobile 79/79 +
> sync-engine-rn 43/43 + podCache 6/6 green; full repo 42/43 (only the
> documented unrelated `core/mesh-scenario` flake, passes isolated).
> **Honest limit:** folio-mobile's `buildAndAttachEngine` isn't
> vitest-exercised (engine bring-up is device/react-test-renderer-only,
> as it always was) — true RN end-to-end parity is an on-device
> acceptance gate; the shared logic + RN backend are unit-covered.
> Drafted
> 2026-05-15. Relocated from `coding-plans/` (stale dir) to `Substrates/`
> (authoritative). Source: codebase + design-doc audit (see §0).

---

## Open-questions tracker (resolve before / during the phase noted)

| # | Question | Status (2026-05-15) | Gates |
|---|---|---|---|
| **OQ-1** | Ratify the corrected scope: P3 = build `syncEngineAdapter.js` + cut Folio (web+mobile) over to a pseudo-pod-backed pod client; **keep** `@canopy/sync-engine` as plumbing inside pseudo-pod; do **not** rebuild pseudo-pod V1 (shipped) or re-run the already-done V0-tier deletion in `L1a-sync-engine-refactor.md`. | **RATIFIED 2026-05-16** — "follow the code and write the adapter". Also confirmed `coding-plans/` is stale; authoritative docs live in `Project Files/` directly or project-focused dirs (`Substrates/`, `Folio/`, …), cross-checked against the two newest standardisation plans. | Phase A start |
| **OQ-2** | Folio's desktop daemon needs the pseudo-pod write-through queue to survive process restart, but only an in-memory backend exists (RN has persistent backends; Node does not). Build a small persistent Node `StorageBackend`, or accept memory-only for V1? | **RESOLVED 2026-05-16 — BUILD a general opt-in `@canopy/pseudo-pod` Node backend in Phase B.** Not Folio-branded: any future Node consumer may use it; Folio desktop is merely the first. Verification (below) confirms no current app needs it (stoop + tasks-v0 use `standalone` mode, not cache). | Phase B |
| **OQ-3** | `PodClient` already routes `pseudo-pod://` URIs to an injected pseudoPod (P1 cross-pod-ref seam). P3's cache mode wires a pseudoPod *to* a PodClient (inverse). Confirm these stay two distinct seams and Folio uses only the P3 cache-mode one. | **CONFIRMED 2026-05-16 (Phase A).** The adapter wraps a cache-mode pseudoPod whose `podUploader/podFetcher` wrap a PodClient (P3 seam). It never emits `pseudo-pod://` URIs — Folio is pod-primary, URIs are `https://`. The P1 `pseudo-pod://`-dispatch seam in PodClient is untouched and unused by Folio. Two distinct seams, no overlap. | Phase A |
| **OQ-4** | Ratify parallel-run-then-flip (config flag + dual parity run) over the Q-A/Q-B clean-break precedent, for Folio specifically. | **RATIFIED + executed** (Phases B–D). | Phase B |
| **OQ-5** | Remove the direct-path fallback branch (irreversible: loses the flag-flip rollback)? | **DECIDED 2026-05-16 — NO (risk-averse).** Keep the branch + the parity harness. Revisit *only* after cache-mode-default has burned in under real-world Folio desktop use and is trusted; there is no urgency and the dead-ish code is harmless. Do **not** delete without a fresh explicit decision. | post-burn-in |
| **OQ-6** | Flip folio-mobile's pseudo-pod default ON? | **DECIDED 2026-05-16 — NOT YET (risk-averse).** Stays opt-in. Flipping is unverifiable here (no vitest signal for RN engine bring-up) so it is bound to the **Folio-mobile real-device acceptance pass** (TODO-GENERAL hardware-pending) — flip + on-device offline→reconnect→drain verification happen together, never blind. **Enablement wired 2026-05-16:** `ServiceContext` now also reads `EXPO_PUBLIC_FOLIO_PSEUDO_POD` (Metro inlines `EXPO_PUBLIC_*`; plain `process.env` doesn't survive into RN — the original wiring couldn't be turned on in a device build). The pass is now actually runnable; steps in `Project Files/real-device-pass-master-checklist-2026-05-16.md` §3b. | Folio-mobile device pass |

### OQ-1 clarification (2026-05-15)

User asked: *"so you mean, folio was never built for a pseudo pod and to make
it work we need to update the sync engine so it is compatible with the pseudo
pod?"*

Clarification: Folio predates pseudo-pod; its path today is
`Folio → sync-engine → PodClient → Solid pod` (direct pod writes). We do
**not** modify sync-engine to be pseudo-pod-aware. We add a thin **adapter**
that makes a pseudo-pod instance present the exact `PodClient` surface
sync-engine already consumes, and inject it in place of the raw PodClient.
sync-engine stays ignorant of pseudo-pod; its reads/writes simply flow
through pseudo-pod's queue+cache instead of hitting the pod directly. This is
why sync-engine's behavioural test suite can stay green and the change is
low-risk. The only edit to sync-engine itself is an optional `tombstoneStore`
parameter in Phase D.

### OQ-2 spike findings (2026-05-16, Phase A)

**Recommendation: BUILD a minimal persistent Node `StorageBackend` in
Phase B.** Final call is the user's at Phase B kickoff.

- **Why it's needed:** cache mode's whole value for Folio desktop is the
  write-through queue surviving an offline→restart→reconnect cycle
  (functional design §4.1.6). The queue is itself stored *via the backend*
  (`createWriteThroughQueue({backend})` uses `backend.put/list/delete` under
  `QUEUE_PREFIX`), so a memory backend silently drops every queued offline
  write on daemon restart — that contradicts Folio's durability requirement.
  Memory-only is not acceptable for V1.
- **Effort: ~1 day, low-moderate risk.** The `StorageBackend` interface is
  narrow (`get/put/delete/list` + in-process `subscribe/listDirty/
  subscribeDirty`). Mirror `MemoryBackend` (~163 LOC) with: hash-named
  record files (`{key, etag, _v, bytesB64}`) so long/`:`/`/`-bearing URI
  keys are filename-safe and length-safe; atomic write (`tmp`+`rename`) so
  a crash mid-write can't corrupt a record; base64 bytes (lossless for the
  Buffer/string SyncEngine writes); `_v` semantics identical to MemoryBackend
  (new key `_v=1`, increment unless pinned).
- **Acceptable V1 simplifications (document, don't over-build):**
  `subscribe`/`subscribeDirty`/dirty-set stay in-process (the Folio daemon is
  a single process; subscribers re-attach on boot; the durable signal is the
  queue keys themselves). `list(prefix)` is an O(n) directory scan — fine at
  Folio note scale; flag an index as future work. Assume a single writer
  (one Folio daemon per store dir) — document the assumption.
- **Reusable** beyond Folio: any Node pseudo-pod consumer gets persistence
  for free, so it belongs in `@canopy/pseudo-pod` (e.g.
  `src/NodeFsBackend.js`), not in `apps/folio`. **Do not brand it
  Folio-only** in code, comments, or docs — Folio desktop is the first
  consumer, not the only possible one.

### Node-usage verification + portability convention (2026-05-16)

Audit of Node coupling across the monorepo (driving the OQ-2 shape):

| Surface | Node coupling | Verdict |
|---|---|---|
| `@canopy/core` | `node:crypto` (`createHash`) in 2 manifest/hashing files only | near-portable; agent/transport path is Node-free |
| `@canopy/pod-client` | `os`+`path` in `tombstones/FileTombstones.js` only | isolated, opt-in file-backed store |
| `@canopy/sync-engine` | isolated in `adapters/fsNode.js` (paired `fsRN.js`) | deliberate adapter split |
| `@canopy/pseudo-pod`, `item-store`, most substrates | none | pure JS (browser-capable) |
| `apps/folio` | desktop daemon (`folio serve`, chokidar watch, systray) | **the justified Node bridge** (local machine ↔ Solid pod) |
| `apps/archive` | CLI + `Db.js` (`mkdirSync`, `node:path`) | CLI tool — Node-appropriate; no user-facing web/mobile surface |
| `apps/stoop` | exactly one server-side helper `src/lib/FilePersist.js` (`node:path.dirname`) | user-facing web/mobile is Node-free; principle holds |
| `apps/tasks-v0`, `apps/household` | no `node:` imports in `src` | clean |
| `apps/relay` | Node by nature | hosted/self-hosted infra (out of scope by user) |
| `folio-mobile`, `stoop-mobile`, `tasks-mobile`, `mesh-demo` | none | React Native (Hermes) — zero Node, zero server |
| pseudo-pod **cache mode** (the write-through-queue consumer) | used by **no app today** — `stoop` + `tasks-v0` use `standalone` | Folio (Phase B) is the first cache-mode consumer |

**Distribution principle (ratified by user 2026-05-16):** Node is
justified where an app's *job* is bridging the local machine (Folio
desktop, the relay, CLI tools). It must stay out of the user-facing
Stoop-class web/mobile surfaces, which ship as pure JS / RN with no
server. The codebase already honors this; protect it.

**Forward convention (not retrospective):** when a function depends on a
Node API, mark it as such and prefer to house it in a file whose name
contains `node` (mirroring the existing `fsNode.js`/`fsRN.js`,
`hashNode`/`hashRN` split). This is a *going-forward* rule for new code —
do **not** rename existing files (e.g. `FilePersist.js`,
`FileTombstones.js`) just to comply. The goal: a future developer
building a portable web app can tell at a glance which pieces are
Node-bound and need a browser/RN substitute. `NodeFsBackend.js` (OQ-2)
follows this from day one.

---

## 0. Scope correction (read first)

The TODO frames P3 as "build pseudo-pod V1, absorb sync-engine (~4 wk)".
Code-vs-docs audit shows:

- **pseudo-pod V1 is already shipped** (Phases 52.8.1–52.8.4): `createPseudoPod`
  has cache mode, per-URI mode override, write-through queue
  (`writeThroughQueue.js`), graceful-degradation drain
  (`drainWriteThroughQueue`), Lamport `_v` (52.14), and the
  `peer-update`/`stale-peer`/`concurrent-write` event surface.
- **Folio does not depend on `@canopy/pseudo-pod` at all** — no dep in
  `apps/folio/package.json` or `apps/folio-mobile/package.json`; zero
  `pseudoPod` references in either `src/`.
- `packages/pseudo-pod/src/syncEngineAdapter.js` is referenced by the coding
  plan (52.8.5) but **does not exist**.
- `Project Files/Substrates/refactor/L1a-sync-engine-refactor.md` describes a
  V0-tier deletion (`BidirectionalSyncEngine` rename, `IngestQueueSource`,
  `InMemoryBackend`) that is **already complete** — `packages/sync-engine/src/`
  has only the single renamed `SyncEngine.js`. That doc is stale; do not
  re-execute it. It remains useful as the canonical engine↔PodClient
  composition description P3 must preserve, and for its tombstone-aware-diff
  gap (closed in Phase D).

**Therefore P3 = coding-plan 52.8.5–52.8.7**: build the
sync-engine↔pseudo-pod adapter and cut Folio (web CLI + mobile) over as the
reference consumer. `@canopy/sync-engine` is **kept** and reclassified from
"parallel substrate" to "pseudo-pod-internal orchestration plumbing"
(functional design §5.3.2: "sync-engine becomes the plumbing *inside*
pseudo-pod V1 rather than a parallel layer"). Revised sizing ≈ 3.5 wk +
buffer (4+5+4+4 days), consistent with the ~4 wk estimate.

Authoritative design material audited:
`Project Files/Substrates/L1a-sync-engine.md`,
`Project Files/Substrates/refactor/L1a-sync-engine-refactor.md`,
`Project Files/Substrates/substrates-v2-functional-design-2026-05-11.md`,
`Project Files/standardisation-plan-restructured-2026-05-10.md`,
`Project Files/standardisation-transition-2026-05-11.md`,
`Project Files/Folio/v1-web-functional-design-2026-05-11.md`,
`Project Files/Folio/v1-mobile-functional-design-2026-05-11.md`,
`Project Files/TODO-GENERAL.md`.

---

## 1. Capability gap analysis

`@canopy/sync-engine` `SyncEngine` (`packages/sync-engine/src/SyncEngine.js`,
1335 LOC) vs `@canopy/pseudo-pod` `createPseudoPod`
(`packages/pseudo-pod/src/PseudoPod.js`):

| Capability | Where now | pseudo-pod today | Disposition |
|---|---|---|---|
| Local FS watch (chokidar/RN poll, debounce, sha-stability vigil v2.6, copy-rename grace v2.10) | `SyncEngine` + `adapters/watcher{Node,RN}.js` | none | **Keep in sync-engine** (plumbing) |
| Pod scanning (`scanPod` BFS list+read+sha) | `scanPod.js` | none | **Keep in sync-engine** |
| Local scanning (`scanLocal`) | `scanLocal.js` | none | **Keep in sync-engine** |
| 3-way diff (local/pod/knownState → upload/download/conflict/delete) | `diff.js` | per-key Lamport `_v` (different model) | **Keep in sync-engine** — complementary to `_v` |
| Path mapping (local↔pod URI, share folders, skip rules) | `PathMap.js` + Folio `parseSharePath` | none | **Keep in sync-engine** (Folio domain) |
| Write-through queue + offline drain | not in sync-engine | **already covered** (`writeThroughQueue.js`) | **Absorb (done)** — sync-engine `podClient.write` → `pseudoPod.write` |
| Read-miss-through + cache | not in sync-engine | **already covered** (cache-mode `read()`) | **Absorb (done)** |
| Conflict policy (engine-side `'conflict'` + `applyConflict.js`) | `SyncEngine` + `apps/folio/src/applyConflict.js` | Lamport `_v` + `concurrent-write` | **Keep sync-engine's; pseudo-pod's underneath** |
| Version time-machine (`.folio/versions/`, retention, restore) | `versions.js` + `SyncEngine` | none | **Keep in sync-engine** |
| Tombstones (`deleteLocal`/`deleteCompletely`) | `SyncEngine` → PodClient | `delete()` only | **Keep delegating to PodClient**; close diff gap in Phase D |
| State persistence (`.canopy/notes-sync-state.json`) | `SyncEngine.#load/#saveState` | none | **Keep in sync-engine** |
| `setPodClient` hot-swap, `forcePush`, `verifyPodState`, ensureShares, 412 catch | `SyncEngine` | none | **Keep in sync-engine** |

**Net:** nothing meaningful is dropped. The only thing *absorbed* (already
built) is the write/read transport: sync-engine stops calling
`podClient.write/read` directly and calls `pseudoPod.write/read` (cache mode,
`https://` URIs), gaining offline queue + drain + cache.

---

## 2. Target architecture

**Before:** `Folio CLI/RN → apps/folio/src/SyncEngine.js (subclass) →
@canopy/sync-engine → @canopy/pod-client PodClient → Solid pod` (pseudo-pod
unused by Folio).

**After (P3 V1):** same chain, but the SyncEngine is handed a
**pseudo-pod-backed pod client**:
`… → @canopy/sync-engine (scan/diff/versions/watcher unchanged; write/read →
injected pseudoPod adapter) → @canopy/pseudo-pod createPseudoPod(mode:'cache';
queue+drain+cache+_v) → @canopy/pod-client PodClient (podUploader/podFetcher)
→ Solid pod`.

Seam = **new `packages/pseudo-pod/src/syncEngineAdapter.js`** (the 52.8.5
named-but-missing file): adapts a `PseudoPod` into the
`{ read, write, list, exists, head, createContainer, deleteLocal,
deleteCompletely, on/off }` surface `SyncEngine` already consumes.

Artifact disposition:

- `@canopy/sync-engine` — kept; behaviour unchanged; receives a
  pseudo-pod-backed client. Test helpers stay exported.
- `@canopy/sync-engine-rn` — kept; `createSyncEngine`/`createMobileBootstrap`
  additionally construct the RN pseudo-pod backend + cache pseudo-pod, then
  inject the adapter.
- `apps/folio/src/SyncEngine.js` — stays a thin subclass, surface unchanged;
  gains a constructor path that builds + injects the adapter.
- `apps/folio/src/PathMap.js` — unchanged (re-export shim).
- `@canopy/pseudo-pod` — +`src/syncEngineAdapter.js` + index export. Core
  `PseudoPod.js` unchanged.
- `@canopy/pod-client` — unchanged. Its `pseudo-pod://` scheme dispatch (P1
  cross-pod-ref seam) stays distinct from P3's cache-mode seam (OQ-3).

---

## 3. Phased breakdown (~4 wk; repo green between every phase)

Invariant: `apps/folio/test/SyncEngine.test.js` (1394 LOC — the engine's
real behavioural contract; there is **no** `SyncEngine.test.js` in
`packages/sync-engine/test/`), `apps/folio/test/cli.test.js`, and the 4
`packages/pseudo-pod/test/*` suites stay green or are deliberately extended.

### Phase A — pseudo-pod sync adapter (substrate-only) — ~4 d
- **Goal:** build `packages/pseudo-pod/src/syncEngineAdapter.js`:
  `createSyncEnginePodClient({ pseudoPod, podRoot })` exposing the exact
  surface SyncEngine consumes; map onto `pseudoPod.read/write/list` (cache
  mode), thread `{queued}` results. Reproduce `scanPod`'s expected shapes
  (`list → {container, entries:[{uri,type}]}`,
  `read → {content,contentType,lastModified,etag,size}`);
  `createContainer` no-op-succeeds (pseudo-pod is flat).
- **Files:** `packages/pseudo-pod/src/syncEngineAdapter.js` (new),
  `packages/pseudo-pod/index.js`, `packages/pseudo-pod/package.json` (subpath
  export if needed).
- **Verify:** new `packages/pseudo-pod/test/syncEngineAdapter.test.js`;
  existing 4 pseudo-pod suites green.
- **Checkpoint:** substrate-only, no app wired → repo green.
  **Independently shippable.** Also: spike OQ-2 (Node FS backend) here.
- **✅ DONE 2026-05-16.** `syncEngineAdapter.js` + `syncEngineAdapter.test.js`
  shipped; exported from `index.js`. Surface: `read/write/list/
  createContainer/deleteLocal/deleteCompletely/delete` (no `exists`/`head`
  — SyncEngine's `read()` fallback covers `verifyPodState`). Structural
  ops delegate to an optional injected real `podClient`; read/write ride
  the cache-mode pseudoPod. pseudo-pod suite green (Phase A: 88/88).
  OQ-2 spiked → recommend BUILD (done in Phase B).

### Phase B — Folio web CLI cutover (reference consumer) — ~5 d
- **Goal:** Folio builds a cache-mode `PseudoPod` (Memory backend for tests;
  persistent Node backend or memory-only per OQ-2 for the daemon) wrapping
  the real `PodClient` as `podUploader/podFetcher`, wraps it in the Phase-A
  adapter, passes that to `SyncEngine` instead of the bare PodClient. Behind
  an off-by-default config flag.
- **Files:** `apps/folio/package.json` (+`@canopy/pseudo-pod`),
  `apps/folio/src/SyncEngine.js`, `apps/folio/src/cli/{syncCmd,watchCmd,
  serveCmd,rmCmd}.js`, `apps/folio/src/cli/_podFactory.js`,
  `apps/folio/src/cli/_config.js` (flag).
- **Verify:** `apps/folio/test/SyncEngine.test.js` + `cli.test.js` run via a
  parametrised harness over `{direct}`/`{pseudo-pod}` — both green
  (coding-plan 52.8.6/52.8.7). Reuse `FOLIO_TEST_MOCK_POD=1` +
  `FsBackedMockPodClient` (`apps/folio/src/cli/_podFactory.js:90`).
- **Checkpoint:** flag off by default → repo green; parity proves on-path.
  **Independently shippable** (parallel-run state).
- **✅ DONE 2026-05-16.** Shipped:
  - **`@canopy/pseudo-pod/src/NodeFsBackend.js`** (OQ-2) — opt-in
    persistent Node backend, exported via the dedicated `./node`
    subpath (NOT the main barrel — keeps `node:fs` out of portable
    bundles). Atomic writes, recursive binary (de)serialiser,
    MemoryBackend-parity semantics. 9 tests incl. the OQ-2 acceptance
    (offline write survives a simulated daemon restart + drains).
    pseudo-pod suite: **98/98**.
  - **Folio wiring** — single chokepoint: `apps/folio/src/cli/
    _podFactory.js` `buildPodClient()` now returns
    `maybeWrapWithPseudoPod(real, cfg)`. Enabled by `FOLIO_PSEUDO_POD=1`
    (harness/opt-in) or `config.json {cacheMode:true}`; **off by
    default**. Backend: MemoryBackend for the test mock, NodeFsBackend
    (`<configDir>/pseudo-pod`) for the real daemon. `podUploader` uses
    `force:true` (cache-mode local store is canonical — sidesteps the
    Phase-A risk #2 If-Match 412). No CLI-command files changed;
    `SyncEngine.js` subclass untouched.
  - **Adapter refinement (found by the parity harness):** `list()` now
    delegates to the real `podClient.list` for **pod truth** when a
    podClient is present (the local `pseudoPod.list` can't see pod-only
    files, so `scanPod` computed 0 downloads). Reads still
    cache-fall-through. +1 delegation test.
  - **Parity:** `apps/folio` `test:parity` script
    (`vitest run && FOLIO_PSEUDO_POD=1 vitest run`). Direct **463/463**
    ≡ pseudo-pod **463/463** independently. Two `auth.test.js`
    `instanceof FsBackedMockPodClient` assertions made wrapper-aware
    (`c._podClient ?? c`) — the invariant ("mock pod used") still holds
    one level down; not a behaviour change.
  - **Known pre-existing flake (NOT P3):** running the suite twice
    back-to-back via `test:parity` can tip one timing-sensitive Folio
    test (same class as core `mesh-scenario`; each path is 463/463 when
    run once). Pre-existing suite flakiness under doubled load.

### Phase C — Folio-mobile (RN) cutover — ~4 d
- **Goal:** RN bootstrap builds cache-mode pseudo-pod via
  `@canopy/react-native`'s shipped `pseudo-pod-adapter` (AsBackend/FsBackend,
  Phase 51.1) + the Phase-A adapter, hands it to existing `createSyncEngine`.
- **Files:** `packages/sync-engine-rn/src/createSyncEngine.js`,
  `createMobileBootstrap.js`; `apps/folio-mobile/src/lib/serviceBuilder.js`,
  `apps/folio-mobile/src/ServiceContext.js`. Deps as needed. The
  platform-shell exception (folio-mobile importing `SyncEngine` from
  `@canopy-app/folio`, `conventions/architectural-layering.md:191`) is
  unchanged.
- **Verify:** `apps/folio-mobile/test/ServiceContext.test.js` +
  `packages/sync-engine-rn/test/**`; parametrised parity as Phase B; explicit
  enqueue-offline → restart → drain test (mirror
  `packages/integration-tests/.../graceful-degradation/cache-mode-edge-cases.scenario.test.js`).
- **Checkpoint:** flag-gated → repo green. **Independently shippable.**

### Phase D — tombstone-aware diff + flip + cleanup — ~4 d (riskiest; last)
- **Goal:** (1) close refactor-doc Finding 9: extend
  `packages/sync-engine/src/diff.js` with optional `tombstoneStore` so a
  local-only file with prior knownState + a tombstone drops instead of
  re-uploading (additive signature). (2) Flip the default flag on; remove the
  direct-path branch after one green full-suite sweep. (3) Reclassify docs
  (`L1a-sync-engine.md`, functional design §5.3, Folio v1 P3 rows) →
  shipped.
- **Files:** `packages/sync-engine/src/diff.js`, `SyncEngine.js` (thread
  tombstoneStore), `packages/sync-engine/test/diff.test.js` (extend; keep
  existing cases), `apps/folio/test/diff.test.js`, config flag default, docs.
- **Verify:** full `vitest run` across all 43 packages green.
- **Checkpoint:** only phase that changes the default; gated on a full green
  sweep; the flip is the single irreversible step and is last.

Independently shippable: A, B, C (off-by-default flag). D is the irreversible
flip and must be last.

---

## 4. Migration & back-compat

**Recommended: parallel-run-then-flip, not clean break (OQ-4).** Clean-break
(Q-A/Q-B) worked because those substrates had no production users and the new
path was strictly stronger at flip. sync-engine carries 1335 LOC of
field-hardened edge-case logic asserted by a 1394-LOC suite; a flag-gated
parametrised parity run (every SyncEngine/CLI test against *both* paths) is
the only way to prove byte-identical behaviour before flipping. The
transition doc itself prescribes this for Folio
(standardisation-plan-restructured ~line 1314: "Dual-run during transition;
parity tests + latency benchmarks before flipping"). Folio's regression risk
is rated lowest of the three apps (transition §IV.4) precisely because its
tests catch regressions.

**Lamport `_v` compatibility:** Folio is single-user/multi-device/pod-primary;
writes go through cache mode, **not** the replication ring, so `writeFromPeer`
3-way `_v` compare is off Folio's hot path. `_v` is tracked per key
(MemoryBackend `versionByKey`), harmless/forward-additive. Cache-mode writes
that take a pod-assigned etag **pin `_v`** (`PseudoPod.js:363
backend.put(key, bytes, result.etag, newV)`) — the adapter must preserve this
when SyncEngine re-writes the same file. No on-disk migration of
`.canopy/notes-sync-state.json` is needed — knownState (sha256/relPath) is
orthogonal to `_v`.

---

## 5. How this unblocks 52.10 / 52.14 / 52.2.x

All three reduce to one root unblock: **Folio gaining a `pseudoPod`
instance**, delivered by Phases B (web) + C (mobile). No extra substrate
phase needed.

| Deferred item | Seam it needs | Delivered by |
|---|---|---|
| **52.10 agent-registry on Folio** | a pseudo-pod read/write path so the registry resource is cached/queued like any URI | B + C |
| **52.14 Q-D Lamport stale-peer on Folio** | a live `pseudoPod` to `.on('stale-peer'/'concurrent-write')`; substrate surface already complete | B/C handle; Folio conflict UI subscribes |
| **52.2.x peer-fetch gates** | Folio owns a `pseudoPod` to call `.fetchResourceSkill({groupCheck,capCheck})` (`PseudoPod.js:634`) and register it on its agent | B/C; gate args plumb through Folio's `PodCapabilityToken` |

---

## 6. Risks & tradeoffs (top 5)

1. **`scanPod` cost regression (HIGHEST, Phase D).** `scanPod`
   (`packages/sync-engine/src/scanPod.js:60`) re-reads+re-sha256s every pod
   file every runOnce; routed through cache mode, a cold cache means a
   `podFetcher` round-trip per scan — potentially worse than the direct path
   the design promises latency parity against. **Mitigation:** Phase A
   adapter serves `scanPod`'s `list`+`read` from local pseudo-pod cache,
   falls through only on miss; add a latency benchmark to the Phase B parity
   harness. Schedule most slack here.
2. **Two conflict layers (refactor-doc Finding 7).** Engine-side diff
   conflict vs pseudo-pod write-time behaviour are different models; for
   Folio's single-user case they shouldn't collide, but `forcePush`
   (`force:true`) and the 412 path interact with the queue. **Mitigation:**
   adapter maps `force:true` to a queue-bypassing direct write; explicit
   parity test for forcePush + offline + reconnect.
3. **RN backend durability across process death (Phase C).** If the RN
   backend isn't wired to persist the `__write-through__/` queue, offline
   writes vanish on app kill. **Mitigation:** explicit enqueue→restart→drain
   test.
4. **Test-surface ownership ambiguity.** The engine's contract lives in
   `apps/folio/test/SyncEngine.test.js`, not the package. **Mitigation:**
   parametrised dual-path execution of the *Folio* suites; never thin/delete
   SyncEngine.test.js during P3.
5. **Doc/code drift → wrong scope.** The refactor doc describes done work;
   the coding plan names a missing file. **Mitigation:** OQ-1 ratification
   before Phase A.

---

## 7. Test strategy (keep 43/43, ~7,300 green throughout)

- Per-phase gate: relevant package suite green; A/B/C land behind
  off-by-default flag so the default sweep is unconditionally green.
- **Parametrised parity harness (core technique):** wrap
  `apps/folio/test/SyncEngine.test.js` + `cli.test.js` in a matrix over
  `{path:'direct'}` and `{path:'pseudo-pod'}`; both pass identically (this
  *is* coding-plan 52.8.6). Reuse `FOLIO_TEST_MOCK_POD=1` +
  `FsBackedMockPodClient`.
- pseudo-pod's 4 suites untouched; add `syncEngineAdapter.test.js`. Extend
  `packages/sync-engine/test/diff.test.js` additively in Phase D.
- Reuse `packages/integration-tests/.../graceful-degradation/
  cache-mode-edge-cases.scenario.test.js` for offline→reconnect.
- Phase B latency benchmark for scanPod-through-pseudo-pod (guards §6.1 +
  the standardisation-plan "latency parity" acceptance criterion).
- Phase D final flip gate: full `vitest run` across all 43 packages green
  before removing the direct-path branch.

---

## Critical files

- `packages/pseudo-pod/src/syncEngineAdapter.js` (NEW — the seam; 52.8.5
  names it, does not exist)
- `packages/sync-engine/src/SyncEngine.js` (1335 LOC; behaviour preserved
  while write/read redirected; `diff.js` for Phase D)
- `packages/pseudo-pod/src/PseudoPod.js` (cache+queue+`_v` — done; the
  absorption target)
- `apps/folio/src/SyncEngine.js` + `apps/folio/src/cli/_podFactory.js`
  (reference-consumer cutover / injection point)
- `apps/folio/test/SyncEngine.test.js` (1394 LOC — authoritative contract;
  the parity harness wraps this)
