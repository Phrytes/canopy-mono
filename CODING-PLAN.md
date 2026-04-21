# Coding plan — extraction groups M through AA

One implementation checklist per group in `EXTRACTION-PLAN.md`. Each section:

- **Ref** — points to the group's section in `EXTRACTION-PLAN.md`.
- **Files** — exact paths to create / modify / delete.
- **Sequence** — ordered steps, test-first where practical.
- **DoD** (definition of done) — what "complete" means.

Groups can be worked independently once their stated dependencies land (see delegation tree in `EXTRACTION-PLAN.md` §7). Every group must satisfy its **Tests** bullets from the extraction plan before it's considered done.

---

## Group M — Core extractions

**Ref:** `EXTRACTION-PLAN.md` §7 Group M.

### Files

Create:
- `packages/core/src/transport/OfflineTransport.js`
- `packages/core/src/routing/invokeWithHop.js`
- `packages/core/src/skills/relayForward.js`
- `packages/core/src/discovery/pullPeerList.js`
- `packages/core/test/transport/OfflineTransport.test.js`
- `packages/core/test/routing/invokeWithHop.test.js`
- `packages/core/test/skills/relayForward.test.js`
- `packages/core/test/discovery/pullPeerList.test.js`
- `packages/core/test/discovery/PeerGraph.clear.test.js`

Modify:
- `packages/core/src/discovery/PeerGraph.js` — add `clear()` method.
- `packages/core/src/discovery/PeerDiscovery.js` — fold `hops === 0` + skip-caller filters into `#registerPeerListSkill`.
- `packages/core/src/index.js` — export the new modules.
- `packages/core/src/skills/index.js` (create if absent) — export `registerRelayForward`.

Delete (in `step1-expo52`):
- `src/relaySkill.js`
- `src/routing/setup.js::setupRouting`, `::registerPeerListSkill` (retain `pullPeerList` temporarily as a re-export during Phase U migration).

### Sequence

1. Write failing tests for `OfflineTransport` → implement (thin subclass of `Transport`, `_put` throws with peer-address slice).
2. Write failing tests for `invokeWithHop` → port the current app version; keep the direct-first, bridges-fallback logic.
3. Write failing tests for `relayForward` covering each policy tier (`never | authenticated | trusted | group:X | always`) → port the app skill; **add** the `authenticated` branch (`agent.security.getPeerKey(from)` check).
4. Write failing tests for `pullPeerList` → port from app.
5. Write test for `PeerGraph.clear()` → implement by calling `backend.delete(k)` for every `peer:` key.
6. Write test for `PeerDiscovery.peer-list` response filter → update skill to filter by `hops === 0` and skip `from`.
7. Export new symbols from `src/index.js`.
8. `cd packages/core && npm test` — green.
9. In `step1-expo52`: swap imports, delete the duplicated files, reboot app, smoke-test direct + hop routing.

### DoD
All six **Tests** bullets from `EXTRACTION-PLAN.md` §Group M pass. `step1-expo52` runs without any imports to the deleted files. `@canopy/core` vitest suite green.

---

## Group N — Core API ergonomics

**Ref:** `EXTRACTION-PLAN.md` §7 Group N. Depends on M.

### Files

Modify:
- `packages/core/src/Agent.js` — add methods `invokeWithHop`, `enableRelayForward`, `startDiscovery`.
- `packages/core/test/Agent.methods.test.js` (create) — coverage for the three new methods.

### Sequence

1. Add `agent.invokeWithHop(peerId, skillId, input, opts)` that delegates to the function export from Group M, wrapping input via `Parts.wrap`.
2. Add `agent.enableRelayForward({ policy } = {})` that:
   - Sets `policy` in `agent.config` if provided.
   - Calls `registerRelayForward(this)` from Group M.
   - Idempotent — if skill already registered, no-op.
3. Add `agent.startDiscovery({ pingIntervalMs, gossipIntervalMs } = {})` that:
   - Instantiates `PeerDiscovery` if not already.
   - Calls `.start()`.
   - Stores handle on a private field; second call is a no-op.
4. Write tests per extraction plan's **Tests** bullets.

### DoD
`agent.invokeWithHop`, `agent.enableRelayForward`, `agent.startDiscovery` are reachable and idempotent. Tests green.

---

## Group O — React-Native permissions

**Ref:** `EXTRACTION-PLAN.md` §7 Group O.

