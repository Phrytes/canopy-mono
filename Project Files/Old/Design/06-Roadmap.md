# Roadmap

---

## Phase 1 — Core foundation
**Goal**: a working, testable transport layer. Two agents can exchange all four primitives without a real network. Security is wired in from the start.

### Transport base class
Implement `Transport.js` with:
- Four primitives as methods with default envelope-based implementations
- Pending-reply map (was PatternHandler) built in
- `_put(to, envelope)` as the sole override point for subclasses
- Inbound dispatch by `_p` code (emits `message`, `request`, `publish`, `stream`, `bulk`)
- SecurityLayer hook: every `_put` call passes through encrypt+sign before hitting the wire; every `_receive` call passes through verify+decrypt before dispatch

### Envelope
`Envelope.js` defines the format and `mkEnvelope()` helper. All fields including `_from`, `_to`, `_ts` are set at construction time by the base class — not by the subclass.

### SecurityLayer + AgentIdentity
`AgentIdentity.js`: generate Ed25519 keypair on first run, expose `publicKey` and `sign()`.
`Vault.js`: pluggable storage. Ship `VaultMemory` (test) and `VaultLocalStorage` (browser). React Native ships `KeychainVault` separately.
`SecurityLayer.js`: `encrypt(payload, recipientPubKey)` + `sign(envelope, privKey)` outbound; `verify` + `decrypt` inbound. Used by Transport base class automatically.

### InternalTransport
In-process EventEmitter transport. Two instances share a `Bus`. Zero network. Used for all unit tests and same-device multi-agent.

### NknTransport + MqttTransport
Port existing working implementations to the new base class. Both only need to implement `_put`.

**Done when**: a test creates two agents via `InternalTransport`, calls `request()`, and gets a response — with encrypted, signed envelopes, verified on receipt. No network required.

---

## Phase 2 — Agent layer + protocol basics
**Goal**: Agent object is usable by a developer. Basic interactions work end-to-end.

### Agent class
- Load from agent file (YAML/JSON via `AgentFile.js`)
- Start all configured transports in parallel
- Register capabilities with handlers
- Route inbound requests to capability handlers automatically
- Export/import (`agent.export()` / `Agent.from(json)`)
- Blueprint inheritance (`Blueprint.js`, `BlueprintRegistry.js`)

### Protocol: hello, ping, messaging, capDiscovery
`hello.js` — sent on connect; contains agent card (id, publicKey, capabilities, patterns). Both sides store peer in PeerRegistry, reply with their card.
`ping.js` — `sendAck` to peer, measures round-trip latency.
`messaging.js` — `sendAck` by default, falls back to `sendOneWay` if peer capability card says so.
`capDiscovery.js` — explicit `request` for a peer's agent card (refresh or first contact via gossip).

### PolicyEngine v1 (static)
Gate every inbound protocol action against the peer's trust tier:
- Tier 0 (unknown): ping + capDiscovery only
- Tier 1 (verified peer): messaging + task offers
- Tier 2 (group member): full capability access per group scope
Static modes: `accept_all`, `on-request`, `group:<id>`, `never`.

### taskExchange
Wire `Task.js` state machine to actions. Sender submits task offer → receiver accepts/rejects per policy → accepted tasks transition `working → completed | failed`. Sender tracks state via events.

**Done when**: two agents (browser + Node) can connect via NKN or MQTT, exchange agent cards, send a message, submit a task, and get a result — all with encrypted envelopes.

---

## Phase 3 — State + advanced patterns
**Goal**: stateful interactions (sessions, streams) work. Multi-transport routing is automatic.

### StateManager
- **Dedup cache**: `Map<envelopeId, ts>`, TTL 5 min — prevents replay and double delivery
- **Session registry**: `Map<sessionId, { peer, state, handler }>` — open sessions
- **Stream registry**: `Map<streamId, { chunks[], expected, handler }>` — reassembly buffers
- **Task registry**: `Map<taskId, Task>` — move from Agent.js

### Session pattern
Both sides hold a `Session` object: `send(payload)`, `on('message', fn)`, `close()`. Session ID is the opening RQ envelope ID. StateManager tracks open sessions. `close()` sends a one-way SE and cleans up both sides.

### Streaming pattern
Sender iterates an async iterable, sends ST chunks with `{ _sid, _seq }`. Final `SE` closes the stream. Receiver reassembles by `_seq` using StateManager. Delivers complete payload or yields chunks as they arrive.

