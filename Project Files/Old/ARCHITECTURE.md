# Architecture map

A pointer document.  Use it to find: *"the code for feature X lives where?"*
or *"this commit message says Group BB — what does that mean?"*

For a deeper read, see:
- `QUICKSTART.md` — hands-on minimal agent in ~20 lines; start here if you've never used the SDK.
- `ARCHITECTURE-REVIEW.md` — current SDK shape, findings, refactor proposals.
- `EXTRACTION-PLAN.md` — vision + delegation tree for SDK extraction.
- `CODING-PLAN.md` — per-Group implementation checklist with tests.
- `Design-v3/*.md` — feature-level design docs (one per major capability).

---

## Where things live

```
packages/core/             pure JS — runs in Node + browser + RN
  src/Agent.js               composition root, dispatch, skill registry
  src/Task.js                task lifecycle state machine
  src/Parts.js               TextPart / DataPart / FilePart helpers
  src/Envelope.js            wire envelope + protocol codes (HI, RQ, RS, OW, …)

  src/identity/              Ed25519 keypair, Vault backends, BIP39 mnemonic,
                             KeyRotation proof
  src/security/              SecurityLayer (encrypt+sign), originSignature,
                             sealedForward, tunnelSeal, helloGates,
                             reachabilityClaim
  src/protocol/              hello, taskExchange, skillDiscovery, ping,
                             session, messaging, streaming, fileSharing,
                             pubSub, keyRotation
  src/skills/                core protocol skills + SkillRegistry +
                             defineSkill (capabilities, relayForward,
                             relayReceiveSealed, tunnelOpen, tunnelOw,
                             tunnelReceiveSealed, tunnelSessions,
                             reachablePeers)
  src/routing/               callWithHop, invokeWithHop, FallbackTable,
                             RoutingStrategy
  src/discovery/             PeerGraph, PeerDiscovery, GossipProtocol,
                             pullPeerList, PingScheduler
  src/transport/             Transport (base), OfflineTransport,
                             RelayTransport, LocalTransport,
                             InternalTransport, NknTransport, MqttTransport,
                             RendezvousTransport
  src/permissions/           PolicyEngine, TokenRegistry, CapabilityToken,
                             DataSourcePolicy, GroupManager, TrustRegistry
  src/storage/               StorageManager + DataSource backends
                             (Memory, FileSystem, IndexedDB, SolidPod) +
                             SolidVault
  src/state/StateManager.js  durable per-skill state
  src/a2a/                   A2A interop (external-protocol bridge)
  src/config/AgentConfig.js  runtime knobs

packages/react-native/     RN-specific transports + factory
  src/createMeshAgent.js     opinionated factory (the "easy mode" entry)
  src/identity/KeychainVault.js     expo-secure-store adapter
  src/storage/AsyncStorageAdapter.js  PeerGraph persistence
  src/permissions.js         BLE + location permission flow
  src/transport/BleTransport.js     bidirectional BLE (ble-plx + Kotlin GATT)
  src/transport/MdnsTransport.js    Zeroconf + TCP hello
  src/transport/rendezvousRtcLib.js safe loader for react-native-webrtc

packages/relay/            standalone WebSocket relay (Node)
apps/mesh-demo/            Expo phone app
examples/mesh-demo/        browser demo
```

---

## Groups → features → code

The codebase uses **Group** labels as a shorthand for cohesive
extraction / feature waves.  Commit messages reference them; code
comments cite them; this section is the single index.

### SDK extraction (M–S)

The core extraction wave that turned the original `step1-expo52` repo
into `@canopy/*` packages.

