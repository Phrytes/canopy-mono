# React Native V2 — Coding plan (2026-05-11)

> Phase-by-phase build of `packages/react-native`'s
> standardisation work. Companion to the functional design
> ([`../Substrates/substrates-v2-functional-design-2026-05-11.md`](../Substrates/substrates-v2-functional-design-2026-05-11.md)
> §5.8). Numbered **Phase 51.x** to reserve a fresh prefix
> alongside core's 50.x.
>
> Phase numbers map to the standardisation plan's P-phases:
> 51.1–51.4 land in P1; 51.5 in P3; 51.6–51.10 in P4 (Hub
> track). The Hub-track phases are **direction-only** until
> the timing is committed.
>
> The user's mental model is that `react-native` is part of
> core too — this coding plan lives next to
> [`core-v2-coding-plan-2026-05-11.md`](core-v2-coding-plan-2026-05-11.md)
> for that reason.

## Scope locks (carried from the functional design)

1. **Android-primary; no iOS-specific code.** Per the main
   project lock.
2. **Existing modules carry forward unchanged.** theme,
   hooks, picker, qr, mnemonic, push, i18n, native adapters
   (KeychainVault, FileSystemAdapter, AsyncStorageAdapter,
   MdnsTransport, BleTransport, MobilePushBridge,
   requestMeshPermissions, createMeshAgent, metro-preset,
   platform/polyfills).
3. **New modules ship as separate sub-paths.**
   `pseudo-pod-adapter` (P1), `hub-discovery` + `hub-binding`
   (P4). Each addressable via `@canopy/react-native/<name>`.
4. **AIDL surface versioning.** Lock `IHub_V1` shape in P4;
   `IHub_V2` (additive) in P6. No incompatible changes.
5. **Pseudo-pod RN adapter location pinned to
   `react-native`** (not `sync-engine-rn`) — the adapter
   wraps RN-platform APIs (Expo FileSystem, AsyncStorage,
   permissions); pseudo-pod consumes it via a small abstract
   `StorageBackend` interface that the Node side mirrors.

## Substrate touches (overview)

| Substrate | Action | Phase |
|---|---|---|
| `@canopy/react-native/pseudo-pod-adapter` | NEW module — RN-side `StorageBackend` for pseudo-pod V0 + V1. | 51.1 – 51.4 |
| `@canopy/react-native/hub-discovery` | NEW module — Android `PackageManager` wrapper. | 51.6 |
| `@canopy/react-native/hub-binding` | NEW module — AIDL bound-service client. | 51.7 – 51.9 |

The existing modules (theme, picker, qr, mnemonic, push,
i18n, native adapters) are **unchanged** in V2.

---

# Part I — P1 phases (Hub-free interim)

## Phase 51.1 — Pseudo-pod RN adapter scaffold + `StorageBackend` interface

> **Purpose:** define the cross-platform `StorageBackend`
> contract that pseudo-pod V0 sits on. Node + RN both
> implement it; pseudo-pod is platform-neutral above it.

| # | Task | Files |
|---|---|---|
| 51.1.1 | Decide the `StorageBackend` interface jointly with the substrate coding plan: `get(key) → bytes`, `put(key, bytes) → void`, `delete(key) → void`, `list(prefix) → keys`, `subscribe(prefix, cb) → unsub`. Lives in `@canopy/pseudo-pod` (substrate); RN provides the implementation. | `packages/pseudo-pod/src/StorageBackend.js` (interface) |
| 51.1.2 | Scaffold `packages/react-native/src/pseudo-pod-adapter/` directory. Add `index.js` exporting `createBackend({rootDir, scope})` — returns a `StorageBackend` instance. | `packages/react-native/src/pseudo-pod-adapter/{index,createBackend}.js` |
| 51.1.3 | Re-export from `packages/react-native/index.js` as `@canopy/react-native/pseudo-pod-adapter`. | `packages/react-native/index.js` |
| 51.1.4 | Module-level README explaining the role + linking to pseudo-pod substrate docs. | `packages/react-native/src/pseudo-pod-adapter/README.md` |

**Estimate:** 0.5 day.
**Acceptance:** `import { createBackend } from
'@canopy/react-native/pseudo-pod-adapter'` resolves; type
shape matches the interface.

## Phase 51.2 — `FileSystemAdapter`-backed storage

> **Purpose:** large-payload writes (item bodies, attachment
> bytes) live in `expo-file-system`'s document directory.

