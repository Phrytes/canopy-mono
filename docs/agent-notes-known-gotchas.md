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
