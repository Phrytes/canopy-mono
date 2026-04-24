# Architecture Review — 2026-04-24

Candid snapshot of the @canopy agent SDK as it stands today. Three sections:

1. **Architecture overview** — what exists and how it fits together.
2. **Architecture findings** — what's clean, what's drifting, what to fix.
3. **Safety / security findings** — crypto, trust model, DoS, validation.
4. **Fragility notes** — non-security things that will bite later.

Written as a one-shot snapshot. Re-run the review every ~3 groups or when
a new transport / protocol lands.

---

## 1. Architecture overview

### Packages

```
packages/
  core/             pure-JS core — no native deps, runs in Node + browser + RN
  react-native/     RN-specific transports + factory on top of core
  relay/            standalone WebSocket relay server (Node)

apps/
  mesh-demo/        Expo phone app; consumes @canopy/react-native

examples/
  mesh-demo/        browser demo; consumes @canopy/core directly
```

Package boundaries are respected via `package.json` file-link deps. `core`
has zero imports from `react-native`; `react-native` imports `core` only.
Nothing imports from `apps/` or `examples/`.

### `packages/core/src/` — layered

```
  Agent.js              — composition root, transport mux, skill registry, dispatch (~1100 LoC)
  Task.js               — task lifecycle state machine
  Parts.js              — TextPart / DataPart / FilePart construction + helpers
  Envelope.js           — framed message envelope
  Emitter.js            — minimal EventEmitter

  identity/             AgentIdentity + Vault implementations
    AgentIdentity.js      Ed25519 keypair + derived X25519 (via ed2curve)
    Vault.js              base class
    Vault{Memory,LocalStorage,IndexedDB,NodeFs}.js  — platform-specific
    KeyRotation.js        stub — not wired

  security/             crypto boundary; trust decisions
    SecurityLayer.js      nacl.box decrypt, Ed25519 verify, replay window, dedup
    originSignature.js    Z-group origin-signing for relay-hop messages
    sealedForward.js      BB-group sealed-forward crypto
    tunnelSeal.js         CC-group sealed tunnel (nacl.secretbox, session key K)
    helloGates.js         cross-check at hello time
    reachabilityClaim.js  T-group oracle claims

  protocol/             wire-level handshakes + task exchange
    hello.js              HI / HI-ACK handshake + capability snapshot (Group DD1 delegates to _snapshot)
    taskExchange.js       RQ / RS / OW / CNL / IR / EXP flow + timeouts (~568 LoC)
    skillDiscovery.js     capability probe
    ping.js, session.js, streaming.js, messaging.js, fileSharing.js, pubSub.js

  skills/               core protocol skills (same registry as app skills — see finding 1.3)
    capabilities.js       _snapshot + registerCapabilitiesSkill (AA3)
    relayForward.js       M-group relay-forward with 'authenticated' policy
    relayReceiveSealed.js BB
    tunnelOpen.js         CC — Alice-side plaintext tunnel
    tunnelOw.js           CC — one-way streamed tunnel chunks
    tunnelReceiveSealed.js CC3b — bridge-side sealed tunnel receive
    tunnelSessions.js     CC — in-flight tunnel session map
    reachablePeers.js     T-group oracle skill
    SkillRegistry.js      registry implementation

  routing/
    callWithHop.js        hop-aware invoke + tunnel negotiation (~542 LoC)
    invokeWithHop.js      thin wrapper that picks callWithHop when hops>0
    RoutingStrategy.js    unused in production; built for FallbackTable
    FallbackTable.js      per-peer per-transport latency + degraded tracking; unused

  discovery/
    PeerGraph.js          persistent peer directory (hops, via, caps, lastSeen)
    PeerDiscovery.js      peer-event → upsert plumbing
    GossipProtocol.js     peer-list + reachable-peers gossip loops
    pullPeerList.js       M-group one-shot peer pull
    PingScheduler.js      keepalive pings

  transport/
    Transport.js          abstract base (_put, _receive, _hasPeer)
    OfflineTransport.js   always-rejects fallback — lets invoke fail cleanly
    RelayTransport.js     WebSocket client to @canopy/relay
    NknTransport.js       (legacy; still in tree)
    LocalTransport.js     in-process pair for tests
    InternalTransport.js  sibling-pair for rendezvous handoff
    MqttTransport.js      (experimental)
    RendezvousTransport.js  AA-group WebRTC data-channel upgrade

  permissions/          policy engine for skill calls
    PolicyEngine.js       allow/deny decisions
    TokenRegistry.js      capability tokens
    CapabilityToken.js    token envelope
    DataSourcePolicy.js   per-storage ACL
    GroupManager.js, TrustRegistry.js

  storage/              DataSource + StorageManager for skill file IO
    StorageManager.js, DataSource.js
    MemorySource.js, FileSystemSource.js, IndexedDBSource.js, SolidPodSource.js
    SolidVault.js

  state/                StateManager.js — skill-visible durable state

  a2a/                  A2A interop layer (external protocol bridge)
    A2ATransport.js, A2ATLSLayer.js, A2AAuth.js
    a2aDiscover.js, a2aTaskSend.js, a2aTaskSubscribe.js
    AgentCardBuilder.js

  config/AgentConfig.js

  index.js              public surface — re-exports
```