### Files

Create:
- `packages/react-native/src/permissions.js`
- `packages/react-native/test/permissions.test.js`

Modify:
- `packages/react-native/src/index.js` — export `requestMeshPermissions`.

Delete:
- `step1-expo52/src/permissions.js` (after the app is updated to import from the RN package).

### Sequence

1. Copy `step1-expo52/src/permissions.js` → `packages/react-native/src/permissions.js`, rename export to `requestMeshPermissions`.
2. Mock `PermissionsAndroid` and `Platform` in vitest setup.
3. Write tests for Android-granted / partial / denied paths and iOS short-circuit.
4. Update `step1-expo52/src/agent.js` to `import { requestMeshPermissions } from '@canopy/react-native'`.
5. Delete the old app file.

### DoD
Test matrix green. App uses the packaged permission helper.

---

## Group P — Native module packaging

**Ref:** `EXTRACTION-PLAN.md` §7 Group P.

### Files

Create:
- `packages/react-native/android/` — full Gradle module (`build.gradle`, `src/main/AndroidManifest.xml`, Kotlin sources moved from `step1-expo52/android/app/src/main/java/.../`).
- `packages/react-native/android/src/main/java/com/canopy/mdns/MdnsModule.kt` (moved)
- `packages/react-native/android/src/main/java/com/canopy/mdns/MdnsPackage.kt`
- `packages/react-native/android/src/main/java/com/canopy/mdns/MdnsFraming.kt`
- `packages/react-native/android/src/main/java/com/canopy/ble/BlePeripheralModule.kt`
- `packages/react-native/android/src/main/java/com/canopy/ble/BlePeripheralPackage.kt`
- `packages/react-native/android/src/main/java/com/canopy/ble/BackoffPolicy.kt`
- `packages/react-native/android/src/test/kotlin/MdnsFramingTest.kt`
- `packages/react-native/android/src/test/kotlin/BackoffPolicyTest.kt`
- `packages/react-native/ios/` — stub `*.swift` + `*.podspec` (empty modules for future iOS work).
- `packages/react-native/package.json` — declare Android + iOS modules via Expo config plugin or plain autolinking metadata.

Delete:
- Corresponding Kotlin files under `step1-expo52/android/app/src/main/java/com/phrytes/step1expo52/` (the `Ble*`, `Mdns*` files — keep `MainActivity.kt` and `MainApplication.kt`).
- Registration of the moved packages from `MainApplication.kt` (autolinking takes over).

### Sequence

1. Decide package namespace (`com.canopy.*`) and rename Kotlin packages accordingly.
2. Set up a Gradle module under `packages/react-native/android/` that compiles these sources standalone.
3. Write Kotlin unit tests for `MdnsFraming` (encode/decode round-trip, boundary cases) and `BackoffPolicy` (growth curve, cap, reset).
4. Add Expo config-plugin config (or `expo-module.config.json`) so autolinking picks the module up in consumer apps.
5. In `step1-expo52`: run `npx expo prebuild --clean` and verify the modules are autolinked (grep `settings.gradle` for the canopy paths).
6. Smoke-test: build APK, install, verify BLE + mDNS transports still work end-to-end.
7. Create empty iOS stubs + `.podspec` so `pod install` succeeds (modules are no-ops until iOS transports are implemented).

### DoD
Fresh `step1-expo52` prebuild + assembleDebug succeeds without hand-copying native files. BLE + mDNS still operational. Kotlin unit tests green. `pod install` on iOS succeeds (even though transports are stubs).

---

## Group Q — `createMeshAgent` factory

**Ref:** `EXTRACTION-PLAN.md` §7 Group Q and §2. Depends on M, N, O, P.

### Files

Create:
- `packages/react-native/src/createMeshAgent.js`
- `packages/react-native/test/createMeshAgent.test.js`

Modify:
- `packages/react-native/src/index.js` — export `createMeshAgent`.
- `step1-expo52/src/agent.js` — rewrite as thin wrapper (Group U properly; stub now).

### Sequence

1. Port the body of `step1-expo52/src/agent.js::createAgent` into the factory, generalising:
   - `label`, `relayUrl`, `vault` become opts (defaults: `vault = new KeychainVault({ service: 'mesh' })`).
   - `transports: { ble?: boolean, mdns?: boolean }` — default true, allow disabling.
   - Internal: pre-connect mDNS with timeout; `OfflineTransport` as fallback primary; BLE + relay always secondaries.
