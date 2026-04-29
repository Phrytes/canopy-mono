# Folio.C1 — RN Sync Engine Adapter (Phase C kickoff)

| | |
|---|---|
| **Status** | plan-drafted (awaiting user OK to spawn) |
| **Started** | — |
| **Last updated** | 2026-04-29 — initial plan |
| **Owner** | unassigned |
| **Blocked on** | nothing hard — Phase C was gated on the two-device smoke, but C1 is the *library-portability* slice; smoke gates the *substrate* (BLE/WiFi/clock skew on real phones), not the JS shim work.  C1 can proceed independently.  C2 (RN screens) remains gated on smoke results before we put it in users' hands. |

**Goal:** make Folio's SyncEngine run **in-process inside a React Native
app**, so a future Folio mobile client doesn't need a Node runtime or
HTTP/WebSocket bridge — RN screens call `engine.runOnce()` directly.

**Refs:**
- [`./track-H-app-folio.md`](./track-H-app-folio.md) §Phase C — original
  C1 sketch (file layout + sequence)
- [`./sdk-two-device-smoke.md`](./sdk-two-device-smoke.md) — gates C2 (not C1)
- `apps/mesh-demo/` — pinned RN stack (Expo 52 / RN 0.76.9 / React 18.3.1
  / rn-webrtc 124.0.7) per CLAUDE.md.  C1 mirrors this.

---

## Identity (re-stated for the agent)

> Folio's library is **"one engine, three drivers."**  C1 is the third
> driver's shim layer — replacing Node-only primitives (`node:fs`,
> `chokidar`) with React-Native equivalents.

**SyncEngine logic stays untouched.**  Only the *adapter shims* are
new: filesystem, watcher, vault.  The diff/conflict/versioning/auto-share
modules are pure JS and already portable.

---

## What needs to change

### Audit table — Node-only primitives in current SyncEngine + helpers

| Module | Node-only call | RN replacement |
|---|---|---|
| `SyncEngine.js` | `node:fs/promises` (`readFile`, `writeFile`, `readdir`, `mkdir`, `stat`, `rm`) | `expo-file-system` (`readAsStringAsync`, `writeAsStringAsync`, `readDirectoryAsync`, `makeDirectoryAsync`, `getInfoAsync`, `deleteAsync`) |
| `SyncEngine.js` | `node:path` (`join`, `dirname`) | Portable path helpers — write a tiny `pathPosix.js` in the shim layer |
| `SyncEngine.js` | `chokidar` | Manual interval scan: walk `localRoot`, compare each file's `(mtime, size)` against the previous walk; emit synthetic `change`/`add`/`unlink` events.  Tunable interval (default 5–10s; configurable). |
| `scanLocal.js` | `node:fs/promises` + `node:crypto` (sha256) | `expo-file-system` + `expo-crypto` (which has `digestStringAsync`) |
| `applyConflict.js` | `node:fs/promises` | `expo-file-system` |
| `versions.js` | `node:fs/promises` | `expo-file-system`; some bookkeeping (sidecar `.sha256` files) ports cleanly |
| `autoShare.js` | `node:fs/promises` (atomic write of `shares.json`) | `expo-file-system` (no atomic rename — use temp-then-move; document as best-effort) |
| `_config.js` (CLI only) | `node:os.homedir` + `node:fs/promises` | Skipped — RN driver doesn't reuse the CLI's config flow; uses its own config pattern (AsyncStorage + secure store) |
| `cli/_podFactory.js` | `node:fs` for FsBackedMockPodClient | Skipped for RN; mobile uses the real PodClient with `expo-auth-session` for OIDC |
| Vault | `VaultNodeFs` (file-backed) | `VaultRN` using `expo-secure-store` (already exists in `@canopy/react-native` per CLAUDE.md — confirm) |

### Architecture: dependency injection, not platform branches

Don't sprinkle `Platform.OS === 'web'` checks throughout SyncEngine.  Use
a **filesystem-adapter object** the engine accepts in its constructor:

```js
// new in C1
const engine = new SyncEngine({
  podClient,
  localRoot,
  podRoot,
  fs:        rnFsAdapter,           // ← new dep injection point
  watcher:   rnWatcherFactory,      // ← replaces chokidar
  hash:      rnHashAdapter,         // ← replaces node:crypto
});
```

Default values point at the existing Node-backed adapters so the CLI +
web driver keep working with zero changes.  The RN driver provides its
own implementations.

This is a **structural refactor of SyncEngine** — the biggest risk in
the slice.  Tests must verify Node + RN both work.

---

## File layout

