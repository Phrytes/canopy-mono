# Changelog — @canopy/react-native

All notable changes to the package.  Versioning per
`Project Files/Substrates/policies.md`: minor for additive changes,
major for breaking changes.

## [Unreleased]

### Added

- **pseudo-pod-adapter** sub-path (Phases 51.1 – 51.4). RN-side
  `StorageBackend` implementations for `@canopy/pseudo-pod`:
  - `createAsBackend({AsyncStorage, scope})` — AsyncStorage-backed.
  - `createFsBackend({FileSystem, rootDir, scope})` —
    expo-file-system-backed; atomic writes via `.tmp` + moveAsync.
  - `createBackend({...})` — composite that picks AS for small
    payloads, FS for large (default threshold 4 KB); supports
    cross-backend migration on update.
  Importable as `@canopy/react-native/pseudo-pod-adapter`. 35 new
  tests with mocked native modules.

## [0.2.0] — 2026-05-02

### Added

- **Platform layer** (cross-cutting RN plumbing).  This package
  expands beyond its original "RN-specific SDK adapters" scope to
  also serve as the RN platform layer that every `@canopy` app
  on phone consumes.  See
  `Project Files/Substrates/L0-react-native.md` for the layer
  sketch.

- **Documentation** under `./docs/`:
  - `BRING-UP-NOTES.md` — folded in from
    `apps/folio-mobile/docs/SOLID-RN-NOTES.md` (verbatim trap
    catalogue, 17 traps from Folio's 2026-04-30 mobile bring-up).
  - `VERSION-MATRIX.md` — pinned versions for the RN stack
    (Expo 52 / RN 0.76.9 / React 18.3.1 / rn-webrtc 124.0.7,
    plus polyfill packages).
  - `PER-SUBSTRATE-CHECKLIST.md` — guidance for substrate authors
    adding RN variants.

- **`metro-preset.cjs`** — exported reusable Metro preset.  Apps
  consume via:
  ```js
  const { withCanopyPreset } = require('@canopy/react-native/metro-preset');
  module.exports = withCanopyPreset({ projectRoot: __dirname, repoRoot: '...' });
  ```
  Encapsulates: NODE_BUILTINS shim list, `node:` prefix stripping,
  `util` / `path` / `ws` shim routing, monorepo subpath handling,
  `unstable_enablePackageExports: false`.  App-specific bits
  (Folio's `@canopy-app/folio/rn/*` subpath, app-specific
  `extraNodeModules`) come in via options.

- **Subpath exports** under `./platform/...`:
  - `./platform/polyfills` — side-effect import; idempotent on Node
    (no-op variant) and RN (loads `react-native-get-random-values`).
  - `./platform/service-factory` — `selectPlatform({rn, default})`
    helper for substrate authors.
  - `./platform/shims/{node-builtins, path, util, ws}` — re-usable
    shims migrated from `apps/folio-mobile/shims/`.

### Unchanged

- The existing `@canopy/react-native` barrel
  (`KeychainVault`, `BleTransport`, `MdnsTransport`,
  `MobilePushBridge`, `createMeshAgent`, `requestMeshPermissions`,
  `attachIdentityToAgent`, `AsyncStorageAdapter`, `PushAdapter`)
  is preserved.  Existing consumers (Folio mobile) require no
  changes.

### Notes for consumers

- Folio mobile keeps its own `metro.config.js` for now; the preset
  is available but the migration is a separate work item.  See
  `Project Files/Substrates/L0-react-native.md` § "V0 deliverable"
  for the migration plan.
- New apps starting on RN should consume the preset directly:
  - `apps/<my-app>/metro.config.js` → `withCanopyPreset(...)`
  - `apps/<my-app>/index.js` → `import '@canopy/react-native/platform/polyfills';` first.
- BRING-UP-NOTES.md is the canonical reference for new mobile
  bring-ups; append new traps here, don't duplicate in app docs.

## [0.1.0]

Initial scope.  RN-specific SDK adapters: BLE transport, mDNS
transport, Keychain vault, AsyncStorage adapter, mobile push
bridge, Expo notifications adapter, mesh agent factory.
