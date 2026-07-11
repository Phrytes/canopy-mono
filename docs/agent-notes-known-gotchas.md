# Known gotchas — check here BEFORE debugging build/native issues

Agent-facing. These are traps that have already cost time in this repo and **will bite again**.
Several pass locally and only fail on device/CI, so they're easy to misdiagnose. Skim this list
before you start bisecting a build or native crash.

---

## Monorepo module resolution (npm workspaces + symlinks)

**Umbrella pattern.** Workspace packages are symlinked into `node_modules`. Anything that breaks
or bypasses those symlinks — a build step that strips them, a circular reference, a hoisting quirk
— makes module resolution fail. The tell is **"works locally, fails on EAS/CI"**, because the
local tree has the symlinks/`node_modules` and the build server doesn't.

- **EAS strips `node_modules` → Metro can't resolve `packages/core` deps.**
  EAS Build removes every `node_modules/` from the upload (to shrink transfer), then runs `npm ci`
  **only in the app directory**. So `packages/core/node_modules` never exists on the build server,
  and the moment Metro processes a file under `packages/core/src/` it fails to resolve the kernel's
  crypto deps (`tweetnacl`, `@scure/bip39`, `@noble/*`).
  **Fix:** add `packages/core/node_modules` to Metro's `resolver.nodeModulesPaths` as a fallback.
  **Caveat (important):** add *only* that path — it holds the kernel's crypto deps and nothing else.
  Do **NOT** add `packages/react-native/node_modules`; it contains React Native **native modules**,
  and putting those on `nodeModulesPaths` causes duplicate-native-module conflicts.
  **Generalizes:** if a future build hits this with another package, find which package's source
  triggered it and add *that* package's `node_modules` — provided it has no RN native modules.

- **New workspace dep needs its `node_modules` symlink materialized.**
  This repo has NO root hoisting: each package's `file:` deps live as symlinks in *its own*
  `node_modules`. Adding a `@canopy/*` dep to a package's `package.json` is not enough for a fresh
  checkout that doesn't re-run install — the symlink must exist. Slice 1a (2026-07-10) wired
  `@canopy/sync-engine` onto `@canopy/versioning` + `@canopy/pseudo-pod` (the `/node` fs backend for
  the retired `versions.js`); both are declared deps AND symlinked into
  `packages/sync-engine/node_modules/@canopy/{versioning,pseudo-pod}`. If sync-engine (or any Folio
  test that imports `SyncEngine`) suddenly can't resolve `@canopy/versioning` / `@canopy/pseudo-pod`,
  recreate those two symlinks (`ln -sf ../../../versioning versioning`, `ln -sf ../../../pseudo-pod
  pseudo-pod`).

- **Recursive / self package references → solved with (workspace) symlinks.**
  A package that references itself or forms a dependency cycle has broken resolution here before;
  workspace symlinking is what fixed it. Same "symlink integrity" family as the EAS trap above —
  if resolution breaks, check that the workspace symlinks are intact first.

- **New `@canopy/*` workspace dep → its `node_modules` symlink must be materialized (or `pnpm install` re-run).**
  Adding a `@canopy/*` dep to a package's `package.json` — or repointing a raw-`src` reach-in onto a public
  `@canopy/<pkg>` specifier — only resolves once that package has `node_modules/@canopy/<pkg> →
  ../../../../packages/<pkg>`, which `pnpm install` creates from the declared dep. If you can't run a full install
  (the offline store is often incomplete here), materialize the link by hand, mirroring an existing one (e.g.
  `@canopy/redaction`). **Tell:** an import that resolves in one package but throws `ERR_MODULE_NOT_FOUND` in
  another. *Concrete (2026-07-08):* feedback-split F1 added `@canopy/{core,pod-client,pseudo-pod}` to
  `apps/feedback-pipeline`; links were materialized by hand pending the next install. *Concrete (2026-07-09):* the
  versioning/agents work hand-materialized `@canopy/versioning` into `apps/canopy-chat`, `apps/canopy-chat-mobile`,
  and `packages/substrate-stack`; `@canopy/substrate-stack` into `apps/{stoop,tasks-v0,household}`; and
  `@canopy-app/agents` + `@canopy/agent-registry` into `apps/canopy-chat` — all pending the next real install.
  **Same family — a fresh `git worktree` has NO `node_modules`:** before running a worktree's tests, wire them by
  symlinking the main tree's root `node_modules` + each `apps/*/node_modules` & `packages/*/node_modules`. And note
  the Agent-tool `isolation: worktree` branches from stale `origin/master` here (local master is unpushed) — pin
  worktrees to local `HEAD` instead. (See the `worktree-base-stale-gotcha` agent memory.)

## Android 12+ instant crash on BLE / mDNS

**Root cause.** On Android 12+ (API 31+), BLE calls require runtime-granted `ACCESS_FINE_LOCATION`
+ `BLUETOOTH_SCAN` / `BLUETOOTH_ADVERTISE` / `BLUETOOTH_CONNECT`. If the app instantiates
`BleTransport` / `MdnsTransport` (Zeroconf) and touches the native module **before** those grants,
Android throws an **instant native crash** — blank white/black screen, no JS stack trace.

**Fix.** Request all needed permissions **first** (a `permissions.js` up front). If BLE is denied,
start the agent **mDNS-only** (non-fatal). Wrap the app in an **ErrorBoundary** so any *later* JS
error renders readable on-screen text instead of a blank crash you can't screenshot.

## Debugging native crashes (no Android Studio needed)

