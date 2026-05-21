# Architecture Plan — Portable Decentralized Agents SDK

**Date**: 2026-04-14
**Status**: Design / planning

---

## Caveats

**1. Routing strategy is a real gap, not just a `??`**
Flagged in design notes but undesigned everywhere. `Agent.js` currently just picks the first connected transport. A concrete model is needed: static priority (BLE > WiFi > NKN > MQTT), context-aware (network type, battery), or per-peer negotiated. This affects the whole Agent Core.

**2. "Internal agents" as a transport is missing and actually important**
Listed in transport layer ideas but doesn't exist anywhere in the codebase or design docs. An in-process EventEmitter-based transport (same JS runtime) is needed for: testing, same-device multi-agent setups, and app-internal agent-to-agent calls. Without it, you can't unit test the protocol layer without a real network.

**3. Developer override vs. user authority is unresolved**
Safety.txt identifies malicious app as the top threat, but doesn't specify the actual authority model. Who wins when the developer wants to add BLE and the user's file says no BLE? Needs an explicit rule: user file defines the allowed envelope; developer can restrict but not expand user permissions.

**4. "How does the receiver know it should ack?" — partially answered, but with a dependency**
The `_p` field in the envelope handles this. But for it to work, the receiver must understand that pattern. This means capability exchange (the `hello`/agent card) needs to include **pattern support** — not just skill names. A receiver that only does OW will silently drop AS messages. Currently the agent card design doesn't include `canDo()` info.

**5. Pub-sub simulated over P2P transports breaks at scale**
Over NKN/BLE/WiFi Direct, pub-sub must be simulated with repeated sends to known addresses. This breaks when you have unknown subscribers — you'd have to broadcast to all known peers. Fine for small networks; needs to be documented as a known limitation, and the PatternHandler's `subscribe()` fallback path needs this clarification.

**6. State is a cross-cutting concern without a home**
Sessions and streams require state on both sides. There's no StateManager anywhere. The `Session.js` and `Streaming.js` stubs exist but have no state model. This is a real architectural gap that blocks implementation of those patterns.

**7. Policy conditionality is much harder than current model**
Desired: "conditional behavior: with certain events, on request, after consultation." The existing policy model (accept_all / group_only / manual / skill_whitelist) is static. Event-driven and negotiated policies require a significantly more complex rule engine. Separate into "policy v1" (static, ship now) and "policy v2" (event-driven, future).

**8. Browser-level user control is a separate product, not a feature**
Safety.txt has this as Layer 4 with a REST API, a confirmation queue, and an activity log. This is substantial — essentially a middleware daemon + companion UI. Not in scope for the PoC core SDK, but needs to be architecturally reserved as a slot.

---

## Architecture Sketch

```
┌────────────────────────────────────────────────────────────────────┐
│                      Agent Properties File                          │
│  YAML/JSON: id · keypair ref · transports · groups · policy · role │
└─────────────────────────────┬──────────────────────────────────────┘
                              │ load
┌─────────────────────────────▼──────────────────────────────────────┐
│                          AGENT CORE                                 │
│                                                                     │
│  AgentIdentity       keypair (Ed25519), stable ID = public key     │
│  AgentFile           parse + validate YAML, merge role             │
│  CapabilityRegistry  add/remove/broadcast caps at runtime          │
│  PeerRegistry        known peers: pubkey → {card, transports}      │
│  RoutingStrategy     select transport per peer per action          │
│  [!] StateManager    session state, stream state, pending tasks    │
└──────┬──────────────────────────────────┬──────────────────────────┘
       │                                  │
       │           ┌──────────────────────▼─────────────────────────┐
       │           │         [!] BROWSER LAYER (future)             │
       │           │  OutboundMiddleware · RuleEngine · ActivityLog │
       │           │  ConfirmationQueue · REST endpoint             │
       │           └──────────────────────┬─────────────────────────┘
       │                                  │
┌──────▼──────────────────────────────────▼─────────────────────────┐
│                        PROTOCOL LAYER                               │
│                 (actions, according to policy)                      │
│                                                                     │
│  hello          one-way send, on connect                           │
│  ping           request-response                                   │
│  messaging      ack-send | one-way                                 │
│  capDiscovery   request-response                                   │
│  taskExchange   request-response + state machine                   │
│  session        session pattern + state                            │
│  negotiation    request-response (multi-turn)                      │
│  streaming      streaming pattern                                  │
│  fileSharing    bulk-transfer | streaming                          │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────────┐
│                   INTERACTION PATTERN LAYER                         │
│                   PatternHandler (per transport)                    │
│                                                                     │
│  OneWay · AckSend · RequestResponse · PubSub                       │
│  [!] Streaming · [!] BulkTransfer · [!] Session                    │
│                                                                     │
│  Envelope: {id, replyTo, from, to, pattern, protocol, payload, ts} │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────────┐
│                     TRANSPORT ABSTRACTION                           │
│              Transport: connect · disconnect · _rawSend · canDo    │
└─┬──────┬────────┬─────────┬──────────┬──────────┬──────────────────┘
  │      │        │         │          │          │
NKN   MQTT    PeerJS    WiFi/mDNS    BLE      [!] Internal
 ✓      ✓        ✓       partial     stub      missing
```