| # | Task | Files |
|---|---|---|
| 51.2.1 | Implement `FsBackend({rootDir, scope})` — implements `StorageBackend`. Maps keys to file paths via a deterministic scheme (path-safe encoding). | `packages/react-native/src/pseudo-pod-adapter/FsBackend.js` |
| 51.2.2 | Subscribe semantics: directory watcher via `FileSystem.getInfoAsync` polling (no native FS-watcher on Expo) at a configurable interval (default 500ms). Acceptable for cache-mode use; replication-ring writes use the inbound envelope callback path instead. | `packages/react-native/src/pseudo-pod-adapter/FsBackend.js` |
| 51.2.3 | Tests with mocked `expo-file-system`. | `packages/react-native/test/pseudo-pod-adapter/FsBackend.test.js` |

**Estimate:** 1 day.
**Acceptance:** Write a 500 KB resource → restart agent → read
returns identical bytes.

## Phase 51.3 — `AsyncStorageAdapter`-backed storage

> **Purpose:** small-payload + metadata + ack-state writes
> live in AsyncStorage (faster for small values; survives
> across app restarts).

| # | Task | Files |
|---|---|---|
| 51.3.1 | Implement `AsBackend({scope})` — implements `StorageBackend`. Keys carry the `scope:` prefix to avoid collisions across crews. | `packages/react-native/src/pseudo-pod-adapter/AsBackend.js` |
| 51.3.2 | Subscribe semantics: pure in-memory event emitter — the substrate notifies on write; subscribers in the same process fire. (Cross-process subscriptions are out of scope; not needed for the agent's lifetime.) | `packages/react-native/src/pseudo-pod-adapter/AsBackend.js` |
| 51.3.3 | Tests with mocked `@react-native-async-storage/async-storage`. | `packages/react-native/test/pseudo-pod-adapter/AsBackend.test.js` |

**Estimate:** 0.5 day.
**Acceptance:** AsyncStorage round-trip for keyed metadata
works; events fire on writes.

## Phase 51.4 — `createBackend` size-based routing + integration

> **Purpose:** the RN backend picks `FsBackend` vs
> `AsBackend` per resource size — large goes to FS, small
> goes to AsyncStorage. Same `StorageBackend` API surface.

| # | Task | Files |
|---|---|---|
| 51.4.1 | `createBackend({rootDir, scope, fsThresholdBytes})` returns a `StorageBackend` that internally routes by size. Default `fsThresholdBytes`: 4 KB. | `packages/react-native/src/pseudo-pod-adapter/createBackend.js` |
| 51.4.2 | Migration path: when a resource crosses the threshold during an update, atomically move from one backend to the other (write new → delete old). | `packages/react-native/src/pseudo-pod-adapter/createBackend.js` |
| 51.4.3 | Tests covering routing + migration. | `packages/react-native/test/pseudo-pod-adapter/createBackend.test.js` |
| 51.4.4 | CHANGELOG entry + integration note for the substrate's V0 milestone. | `packages/react-native/CHANGELOG.md` |

**Estimate:** 0.5 day.
**Acceptance:** Pseudo-pod V0 in tasks-mobile + stoop-mobile
+ folio-mobile (when adopted) writes through the right
backend per size; existing tests pass.

---

# Part II — P3 phases

## Phase 51.5 — Pseudo-pod V1 write-through queue support

> **Purpose:** pseudo-pod V1's cache mode (drained writes to
> the real pod via OIDC). The RN backend exposes the right
> hooks for the substrate to register a write-through
> consumer.

| # | Task | Files |
|---|---|---|
| 51.5.1 | Extend `StorageBackend` with an optional `subscribeDirty(cb)` hook. The substrate's write-through queue subscribes; the backend fires whenever a write happens with `dirty: true` flag. | `packages/react-native/src/pseudo-pod-adapter/createBackend.js` |
| 51.5.2 | Persistent dirty-state across restarts: on agent start, the substrate scans the backend's dirty set; the backend exposes `listDirty()` for that. | `packages/react-native/src/pseudo-pod-adapter/createBackend.js` |
| 51.5.3 | Tests: dirty-state survives backend recreate; subscribeDirty fires reliably. | `packages/react-native/test/pseudo-pod-adapter/createBackend.dirty.test.js` |

**Estimate:** 1 day.
**Acceptance:** Substrate-side write-through queue (in
pseudo-pod V1) drains pending writes correctly after agent
restart on real device.

---

# Part III — P4 phases (Hub track)

## Phase 51.6 — `hub-discovery` module

> **Purpose:** detect whether the Hub-Android is installed
> on the device. Cheap one-shot on app launch.

