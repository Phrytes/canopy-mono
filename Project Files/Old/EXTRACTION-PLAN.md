# step1-expo52 → SDK packages: extraction plan

## Goal

Distil `step1-expo52` into two parts:
1. Reusable SDK code → `@canopy/core`, `@canopy/react-native`, `@canopy/relay`
2. A lean mesh-chat app on top of the SDK

The debugging done in this repo surfaced a lot of "every mesh app will need this" logic. Pull that into the SDK; keep only UI + app-specific skills in the demo.

---

## Vision decisions (recorded)

1. **`@canopy/react-native` is opinionated.** Ship `createMeshAgent({ relayUrl, label, vault? })` that wires BLE + mDNS + relay + offline-fallback with the defaults we spent this session fixing.
2. **`agent.invoke()` stays direct.** Hop-aware invoke is a separate, opt-in function/method (`agent.invokeWithHop(...)`).
3. **`agent.enableAutoHello()`** is an opt-in method that installs `peer-discovered → hello (+ optional pullPeerList)` on every transport. Apps that want selective hello per event don't call it.
4. **Add `'authenticated'` as a policy tier.** Any hello'd peer (tier ≥ 1) passes `allowRelayFor: 'authenticated'` policy checks. Retains `'trusted'` (explicit TrustRegistry elevation to tier 2) for stricter apps.
5. **Oracle model is the target for bridge selection** (see §5). Ship probe-retry today as the transitional implementation; oracle supersedes it.

---

## Package roles

| Package | Platform | Scope |
|---|---|---|
| `@canopy/core` | Pure JS | Protocol, security, skills, PeerGraph, Transport base, routing primitives |
| `@canopy/react-native` | RN-only | Native transports (BLE, mDNS), KeychainVault, AsyncStorageAdapter, permission flow, **`createMeshAgent` factory**, bundled native Kotlin/Swift modules |
| `@canopy/relay` | Node-only | Relay/rendezvous WS server (static broker today; TLS + rendezvous later). The current `packages/core/relay-server.js` **moves here**. |

---

## 1. No-brainers (mechanical moves)

All of these are clear extractions with zero platform coupling or policy implications. Ship first.

| step1-expo52 file / symbol | Destination | Notes |
|---|---|---|
| `agent.js::OfflineTransport` | `@canopy/core/transport/OfflineTransport.js` | Tiny, generic |
| `relaySkill.js` | `@canopy/core/skills/relayForward.js` | Expose as `registerRelayForward(agent, { policy })` **and** `agent.enableRelayForward({ policy })`. Add `'authenticated'` policy tier here. |
| `routing/invokeWithHop.js` | `@canopy/core/routing/invokeWithHop.js` | Function export **and** `agent.invokeWithHop(...)` method. Don't merge into `agent.invoke` — per vision decision #2. |
| `routing/setup.js::pullPeerList` | `@canopy/core/discovery/pullPeerList.js` | Generic helper |
| `routing/setup.js::registerPeerListSkill` | Delete (duplicate) — merge the `hops === 0` + skip-caller filters into core's existing `PeerDiscovery.#registerPeerListSkill` | |
| `routing/setup.js::setupRouting` | Delete — replace with `agent.startDiscovery({ pingIntervalMs, gossipIntervalMs })` method in core | |
| `permissions.js` | `@canopy/react-native/permissions.js` | Export `requestMeshPermissions()` |
| `android/app/src/main/.../MdnsModule.kt` + `BlePeripheralModule.kt` + supporting files | `@canopy/react-native/android/` so Expo autolinking picks them up | **Packaging work — mandatory before RN package is publishable.** Mirror expected in `ios/` when iOS support lands. |
| `packages/core/relay-server.js` | `@canopy/relay/src/server.js` | Core becomes truly platform-pure |
| `peerGraph.clear()` | New method on core's `PeerGraph` | Useful for "wipe mesh memory" UX |

---

## 2. `createMeshAgent` factory (vision item)

Lives in `@canopy/react-native`. Absorbs `step1-expo52/src/agent.js` setup logic.

```js
import { createMeshAgent } from '@canopy/react-native';

const agent = await createMeshAgent({
  label:    'mesh-phone',
  relayUrl: 'ws://192.168.1.50:8787',   // optional
  vault:    new KeychainVault({ service: 'mesh-demo' }),  // optional
  transports: { ble: true, mdns: true }, // default true; set false to disable
});
```

What it encapsulates (all session-fixes baked in):