- **Dev build for Metro's red-box overlay** (full stack + hot reload):
  `npx expo start` + `eas build -p android --profile development`, then open with
  `exp+<app>://<laptop-ip>:<port>` or scan the QR.
- **adb logcat**, just the platform-tools zip:
  `adb logcat --pid=$(adb shell pidof <app.package>) | grep -E "Error|Fatal|FATAL|Exception"`.

## Cross-package RELATIVE imports in canopy-chat-mobile (Metro)

Some mobile modules import packages RELATIVELY (`../../../../packages/<pkg>/src/…`) when the package is not in
mobile's package.json — e.g. `src/core/mediaCardModel.js` → blob-gateway (2026-07-10), same pattern as the earlier
`rendezvousRtcLib` import. Works in vitest/Node; on-device Metro needs the path inside `nodeModulesPaths`/watchFolders
(check metro.config.js) or the dep declared + linked. **Tell:** green tests but a device-only "module not found".

## better-sqlite3 native binding not built → relay suite 5 failures (cold clone)

`packages/relay` uses **better-sqlite3** (Sqlite queue store + the blob-gate ACL store). It's a NATIVE
addon — a cold clone / fresh environment where it was never compiled shows **~5 relay test failures**
that look unrelated to your change (they're the SQLite-backed suites failing to load the binding).
**Fix:** `npm rebuild better-sqlite3` (from repo root) → true baseline restored. **Tell:** the failures
are all in the sqlite-store suites and mention a `.node` binding / `NODE_MODULE_VERSION`; non-sqlite relay
tests stay green. Not a regression — check this before bisecting a relay failure. (Found 2026-07-10 during
the blob-gate edge mount.)

**R-media (2nd tenant, 2026-07-10):** composing the media blob edge into companion-node added TWO new
hand-materialized `@canopy/*` symlinks in `apps/companion-node/node_modules/@canopy/`:
`blob-gateway → ../../../../packages/blob-gateway` (used by `src/mediaEdge.js` for the capability-verifier
adapter) and `pod-client → ../../../../packages/pod-client` (used by `test/companionMedia.test.js` for the
sealing `makeSealer`/`makeOpener`). Re-create with `ln -sfn ../../../../packages/<pkg> <pkg>` from that dir
if a fresh checkout drops them. **Tell:** `Cannot find package '@canopy/blob-gateway'` (or `pod-client`)
only when companion-node's media suite runs. NOTE: the SQLite native-binding trap above ALSO applies here —
the blob-gate ACL store defaults to a MemoryBlobAclStore (no sqlite), so companion-node's media suite itself
needs no rebuild, but a cold clone still needs `npm rebuild better-sqlite3` for the broader relay suite.

## companion-node hand-linked @canopy symlinks + relative-import-into-folio (R1)

`apps/companion-node` (Slice R1) follows the repo's no-hoist convention: its direct bare `@canopy/*`
imports resolve from **hand-materialized** symlinks in `apps/companion-node/node_modules/@canopy/`
(`core`, `transports`, `relay`, `vault`, `agent-registry` → `../../../../packages/<pkg>`). If you add a
new direct `@canopy/*` import to companion-node's own `src/`/`test/`, materialize its symlink too — a
missing one shows as `Cannot find package '@canopy/<x>'` only when companion-node runs (folio/agents are
unaffected because they resolve via their OWN node_modules). `vitest` resolves by walking up to the repo
root's `node_modules`, so it needs no app-local link.

companion-node **reuses folio verbatim by RELATIVE path into `apps/folio/src/`** (`../../folio/src/…` for
`wireSkills`, `registerFolioAgent`, `agentCores`, `autoShare`, `folioPodList`, `folioSearch`,
`cli/_podFactory`). Those folio files' transitive `@canopy/*` deps resolve via **folio's** node_modules,
NOT companion-node's — so companion-node does NOT need e.g. `@canopy/pseudo-pod`/`pod-search` links even
though the imported folio code uses them. **Tell:** if you see companion-node failing to resolve a package
that only the imported folio code imports, the fix is a missing symlink in `apps/folio/node_modules`, not
companion-node's. Do NOT edit `apps/folio/` to "fix" a companion-node import — R1 only consumes folio.
(Added 2026-07-10, companion-node R1.)

## canopy-chat-mobile now depends on @canopy/blob-gateway (hygiene pass)

`apps/canopy-chat-mobile/src/core/mediaCardModel.js` used to reach into
`../../../../packages/blob-gateway/src/openBlob.js` (a deep `/src/` reach-in on an **undeclared**
package — invariant #5). It now imports the bare barrel `@canopy/blob-gateway` (its `main`/`.` export
= `src/index.js`, which re-exports `openThumbnail`), matching how the app's other core files consume
`@canopy/*`. This added `@canopy/blob-gateway` to `apps/canopy-chat-mobile/package.json` deps, so the
no-hoist symlink must exist: `ln -sfn ../../../../packages/blob-gateway blob-gateway` from
`apps/canopy-chat-mobile/node_modules/@canopy/`. **Tell:** `Cannot find package '@canopy/blob-gateway'`
when the mobile app boots or its Vitest suite runs. RN-bundle-safe: the barrel pulls only
`uploadBlob`/`gatekeeper`/`ref`/`bytes`/`openBlob`, and `bytes.js`'s guarded `require('node:crypto')`
(behind `globalThis.crypto ||`) + `@canopy/pod-client/sealing` were already in the RN graph via the old
`openBlob.js` import — no NEW node-only dep enters the bundle. (Added 2026-07-11, code-quality hygiene pass.)