| # | Task | Files |
|---|---|---|
| 51.6.1 | Scaffold `packages/react-native/src/hub-discovery/` directory. | `packages/react-native/src/hub-discovery/{index,check,watch}.js` |
| 51.6.2 | Implement `check()` — calls Android `PackageManager.queryIntentServices` for the Hub's well-known intent action (`com.canopy.hub.BIND`). Returns `{hubInstalled: bool, hubVersion?: string, packageName?: string}`. | `packages/react-native/src/hub-discovery/check.js` |
| 51.6.3 | Implement `watch(callback)` — listens for `ACTION_PACKAGE_ADDED` / `ACTION_PACKAGE_REMOVED` intents to detect install / uninstall mid-session. | `packages/react-native/src/hub-discovery/watch.js` |
| 51.6.4 | Cache the `check()` result for process lifetime; expose `invalidate()` for explicit re-check after a watch event. | `packages/react-native/src/hub-discovery/cache.js` |
| 51.6.5 | Native module bridge to `PackageManager`: implement via a small Java/Kotlin wrapper that Expo's `createPermissionHook` doesn't already cover. | `packages/react-native/android/.../HubDiscoveryModule.kt`, `packages/react-native/src/hub-discovery/native.js` |
| 51.6.6 | Tests with mocked native module; verify check + watch + invalidate. | `packages/react-native/test/hub-discovery/*.test.js` |
| 51.6.7 | Module README + re-export. | `packages/react-native/src/hub-discovery/README.md`, `packages/react-native/index.js` |

**Estimate:** 2 days (most of the time is the native bridge).
**Acceptance:** On a device with the Hub installed, `check()`
returns `{hubInstalled: true, hubVersion: 1}` within 50ms;
without it, returns `{hubInstalled: false}` reliably; `watch`
fires on install / uninstall events.

## Phase 51.7 — `hub-binding` AIDL surface stubs

> **Purpose:** define the AIDL interface (`IHub_V1`) +
> generate the binding client stubs.

| # | Task | Files |
|---|---|---|
| 51.7.1 | Author the AIDL interface file: `IHub_V1.aidl` with methods `registerBundle`, `declareCapabilities`, `fetchResource`, `writeResource`, `publishEnvelope`, `registerIncomingCallback`. | `packages/react-native/android/aidl/com/canopy/hub/IHub_V1.aidl`, `packages/react-native/android/aidl/com/canopy/hub/IIncomingCallback.aidl` |
| 51.7.2 | Build step: `aidl` tool generates the Java stubs as part of the Android module's build (or commit pre-generated stubs to avoid relying on the host having `aidl`). Document the choice. | `packages/react-native/android/build.gradle` |
| 51.7.3 | Custom Android permission declaration (`com.canopy.hub.PERMISSION_BIND`) + signature-verification expectations documented. | `packages/react-native/android/src/main/AndroidManifest.xml` (declared) |

**Estimate:** 1 day.
**Acceptance:** AIDL stubs build cleanly; the binding
permission is declared at the right scope.

## Phase 51.8 — `hub-binding` client wrapper

> **Purpose:** Promise-based wrapper around the AIDL binder.
> Apps call high-level methods; the wrapper handles the
> binder lifecycle.

| # | Task | Files |
|---|---|---|
| 51.8.1 | Implement `bind({hubVersion, intentAction})` — finds the service, calls `Context.bindService`, returns an `IHubBinding` instance once `onServiceConnected` fires. Handles reconnect on `onServiceDisconnected`. | `packages/react-native/src/hub-binding/bind.js`, native side |
| 51.8.2 | `IHubBinding` exposes promise-based methods: `registerBundle(manifest) → ack`, `declareCapabilities(caps) → ack`, `fetchResource(uri) → bytes`, `writeResource(uri, bytes) → etag`, `publishEnvelope(envelope, recipients) → ack`, `onIncomingEnvelope(callback) → unsubscribe`. Each marshals + unmarshals via the AIDL stubs. | `packages/react-native/src/hub-binding/IHubBinding.js`, native side |
| 51.8.3 | `binding.close()` — unbinds the service. | `packages/react-native/src/hub-binding/IHubBinding.js` |
| 51.8.4 | Tests with mocked binder; verify method round-trips + reconnect behaviour. | `packages/react-native/test/hub-binding/*.test.js` |

**Estimate:** 2 days.
**Acceptance:** A test app can bind to a stub Hub service +
round-trip `fetchResource` + `publishEnvelope` calls.

## Phase 51.9 — `hub-binding` callback path + version negotiation

| # | Task | Files |
|---|---|---|
| 51.9.1 | `onIncomingEnvelope` callback wiring: the Hub invokes the bundle's `IIncomingCallback.onEnvelope(...)` per the bundle's registration; the wrapper marshals into JS via the RN event-emitter. | `packages/react-native/src/hub-binding/callback.js`, native side |
| 51.9.2 | Version negotiation: `bind()` asks the Hub which `IHub_VN` versions it supports; picks the highest the client also understands. Mismatch → graceful fallback. | `packages/react-native/src/hub-binding/bind.js` |
| 51.9.3 | Tests for version-negotiation edges (Hub V2 + client V1; Hub V1 + client V2). | `packages/react-native/test/hub-binding/version.test.js` |

**Estimate:** 1 day.
**Acceptance:** Callback round-trip works (Hub → bundle);
version mismatch handled with the right fallback path.