2. Routing strategy matches today's (BLE by MAC or pubKey → mDNS → relay → offline).
3. PeerGraph backed by `AsyncStorageAdapter`.
4. Do **not** call `enableAutoHello` / `enableRelayForward` / `startDiscovery` — leave those as explicit app choices.
5. Write unit tests with RN modules mocked: each transport-combination matrix, routing outputs, identity restore vs generate.
6. Expose `createMeshAgent` + all underlying transports as escape hatches (export `{ OfflineTransport, BleTransport, MdnsTransport, ... }`).

### DoD
Test matrix green. A trivial `await createMeshAgent({ label, relayUrl })` returns a ready `Agent`. `step1-expo52` factory file can be collapsed to ~15 lines in Group U using this.

---

## Group R — Auto-hello helper

**Ref:** `EXTRACTION-PLAN.md` §7 Group R and §3. Depends on N.

### Files

Modify:
- `packages/core/src/Agent.js` — add `enableAutoHello({ pullPeers, helloTimeout } = {})` method.
- `packages/core/test/Agent.enableAutoHello.test.js` (create).

### Sequence

1. Method installs, on every `t` in `this.#transports`, the same `peer-discovered` listener currently in `step1-expo52/src/agent.js` (MAC dedup set + `getPeerKey` guard for pubKeys).
2. Stores the set of transports it has wired so a second call is a no-op.
3. On new `addTransport` after `enableAutoHello`, also wire that transport.
4. If `opts.pullPeers`, call `pullPeerList` (from M) after each successful hello.
5. Write tests using synthetic transports emitting `peer-discovered` events; assert `agent.hello` / `sendHello` / `pullPeerList` call counts.

### DoD
Idempotent. Tests green per extraction plan's bullets.

---

## Group S — Relay package migration

**Ref:** `EXTRACTION-PLAN.md` §7 Group S.

### Files

Create:
- `packages/relay/src/server.js` — moved from `packages/core/relay-server.js`, refactored to export `startRelay(opts)`.
- `packages/relay/bin/relay.js` — thin CLI that reads env (`PORT`, `TLS_CERT`, `TLS_KEY`) and calls `startRelay`.
- `packages/relay/test/integration.test.js` — server spin-up, register/send round-trip, offline queue, TLS.

Modify:
- `packages/relay/package.json` — add bin entry, vitest script, TLS cert fixture paths.
- `packages/relay/src/index.js` — re-export `startRelay`.

Delete:
- `packages/core/relay-server.js` after the move.

### Sequence

1. Move `relay-server.js` to `packages/relay/src/server.js`; refactor into `startRelay({ port, tlsCert, tlsKey, serveStaticDir })` returning `{ httpServer, wss, stop() }`.
2. Add conditional HTTPS mode when cert + key provided (Node `https.createServer`).
3. Create `packages/relay/test/fixtures/` with self-signed cert for TLS tests (script to regenerate noted in README).
4. Write vitest integration tests per extraction plan's bullets.
5. Add `bin/relay.js` for CLI usage; update start scripts.
6. Remove `relay-server.js` from core; update any docs referencing the old path.

### DoD
`npx @canopy/relay` starts the server on default port. `wss://` works when cert provided. All tests green.

---

## Group T — Oracle bridge model

**Ref:** `EXTRACTION-PLAN.md` §7 Group T and §5.
**Design doc:** `Design-v3/oracle-bridge-selection.md` — claim format, signature, canonicalisation, TTL, threats, API. Must be approved before T2 implementation starts.

**Dependencies:** M (invokeWithHop, PeerGraph), N (Agent method conventions). Optional: Y phase-9 assertion needs T.

**Outcome:** when a fresh signed reachability claim is available, `invokeWithHop` picks the correct bridge on the *first* try. Probe-retry remains as cold-start / stale-cache fallback. No existing API breaks.

### Sub-phases

Break Group T into 6 sub-phases, each self-contained and independently testable. Ship them in order; each commits green.

#### T1 — Design decisions *(doc-only commit)*

Resolved in `Design-v3/oracle-bridge-selection.md` §10 (2026-04-21):