### `packages/react-native/src/`

```
createMeshAgent.js          opinionated RN factory (~282 LoC) — this is the "easy mode" entry
identity/KeychainVault.js   expo-secure-store adapter
storage/AsyncStorageAdapter.js  PeerGraph persistence
permissions.js              BLE + location permission flow
transport/
  BleTransport.js           bidirectional BLE (central + peripheral) via ble-plx + BlePeripheralModule
  MdnsTransport.js          Zeroconf-based mDNS discovery + TCP hello
  rendezvousRtcLib.js       safe loader for react-native-webrtc (returns null in Expo Go)
utils/base64.js
```

### Data flow (end-to-end, send path)

```
 app code
   │  agent.invoke(peerId, 'skill', parts, opts)
   ▼
 Agent._dispatch / routing
   │  selectTransport(peerId) via createMeshAgent's inline router
   │     → mDNS (fresh) > BLE > mDNS (stale) > relay > offline
   ▼
 Task / taskExchange.js
   │  wraps parts in an envelope; assigns reqId; applies timeout
   ▼
 SecurityLayer.encryptAndSign(envelope, to)
   │  nacl.box payload + Ed25519 signature over header+payload
   ▼
 Transport._put(to, envelope)
   │  per-transport framing (WebSocket frame / GATT chunks / TCP length-prefix)
   ▼  peer
 Transport._receive
   ▼
 SecurityLayer.decryptAndVerify(envelope)
   │  verify signature, check replay window, dedup reqId
   ▼
 Agent._dispatch (inbound)
   │  resolve skill from #skills, or deliver RS to the pending Task
   ▼
 SkillRegistry → handler({ parts, from, originFrom, originVerified }) → [parts]
   │  reply wrapped as RS envelope, same encrypt+send path back
   ▼
 caller's Task resolves / streams / errors
```

For hop calls (`agent.invokeWithHop`), `routing/callWithHop.js` wraps the
whole flow in a tunnel-open / sealed-forward layer; see
`Design-v3/hop-tunnel.md`.

### Public surface (roughly)

From `@canopy/core`:
- **Construction:** `Agent`, `AgentConfig`, `AgentIdentity`, `Vault*`
- **Transports:** `Transport` (base), `OfflineTransport`, `RelayTransport`, `LocalTransport`
- **Messaging:** `TextPart`, `DataPart`, `FilePart`, `Parts`, `Task`
- **Discovery:** `PeerGraph`, `pullPeerList`
- **Routing:** `invokeWithHop`, `RoutingStrategy`, `FallbackTable`
- **Core skills:** `registerCapabilitiesSkill`, `registerTunnelReceiveSealed`
- **Security primitives:** `SecurityLayer`, `sealedForward`, `tunnelSeal`