| Group | Feature | Design / Plan | Code |
|---|---|---|---|
| **M** | Core extractions: OfflineTransport, invokeWithHop, relayForward, pullPeerList, PeerGraph.clear | `EXTRACTION-PLAN.md` §7 | `src/transport/OfflineTransport.js`, `src/routing/invokeWithHop.js`, `src/skills/relayForward.js`, `src/discovery/pullPeerList.js`, `src/discovery/PeerGraph.js` |
| **N** | Core API ergonomics: `agent.startDiscovery`, `agent.enableRelayForward`, `'authenticated'` policy tier | `EXTRACTION-PLAN.md` §7 + §4 | `src/Agent.js` (`enableRelayForward`, `startDiscovery`); `src/skills/relayForward.js` policy tiers |
| **O** | RN permissions flow | — | `packages/react-native/src/permissions.js` |
| **P** | Native module packaging (Android Kotlin) | — | `packages/react-native/android/` |
| **Q** | `createMeshAgent` factory | `EXTRACTION-PLAN.md` §2 | `packages/react-native/src/createMeshAgent.js` |
| **R** | Auto-hello helper (`agent.enableAutoHello`) | `EXTRACTION-PLAN.md` §3 | `src/Agent.js` (`enableAutoHello`, `#bindAutoHello`) |
| **S** | Relay package migration | `EXTRACTION-PLAN.md` §1 | `packages/relay/src/server.js` |

### Capabilities (T–CC)

Layered features built on top of the extracted core.

| Group | Feature | Design doc | Code |
|---|---|---|---|
| **T** | Reachability oracle — bridge selection by signed claim | `Design-v3/oracle-bridge-selection.md` | `src/security/reachabilityClaim.js`, `src/skills/reachablePeers.js`, `src/Agent.js` (`enableReachabilityOracle`) |
| **U** | mesh-chat app rewrite (consumes Q + R) | — | `apps/mesh-demo/src/agent.js` |
| **V** | BLE store-and-forward (offline-peer buffer) | — | `packages/react-native/src/transport/BleTransport.js` (`#pendingForPeer`, `_drainBuffer`) |
| **W** | Hello gate (opt-in admission control) | — | `src/security/helloGates.js`, `src/protocol/hello.js`, `src/Agent.js` (`helloGate`) |
| **X** | Group-visible skills (caller-pubkey based filter) | — | `src/permissions/GroupManager.js`, `src/skills/SkillRegistry.js` |
| **Y** | End-to-end mesh-scenario integration test | — | `packages/core/test/integration/mesh-scenario.test.js` |
| **Z** | Origin signature verification (signed `originFrom` for hop messages) | `Design-v3/origin-signature.md` | `src/security/originSignature.js`, `src/skills/relayForward.js` (sig path) |
| **AA** | Rendezvous (WebRTC DataChannel upgrade) | `Design-v3/rendezvous-mode.md` | `src/transport/RendezvousTransport.js`, `src/Agent.js` (`enableRendezvous`, `upgradeToRendezvous`); RN loader: `packages/react-native/src/transport/rendezvousRtcLib.js` |
| **AA3** | `get-capabilities` skill (sub-phase of AA) | — | `src/skills/capabilities.js` |
| **BB** | Blind / sealed relay-forward (content privacy from bridges) | `Design-v3/blind-forward.md` | `src/security/sealedForward.js`, `src/skills/relayReceiveSealed.js`, `src/Agent.js` (`enableSealedForwardFor`) |
| **BB5** | mesh-scenario phase 11 — sealed-forward integration test | — | `packages/core/test/integration/mesh-scenario.test.js` (phase 11) |
| **CC** | Hop-aware task tunnel (bidirectional streaming via bridge) | `Design-v3/hop-tunnel.md` | `src/routing/callWithHop.js` (orchestrator), `src/routing/hopBridges.js` (selection), `src/routing/hopTunnel.js` (open + sealed), `src/routing/hopOneShot.js` (fallback), `src/skills/tunnelOpen.js`, `src/skills/tunnelOw.js`, `src/skills/tunnelReceiveSealed.js`, `src/skills/tunnelSessions.js`, `src/security/tunnelSeal.js`, `src/Agent.js` (`enableTunnelForward`) |
| **DD** | Phone app integration (mesh-demo wires T/AA/BB/CC) | `CODING-PLAN.md` § Group DD | `apps/mesh-demo/src/agent.js`, `apps/mesh-demo/src/context/AgentContext.js`, `packages/react-native/src/createMeshAgent.js` (rendezvous opt) |