```
create:
  apps/folio/src/adapters/                       # NEW shim layer (used by all drivers)
    fsNode.js                                    # current node:fs wrapper extracted
    fsRN.js                                      # expo-file-system wrapper
    watcherNode.js                               # current chokidar wrapper extracted
    watcherRN.js                                 # interval-poll watcher
    hashNode.js                                  # current node:crypto wrapper
    hashRN.js                                    # expo-crypto wrapper
    pathPosix.js                                 # join / dirname / basename — pure string ops
    index.js                                     # the FsAdapter / WatcherAdapter / HashAdapter interfaces (just JSDoc + factory dispatch)
  apps/folio/src/rn/
    backgroundTasks.js                           # expo-background-fetch + WorkManager hooks
    serviceFactory.js                            # builds a SyncEngine for RN with all the adapters wired
  apps/folio/test/adapters/
    fsRN.test.js                                 # vitest with @expo/vector-icons mocked
    watcherRN.test.js
    hashRN.test.js
    pathPosix.test.js
  apps/folio/test/rn/
    serviceFactory.test.js                       # smoke: build engine with RN adapters; runOnce against MockPodClient
modify:
  apps/folio/src/SyncEngine.js                   # accept fs / watcher / hash via constructor, default to Node adapters
  apps/folio/src/scanLocal.js                    # take fs + hash via parameter
  apps/folio/src/scanPod.js                      # already abstract over PodClient — confirm; minor tweak if needed
  apps/folio/src/applyConflict.js                # take fs via parameter
  apps/folio/src/versions.js                     # take fs + hash via parameter
  apps/folio/src/autoShare.js                    # take fs via parameter
  apps/folio/package.json                        # add expo-file-system, expo-crypto, expo-secure-store as peerDependencies (mobile-only); NOT in dependencies
  coding-plans/track-H-folio-C1.md               # mark sequence done; scratchpad entry
```

C1 deliberately does NOT add a new app workspace yet.  C2 will create
`apps/folio-mobile/` (or fold into mesh-demo as a screen module — TBD).
C1 is purely the library-side adapter work.

---

## Open questions

| # | Question | Lean |
|---|---|---|
| Q-C1.1 | Adapter interface shape — Promise-based methods only?  Or a stream variant for large files? | **Promise-only for v1.**  Folio's biggest files are markdown notes (KB, not MB).  Streams add complexity with little payoff. |
| Q-C1.2 | Watcher polling interval default for RN | **10 s.**  RN watching is best-effort; users on mobile expect "open the app" semantics anyway.  Background-fetch is the bigger lever (Q-C1.4). |
| Q-C1.3 | Single `apps/folio-mobile/` workspace OR fold into `apps/mesh-demo/` as a screen module? | **TBD — defer to C2.**  C1 doesn't ship an RN app; C2 decides. |
| Q-C1.4 | Background-fetch cadence — every 15 min?  Every hour?  Configurable? | **Configurable; default 30 min.**  Document iOS Doze behavior + Android Doze caveats. |
| Q-C1.5 | Vault-on-mobile — use `expo-secure-store` directly, or wrap via `@canopy/react-native`'s existing `VaultRN`? | **Wrap via `VaultRN`.**  Already-shipped surface; consistent with mesh-demo's existing identity flow. |
| Q-C1.6 | Reuse `@canopy/pod-client`'s `CapabilityAuth` + `SolidOidcAuth` directly, or write a thin RN-aware variant? | **Reuse directly.**  The auth modules don't touch fs; they're pure crypto + http.  RN's `fetch` is compatible.  The OIDC *redirect* flow is C2's concern (see "Mobile auth flow" below) — C1 just makes sure the engine, vault, and PodClient still wire together when given an authenticated session from RN-land. |

User leans documented; nothing requires a lock before C1 spawns.

---

## Sequence (one agent slice, ~1.5 days)

- [ ] 1. Define adapter interfaces in `apps/folio/src/adapters/index.js` (JSDoc only; no code yet)
- [ ] 2. Extract Node implementations: `fsNode.js` / `watcherNode.js` / `hashNode.js` from current SyncEngine code
- [ ] 3. Refactor `SyncEngine.js` to accept `{ fs, watcher, hash }` via constructor; default to Node adapters
- [ ] 4. Apply same refactor to `scanLocal.js`, `applyConflict.js`, `versions.js`, `autoShare.js` (each takes `fs` and/or `hash` parameters)
- [ ] 5. Verify all 367+ existing Folio tests still pass — Node-side regression check
- [ ] 6. Implement RN adapters: `fsRN.js` (expo-file-system), `watcherRN.js` (interval poll), `hashRN.js` (expo-crypto)
- [ ] 7. Write `pathPosix.js` — pure string `join`/`dirname`/`basename`
- [ ] 8. Write `serviceFactory.js` — convenience that wires RN adapters + a real PodClient
- [ ] 9. Tests: vitest with mocked `expo-file-system` / `expo-crypto` / `expo-secure-store` modules.  At least 25 new tests across the adapter files + the service factory
- [ ] 10. `backgroundTasks.js` — minimal scaffold for `expo-background-fetch` + WorkManager.  Tests mock the platform APIs
- [ ] 11. Update `apps/folio/package.json` peerDependencies for the Expo libs
- [ ] 12. Document the new constructor shape in a §C1 scratchpad entry of this file

---

## DoD