From `@canopy/react-native`:
- `createMeshAgent(opts)` — factory that bundles everything above
- `KeychainVault`, `BleTransport`, `MdnsTransport`, `AsyncStorageAdapter`

---

## 2. Architecture findings

**Overall:** the layering is honest. core ↔ transports ↔ app boundaries
are not violated. The drift is concentrated in a few files that are
growing faster than they are being refactored.

### 2.1 Agent.js is a god class (1103 lines)

Everything lands here — identity injection, transport mux, skill
registry, hello protocol, dispatch, routing delegation, ~a dozen
`enable*` feature methods (relayForward, autoHello, reachabilityOracle,
rendezvous, tunnelForward, …). Every group (R, AA, BB, CC, DD) added
methods. Readable today, will hurt in another 2–3 groups.

**Natural extractions:**
- `DiscoveryOrchestrator` — owns peer-discovered → PeerGraph upsert + autoHello
- `SkillExecutor` — owns the handler invocation, streaming, IR, cancellation
- `HelloProtocol` — owns HI / HI-ACK state
- `Agent` — composition root only (transport mux + dispatch)

### 2.2 callWithHop.js is a 542-line mini state machine

Concentrates hop routing, bridge-candidate retry, capability cache
(60s TTL, invisible), sealed vs plaintext tunnel decision tree, and
one-shot relay fallback. Works, but any new hop mode will make it
worse. Break into `selectBridge()`, `decideTunnelMode()`,
`_openTunnel()`, `_oneShot()` — same behavior, testable in isolation.

### 2.3 Core skills live in the same registry as app skills

`relay-forward`, `tunnel-open`, `tunnel-receive-sealed`, `peer-list`,
`reachable-peers`, `get-capabilities` all register via
`agent.register(...)` — indistinguishable from the app's
`receive-message`. No core↔app boundary.

Fix: introduce `registerCoreProtocolSkills(agent, { relay, tunnel,
oracle })` that groups them. Makes the SDK's protocol footprint
explicit and easier to reason about for new contributors.

### 2.4 Dead code that looks alive

- `routing/RoutingStrategy.js` + `routing/FallbackTable.js` exist,
  have full test suites, and are not used in production. `createMeshAgent`
  has its own inline `selectTransport`. Either wire these up or delete
  them — right now a reader will think they matter.
- `identity/KeyRotation.js` — stub with no integration.
- `transport/NknTransport.js`, `transport/MqttTransport.js` — legacy /
  experimental; flag with a header comment or move to `transport/legacy/`.

### 2.5 Group labels (A–DD) are comment-level only

Commits and code reference "Group R" / "Group BB" / "Group CC". There
is no single map from group → design doc → code files. A new
contributor cannot navigate.

Fix: add `ARCHITECTURE.md` (or extend this file) with a table:

| Group | Feature | Design doc | Code anchor |
|---|---|---|---|
| R | Auto-hello | — | `Agent.enableAutoHello` |
| Z | Origin signatures | `Design-v3/origin-signature.md` | `security/originSignature.js` |
| BB | Sealed forward | `Design-v3/blind-forward.md` | `security/sealedForward.js`, `skills/relayReceiveSealed.js` |
| CC | Hop tunnel | `Design-v3/hop-tunnel.md` | `routing/callWithHop.js`, `skills/tunnel*.js`, `security/tunnelSeal.js` |
| T | Reachability oracle | `Design-v3/oracle-bridge-selection.md` | `security/reachabilityClaim.js`, `skills/reachablePeers.js` |
| AA | Rendezvous (WebRTC) | `Design-v3/rendezvous-mode.md` | `transport/RendezvousTransport.js` |
| DD | RN rendezvous wiring | — | `react-native/createMeshAgent.js` (rendezvous opt) |

### 2.6 `createMeshAgent` is the cleanest part

Proper opinionated factory with explicit opt-ins. Log-loud about the
decisions it silently makes (mDNS timeout, relay fallback, rendezvous
skip in Expo Go). Keep this shape — if/when Agent.js is split,
createMeshAgent stays the stable entry.

### 2.7 Testing posture