### BulkTransfer pattern
Chunked acknowledged transfer. Sender splits buffer into N chunks (default 64 KB), sends each as BT with `{ _bid, _seq, _total }`. Receiver collects into StateManager, reassembles on `_total`. Sender waits for per-chunk or per-batch AK.

### RoutingStrategy
- Priority: Internal > BLE > mDNS > NKN > MQTT > WS (relay)
- Checks peer's known transport addresses + pattern requirements
- FallbackTable: per-peer latency + canDo cache, updated after each interaction
- Automatic fallback chain on failure

**Done when**: two agents can stream 1 MB over NKN without data loss. Session open/close/message works. RoutingStrategy picks NKN over MQTT when both are available.

---

## Phase 4 — Relay agent
**Goal**: a deployable relay agent. Browser and mobile agents can bootstrap from a stable URL.

### RelayTransport (client)
WebSocket client to a relay URL. `_put` sends envelope over socket. Auto-reconnect on disconnect. Used by any agent (browser, mobile, Node) that wants to reach the relay.

### WsServerTransport (relay side)
WebSocket server. Maintains `Map<agentId, WebSocket>`. On incoming envelope: registers `_from`, looks up `_to`, forwards raw envelope unchanged. Optional offline queue per peer (TTL configurable).

### RelayAgent (`@canopy/relay`)
`Agent` subclass that starts `WsServerTransport` alongside its normal transports. Registers a `relay` capability. No separate signaling server — WebRTC signaling is handled by forwarding regular envelopes through the relay. Easy to deploy as a Docker container.

### RendezvousTransport (optional, same phase)
Uses the browser-native `RTCPeerConnection` API directly — no PeerJS dependency. Signaling messages (`webrtc-offer`, `webrtc-answer`, `webrtc-ice`) are sent as regular OW payloads via whatever transport is currently available (typically WS relay). Once the DataChannel opens, `_put` sends over it and the relay is out of the path. Can be omitted from the PoC if WS relay latency is acceptable — WebRTC is a latency optimization, not a correctness requirement.

**Done when**: a browser agent with no NKN address connects to a deployed relay over WSS. A second browser agent does the same. They exchange messages through the relay. Optionally: they establish a direct WebRTC DataChannel via the relay-as-signaling and continue without the relay.

---

## Phase 5 — React Native (`@canopy/react-native`)
**Goal**: the SDK runs in a React Native app with native LAN discovery and BLE.

**Note**: `@canopy/core` is pure JS and already runs unchanged in React Native. This phase adds native-only extras.

### Storage + vault
`AsyncStorageAdapter.js` — replaces `localStorage` in `AgentCache`, injectable via the storage interface from Phase 1.
`KeychainVault.js` — uses `react-native-keychain` for hardware-backed private key storage.

### MdnsTransport
`react-native-zeroconf` based. Advertises `_canopy._tcp`. On peer discovery, opens a WebSocket to found peer. Same envelope flow as RelayTransport once connected. Degrades gracefully on web (mDNS not available).

### BleTransport
`react-native-ble-plx` based. Bootstrap only — not for bulk data. Advertises agent address in BLE local name. On peer discovery, exchanges NKN/MQTT/WS address via BLE characteristic, then promotes to higher-bandwidth transport.

### Background execution
Android: `react-native-background-actions` — foreground service keeps NKN/MQTT connected with a persistent notification.
iOS: NKN/MQTT stay connected while app is in foreground. APNs for background wakeup. Accept iOS limitation for PoC — VoIP push (PushKit) for persistent connection if required later.

**Done when**: a React Native app discovers a desktop agent via mDNS on the same LAN, without QR code or manual address entry, and completes a task exchange.

---

## Phase 6 — Protocol completions
**Goal**: all declared protocol actions are implemented. File sharing and negotiation work.

### fileSharing
Sender sends a file offer: `{ protocol: 'file-offer', name, size, mimeType }`. Receiver accepts/rejects. If accepted, sender initiates BulkTransfer. Receiver delivers as `Blob` or `Buffer`.

### negotiation
Multi-turn request-response. Each turn is a standard RQ/RS. StateManager tracks negotiation ID and round. Developer defines acceptance/rejection criteria. Used by task exchange for policy-gated offers.