- [ ] SyncEngine accepts `{ fs, watcher, hash }` via constructor; defaults to Node adapters
- [ ] All 367 baseline Folio tests pass with the refactor (Node side)
- [ ] At least 25 new tests for the RN adapters (mocked Expo modules)
- [ ] `serviceFactory.js` builds an engine + runs a smoke `runOnce()` against `FsBackedMockPodClient` (proving the RN-shaped construction path works at all)
- [ ] Documented adapter API surface (JSDoc complete)
- [ ] No new top-level deps in root or `packages/*`
- [ ] `expo-*` libs declared as `peerDependencies` only — not pulled in for the CLI / web build
- [ ] `npm test --prefix apps/folio` green
- [ ] §Folio.C1 scratchpad in this file (`track-H-folio-C1.md`)

---

## Hand-off triggers

| When this completes | What it unblocks |
|---|---|
| **C1 (this slice)** | C2 (RN screens) can be built on top — no further engine refactoring needed |
| **C1 + the smoke (S1–S10) green** | C2 spawns; mobile Folio enters real-device testing |
| **C2 ships** | Folio is end-to-end on mobile; Phase C complete |

---

## Mobile auth flow (C2's job; documented here for continuity)

The desktop web flow opens the system browser and waits for a localhost
callback.  Mobile uses `expo-auth-session` instead — same OIDC standard,
different transport.  User experience:

1. User taps "Sign in" in Folio mobile
2. **Safari View Controller** (iOS) or **Chrome Custom Tab** (Android)
   slides up as a native modal showing `https://login.inrupt.com/...`
3. User authenticates (Inrupt's full login UX — password manager,
   biometrics, etc.)
4. Inrupt redirects to a custom URL scheme: `folio://auth/callback?code=...`
5. The OS recognises the scheme, dismisses the browser sheet, hands
   the URL to the Folio app
6. Folio exchanges the auth code for tokens via Inrupt's token endpoint
   (**PKCE** — no client-secret embedded in the binary)
7. Refresh token persisted to the OS keychain via `expo-secure-store`
   (iOS Keychain / Android Keystore — hardware-backed where available)
8. UI updates: signed in, sync starts

This is **NOT**:
- ❌ a WebView pointing at the desktop's `localhost:8888`
- ❌ a context-switch into a separate browser app + manual return
- ❌ a custom password form (security smell)

What stays the same as desktop:
- PKCE protection against auth-code intercept
- Inrupt's dynamic client registration (no pre-registration of the app)
- Same `OidcSession.js` logic for token refresh once tokens are obtained
- Same `SolidOidcAuth` plumbing into PodClient

C2 work to ship this:
- New `apps/folio/src/rn/auth/folioAuth.js` — wraps
  `expo-auth-session.useAuthRequest()`, handles the redirect, hands the
  resulting tokens to a `OidcSession` instance.
- `app.json` (RN app's) `scheme: 'folio'` so the OS routes
  `folio://auth/callback` back to the app.
- Inrupt registration of `folio://auth/callback` as an allowed redirect
  URI for our dynamically-registered client (Inrupt accepts custom
  schemes for native apps).
- `expo-auth-session` + `expo-web-browser` + `expo-secure-store` added
  to the RN app's `package.json`.

C1 explicitly does NOT touch any of this — but the C1 SyncEngine
refactor must keep `OidcSession` injection-friendly so C2 can hand it
a session built from `expo-auth-session` tokens without further engine
changes.

---

## Out of scope for C1

- The mobile app itself (`apps/folio-mobile/` or mesh-demo screen module)
- OIDC sign-in UX on mobile (`expo-auth-session` integration)
- Push notifications (E2c is deferred per the SDK plan)
- Markdown editor on mobile (RN editor library choice — likely
  `react-native-markdown-editor` or similar; C2's call)
- A "drop a file from Files app" share-extension intent
- iOS App Store / Play Store packaging
- Hot-reload of the engine during development on a real device

---

## Risk assessment

**Highest risk:** the SyncEngine refactor (steps 3–4).  We're going from
"SyncEngine imports `node:fs` directly" to "SyncEngine takes an `fs`
adapter via constructor."  Every call site needs to thread the adapter
through.  Mitigation: keep the Node default in place so existing tests
catch regressions immediately.

**Medium risk:** `expo-file-system`'s API shape differs from `node:fs`
(URI-based, not path-based; some operations need `EncodingType`).  The
`fsRN.js` adapter has to bridge.  Tests on mocked Expo modules verify
the shape; the real test happens on simulator.

**Low risk:** `expo-crypto` has `digestStringAsync` which is straightforward;
the watcher's interval scan is a well-understood pattern.

---

## Pointers

- `apps/mesh-demo/package.json` for the pinned Expo / RN versions C1 must match
- `packages/react-native/src/` for `VaultRN` / `attachIdentityToAgent` patterns C1 should fit alongside
- [Expo File System docs](https://docs.expo.dev/versions/latest/sdk/filesystem/) — the API surface `fsRN.js` wraps