62 test files, ~10,700 LoC of tests for ~11,600 LoC of source. Coverage
is broad. Shallow in:

- Chaos / resilience (drop 10% of BLE packets, 30s mDNS outage mid-call).
- Replay-window boundary conditions (±10 min clock skew).
- Malformed inbound envelopes (oversized, invalid base64, truncated).
- Timeout races (bridge times out *just as* one-shot handler completes).

Not urgent, but worth a "chaos" test file before the next on-device push.

---

## 3. Safety / security findings

**Overall:** Ed25519 signatures, nacl.box payload encryption, Ed25519→X25519
conversion via `ed2curve`, signed `originFrom` for sealed-forward — all
the primitives are used correctly. `originVerified` cross-check in
`sealedForward.openSealed` (checking `body.origin === senderPubKey`) is
real defense-in-depth.

The weak spots are operational, not cryptographic.

### 3.1 Relay has no auth or rate limiting

`packages/relay/src/server.js` accepts `register` and `send` from any
WebSocket client with any claimed address. No proof-of-identity, no
rate limit, no queue cap per address.

- Fine for a private home/LAN relay.
- Unsafe on the open internet — a memory-exhaustion amplifier.

**Action:** loud warning in `packages/relay/README.md`; leave an
`authenticate(socket, claimedAddress)` hook for later wiring.

### 3.2 No key rotation

`AgentIdentity` is one keypair for the lifetime of the vault. If a
phone is lost or compromised, peers have no in-band way to learn "use
this new key instead" — everyone has to manually forget and re-add.

`identity/KeyRotation.js` is a stub. Fine for demo; flag before anyone
deploys for real use. Minimum viable design: `agent.rotateKey()` emits
a signed claim `{ oldPub, newPub, ts }` via all transports; peers'
PeerGraph learns `newPub`; routes to `oldPub` get rewritten for a
grace window.

### 3.3 Dedup cache is theoretically unbounded

`SecurityLayer.#dedup` grows with every unique envelope within the
replay window (10 min). Cleanup runs on every decrypt call so it
self-limits in practice; no meaningful risk on a phone.

Matters if you ever host a public relay forwarding for many peers —
then move to a time-bucketed structure
(`Map<bucket, Set<reqId>>`, drop buckets > 2 ahead of now).

### 3.4 `Parts.data()` uses `Object.assign({}, ...)`

At `packages/core/src/Parts.js:40`. In theory a malicious `__proto__`
key in a DataPart could pollute a merged object. In practice:

- DataParts come through `nacl.box`, so only *authenticated* peers can
  send one.
- No handler in the codebase treats `parts.data()` as control flow
  (no `eval`, no dynamic dispatch on its keys).

Mitigated in practice. Worth either a prototype-less merge or an
inline comment "trusted-peer-only; do not treat keys as commands."

### 3.5 Relay can silently drop messages

Relay forwards envelopes as-is. It *could* mutate `_ts` to push an
envelope outside the receiver's replay window — receiver rejects
silently, no audit trail. Trust-the-relay model; not exploitable
beyond denial-of-service by a relay that is already in the trust
boundary.

### 3.6 Input validation at the crypto boundary is OK

`SecurityLayer.decryptAndVerify` + `sealedForward.openSealed` both
wrap `JSON.parse` in try/catch. Malformed payloads throw cleanly. No
schema validation beyond "parses as JSON and has expected field
names" — fine given the payload is already authenticated.

### 3.7 Relay registration and pubKey binding

`SecurityLayer` auto-registers `env._from → env.payload.pubKey` on
first HI. Because `_from` is *transport-dependent* (a MAC on BLE, a
pubKey on relay, an IP:port on mDNS), the same peer may end up
registered under multiple keys. This is intentional (transports are
disjoint address spaces) but means `forgetPeer(blePk)` does NOT forget
the relay entry for the same person.

Worth documenting. Consider an `agent.forgetPeer(pubKey, { allAddresses: true })`.

---

## 4. Fragility notes (non-security)

### 4.1 Timing-sensitive PeerGraph upserts