## Phase 51.10 — Integration test harness + docs

| # | Task | Files |
|---|---|---|
| 51.10.1 | Integration-tests directory `packages/integration-tests/hub-binding/` with a stub Hub APK (or a manifest for one) + a mobile-side scenario script. | `packages/integration-tests/hub-binding/**` |
| 51.10.2 | Update `packages/react-native/README.md` with the hub-discovery + hub-binding section. | `packages/react-native/README.md` |
| 51.10.3 | CHANGELOG entry for the P4 modules. | `packages/react-native/CHANGELOG.md` |

**Estimate:** 1 day.
**Acceptance:** Integration test runs end-to-end against an
emulator-deployed stub Hub.

---

# Part IV — P6 phases (Hub track, direction)

## Phase 51.11 — `hub-binding` V2 surface additions

> **Purpose:** AIDL V2 adds interface-registry + protocol
> orchestration methods. Additive over V1.

| # | Task | Files |
|---|---|---|
| 51.11.1 | Author `IHub_V2.aidl` extending V1 with `registerInterface`, `lookupInterface`, `orchestrateProtocol`, `subscribeProtocolState`. | `packages/react-native/android/aidl/com/canopy/hub/IHub_V2.aidl` |
| 51.11.2 | Client wrapper extension: V2-only methods on `IHubBinding` available when negotiated version is ≥ 2. | `packages/react-native/src/hub-binding/IHubBindingV2.js`, native side |
| 51.11.3 | Tests + docs. | `packages/react-native/test/hub-binding/v2.test.js`, README updates |

**Estimate:** 1.5 days.
**Acceptance:** V2-capable agent registers a type's
renderer through `registerInterface`; protocol state
subscription fires updates correctly.

---

## Phasing summary

| Phase range | Standardisation P-phase | Estimate |
|---|---|---|
| 51.1 – 51.4 | P1 (Hub-free) | ≈2.5 days |
| 51.5 | P3 (Hub-free) | ≈1 day |
| 51.6 – 51.10 | P4 (Hub track) | ≈7 days |
| 51.11 | P6 (Hub track, direction) | ≈1.5 days |

Total ≈12 days of react-native-side work across the
standardisation arc. The bulk is in P4 (hub-discovery +
hub-binding native bridge); P1 + P3 are lighter.

## Acceptance gates per P-phase

- **P1 (51.1–51.4) gate:** Pseudo-pod V0 in the three mobile
  apps writes through the `StorageBackend` interface;
  `FsBackend` + `AsBackend` round-trip both small + large
  payloads on a real Android device.
- **P3 (51.5) gate:** Pseudo-pod V1's write-through queue
  drains correctly after app kill/restart; persistent
  dirty-state survives.
- **P4 (51.6–51.10) gate:** Test app on Android emulator
  detects the Hub via PackageManager; binds via AIDL;
  round-trips fetch + write + envelope publish through the
  binder; reconnects on service disconnect.
- **P6 (51.11) gate:** V2-capable apps register their type
  renderers through the binding; protocol state changes
  flow Hub → app via the callback path.

## Open questions

- **Pre-generated AIDL stubs vs build-time generation.**
  Trade-off: build-time keeps the source-of-truth in the
  `.aidl` file; pre-generated avoids host-tool requirements.
  Default proposed: pre-generated, committed; regenerate on
  AIDL changes. Pin during 51.7.
- **Stub Hub APK provenance.** Maintained alongside the real
  Hub-Android codebase, or a separate test stub kept in
  `packages/integration-tests/hub-binding/`? Default
  proposed: separate stub, kept in lockstep with `IHub_V1`'s
  AIDL definition. Pin during 51.10.
- **iOS path.** Out of scope per the main project lock; if
  iOS is ever reopened, AIDL has no equivalent and the Hub
  story doesn't apply. The `pseudo-pod-adapter` + the
  existing native modules would work on iOS via Expo.

## References

- Functional design:
  [`../Substrates/substrates-v2-functional-design-2026-05-11.md`](../Substrates/substrates-v2-functional-design-2026-05-11.md)
  — §5.8 covers the `react-native` package extensions.
- Core coding plan companion:
  [`core-v2-coding-plan-2026-05-11.md`](core-v2-coding-plan-2026-05-11.md).
- Standardisation plan:
  [`../standardisation-plan-restructured-2026-05-10.md`](../standardisation-plan-restructured-2026-05-10.md).
- Transition doc:
  [`../standardisation-transition-2026-05-11.md`](../standardisation-transition-2026-05-11.md)
  — Part III's `react-native` row.
- Layering convention:
  [`../conventions/architectural-layering.md`](../conventions/architectural-layering.md)
  — RN-substrate-separation rule.
- Existing `react-native` package:
  [`packages/react-native/`](../../packages/react-native/).