- **T1-a · `MAX_PEERS` default = 256**; override via `enableReachabilityOracle({ maxPeers })` or `oracle.maxPeers` in the agent definition file.
- **T1-b · Receiver-anchored TTL** — signed body carries `t` (ttlMs) + `s` (monotonic sequence). No wall-clock comparison between issuer and receiver. Sequence replay guard supersedes the absolute-expiry / clock-skew approach.
- **T1-c · Volatile cache only**; producer re-signs when within `refreshBeforeMs` of expiry. Both `ttlMs` and `refreshBeforeMs` tunable in code and via the agent definition file (`oracle.ttlMs`, `oracle.refreshBeforeMs`).
- **T1-d · Share only `canonicalize()`** with `CapabilityToken`; no new higher-level helper.

Commit is docs-only: the design doc plus this plan update. No code.

#### T2 — Canonical sign/verify helpers

Files:
- `packages/core/src/security/reachabilityClaim.js`
- `packages/core/test/reachabilityClaim.test.js`

Exports:
```js
signReachabilityClaim(identity, peerPubKeys, { ttlMs, seqStore }) → { body, sig }
//   seqStore = { read(): Promise<number>, write(n): Promise<void> }
//              Defaults to an in-memory counter seeded with Date.now().

verifyReachabilityClaim(claim, {
  expectedIssuer,
  lastSeenSeq,     // number | undefined; undefined = first time
  maxPeers, maxTtlMs, maxBytes,
}) → { ok: true, newLastSeq: number }
   | { ok: false, reason: string }
```

The signed body is `{ v, i, p, t, s }` (see design doc §2). `canonicalize()` from `core/Envelope.js` is reused for determinism; no new canonicaliser.

Tests (minimum):
- Sign then verify round-trip → `ok: true`, `newLastSeq === body.s`.
- Tampered `p` / `t` / `s` / `i` → each fails with a distinct `reason`.
- Wrong `expectedIssuer` → rejected (reflection guard).
- Replay: `claim.body.s <= lastSeenSeq` → rejected as replay; `lastSeenSeq` unchanged.
- Strictly newer claim (`s = lastSeenSeq + 1`) → accepted, `newLastSeq` bumped.
- `t <= 0` or `t > maxTtlMs` → rejected.
- Oversize `p` (`> maxPeers`) → rejected.
- Oversize serialised payload (`> maxBytes`) → rejected.
- Version byte ≠ `1` → rejected.
- `p` not sorted in the signed body → rejected (determinism guarantee).
- Signer uses `seqStore` correctly: two consecutive `signReachabilityClaim` calls produce strictly increasing `s`, even if the wall clock is frozen between them (simulate by mocking `Date.now`).
- Signer tolerates a backwards wall-clock jump: mock `Date.now` to return a value *smaller* than `lastSignedSeq`, expect the next `s` to be `lastSignedSeq + 1` (never decreases).

#### T3 — `reachable-peers` skill + `agent.enableReachabilityOracle()`

Files:
- `packages/core/src/skills/reachablePeers.js`
- `packages/core/test/reachablePeers.test.js`

Modify:
- `packages/core/src/Agent.js` — add `agent.enableReachabilityOracle({ ttlMs, refreshBeforeMs, maxPeers })` method.

Config resolution for every knob: **explicit code arg → `agent.config.get('oracle.<name>')` → built-in default.** So all three can be set via `AgentConfig` overrides (i.e. the agent definition file) and the method call can override that when needed.

Defaults: `ttlMs = 5 * 60_000`, `refreshBeforeMs = 60_000`, `maxPeers = 256`.