`createMeshAgent` calls `peers.upsert(...)` on `agent.on('peer')`
without awaiting. An app that calls `invokeWithHop` synchronously
after a peer event may hit stale graph state. Mitigation: add
`agent.onPeerDiscovered(handler)` that awaits the upsert before
firing the handler.

### 4.2 Gossip is interval-driven

A peer that just disappeared stays in the graph until the next
`gossipIntervalMs` tick (currently 60 s). No event-driven fast path
on `peer-disconnected`. Fine for a 5-phone mesh; matters at scale.

### 4.3 AsyncStorage quota

Android AsyncStorage caps at ~6 MB. A large persisted PeerGraph could
silently hit it. No quota handling in
`AsyncStorageAdapter.js`. Eviction on write when > 90% full would be
a 10-line fix.

### 4.4 Task TTL asymmetry

Caller's `Task` has no independent deadline — it waits for the RS or
the invoke's own timeout. Server's handler runs under its own TTL
(via `setTimeout` in `taskExchange.js`). If the server's RS is lost in
transit, the caller hangs until the invoke timeout, independent of
the server-side `effectiveTtl`. Add a caller-side clamp.

### 4.5 Relay reconnect loops forever

`RelayTransport` has exponential backoff capped at 30 s. An agent
that loses relay will retry every 30 s forever. No circuit breaker.
If the relay is permanently down, logs get noisy. Fine behaviorally.

### 4.6 BT-only messaging is unreliable

See `TODO-GENERAL.md § BT-only messaging reliability (parked
2026-04-24)`. Outbound BLE writes to a peer that's restarted can land
on a stale GATT handle; Android's BLE stack doesn't always report it.
Parked until a native-side debugging session is feasible.

---

## 5. Proposal: slim Agent + opt-in extensions

Goal: a minimal `Agent` base class that a dev can **extend with whatever
features they actually want** — instead of a 1103-line class that has
every feature baked in. Applies finding 2.1.

### 5.1 What stays in the slim base (target: ~300 LoC)

Strict minimum for "I have an identity, I have transports, I can
register skills and call them":

```
Agent
  ─ identity, security (SecurityLayer)
  ─ transports     Map<name, Transport>  + addTransport / removeTransport
  ─ skills         SkillRegistry         + register(id, handler, opts)
  ─ config         AgentConfig
  ─ peers          PeerGraph | null      (injected; not wired to anything)
  ─ stateManager   StateManager
  ─ start / stop
  ─ call / invoke                        (flat RPC, no hop, no tunnel)
  ─ _dispatch                            (inbound envelope → skill or Task RS)
  ─ on / emit                            (Emitter plumbing)
```

That's it. No `enableRelayForward`, no `enableTunnelForward`, no hop
routing, no auto-hello, no rendezvous. No `#sealedConfigs`, no
`#autoHelloBound`, no `#autoHelloedMacs`, no `#helloGate`, no
`#discovery`.

### 5.2 What moves out — each as a standalone module

The current `enableXxx` methods are already thin wrappers around
`registerXxx(this, opts)` functions that live in `skills/` or
`protocol/`. The pattern is:

```js
// current
enableTunnelForward(opts = {}) {
  if (this.#skills.get('tunnel-open')) return this;
  if (opts.policy !== undefined) this.#config?.set('policy.allowTunnelFor', opts.policy);
  registerTunnelOpen(this, opts);
  registerTunnelOw(this);
  return this;
}
```

Move the guard + config setup into the `register*` function itself, and
drop the `enable*` wrapper. Then the dev calls the module directly:

```js
// proposed
import { attachTunnelForward } from '@canopy/core';
attachTunnelForward(agent, { policy: 'authenticated' });
```

Mapping:

