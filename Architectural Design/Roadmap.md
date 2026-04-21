# Roadmap — Portable Decentralized Agents SDK

**Date**: 2026-04-14
**Target platforms**: Browser (web app) · React Native (iOS + Android)

---

## Phase 1 — Foundation hardening
**Goal**: the SDK core is solid, testable without a real network, and peers can negotiate what they support.

**What to build:**

`InternalTransport` — a transport that connects two agents in the same JS process via a shared EventEmitter. Takes no network, instant delivery. Used for all unit tests going forward. Both sides share one bus object; each side subscribes to its own address channel.

```js
const bus = new InternalBus();
const t1 = new InternalTransport(bus, 'agent-a');
const t2 = new InternalTransport(bus, 'agent-b');
```

`canDo` in agent card — add a `patterns` field to the agent card (the object exchanged during `hello`). When Agent A connects to Agent B, both now know which interaction patterns the other supports. PatternHandler can then pick the right fallback automatically without guessing.

```js
// agent card gains:
{ ..., patterns: ['one-way', 'ack-send', 'request-response', 'pub-sub'] }
```

`AgentCache` portability — `AgentCache` currently uses `localStorage` directly. Wrap storage access behind a simple interface so React Native can swap in `AsyncStorage` without touching the rest of the code.

**Done when**: you can write a test that creates two agents connected via `InternalTransport`, runs a request-response, and it passes. No network required.

---

## Phase 2 — Protocol layer: extract from demo.html into SDK
**Goal**: all agent interactions that currently live in `demo.html` exist as proper SDK modules with clean APIs.

**What to build:**

`hello.js` — sent immediately on transport connect. Contains the agent card (name, capabilities, patterns, group memberships). Receiver stores peer in PeerRegistry and replies with its own card. Two-way: A sends hello → B replies hello.

```
A →── hello (agent card) ──→ B
A ←── hello (agent card) ──← B
```

`ping.js` — sendAck to peer, returns round-trip latency in ms. Useful for health checks and transport selection.

`messaging.js` — send a payload to a peer. Uses AckSend by default; falls back to OneWay if peer doesn't support AckSend (learned from their agent card). Developer receives a delivery confirmation or a timeout error.

`capDiscovery.js` — explicitly request an agent card from a peer (outside of the hello handshake). Useful for refreshing a stale card or querying a peer you got via gossip but never connected to directly.

`taskExchange.js` — wire `Task.js` (which already has the state machine) into the actions layer. Sender submits a task offer; receiver accepts, rejects, or ignores per policy; if accepted, receiver updates state (working → completed/failed) and sender tracks it.

```
submitted → [peer accepts] → working → completed
                          ↘ failed
          → [peer rejects] → rejected
```

`PolicyEngine` v1 — extract the `handleMessage` policy logic from `demo.html` into a proper module. Inputs: inbound envelope + peer trust tier. Output: allow / reject / queue-for-manual. Covers: accept_all, group_only, manual, skill_whitelist. Used by every inbound action handler.

**Done when**: you can run the full task flow between two agents using only SDK imports, with no demo.html code involved.

---

## Phase 3 — Routing + state
**Goal**: agents with multiple transports pick the right one per peer automatically, and stateful interactions (sessions, streams) have a home.

**What to build:**

`RoutingStrategy` — given a peer address and an action name, return the best PatternHandler to use. Inputs: peer's known transport addresses + `canDo` capabilities (from PeerRegistry), action's preferred pattern list, current transport connection status. Default priority: Internal > BLE > mDNS/WiFi > NKN > MQTT. Developer can override per agent or per action.

```js
agent.send(peerId, data, { prefer: ['ack-send', 'one-way'] });
// RoutingStrategy picks: best connected transport that canDo('ack-send')
```

`FallbackTable` — a per-peer cache of `{ transport → last-known-latency, canDo-set }`. Updated after every interaction. Used by RoutingStrategy to avoid re-probing on every send.

`StateManager` — owns all mutable interaction state:
- **Dedup cache**: `Map<envelopeId, timestamp>` — TTL 5 min, prevents replay and double-delivery from scream mode
- **Session registry**: `Map<sessionId, { peer, state, handler, created }>` — open sessions and their handlers
- **Stream registry**: `Map<streamId, { peer, chunks, expected, handler }>` — in-progress streams
- **Task registry**: `Map<taskId, Task>` — pending/active tasks (migrates from Agent.js)

`Session` pattern — implement the stub. Uses StateManager. Both sides hold a `session` object with `send()`, `on('message')`, `close()`. Session ID is the original `hello` envelope ID. Close is a one-way send; both sides clean up their registry entry.

`Streaming` pattern — implement the stub. Sender iterates an async iterable and sends chunks with `{ _p: 'ST', _sid, _seq }`. Final chunk carries `_p: 'SE'`. Receiver reassembles in order by `_seq`, delivers complete payload or yields chunks as they arrive. Uses StateManager for reassembly buffer.

**Done when**: two agents can open a session, exchange messages, close it, and state is cleaned up. A streaming send of 1 MB across NKN or MQTT works without data loss.

---

## Phase 4 — Security
**Goal**: all envelopes are signed by sender and encrypted for recipient. Group proofs expire and can be revoked. Private keys never leave the device.

**What to build:**

`AgentIdentity` — generates an Ed25519 keypair on first run. Public key becomes the stable agent identity (NKN address is derived from it automatically). Private key goes to `Vault`.

`Vault` — thin storage wrapper for private key material:
- Browser: `localStorage` with an in-memory cache (PoC-level; not production-hardened)
- React Native: `react-native-keychain` (hardware-backed secure storage on iOS/Android)