### pubSub (agent-as-broker)
`subscribe` and `unsubscribe` are standard request-response. Publishing agent maintains a subscriber list, sends one-way to each subscriber on topic update. Pull model: subscriber calls `request` on publisher on demand.

### GroupManager upgrade
Align group proofs with Ed25519 (replacing HMAC-SHA256). Proof: admin signs `{ memberPubKey, groupId, issuedAt, expiresAt }`. Add expiry check, revocation cache, background renewal before expiry.

**Done when**: two agents negotiate a task, transfer a 10 MB file over MQTT, and group proof expiry + renewal works correctly.

---

## Phase 7 — Identity persistence + Solid Pod

**Goal**: Agent identity survives device loss. Agent file, peer graph, and vault are backed by user-owned storage. Multi-device use works without manual setup.

See `Design/10-SolidPod-Identity.md` for the full design.

### Mnemonic seed recovery
Every agent's Ed25519 keypair is generated from a 32-byte seed representable as a BIP39 24-word mnemonic. On first run, the SDK presents this mnemonic to the user once for safekeeping. Recovery on a new device = enter mnemonic → same keypair, same identity, same NKN address.

```js
const { agent, mnemonic } = await Agent.createNew({ ... });
// mnemonic: "correct horse battery staple ..."
// user writes it down — this is the only recovery key
```

### Key rotation
An agent can rotate its Ed25519 keypair while keeping its identity continuous:
1. Generate new keypair from a new mnemonic (or derive it)
2. Sign a rotation proof: `{ _type: 'key-rotation', oldPubKey, newPubKey, ts, sig_by_old_key }`
3. Broadcast rotation proof to all known peers via `sendOneWay` and publish to SolidPod
4. Known peers update their PeerGraph entry; group admins re-issue group proofs for the new key
5. Old key stays valid for a configurable grace period (default: 7 days)

New peers that were never part of the network can verify the rotation chain by fetching the rotation proof from the SolidPod URL published in the agent's profile.

### Solid Pod integration
Full `SolidPodSource` implementation (LDP + WebID-OIDC). A SolidPod can back:
- **Vault**: encrypted private key and tokens stored at a private container on the pod
- **Agent file**: YAML file hosted on the pod, loadable via `Agent.fromSolidPod(url)`
- **PeerGraph**: serialised peer graph backed up to pod on change
- **Group proofs + capability tokens**: backed up to pod, survive device loss

```yaml
vault:
  backend: solid-pod
  url:     https://alice.solidpod.example/vault/
  credential: vault:solid-pod-token     # bootstrapped from local vault on first run

storage:
  sources:
    - label:  private
      type:   solid-pod
      url:    https://alice.solidpod.example/data/
      credential: vault:solid-pod-token
```

**Done when**: an agent is restored on a new device from mnemonic only, with full peer graph and group memberships recovered from its SolidPod. Key rotation proof is published and verified by a peer.

---

## Future (out of PoC scope)

- **PolicyEngine v2**: event-driven, conditional, negotiated policies
- **User control layer**: OutboundMiddleware + RuleEngine + ActivityLog + REST endpoint — lets the user see and approve outbound traffic from a companion UI
- **Task-capability matcher**: auto-route tasks to peers with matching capabilities, including gossip-based delegation ("I can't do this but I know who can")
- **Layered discovery**: only reveal peer addresses to group members
- **Multi-relay resilience**: agent connects to multiple relays simultaneously, relay mesh for redundancy
- **Offline message queue**: relay queues envelopes for offline peers beyond the short TTL
- **Local server package**: mDNS + relay + NKN node in a single self-hostable package for neighborhood/community use
- **Token revocation propagation**: see `Design/11-Revocation-Note.md`

---

## Dependency graph

```
Phase 1 (transport + security)
    ↓
Phase 2 (agent + protocol basics)   ←─ usable SDK starts here
    ↓
Phase 3 (state + patterns)
    ↓                    ↘
Phase 4 (relay)       Phase 5 (React Native)
    ↓                    ↓
Phase 6 (protocol completions — needs Phase 3 + GroupManager upgrade)
    ↓
Phase 7 (identity persistence + SolidPod)
```

Phases 4 and 5 are independent of each other and can run in parallel after Phase 3.
Phase 7 depends on Phase 6 (GroupManager must be complete for group proof re-issuance on key rotation).