| Current on Agent             | Moves to (new or existing file)                      |
|------------------------------|------------------------------------------------------|
| `enableAutoHello`            | `protocol/autoHello.js` → `attachAutoHello(agent, opts)` — owns `#autoHelloBound`, `#autoHelloedMacs` in closure |
| `startDiscovery`             | `discovery/Discovery.js` → `attachDiscovery(agent, opts)` — owns `#discovery` |
| `enableRelayForward`         | `skills/relayForward.js` → `attachRelayForward(agent, opts)` — absorbs the `enable*` guard |
| `enableTunnelForward`        | `skills/tunnel.js` → `attachTunnelForward(agent, opts)` — calls `registerTunnelOpen` + `registerTunnelOw` |
| `enableSealedForwardFor`     | `security/sealedForward.js` → `attachSealedForward(agent, groupId, opts)` — owns a `SealedForwardManager` that tracks groups |
| `enableReachabilityOracle`   | `skills/reachablePeers.js` → `attachReachabilityOracle(agent, opts)` |
| `enableRendezvous`           | `transport/rendezvous.js` → `attachRendezvous(agent, opts)` |
| `invokeWithHop` / `callWithHop` | `routing/invokeWithHop.js` — **free functions**, not methods. `invokeWithHop(agent, peerId, skillId, ...)` |
| `helloGate`                  | `security/helloGates.js` → `setHelloGate(agent, gate)` — stored in a WeakMap keyed on agent |

**Key idea:** all feature state that currently lives as `#privateField`
on Agent moves into a closure or a small per-feature class. The
extension only needs the **public** Agent API
(`agent.register`, `agent.on`, `agent.config`, `agent.transportNames`).

That's the contract: *if an extension can be built using only the slim
Agent's public API, it never needs to touch Agent's internals.*

### 5.3 Two extension patterns — pick what fits the use case

**Pattern A — standalone `attach*` functions (the default).**
Most flexible. No subclassing. Easy to compose:

```js
import { Agent, AgentIdentity, RelayTransport,
         attachRelayForward, attachTunnelForward,
         attachAutoHello, attachDiscovery,
         invokeWithHop } from '@canopy/core';

const agent = new Agent({ identity, transport: relay, config });
attachRelayForward(agent, { policy: 'authenticated' });
attachTunnelForward(agent, { policy: 'authenticated' });
attachAutoHello(agent, { pullPeers: true });
attachDiscovery(agent, { gossipIntervalMs: 60_000 });

await agent.start();
const reply = await invokeWithHop(agent, peerPk, 'greet', parts, { hops: 2 });
```

**Pattern B — opinionated subclass.**
For teams that want a named "flavor" of agent — e.g. `MeshAgent`, `RelayAgent`, `BridgeAgent`:

```js
// packages/core/src/MeshAgent.js  (or defined in user-land)
import { Agent, attachAutoHello, attachDiscovery, attachTunnelForward,
         attachRelayForward, attachReachabilityOracle } from './index.js';

export class MeshAgent extends Agent {
  constructor(opts) {
    super(opts);
    attachAutoHello(this, { pullPeers: true });
    attachDiscovery(this, { gossipIntervalMs: 60_000 });
    attachRelayForward(this, { policy: 'authenticated' });
    attachTunnelForward(this, { policy: 'authenticated' });
    attachReachabilityOracle(this);
  }
}
```

`createMeshAgent` (the RN factory) becomes a thin wrapper that picks
the right transports + instantiates `MeshAgent`. Dev apps that want a
custom feature mix can either subclass `Agent` or just use Pattern A.

**Why offer both?** Pattern A is strictly more powerful. Pattern B is
only for named, reusable bundles — exactly the role `createMeshAgent`
plays today. Don't let B proliferate into a zoo of `XyzAgent` classes;
keep maybe 2–3 well-named ones.

### 5.4 Backward compatibility

All current `agent.enableXxx()` methods stay as **one-line
deprecated shims** during a grace period:

```js
// Agent.js — during transition only
enableTunnelForward(opts) {
  console.warn('agent.enableTunnelForward is deprecated; use attachTunnelForward(agent, opts)');
  return attachTunnelForward(this, opts);
}
```

Apps don't break on day 1. Delete the shims after a release or two. The
`mesh-demo` app gets migrated as the exemplar.

### 5.5 Migration path (one PR per step, reversible each)