### Operational hardening (EE–FF+1)

Recent work that closed gaps the core extractions left dangling.

| Group | Feature | Design / Plan | Code |
|---|---|---|---|
| **EE** | Wire `RoutingStrategy` + `FallbackTable` into createMeshAgent; per-transport `canReach()` contract; degraded-skip + latency record | `CODING-PLAN.md` § Group EE | `src/routing/RoutingStrategy.js`, `src/routing/FallbackTable.js`, `src/protocol/taskExchange.js`, `src/Agent.js` (`routeFor`); `canReach()` on `BleTransport`, `MdnsTransport`, `RelayTransport`, `OfflineTransport`; `packages/react-native/src/createMeshAgent.js` |
| **FF** | Key rotation end-to-end: receive handler, vault dual-key blob, `agent.rotateIdentity`, `SecurityLayer` grace period | `CODING-PLAN.md` § Group FF | `src/identity/AgentIdentity.js` (rotate, restoreWithPrevious), `src/protocol/keyRotation.js`, `src/security/SecurityLayer.js` (selfHistory, swapIdentity, registerSelfRotation), `src/Agent.js` (`rotateIdentity`); KeyRotation primitives at `src/identity/KeyRotation.js` |
| **FF+1** | Inline rotation proof during grace — peers that missed the broadcast auto-migrate on first post-rotation envelope | `CODING-PLAN.md` § Group FF+1 | `src/security/SecurityLayer.js` (`#inlineProof`, `setInlineProof`, decrypt-side migrate-pre-verify), `src/Agent.js` (`_dispatch` mirror to PeerGraph), `src/protocol/keyRotation.js` (exported `migratePeerGraph`) |

### Legacy app-level groups (A–L)

The early letters appear in `Design-v3/mesh-demo.md` and
`Design-v3/relay-demo-app.md` and refer to the **demo-app scaffold**
(UI sections, app-side skills) rather than SDK code.  They predate
the M–FF extraction wave.  References still live in some `index.js`
section comments (e.g. "Group G — Routing", "Group H — A2A",
"Group I — Storage"); treat those as pre-extraction shorthand for
the corresponding directory and ignore unless you're spelunking
through git history.

App-level letters: B (PeersScreen), D (MessageScreen + messages
state, also session.js / streaming.js / fileSharing.js — these
filenames carry a `Group D` comment), E (peer-list skill scaffolding,
later subsumed by Group N), F (LocalTransport + RendezvousTransport
— later refined by AA), G (Routing index section), H (A2A index
section), I (Storage index section).

If you're adding new code, **use the latest Group label that still
fits the extraction wave** (currently FF+1) or open a new one in
`CODING-PLAN.md`.  Don't reuse a single-letter legacy label.

---

## Feature areas — narrative

### Identity

A peer's stable identity is its Ed25519 public key.  The same 32-byte
seed drives both signing (Ed25519) and encryption (Curve25519 via
`ed2curve`), so one keypair covers both.  Seeds live in a `Vault`:
`VaultMemory` for tests, `VaultNodeFs` / `VaultIndexedDB` /
`VaultLocalStorage` for the various JS hosts, `KeychainVault` (RN)
for phones.  The vault stores a JSON envelope `{ current, previous }`
since FF; legacy bare-seed values still parse.

**Rotate** an identity with `agent.rotateIdentity({ gracePeriodSeconds })`
(FF).  During the grace window the agent accepts envelopes addressed
to either the old or new pubkey, and outbound envelopes carry an
inline proof so peers that missed the broadcast auto-migrate (FF+1).

### Transports

Every transport extends `Transport` and implements `_put(to, env)` +
`_receive(env)`.  `canReach(peerId)` is an EE addition that lets
RoutingStrategy skip transports that aren't currently usable for a
given peer.