- Identity restore-or-generate from vault
- `requestMeshPermissions()` before constructing native transports
- Pre-connect mDNS with timeout; null on failure
- `OfflineTransport` as safe primary fallback
- BLE + relay always added as secondaries via `addTransport`
- Routing strategy: BLE (by MAC or pubKey) → mDNS → relay → offline
- PeerGraph with `AsyncStorageAdapter`
- Deduped `peer-discovered` wiring handled internally if `enableAutoHello` is called later
- BLE write queue, `onDisconnected` cleanup, `#doWrite` error recovery (already in `BleTransport` — just ensuring factory uses the fixed class)

Escape hatch: the factory returns a regular `Agent`, so anything the app needs can be added after (`agent.addTransport`, `agent.register`, etc.).

---

## 3. `agent.enableAutoHello()` (vision item)

Opt-in method, lives on `Agent` in core. Replaces the ~30-line block that every app currently writes in its `peer-discovered` handler.

```js
agent.enableAutoHello({
  pullPeers: true,         // also call pullPeerList after each successful hello
  helloTimeout: 15_000,
});
```

Installs a listener on every attached transport. For each `peer-discovered`:

- If MAC address (BLE): calls `transport.sendHello()` with dedup on MAC
- If pubKey: guards on `agent.security.getPeerKey()` before calling `agent.hello()`
- On success, optionally pulls the peer's peer-list

Matches vision decision #3: apps that want selective hello just don't call this method.

---

## 4. `'authenticated'` policy tier (vision item)

Today the `relay-forward` policy check:

```js
if (policy === 'trusted') {
  if (tierLevel < TIER_LEVEL.trusted) return [DataPart({ error: 'relay-denied' })];
}
```

Adds:

```js
if (policy === 'authenticated') {
  if (!agent.security.getPeerKey(from)) return [DataPart({ error: 'relay-denied: not hello\'d' })];
}
```

Semantics:

| Policy value | Accepts caller if… |
|---|---|
| `'never'` | never (default) |
| `'authenticated'` | caller has completed a hello (tier ≥ 1) — **new, recommended default for mesh apps** |
| `'trusted'` | caller elevated to tier `'trusted'` (≥ 2) via TrustRegistry |
| `'group:X'` | caller has a valid group-X membership proof |
| `'always'` | anyone (dev/testing only) |

`createMeshAgent` defaults `allowRelayFor: 'authenticated'`. Change from today's `'always'` workaround (which was only needed because `'trusted'` required a TrustRegistry we never wired).

---

## 5. Oracle bridge-selection model (vision target)

### Today: probe-retry (ships as interim)

`invokeWithHop` tries `record.via` first, then other direct peers in order. Bad bridges reply `target-unreachable`; we catch and move on. Wasteful but simple.

### Target: signed reachability oracle

Each peer publishes and gossips a **signed list of its direct peers**. Other peers cache these lists and use them to pick the correct bridge the first time.

**Protocol** (fully specified in `Design-v3/oracle-bridge-selection.md`):