1. **Extract the cleanest methods first.** Start with
   `enableReachabilityOracle` — it's already a pure wrapper around
   `registerReachablePeersSkill`. One-line move to `attachReachabilityOracle`,
   deprecate the Agent method, update `mesh-demo`.
2. **Extract `enableRelayForward`** — same pattern, also trivial.
3. **Extract `enableTunnelForward` + `enableSealedForwardFor` together** —
   introduce `SealedForwardManager` to hold `#sealedConfigs`. The Agent's
   `getSealedForwardConfig(groupId)` becomes a method on the manager;
   consumers get it via `agent.extensions.get('sealedForward').getConfig(g)`
   or via a closure.
4. **Extract `enableAutoHello` + `startDiscovery`** — these are the
   trickier ones because they hold long-lived state (`#autoHelloBound`,
   `#discovery`). Store inside the closure. Add an
   `agent.on('stop', cleanup)` hook so resources tear down.
5. **Extract `enableRendezvous`** — already mostly self-contained.
6. **Promote `invokeWithHop` / `callWithHop` to free functions.** This is
   the biggest API change and the most valuable — it gets routing out of
   Agent entirely. `agent.invoke` stays (flat RPC); `invokeWithHop(agent,
   …)` becomes the way to do hop-aware calls.
7. **Introduce `MeshAgent`** as the named bundle, retire the ad-hoc
   `enable*` chain in `apps/mesh-demo/src/agent.js`.
8. **Delete deprecated shims.**

Each step is independently shippable, keeps the test suite green, and
moves ~50–200 lines out of `Agent.js`. Target end-state: `Agent.js` at
~350 LoC, `MeshAgent.js` at ~40 LoC, each extension at 30–150 LoC.

### 5.6 What this buys you

- **Tree-shakeable.** A browser demo that only needs flat RPC pulls
  in `Agent` + one transport. No hop/tunnel/rendezvous code ships.
- **Testable in isolation.** Each `attach*` has obvious input (Agent +
  opts) and obvious output (registered skills + attached state). No
  need to spin up a full Agent to unit-test tunnel negotiation logic.
- **Readable.** A new contributor opens `Agent.js`, sees 300 lines of
  dispatch + skill registry, and actually understands it. The feature
  code is separate, searchable by filename.
- **Extensible by devs.** Someone building a new kind of agent
  (e.g. an LLM-backed skill executor) writes their own `attachLlm(agent)`
  without having to understand how `enableRendezvous` works.

### 5.7 What this does **not** buy you

- **It doesn't fix `callWithHop.js`.** That file still needs its own
  split (see 2.2). But once `invokeWithHop` is a free function,
  splitting `callWithHop` is a pure internal refactor that touches
  nothing else.
- **It doesn't change the wire protocol.** Same envelopes, same skills,
  same handshake. Pure code organization.
- **It doesn't introduce new dependencies.** Just moves existing code
  around.

---

## 6. Top-5 priority fixes (if you had one afternoon)

In descending bang-for-buck:

1. **Split `Agent.js`** per the slim-base + `attach*` proposal in §5.
   Start with step 1 of §5.5 (`attachReachabilityOracle`) — it's a
   one-file move that proves the pattern. Everything else gets easier
   afterward.
2. **Add `ARCHITECTURE.md` (or a Groups-map section here)** — cost
   measured in minutes, ROI measured in hours saved per new contributor
   or per future the author reading this in six months.
3. **Wire `RoutingStrategy` + `FallbackTable` into `createMeshAgent`**
   — you already have the machinery for "prefer last-working transport,
   skip dead ones." It just isn't plugged in. Would fix the
   `Cannot read property 'send' of null` relay cascade observed on
   2026-04-24.
4. **Split `callWithHop.js`** into the four functions listed in 2.2.
5. **Put a visible warning in the relay README** about no-auth /
   private-network-only. Takes five minutes; removes a footgun.

Groups 6+ (key rotation, dedup bucketing, chaos tests, quota mgmt) can
wait until there's a concrete driver.