Behaviour:
- Method registers the skill (idempotent).
- Skill handler returns `[DataPart({ body, sig })]`. Caches the claim, re-signing when (a) the direct-peer set changes, (b) the cached claim has `≤ refreshBeforeMs` of its `ttlMs` left (measured from the producer's own `signedAt`), or (c) there is no cached claim yet.
- Listens to `peer` and `peer-disconnected` events to invalidate the cache.
- Respects `maxPeers` by truncating the direct-peer list deterministically (lexicographic on pubKey) before signing.

Tests:
- Calling the skill returns a claim verifiable by the issuer's pubKey (using `verifyReachabilityClaim` from T2).
- Repeated calls in quick succession return the *same* cached body (byte-equal). The `s` (sequence) therefore doesn't bump until a real refresh is due.
- After a `peer` event, the next call returns a *different* claim — a higher `s` and the new peer in `p`.
- After `peer-disconnected`, the removed peer is gone from the next claim.
- `refreshBeforeMs` observed: simulate time passage by mocking `Date.now`; confirm re-sign fires when remaining TTL drops below the threshold.
- `maxPeers: 5` with 10 direct peers — claim contains exactly 5, truncated in deterministic order.
- Values from `AgentConfig` (`oracle.ttlMs`, `oracle.refreshBeforeMs`, `oracle.maxPeers`) flow through when the method is called with no code args.
- Explicit code args win over `AgentConfig` values.
- `enableReachabilityOracle()` is idempotent.

#### T4 — Graph storage

Modify:
- `packages/core/src/discovery/PeerGraph.js` — document `knownPeers`, `knownPeersTs`, `knownPeersSig` in the record shape; make sure the existing `upsert` spread-merge handles them without duplication.

Files to add:
- `packages/core/test/PeerGraph.knownPeers.test.js` (minor — existing tests cover most merging logic).

**Important:** `knownPeersTs` here is the **receiver's own `receivedAt + ttlMs`** — the locally-computed moment at which the claim stops being fresh. It is *not* a wall-clock timestamp set by the issuer; that distinction is what protects us from issuer/receiver clock skew (see design doc §2 T1-b). The `knownPeersSeq` field stores `body.s` and drives replay detection on the next arrival.

Shape additions on the record:
- `knownPeers: string[]` — accepted peer list from the latest claim
- `knownPeersTs: number` — `receivedAt + body.t` (local ms); consult with `now_local` to decide freshness
- `knownPeersSeq: number` — the issuer's `s` from the latest accepted claim; used as `lastSeenSeq` on the next verification
- `knownPeersSig?: string` — optional, retained for debugging / re-broadcast

Tests:
- Upserting a record with `knownPeers` + `knownPeersTs` persists all three fields.
- A second upsert with a newer `knownPeersSeq` replaces the array; lower `knownPeersSeq` is ignored.
- Upserting without `knownPeers` doesn't clobber an existing set.
- Freshness check: `now_local < knownPeersTs` → fresh; `now_local ≥ knownPeersTs` → stale.

#### T5 — Oracle-aware bridge selection in `invokeWithHop`

Modify:
- `packages/core/src/routing/invokeWithHop.js` — before walking the existing bridges list, build an "oracle list" from direct peers whose `knownPeers` contains the target AND whose `knownPeersTs > Date.now()` (receiver-anchored expiry, per T1-b). Concatenate `[...oracleBridges, record.via, ...remainingDirectPeers]` (de-duped).

Files to add:
- `packages/core/test/invokeWithHop.oracle.test.js`

Tests:
- Given a PeerGraph where peer B has `knownPeers: [T]` and `knownPeersTs` in the future, `invokeWithHop(T, ...)` calls `relay-forward` on B *first*.
- Given the same graph but B's `knownPeersTs` already in the past (`<= now`), B is NOT prioritised — falls back to probe-retry order.
- Given two direct peers with a valid oracle hit for T, both appear before non-oracle peers in the try order (stable order between oracle candidates — lexicographic on pubKey for determinism).
- If the oracle-picked bridge returns `target-unreachable`, we still fall through to probe-retry candidates — no regression.
- Zero oracle data → behaves exactly like probe-retry (Group M behaviour preserved).

#### T6 — Gossip pulls claims alongside peer-list

Modify:
- `packages/core/src/discovery/GossipProtocol.js` — after the existing `peer-list` call in `runRound`, also call `reachable-peers`, verify it with `lastSeenSeq = existing.knownPeersSeq`, and on success upsert `knownPeers`, `knownPeersTs = Date.now() + body.t`, `knownPeersSeq = body.s`, and `knownPeersSig`.

Files to add:
- `packages/core/test/GossipProtocol.oracle.test.js`

Tests:
- A round against a peer that has the oracle enabled populates `knownPeers` + `knownPeersTs` + `knownPeersSeq` on that peer's record in the caller's graph.
- A round against a peer *without* the oracle (skill absent) is benign — no throw, no graph mutation.
- A round that receives a malformed or size-exceeded claim emits `reachability-claim-rejected` and does not mutate the graph.
- A replay (same `s` returned twice) is rejected the second time: `knownPeersSeq` must not double-count, but no error bubbles.
- Newer `knownPeersSeq` replaces older; an older one is rejected as replay and ignored.

### DoD

All six sub-phases land as individual commits. Each commit is green against the full core suite + every existing integration test. Y phase-9 (see Group Y below) adds a call-order assertion that fails if the oracle ever mis-picks.

---

## Group U — mesh-chat app rewrite

**Ref:** `EXTRACTION-PLAN.md` §7 Group U and §6. Depends on Q, R.

### Files

Rename:
- `step1-expo52/` → `mesh-chat/` (directory).

Modify:
- `mesh-chat/src/agent.js` — collapse to ~15 lines using `createMeshAgent`, `enableAutoHello`, `enableRelayForward`, `startDiscovery`.
- `mesh-chat/src/routing/invokeWithHop.js` — delete (re-export from `@canopy/core`).
- `mesh-chat/src/relaySkill.js` — delete.
- `mesh-chat/src/permissions.js` — delete.
- `mesh-chat/package.json` — rename `name`, update deps, remove direct native module imports now handled by autolinking.

Keep (app-layer):
- `src/screens/*`
- `src/hooks/usePeers.js`
- `src/context/AgentContext.js`
- `src/store/messages.js`, `src/store/settings.js`
- `src/receive-message` skill registration (wherever it ends up).

Create:
- `mesh-chat/test/` — tests per extraction plan's bullets.

### Sequence

1. Rename directory; update `pnpm-workspace.yaml` / `package.json` references.
2. Rewrite `src/agent.js` as the ~15-line factory wrapper.
3. Delete files that moved to SDK packages.
4. Fix imports in remaining files to point to the SDK.
5. Run tests + manual smoke test (hop routing, forget/re-hello, direct messages).
6. Verify line-count target (~300 lines of actual app code).

### DoD
Phone app boots, hops work, app's LOC roughly one-third of pre-extraction. `mesh-chat` tests green.

---

## Group Y — End-to-end integration demo + test

**Ref:** `EXTRACTION-PLAN.md` §7 Group Y. Depends on M, N, Q, R; optional V, W, T.

### Files

Create:
- `packages/core/test/integration/mesh-scenario.test.js` — the vitest version of the three-agent scenario.
- `packages/core/test/integration/LoopbackTransport.js` — test-only transport that simulates BLE-style point-to-point.
- `examples/mesh-demo/` — runnable Node.js demo:
  - `examples/mesh-demo/package.json`
  - `examples/mesh-demo/index.js`
  - `examples/mesh-demo/README.md`

Modify:
- Root `package.json` — add `demo:verify` script that runs the demo and asserts exit code 0.

### Sequence

1. Implement `LoopbackTransport` — two instances share a shared queue + events.
2. Write phases 1–6 first (base mesh scenario); mark 7, 8, 9 as `test.skip` until V, W, T land.
3. Factor phase setup into helpers so the `examples/mesh-demo/` script imports the same steps and logs each one to console.
4. Un-skip phases 7 and 8 as V and W land.
5. Un-skip phase 9 when T lands — assert that the *first* `relay-forward` invocation after a gossip round targets the oracle-picked bridge (Bob, not another direct peer).
6. Wire `npm run demo:verify` in CI.
7. Write `examples/mesh-demo/README.md` with the manual-smoke-test variant (two phones + a laptop).

### Phase 9 — oracle bridge (gated on Group T)

- All three agents call `enableReachabilityOracle()` after hello.
- Run one gossip round so Alice's graph has Bob's signed `knownPeers` (including Carol).
- Spy on `agent.invoke` calls made inside `invokeWithHop`. Alice calls `invokeWithHop(Carol, 'receive-message', [TextPart('oracle')])`.
- **Assertion:** the first `relay-forward` invocation's target is Bob. No other direct peer is tried first. This guarantees probe-retry was skipped — the oracle picked correctly.
- Follow-up within the same phase: manually expire Bob's claim (`knownPeersTs = 0`). Send another message. The call must still succeed but now goes through the probe-retry fallback. This proves oracle staleness degrades gracefully.

### DoD
CI runs the scenario on every PR. Demo script runs locally with `node examples/mesh-demo/index.js`. Phases 7, 8, 9 auto-enable when V, W, T are available.

---

## Group V — BLE store-and-forward

**Ref:** `EXTRACTION-PLAN.md` §7 Group V and §8. No internal deps.

### Files

Modify:
- `packages/react-native/src/transport/BleTransport.js` — add `#pendingForPeer` buffer + drain logic.
- `packages/react-native/test/BleTransport.buffer.test.js` (create).

### Sequence

1. Add `#pendingForPeer: Map<pubKey, Array<{envelope, enqueuedAt}>>` field.
2. Constructor accepts `bufferMaxPerPeer` (default 50), `bufferTtlMs` (default 300 000).
3. In `_put`: if neither `#centralPeers` nor `#peripheralByPubKey` has `to`, push `{envelope, enqueuedAt: Date.now()}` onto the peer's queue; emit `buffered` event with `{ to, queueSize }`; resolve.
4. Drain: on `peer-discovered` after re-key (both central-mode and peripheral-mode re-keying paths), call `#drainBuffer(pubKey)` which:
   - Filters out items past `bufferTtlMs`.
   - Calls `#doWrite(pubKey, payload)` sequentially for remaining items.
   - Preserves the existing write-queue semantics.
5. On overflow (len > `bufferMaxPerPeer`), drop the oldest before pushing the new item.
6. Ensure `forgetPeer` clears the buffer for that peer.
7. Tests per extraction plan's bullets. Key assertions: no re-encryption on drain, FIFO order, overflow drop-oldest, TTL expiry.

### DoD
Reconnect-after-flap delivers buffered messages. Extraction plan's six test bullets green.

---

## Group W — Hello gate (opt-in)

**Ref:** `EXTRACTION-PLAN.md` §7 Group W and §8. No internal deps.

### Files

Create:
- `packages/core/src/security/helloGates.js` — `tokenGate`, `groupGate`, `anyOf`.
- `packages/core/test/security/helloGates.test.js`
- `packages/core/test/protocol/helloGate.test.js`

Modify:
- `packages/core/src/Agent.js` — add `setHelloGate(fn)` method, store gate on agent.
- `packages/core/src/protocol/hello.js::handleHello` — call `agent.helloGate` (default `() => true`) before doing anything else. On `false`: silent return.
- `packages/core/src/Envelope.js` or `Parts` — document `authToken` payload field (no schema change needed, just a convention).

### Sequence

1. Add `agent.setHelloGate(fn)`; default gate returns true (preserves today's behaviour — backward-compat test).
2. In `handleHello`: wrap the gate call in try/catch, treat throws as `false` (fail-closed).
3. If gate returns `false`: return immediately; do not register key, do not emit `peer`, do not ack.
4. Implement `tokenGate(secret)`, `groupGate(groupIds, groupManager)`, `anyOf(...)` in `helloGates.js`.
5. Tests per extraction plan's bullets. Focus on the silent-drop assertion and the backward-compat (no gate set).

### DoD
Default-off: every existing test still passes. With gate set, rejection is silent and indistinguishable from timeout.

---

## Group X — Group-visible skills

**Ref:** `EXTRACTION-PLAN.md` §7 Group X and §8. Depends on M.

### Files

Modify:
- `packages/core/src/skills/SkillRegistry.js` and `defineSkill.js` — accept `visibility: { groups: string[], default: 'hidden' | 'visible' }`.
- `packages/core/src/protocol/taskExchange.js::handleTaskRequest` — when skill has `groups`, verify via `agent.security.groupManager.hasValidProof(from, groupId)`. Non-member: return `Unknown skill: <id>`.
- `packages/core/src/protocol/skillDiscovery.js` — filter skills per caller.
- `packages/core/src/Agent.js::export` — filter skill list when called from a skill context.
- `packages/core/src/skills/peerListSkill.js` (the filter skill from M) — add `includeGroup` option.

Create:
- `packages/core/test/skills/groupVisibility.test.js`

### Sequence

1. Extend `defineSkill` / `SkillRegistry` to accept the new visibility object while keeping the scalar `'public' | 'authenticated' | 'private'` working.
2. In `handleTaskRequest`, when skill has `groups`, verify proof before executing; non-members get `Unknown skill` response (not "not-authorised" — preserves don't-reveal-existence).
3. Filter `skillDiscovery` responses per caller (same proof check).
4. Extend `agent.export()` to take an optional caller pubKey and filter.
5. Update `peer-list` skill to accept `includeGroup` option.
6. Tests per extraction plan's bullets.

### DoD
Group-scoped skills are invisible to non-members in both export and discovery. Existing scalar visibility untouched.

---

## Group Z — Origin signature verification

**Ref:** `EXTRACTION-PLAN.md` §7 Group Z. Depends on M.

### Files

Create:
- `nkn-test/Design-v3/origin-signature.md` — answer the three open design questions (canonical form, timestamp inclusion, token interaction).
- `packages/core/src/security/originSignature.js` — `signOrigin(payload, targetPubKey, skillId, ts)` / `verifyOrigin(envelope, expectedPubKey)` helpers.
- `packages/core/test/security/originSignature.test.js`

Modify:
- `packages/core/src/protocol/taskExchange.js::callSkill` — accept `opts.sign = true` (default true when `opts.origin` is set); compute `_originSig` before placing it into the RQ payload.
- `packages/core/src/protocol/taskExchange.js::handleTaskRequest` — verify `_originSig` when present; on failure emit `security-warning` and fall back to `envelope._from`.
- `packages/core/src/skills/relayForward.js` (from M) — preserve the original `_origin` + `_originSig` through the hop instead of re-signing.
- `packages/core/src/routing/invokeWithHop.js` — sign origin before forwarding.

### Sequence

1. **Design doc first.** Write `origin-signature.md` resolving canonicalisation, ts coverage, relation to `_token`.
2. Implement `signOrigin` / `verifyOrigin` helpers + tests.
3. Extend `callSkill` to include `_originSig`.
4. Extend `handleTaskRequest` verification with fall-back + `security-warning` emission.
5. Update `relayForward` to not re-sign (preserves multi-hop chain).
6. Update `invokeWithHop` to sign.
7. Tests per extraction plan's bullets. Special attention: tampering, expired, missing (backward-compat with unsigned callers).

### DoD
Signed origin is verified end-to-end; tampered or missing sigs degrade attribution gracefully with a warning. Multi-hop preserves the original sig.

---

## Group AA — Relay rendezvous (WebRTC)

**Ref:** `EXTRACTION-PLAN.md` §7 Group AA. Depends on S.

### Files

Create:
- `nkn-test/Design-v3/rendezvous-mode.md` — schema for `webrtc-signal` envelopes, STUN/TURN config, reconnection, DataChannel framing.
- `packages/core/src/transport/RendezvousTransport.js` — implements signalling + DataChannel setup.
- `packages/core/test/transport/RendezvousTransport.test.js` — uses `wrtc` in Node for tests.

Modify:
- `packages/core/package.json` — `peerDependencies: { "wrtc": "*" }` (optional).
- `packages/core/src/Agent.js` — optional auto-upgrade: when both peers advertise rendezvous capability, swap the active transport from `RelayTransport` to `RendezvousTransport` for that peer.

### Sequence

1. **Design doc first.** Answer signalling schema, STUN/TURN defaults, framing (reuse BLE's 4-byte length prefix or plain JSON over DataChannel), reconnect strategy.
2. Implement `RendezvousTransport` that:
   - Accepts a `RelayTransport` as signalling channel.
   - Initiates via `RTCPeerConnection` + `createDataChannel`.
   - Wraps SDP/ICE in OW envelopes with `payload.type: 'webrtc-signal'`.
   - Once DataChannel opens, routes `_send` / `_receive` through it.
3. Add capability handshake (peer advertises `rendezvous: true` in hello payload) so both sides know to attempt upgrade.
4. On DataChannel close: tear down, revert to `RelayTransport` for that peer, optionally retry signalling after backoff.
5. Write tests using `wrtc` in Node: handshake, round-trip, fallback on failure, reconnect after close.

### DoD
Two Node agents establish a DataChannel via the test relay and round-trip an RQ/RS. Fallback path works. Relay server code unchanged.

---

## Overall working order (recommended)

Safe order that avoids circular blockers:

```
1. M → N   (pure-JS foundation)
2. O → P   (RN foundations, parallel with M)
3. Q       (ties M/N/O/P together)
4. R       (ergonomics on top of N)
5. S       (relay package, independent)
6. U       (app rewrite — uses M, N, Q, R)
7. Y       (integration demo — validates 1-6)
8. V, W    (new capabilities, parallel, no deps on each other)
9. Y (update) — enable phases 7, 8 in the integration scenario
10. T       (oracle — design doc first)
11. Z       (origin sig — design doc first)
12. X       (group-visible skills — only when product feature demands it)
13. AA      (rendezvous — design doc first)
```

Design docs for T, Z, AA must be written and reviewed before any implementation starts. Every group merges only after its **Tests** (per extraction plan) are green and reviewed.