The Agent constructor takes one *primary* transport (which is the
"default" name in `agent.transports`) plus zero or more named
secondaries via `agent.addTransport('name', t)`.  `createMeshAgent`
sets the primary to `OfflineTransport` (clean-error fallback) and
adds BLE / mDNS / relay as named secondaries — that way a missing
network never prevents `agent.start()` from completing.

### Security

`SecurityLayer` runs nacl.box (Curve25519+XSalsa20-Poly1305) for
payload encryption and Ed25519 for envelope signatures.  Inbound
envelopes go through replay window check → dedup → optional
HI auto-register → optional inline-rotation-proof migrate (FF+1) →
signature verify → decrypt.

`originSignature` (Z) and `sealedForward` (BB) layer over this for
hop-routing scenarios where the bridge is untrusted.  `tunnelSeal`
(CC) handles bidirectional sealed streaming.

### Routing

The Agent has an optional `RoutingStrategy` that picks among multiple
transports per peer.  Inputs:
- Each transport's `canReach(peerId)` (EE).
- `FallbackTable` recordings of past success latency.
- Optional per-peer pinned preference (used by AA's rendezvous upgrade).

`createMeshAgent` always wires up RoutingStrategy now.  Apps with
custom transports can either pass their own strategy in or rely on
the default-priority path.

`invokeWithHop` (M) and `callWithHop` (CC) handle indirect routes
through bridges.  The hop logic is in `routing/callWithHop.js` —
which is on the refactor list (review §2.2).

### Discovery

`PeerGraph` (N) is a persistent peer directory.  Backed by an
`AsyncStorageAdapter` on RN, `MemorySource` in tests.

Discovery layers:
- transport-level peer-discovered events (BLE scan, mDNS Zeroconf,
  relay register-broadcast).
- `agent.enableAutoHello()` (R) does HI on every newly-discovered peer.
- `agent.startDiscovery()` runs a `GossipProtocol` (peer-list +
  reachable-peers) on a configurable interval.

### Skills

A skill is `{ id, handler, meta }`.  Register with
`agent.register(id, handler, meta)`.  The handler is `async (ctx) =>
parts | iterable<parts>`; `ctx` carries `{ parts, from, originFrom,
originVerified, envelope }`.

Core protocol skills (registered via `enableXxx` methods or
helpers — see Groups N, T, AA3, BB, CC, FF) live alongside app
skills in the same registry.  ARCHITECTURE-REVIEW.md §2.3 proposes
giving them a separate boundary; not done yet.

### A2A interop

`packages/core/src/a2a/` implements the A2A protocol bridge
(separate spec from our native protocol).  Treat as an external
adapter — it has its own transport (`A2ATransport`) and TLS layer.

---

## Reading order — new contributor

If you're trying to understand the codebase, read in this order:

1. **`ARCHITECTURE-REVIEW.md` §1** — package layout + send-path data flow.
   30 minutes.
2. **`packages/core/src/Agent.js`** — the composition root.  Big but
   skim the constructor, `start()`, `_dispatch()` first.  20 minutes.
3. **`packages/core/src/Envelope.js` + `Parts.js` + `Task.js`** — the
   wire types.  Small.  10 minutes.
4. **`packages/core/src/security/SecurityLayer.js`** — every
   envelope passes through this.  20 minutes.
5. **`packages/core/src/protocol/hello.js` + `taskExchange.js`** —
   the two protocols you'll see most often.  30 minutes.
6. **`Design-v3/00-Overview.md`** — the conceptual model behind it
   all.  20 minutes.
7. **One feature area you care about**, picked from the Groups table
   above.  Time-boxed.

After step 7 you should have enough context to do a non-trivial
contribution.  If a Group label in a commit message or comment is
unfamiliar, find it in this doc.

---

## Maintenance

- When you ship a new Group, add a row here (or in `CODING-PLAN.md`
  and let this doc point to it).
- If a feature gets renamed or moved, update the *Code* column.
- If a Group is fully superseded by a later one, mark it
  *(superseded by Group X)* rather than deleting — commit history
  will keep referencing it.