- `reachable-peers` skill returns `{ body: { v, i, p, t, s }, sig }` where the body's `t` is a **relative TTL in ms** (receiver-anchored) and `s` is a **monotonic sequence number** for replay detection. Ed25519 signature over `canonicalize(body)`. No wall-clock comparison between issuer and receiver — designed to be immune to clock skew.
- Each peer refreshes its own signed claim when its direct-peer set changes or when `refreshBeforeMs` of the claim's TTL remain.
- `PeerGraph` records `knownPeers`, `knownPeersTs` (the receiver's local "valid until" computed at arrival), and `knownPeersSeq` (last accepted issuer sequence, used as the replay guard on the next verify).
- `invokeWithHop` uses the oracle first: find direct peers whose `knownPeers` contains the target AND whose `knownPeersTs > Date.now()`. Fall back to probe-retry for staleness / missing data.

**Why oracle over probe-retry in the long run:**

- O(1) correct bridge pick instead of O(n) probing
- Less relay traffic (no wasted forward attempts)
- Better UX on flaky links (no "failed via peer X, retrying via Y" delays)
- Trust chain is explicit and verifiable (signed claims)

**Migration path**: ship probe-retry behind `invokeWithHop` now (done — Group M), add oracle as an oracle-first layer so `invokeWithHop` prefers cached claims when available and falls back to probe-retry. Apps see no API change.

**Tunables** (code arg → `AgentConfig` `oracle.*` → default):
`ttlMs` (5 min), `refreshBeforeMs` (60 s), `maxPeers` (256), `maxTtlMs` (10 min), `maxBytes` (256 KB).

---

## 6. Stays app-layer (`step1-expo52` / future mesh-chat)

| File | Why it's app-level |
|---|---|
| `screens/*` | UI — 100% app concern |
| `hooks/usePeers.js` | React binding specific to this app's shape |
| `context/AgentContext.js` | React lifecycle + app-chosen status model |
| `store/messages.js` | Chat-app domain; a file-share app would have a different store |
| `store/settings.js` | Per-app user prefs |
| `receive-message` skill | Chat-specific; different apps register different skills |

**Target app shape** (sketch):

```js
// src/agent.js in the future mesh-chat app — ~15 lines
import { createMeshAgent, KeychainVault } from '@canopy/react-native';

export async function createAgent({ relayUrl }) {
  const agent = await createMeshAgent({
    label:    'mesh-phone',
    relayUrl,
    vault:    new KeychainVault({ service: 'mesh-demo' }),
  });
  agent.enableRelayForward({ policy: 'authenticated' });
  agent.enableAutoHello({ pullPeers: true });
  agent.startDiscovery({ gossipIntervalMs: 15_000 });
  return agent;
}
```

Plus the usual React screens, the `receive-message` skill, `AgentContext`, and stores.

---

## 7. Delegation groups

Each group can be implemented independently once its dependencies are done.
Matches the convention used in `IMPLEMENTATION-PLAN.md`.

**Universal requirement: every group ships with tests.** No group is considered complete without unit tests covering its public API and at least one integration test that wires it into an `Agent` end-to-end. Core and relay tests use `vitest` (already configured). React-native tests use `@testing-library/react-native` for anything touching RN components; pure JS logic in the RN package can still use `vitest` in Node with mocked native modules. Every group section below includes an explicit **Tests** bullet list with the minimum coverage.

```
Group M  Core extractions         (no internal deps)
Group N  Core API ergonomics      (depends: M)
Group O  React-Native permissions (no internal deps)
Group P  Native module packaging  (no internal deps)
Group Q  createMeshAgent factory  (depends: M, N, O, P)
Group R  Auto-hello helper        (depends: N)
Group S  Relay package migration  (no internal deps on this plan;
                                    depends on core Transport)
Group T  Oracle bridge model      (depends: M, N — needs design doc first)
Group U  mesh-chat app rewrite    (depends: Q, R)
Group Y  Integration demo + test  (depends: M, N, Q, R; optional V, W, T)
Group V  BLE store-and-forward    (no internal deps; builds on BleTransport)
Group W  Hello gate (opt-in)      (no internal deps)
Group X  Group-visible skills     (depends: M; revisit when a product
                                    feature concretely needs scoped subsets)
Group Z  Origin signature         (depends: M — hardens the unverified
                                    _origin field shipped in this session)
Group AA Relay rendezvous (WebRTC)(depends: S — relay becomes signalling
                                    server for P2P data channels)
```

### Group M — Core extractions (no internal deps)

Mechanical moves of pure-JS code from `step1-expo52` and elsewhere into `@canopy/core`. Low-risk, ship first.

- `OfflineTransport` → `core/transport/OfflineTransport.js`
- `invokeWithHop` → `core/routing/invokeWithHop.js` (function export)
- `relayForward` skill → `core/skills/relayForward.js` **with `'authenticated'` policy tier added**
- `pullPeerList` → `core/discovery/pullPeerList.js`
- `peerGraph.clear()` — new method on `PeerGraph`
- Merge the `hops === 0` + skip-caller filters into core's existing `PeerDiscovery.#registerPeerListSkill`
- Delete the now-duplicate code from `step1-expo52/src/routing/setup.js` and `step1-expo52/src/relaySkill.js`

**Tests.**
- `OfflineTransport`: `_put` throws with the peer address substring.
- `invokeWithHop`: direct-succeeds path, direct-fails-bridge-succeeds path, all-bridges-refuse path, `hops>0` skipDirect path, hello-fallback path when key missing.
- `relayForward` skill: each of `'never' | 'authenticated' | 'trusted' | 'group:X' | 'always'` accepts/denies correctly; forwards payload; returns `forwarded:true` on success; returns `error` shapes on each failure mode.
- `pullPeerList`: populates graph as `hops:1, via:`; skips self + direct-peer; doesn't downgrade a direct record.
- `peerGraph.clear()`: empties the backend; `all()` returns `[]` after.
- `peer-list` skill filter: only direct peers; skips caller's own pubKey; respects `discoverable:false`.

### Group N — Core API ergonomics (depends: M)

Surface Group M's exports as `Agent` methods so app code reads naturally.

- `agent.invokeWithHop(peerId, skillId, parts, opts)` — thin wrapper over the function
- `agent.enableRelayForward({ policy })` — registers the skill with config
- `agent.startDiscovery({ pingIntervalMs, gossipIntervalMs })` — replaces `setupRouting`

**Tests.**
- `agent.invokeWithHop` delegates to the function export with the correct args.
- `agent.enableRelayForward()` registers the skill idempotently (calling twice doesn't double-register).
- `agent.startDiscovery()` creates and starts a `PeerDiscovery`; calling again is a no-op; passes interval opts through.

### Group O — React-Native permissions (no internal deps)

- `permissions.js` → `@canopy/react-native/permissions.js`
- Export `requestMeshPermissions()`

**Tests.**
- `vitest` with a mocked `PermissionsAndroid`: granted → `{ ble: true, location: true }`; partial → reports the right booleans; denied → `{ ble: false, location: false }`.
- iOS code path (when it exists) short-circuits to `{ ble: true }` without hitting Android API.

### Group P — Native module packaging (no internal deps)

Infra work, non-trivial. Required before the RN package is publishable.

- Move `MdnsModule.kt`, `MdnsPackage.kt`, `MdnsFraming.kt` → `@canopy/react-native/android/`
- Same for `BlePeripheralModule.kt`, `BlePeripheralPackage.kt`, `BackoffPolicy.kt`
- Configure Expo autolinking so apps pick them up automatically (no hand-copying into each app's `android/`)
- Set up `ios/` folder + Swift stubs for future iOS support

**Tests.**
- Kotlin unit tests on `MdnsFraming` (length-prefix encode/decode round-trip, edge cases at chunk boundaries).
- Kotlin unit tests on `BackoffPolicy` (exponential growth, cap behaviour, reset on success).
- Integration smoke test: fresh Expo project consuming `@canopy/react-native` + `expo prebuild` + `assembleDebug` succeeds and the modules are in the APK (CI check).

### Group Q — `createMeshAgent` factory (depends: M, N, O, P)

Lives in `@canopy/react-native`. See §2 above for the full API shape.

- Identity restore-or-generate via vault (default `KeychainVault`)
- Pre-connect mDNS with timeout; null on failure
- `OfflineTransport` as primary; BLE + relay always secondaries
- Routing: BLE (by MAC or pubKey) → mDNS → relay → offline
- PeerGraph backed by `AsyncStorageAdapter`
- All recent BLE fixes (write queue, `onDisconnected`, scan with `allowDuplicates:true`) included

**Tests.** (RN transports mocked for unit-level; real devices for manual smoke.)
- Factory returns an `Agent` with expected transports attached given each combination: no relay, only relay, BLE disabled, mDNS timeout falls back to offline.
- Routing strategy selects the expected transport for each peer type (MAC address, BLE-known pubKey, mDNS-known pubKey, relay-only pubKey, unknown).
- Identity is restored from vault on second call; generated on first call.
- On `agent.start()` the factory never throws on secondary-transport failure; only primary (offline) failure is fatal — which should never happen because `OfflineTransport.connect()` is a no-op.

### Group R — Auto-hello helper (depends: N)

- `agent.enableAutoHello({ pullPeers, helloTimeout })` installs `peer-discovered → hello (+ optional pullPeerList)` on every attached transport
- MAC-address dedup for BLE MACs; `getPeerKey` guard for pubKey addresses
- Opt-in, per vision decision #3

**Tests.**
- After `enableAutoHello()`, a synthetic `peer-discovered` event on a mock transport triggers exactly one `agent.hello` call.
- Second `peer-discovered` for the same MAC does NOT call `bleTrans.sendHello` again (dedup).
- Second `peer-discovered` for the same pubKey skips `agent.hello` because `getPeerKey` now returns a value.
- With `pullPeers:true`, `pullPeerList` is called after a successful hello; with `pullPeers:false`, it isn't.
- Calling `enableAutoHello()` twice is idempotent (no duplicate listeners).

### Group S — Relay package migration (depends: core `Transport`)

- Move `packages/core/relay-server.js` → `@canopy/relay/src/server.js`
- Expose as `startRelay({ port, tlsCert?, tlsKey?, serveStaticDir? })`
- Add optional TLS (`wss://`) via `TLS_CERT` / `TLS_KEY` env vars or factory options
- Core becomes platform-pure (no Node-only file)

**Tests.**
- `startRelay()` listens on the requested port; `register` + `send` round-trip between two mock WS clients works.
- Offline-message queuing: sending to an unregistered address buffers; when the address registers, buffered messages are delivered.
- `peer-list` broadcast fires on connect and disconnect with the correct list.
- With `tlsCert` + `tlsKey`, the server accepts `wss://` connections with a self-signed cert in the test fixture.
- Without cert, `ws://` works and `wss://` is refused.

### Group T — Oracle bridge model (depends: M, N; design doc first)

See §5 for full rationale. This group starts with a design doc, not code.

- Write `Design-v3/oracle-bridge-selection.md`: skill schema, signature canonicalisation, TTL rules, cache shape, interaction with gossip
- Implement `reachable-peers` skill
- Verify + cache signed reachability claims in `PeerGraph.knownPeers`
- Upgrade `invokeWithHop` to prefer oracle lookup; fall back to probe-retry when cache is empty or stale

**Tests.**
- `reachable-peers` skill returns a correctly-signed payload; verify with peer's known pubKey.
- Malformed or expired signature is rejected (and the stale entry isn't used).
- `PeerGraph.knownPeers` is populated from valid responses only.
- `invokeWithHop` with a valid oracle hit: selects the right bridge on the first try (assertion on call order).
- `invokeWithHop` with all oracle entries stale: falls back to probe-retry.
- TTL expiry: an entry older than the TTL isn't used even if present.

### Group U — mesh-chat app rewrite (depends: Q, R)

Rename `step1-expo52` → `mesh-chat`, rewrite on top of new SDK APIs.

- `src/agent.js`: collapse to ~15 lines (see §6 sketch)
- Keep `screens/`, `hooks/usePeers`, `context/AgentContext`, `store/*`, app-specific skills (`receive-message`)
- Expected line count: ~800 → ~300

**Tests.**
- `receive-message` skill: stores incoming text under `originFrom ?? from`; returns ack shape.
- `messageStore`: add/get/event emission round-trip.
- `usePeers` hook: re-renders on `added`/`removed`/`reachable`/`unreachable` events; unsubscribes on unmount.
- `AgentContext`: non-fatal `error` events don't flip status; fatal `createAgent` rejection does.
- Smoke test: boot the agent with all transports mocked; assert the expected skills are registered.

### Group Y — End-to-end integration demo + test (depends: M, N, Q, R; optional V, W, T)

A capstone that proves all earlier groups compose correctly. Two artefacts sharing one scenario:

- **Automated test** — `packages/core/test/integration/mesh-scenario.test.js` using `vitest`. Real `RelayTransport` pointed at a test relay server on an ephemeral port; a `LoopbackTransport` stands in for BLE. Runs in CI, ~5 s target runtime.
- **Runnable demo** — `examples/mesh-demo/` Node.js script. Same scenario, logs each phase to console, non-zero exit on any assertion failure. Useful for manual regression checks and for demonstrating the SDK.

**Scenario — three agents (Alice, Bob, Carol):**

| Phase | Action | Assertion |
|---|---|---|
| 1 | All three boot via `createMeshAgent` (in-memory vaults). Alice + Bob have relay; Carol has loopback to Bob only. | Each agent reaches `ready`. |
| 2 | `agent.enableAutoHello({ pullPeers: true })` on all three. Alice ↔ Bob hello via relay; Bob ↔ Carol hello via loopback. | `SecurityLayer` holds the expected keys. Alice's graph has Bob as `hops:0`. |
| 3 | Wait one gossip cycle. | Alice's graph has Carol as `hops:1, via: Bob`. |
| 4 | Alice calls `agent.invokeWithHop(Carol.pubKey, 'receive-message', [TextPart('hi')])`. | Carol's handler fires with `originFrom === Alice.pubKey`, `relayedBy === Bob.pubKey`; Alice receives ack. |
| 5 | Carol replies the same way. | Alice's handler fires with `originFrom === Carol.pubKey`. |
| 6 | Alice calls `agent.forget(Bob.pubKey)`. | Bob is removed from Alice's graph + SecurityLayer; within ~1 s re-discovery triggers a fresh hello; graph rebuilds. |
| 7 *(if V landed)* | Carol's loopback "disconnects" for 2 s; Alice sends during the gap. | `buffered` event fires; reconnect drains the queue FIFO; Carol's handler fires with the message. |
| 8 *(if W landed)* | Carol sets `helloGate = tokenGate('family-key')`. Alice without token → timeout; Alice with token → hello succeeds. | Gate semantics match; no side-channel signal on rejection. |
| 9 *(if T landed)* | All three enable reachability oracle. After one gossip round, Alice tries `invokeWithHop(Carol)`. | First `relay-forward` call target is exactly Bob (oracle-picked); no probe-retry on any other direct peer. Assertion on call order. Then expire Bob's claim manually (fast-forward `knownPeersTs`): the next send falls through to probe-retry cleanly without throwing. |

**Why it earns its own group.** Phases 1–6 define "the SDK works end-to-end" — any regression in M, N, Q, R, or T surfaces here before an app sees it. 7 and 8 gate V and W by proving each capability in a full-mesh context, not just in isolation.

**Tests.** The file *is* the test. Additionally:
- CI runs the full scenario on every PR.
- The `examples/mesh-demo/` script exits non-zero if any phase assertion fails (wired into a `npm run demo:verify` alongside the unit suites).
- `examples/mesh-demo/README.md` documents the human smoke-test variant (two phones + a laptop) so the same scenario is reproducible against real transports before tagging releases.

### Group V — BLE store-and-forward (no internal deps)

See §8 for full rationale. Lives in `@canopy/react-native`.

- Per-peer send buffer on `BleTransport`: `#pendingForPeer: Map<pubKey, Array<{envelope, enqueuedAt}>>`.
- When `_put(to, env)` finds no connection, push onto buffer and resolve immediately; emit `buffered` event with `{ to, queueSize }`.
- On `peer-discovered` after re-key to pubKey, drain that peer's buffer FIFO through the normal write path.
- Bounds (configurable via constructor): `bufferMaxPerPeer: 50`, `bufferTtlMs: 5 * 60_000`. Oldest-first drop on overflow; items past TTL dropped on drain.
- No re-encryption on drain (envelopes were already encrypted by SecurityLayer before `_put`).

**Tests.**
- Send to an unknown peer: no throw, `buffered` event fires, item lands in queue with correct size.
- Peer becomes known: queue drains in FIFO order; subsequent `_put` writes directly (queue empty).
- Queue overflow: oldest is dropped when cap is hit; newest always present.
- TTL expiry: item older than `bufferTtlMs` is dropped without being sent.
- Forget (via `BleTransport.forgetPeer`) clears the buffer for that peer.
- Drain doesn't re-encrypt — assert `SecurityLayer.encrypt` is called `N` times for `N` buffered items, not `2N`.

### Group W — Hello gate (opt-in) (no internal deps)

See §8 for full rationale. Lives in `@canopy/core`.

- Optional `authToken` field on HI payload (opaque base64url blob; no SDK semantics).
- New `agent.setHelloGate(async (envelope) => true | false)` method. Default gate: `() => true` (current behaviour — no change for apps that don't opt in).
- In `handleHello`:
  - If gate returns `true` → register key + emit `peer` + send ack (current behaviour).
  - If gate returns `false` → **silently return**. No ack, no `peer` event, no SecurityLayer entry. Sender's `sendHello` times out.
- Shipped gate helpers in `core/security/helloGates.js`:
  - `tokenGate(secret)` — `envelope.payload.authToken === secret`
  - `groupGate(groupIds, groupManager)` — `envelope.payload.authToken` parses as a valid `GroupProof` for one of `groupIds`
  - `anyOf(gate1, gate2, …)` — composition
- **No artificial delay**: the gate drops instantly. Document the timing side-channel as a known limitation in the group's design note.

**Tests.**
- Default gate (none set): hello behaves exactly as today (backward-compat assertion).
- `setHelloGate(() => false)`: inbound HI produces no ack, no `peer` event, no SecurityLayer registration.
- `tokenGate('secret')`: correct token → hello proceeds; wrong/absent token → silent drop.
- `groupGate(['team-a'], gm)`: valid proof → hello proceeds; expired/wrong-group/malformed proof → silent drop.
- `anyOf(a, b)`: passes if either inner gate returns true.
- Gate throws: treated as `false` (fail-closed). Don't leak errors back to the sender.

### Group X — Group-visible skills (depends: M; revisit when needed)

See §8 for full rationale. Optional last group — ship only when a product feature concretely needs scoped subsets. `GroupManager` already provides the cryptographic substrate.

- Extend `skill.visibility` to accept an object: `{ groups: string[], default: 'hidden' | 'visible' }`.
- `handleTaskRequest`: if skill has `groups`, verify caller holds a valid proof via `agent.security.groupManager.hasValidProof(from, groupId)`. Non-members: return `Unknown skill: <id>` (not `not-authorised`) to preserve the "don't reveal existence" principle (aligned with Group W).
- `agent.export()`: filter skill list per caller. Non-members don't see hidden skills.
- `skillDiscovery`: same filter when another agent asks for our skill list.
- `peer-list` skill: new `includeGroup` option so agents return only group-scoped peers to group-scoped callers.
- Backward-compat: existing `visibility: 'public' | 'authenticated' | 'private'` continues to work unchanged.

**Tests.**
- Caller with valid proof sees hidden skill in `export()`; non-member doesn't.
- Caller with valid proof can invoke hidden skill; non-member gets `Unknown skill` (not `not-authorised`).
- Expired proof is treated as non-member.
- `skillDiscovery` responses filter correctly per caller.
- `peer-list` with `includeGroup: 'X'`: only returns peers that hold group-X proofs; non-group caller gets filtered-out list.
- Existing `'public' | 'authenticated' | 'private'` skills still behave as before (no regression).

### Group Z — Origin signature verification (depends: M)

Hardens the unverified `_origin` header shipped in the 2026-04-20 session. Today a relay peer can set `_origin` to any pubKey and the receiver has no way to detect it — any downstream logic that keys on sender identity (reputation, rate limits, capability tokens) is spoofable.

**Design doc:** `Design-v3/origin-signature.md` (Z1 decisions recorded 2026-04-22).

**Protocol additions** (fully backward-compatible — missing sig = safe fallback, not rejection):

- Signed body: `{ v: 1, target, skill, parts, ts }` — canonicalised via `core/Envelope.js::canonicalize`, signed with the origin's Ed25519 identity key. No pre-hash of `parts`; Ed25519 handles arbitrary input.
- Three new RQ-payload fields: `_origin` (already present), `_originSig` (base64url Ed25519), `_originTs` (ms since epoch; must be within ±`ORIGIN_SIG_WINDOW_MS`, default 10 min matching the SecurityLayer replay window).
- `invokeWithHop` signs before calling `relay-forward`; `relay-forward` preserves `_origin` + `_originSig` + `_originTs` through the hop without re-signing. Multi-hop works because each intermediate bridge carries the exact bytes.
- `handleTaskRequest` verifies. On success: `ctx.originFrom = _origin`, `ctx.originVerified = true`. On missing/invalid/stale sig: `ctx.originFrom = envelope._from`, `ctx.originVerified = false`, `security-warning` event emitted (except for the "no sig at all" case which is silent for pre-Z backward compat).
- New handler field `ctx.originVerified` lets apps distinguish "trust-for-security" from "display-only" attribution.

**Tunables** (AgentConfig `originSignature.*` overrides → built-in):
`windowMs` (10 min), `strictFallback` (true — reserved for "reject delivery on failed sig" future work).

**Files likely touched.**
- `core/protocol/taskExchange.js` (RQ payload + handleTaskRequest verification)
- `core/security/SecurityLayer.js` (sign/verify helpers)
- `core/Envelope.js` (canonicalisation utility)
- `core/routing/invokeWithHop.js` (sign before forwarding)
- `core/skills/relayForward.js` (preserve sig through the hop)

**Tests.**
- Valid origin sig: receiver sees `ctx.originFrom` === signer. No warning emitted.
- Missing sig: receiver falls back to `envelope._from`; `security-warning` event emitted once.
- Tampered sig (modified parts): rejected, fallback + warning.
- Wrong signer pubKey: rejected, fallback + warning.
- Expired timestamp: rejected, fallback + warning.
- Multi-hop: two relays in sequence preserve original signer; verification still passes on the far end.
- Backward-compat: a caller that doesn't sign still gets through, with `ctx.originFrom === envelope._from`.

### Group AA — Relay rendezvous mode (depends: S)

Today the relay sits in the data path: every message from Alice to Bob traverses the relay server. That's fine for small messages, wasteful for bulk data. Rendezvous mode has the relay *broker the WebRTC handshake*, then get out of the way; Alice and Bob exchange data directly via a P2P data channel.

- New `RendezvousTransport` in `@canopy/core/transport/RendezvousTransport.js` (pure JS, browser + Node with `wrtc` polyfill).
- Uses `RelayTransport` as the signalling channel: SDP offers, answers, and ICE candidates are wrapped in OW envelopes with a reserved `payload.type: 'webrtc-signal'`.
- Once the `RTCDataChannel` opens, messages flow peer-to-peer. Relay only handles signalling + keepalive reconnect attempts.
- New skills not needed — signalling rides on the existing envelope protocol.
- Relay server keeps its current role plus: no special code needed for signalling (just forwards the envelopes like any other).
- Graceful degradation: if rendezvous fails (NAT-blocked, TURN absent), fall back to relay-in-path mode transparently.

**Design work before implementation** — add `Design-v3/rendezvous-mode.md`:
- Signalling message schema
- STUN/TURN configuration (default public STUN, TURN optional and byo-cert)
- Reconnection on DataChannel close
- Integration with `transportFor` / routing (rendezvous preferred over relay when available)
- Message framing over DataChannel (reuse Envelope JSON, or adopt the same 4-byte length-prefix we use for BLE?)

**Files likely touched.**
- New: `core/transport/RendezvousTransport.js`, `Design-v3/rendezvous-mode.md`
- `core/Agent.js` — optional auto-upgrade of relay peers to rendezvous once both sides support it
- Relay server unchanged (signalling is just OW envelopes)

**Tests.**
- Two Node.js agents using `wrtc` successfully exchange a DataChannel via the test relay; round-trip an RQ/RS through the data channel.
- SDP / ICE failure falls back to relay-in-path transparently; caller sees no error.
- Reconnect: DataChannel close triggers signalling restart; messages buffered during the gap deliver after reconnect.
- Mixed topology: Alice (rendezvous) + Bob (relay-only, no wrtc) still communicate via relay-in-path.

---

## 8. New capabilities (rationale for V / W / X / Z / AA)

### Group V — BLE store-and-forward buffer

Today `BleTransport._put` throws immediately if the peer isn't in either connection map. Real BLE links flap; a 3-second disconnect causes clean sends to fail even though the peer rediscovers shortly after. Mirror the relay server's store-and-forward (buffer per-peer with TTL + cap).

### Group W — Hello gate (opt-in)

Default hello reveals the agent's existence to anyone who tries to contact it. Some agents want to stay invisible to unauthorised peers. Hello-gate lets the app reject a hello *silently*: the sender sees a timeout, indistinguishable from "there's nothing at that address." Tokens, group proofs, or custom logic decide who's allowed to hello.

Explicitly separate from `TrustRegistry` (which elevates *already-hello'd* peers) — this decides whether to *consider* hello'ing at all.

### Group X — Group-visible skills

`'authenticated'` tier means "any peer I've met"; it's pairwise and symmetric. Groups add *delegated* and *scoped* trust: an admin signs a proof that Bob belongs to group "family," and every family-group-gated agent can verify it without maintaining its own list. Useful when the same subset of peers spans many agents (family mesh, work team, neighbourhood) and when trust should expire (proofs have `expiresAt`). Not needed if the app's trust model is flat.

### Group Z — Origin signature verification

The `_origin` field we added this session is *claim-only*: a relay can lie about who originated a message. As soon as you have any behaviour that keys on sender identity beyond attribution display (reputation, rate limits, access control), unverified origin becomes a real attack surface. Signing the origin with the caller's identity key closes that gap without changing the API surface — unsigned messages still work, they just get a degraded `security-warning` attribution.

### Group AA — Relay rendezvous mode

Relay-in-path is fine for chat, wasteful for file transfer. WebRTC DataChannels let peers talk P2P once the relay has brokered the handshake. Cuts relay bandwidth and latency dramatically for bulk use cases, with transparent fallback to relay-in-path when P2P isn't possible. Requires `wrtc` in Node (browser has it natively) so shows up as a peer-dependency on `@canopy/core`, not a hard dependency.

---

### Group EE — Wire RoutingStrategy + FallbackTable into production (depends: Q)

`RoutingStrategy` + `FallbackTable` are fully implemented and tested in
`packages/core/src/routing/` but consumed only by their own test files
— `createMeshAgent` uses an inline hardcoded `selectTransport` that
does not learn from failures, skips health checks, and caused the
"relay WS null cascade" observed 2026-04-24. Group EE wires the
existing machinery into production; no new algorithms, pure plumbing.

See `CODING-PLAN.md § Group EE` for the sub-phase breakdown.

### Group FF — Key rotation end-to-end integration (depends: none; FF can ship independent of EE)

`identity/KeyRotation.js` has `buildProof`, `verify`, `broadcast`, and
`applyToRegistry` implemented, with 14 unit tests passing. What is
missing: a receive-path handler, an `agent.rotateIdentity()`
entry-point, `SecurityLayer` grace-period semantics (accept old OR
new signature during grace), and vault dual-key storage. Group FF
closes those four gaps so that identities are actually rotatable — a
prerequisite for any long-lived deployment.

See `CODING-PLAN.md § Group FF` for the sub-phase breakdown.

---

## Open items (not blocking extraction)

- iOS native counterparts for BLE/mDNS.
- **Onion routing via `relay-forward`** (placeholder Group BB). Closes the
  remaining privacy gap that Group Z doesn't address: bridges still *read*
  the content they forward. Details, sketch, and blockers in
  [`TODO-GENERAL.md`](./TODO-GENERAL.md) (§ Security TODOs). Worth doing when privacy from
  bridges becomes a product requirement; overkill for current chat usage
  since the relay server itself is already blind to payloads (E2E via
  `nacl.box`).
