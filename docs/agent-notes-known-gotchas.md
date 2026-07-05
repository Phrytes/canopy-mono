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