### Cross-cutting modules (not in a layer, used everywhere)

| Module | Description |
|---|---|
| `GroupManager` | sign/verify group membership proofs, expiry, revocation |
| `RoleRegistry` | role definitions + inheritance resolution |
| `[!] SecurityLayer` | envelope signing (Ed25519) + encryption (box) |

`[!]` = designed but not yet implemented, or structurally missing.

---

## Module Overview

```
canopy-sdk/
  src/
    Agent.js                  core agent object
    AgentFile.js              YAML/JSON parser + validator
    AgentIdentity.js          [!] keypair management, signing

    transport/
      Transport.js            abstract base + canDo() + PATTERNS constants
      NknTransport.js         ✓ working
      MqttTransport.js        ✓ working
      PeerJSTransport.js      ✓ working
      BleTransport.js         stub
      WifiDirectTransport.js  Electron only (in HANDOFF)
      [!] InternalTransport.js  in-process EventEmitter transport

    patterns/
      Envelope.js             ✓ message format + P codes
      PatternHandler.js       ✓ OW / AS / AK / RQ / RS / PB
      [!] Session.js          stub — needs StateManager
      [!] Streaming.js        stub — needs StateManager
      [!] BulkTransfer.js     stub

    protocol/
      Task.js                 ✓ task state machine
      [!] hello.js            on-connect handshake
      [!] ping.js
      [!] messaging.js
      [!] capDiscovery.js
      [!] taskExchange.js     wire Task.js to actions
      [!] session.js
      [!] negotiation.js
      [!] streaming.js
      [!] fileSharing.js

    [!] routing/
      RoutingStrategy.js      select transport per peer per action
      FallbackTable.js        per-peer transport capability cache

    [!] state/
      StateManager.js         session state, stream state, dedup cache

    [!] security/
      SecurityLayer.js        Ed25519 sign/verify, box encrypt/decrypt
      Vault.js                private key storage (localStorage / OS keychain)

    [!] policy/
      PolicyEngine.js         v1: static (accept_all / group_only / manual / whitelist)
      [future] RuleEngine.js  v2: event-driven, conditional, negotiated

    roles/
      Role.js                 ✓ role definition + inheritance resolver
      RoleRegistry.js         ✓ named registry

    groups/
      GroupManager.js         ✓ HMAC-SHA256 group proofs

    discovery/
      AgentCache.js           ✓ peer cache (localStorage-backed)
      PeerDiscovery.js        ✓ gossip discovery

    [future] browser-layer/
      OutboundMiddleware.js   intercept all outbound sends
      RuleEngine.js           match + action: allow/block/confirm/log
      ActivityLog.js
      ConfirmationQueue.js
      RestEndpoint.js         GET/POST /agents/:id/activity|confirm|pending

  index.js
```

---

## Roadmap

### Phase 1 — Foundation (largely done, needs hardening)
- Solidify Transport interface + PatternHandler ✓
- NKN + MQTT transports working ✓
- Add `InternalTransport` (EventEmitter, same process) — enables testing without network
- Add pattern support (`canDo` info) to agent card exchange so peers know what patterns a peer supports

### Phase 2 — Protocol layer: extract from demo.html into SDK
- `hello`, `ping`, `messaging`, `capabilityDiscovery` actions
- Task state machine (`Task.js` exists — wire it to actions as `taskExchange`)
- `PolicyEngine` v1: static (accept_all / group_only / manual / skill_whitelist)

### Phase 3 — Routing + state
- `RoutingStrategy`: priority list + per-peer fallback table
- `StateManager`: session state, stream state, dedup cache
- `Session` and `Streaming` patterns (depend on StateManager)

### Phase 4 — Security
- `SecurityLayer`: Ed25519 sign/verify on every envelope
- `Vault`: private key storage (localStorage for browser, OS keychain for Electron/Tauri)
- Group proofs: expiry, revocation, refresh background task
- Blocklist by public key

### Phase 5 — Additional transports
- WiFi Direct / mDNS (Electron + Tauri — architecture in HANDOFF.md)
- BLE (Electron + Capacitor)

### Phase 6 — Advanced patterns
- `BulkTransfer` protocol (chunked, seq-numbered)
- `fileSharing` action (request + bulk/stream)
- `negotiation` action (multi-turn request-response)

### Future — Out of PoC scope
- `PolicyEngine` v2: event-driven, conditional, negotiated policies
- Browser-level user control (OutboundMiddleware + companion UI + REST endpoint)
- Solid Pod storage
- Key rotation protocol
- Task-capability matcher (auto-route tasks to capable peers)

---

## Key risks

| Risk | Mitigation |
|---|---|
| Phase 3 (state + routing) is a dependency of everything interesting | Prioritize StateManager design before coding patterns |
| Pub-sub over P2P doesn't scale | Document as known limitation; keep network small for PoC |
| iOS background execution | Use NKN (works in browser on mobile); native app needs React Native or Tauri |
| Developer can abuse override authority | Define explicit authority model: user file = ceiling, developer can only restrict |
| Agent card doesn't include pattern support | Add `patterns: [...]` field to agent card in Phase 1 |