`SecurityLayer` — wraps every outbound envelope before `_rawSend`, unwraps every inbound before `_receive`:
- **Sign**: `Ed25519.sign(privKey, id + from + to + ts + hash(payload))` → `sig` field
- **Verify**: reject envelope if sig doesn't match sender's known public key
- **Encrypt**: `nacl.box(payload, nonce, recipientPubKey, senderPrivKey)` — payload is ciphertext
- **Decrypt**: `nacl.box.open(...)` — fails loudly if key mismatch or tampered

Group proof upgrade — currently HMAC-SHA256. Align with Ed25519: group admin signs `{ memberPubKey, groupId, issuedAt, expiresAt }` with their private key. Any member can verify with the admin's public key, no secret shared. Add expiry check + revocation cache to `GroupManager.verify()`.

Blocklist — `Set<publicKeyHash>` checked before processing any inbound envelope. `agent.peers.block(pubKey)` adds to the set; persisted to Vault storage.

**Done when**: a tampered envelope is rejected at the receiver. A group proof with a past `expiresAt` is rejected. A blocked agent's envelope is dropped silently.

---

## Phase 5 — React Native transports
**Goal**: the SDK runs in a React Native app with native LAN discovery and BLE.

**Platform note**: the SDK core (NKN, MQTT, PatternHandler, all actions) is pure JS and runs unchanged in React Native. Only the native-API-dependent transports need React Native-specific code. The SDK itself stays platform-agnostic; native transports are optional add-ons.

**What to build:**

`MdnsTransport` (React Native) — uses `react-native-zeroconf`:
- Advertise `_canopy._tcp` service on a random port with agent address in TXT record
- Browse for peers: on `up` event, open WebSocket to found peer, register in PeerRegistry
- Degrade gracefully if plugin unavailable (pure browser, no mDNS)
- Same logic as `WifiDirectTransport` in HANDOFF.md, but using `react-native-zeroconf` instead of `bonjour-service`

`BleTransport` (React Native) — uses `react-native-ble-plx`:
- Peripheral: advertise with agent address in local name (truncated to 20 chars)
- Central: scan for `_canopy` service UUID, connect, exchange agent cards
- Primary use: bootstrap only — exchange NKN/MQTT/mDNS address via BLE, then promote to higher-bandwidth transport
- Not designed for bulk data (BLE MTU ~512 bytes, slow)

Background execution:
- Android: foreground service via `react-native-background-actions` — persistent notification, keeps NKN/MQTT connected
- iOS: restricted. NKN/MQTT stay connected while app is in foreground. Use APNs for wakeup when backgrounded. VoIP push (PushKit) for persistent connection if needed — but Apple audits VoIP usage strictly. Accept limitation for PoC.

Storage adaptation:
- Replace `localStorage` calls in `AgentCache` and `PolicyEngine` with the storage interface introduced in Phase 1
- Inject `AsyncStorage` from `@react-native-async-storage/async-storage`

**Done when**: a React Native app and a browser app can discover each other on the same LAN via mDNS, without any QR code or manual address entry.

---

## Phase 6 — Advanced patterns + file sharing
**Goal**: large data can be transferred reliably between agents.

**What to build:**

`BulkTransfer` — chunked, sequenced, acknowledged transfer for large payloads:
- Sender: split buffer into N chunks of configurable size (default 64 KB), send each as `{ _p: 'BT', _bid, _seq, _total, payload: base64chunk }`
- Receiver: collect all chunks keyed by `_bid + _seq`, reassemble on `_total` received
- Reliability: sender waits for AckSend per chunk (or per N chunks, configurable)
- Out-of-order: receiver sorts by `_seq` before reassembly

`fileSharing` action — built on BulkTransfer:
- Sender sends a file offer: `{ protocol: 'file-offer', name, size, mimeType }`
- Receiver accepts/rejects (policy applies)
- If accepted, sender initiates BulkTransfer
- Receiver delivers to app as a Blob or Buffer

`negotiation` action — multi-turn request-response using StateManager:
- Each turn is a standard RequestResponse
- StateManager tracks negotiation ID, current round, proposals
- App defines what "accepted" and "rejected" look like per negotiation type

**Done when**: two agents can transfer a 10 MB file over NKN or MQTT without corruption, and the transfer survives a brief transport interruption via retry.

---

## Future — Out of PoC scope

- `PolicyEngine` v2: event-driven, conditional, negotiated policies
- User control layer: OutboundMiddleware + companion UI + REST/WebSocket endpoint
- Solid Pod storage integration
- Key rotation protocol (sign new pubkey with old privkey, broadcast rotation proof)
- Task-capability matcher (auto-route tasks to peers with matching capabilities)
- Layered discovery (only reveal peer addresses to group members)
- Dedup cache persistence (survive app restart)

---

## Key risks

| Risk | Mitigation |
|---|---|
| Phase 3 (state + routing) blocks everything interesting | Design StateManager interface before starting Phase 3 implementation |
| Pub-sub over P2P doesn't scale | Document as known limitation; keep network small for PoC |
| iOS background execution | Accept limitation for PoC; NKN works in browser tab; RN foreground service covers Android |
| Developer override authority | User file = ceiling; developer can restrict but not expand — enforce in PolicyEngine |
| Agent card missing pattern support | Add `patterns: [...]` field in Phase 1 before any protocol work |
| react-native-zeroconf Android NSD bugs | Test early; have NKN/MQTT as fallback for all LAN scenarios |
