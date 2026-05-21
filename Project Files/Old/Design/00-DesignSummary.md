# Design Summary — Complete Context for Continuing Work

This document is a self-contained orientation for continuing development of this project. Read it first, then consult the numbered design docs for detail. Everything here reflects decisions that have already been made and should not be re-opened unless the user explicitly asks.

---

## What this project is

A portable, decentralized agent SDK for JavaScript. The goal is to let web and mobile apps become agents that can discover each other, exchange messages, transfer data, and delegate tasks — without requiring a central server. Users own their agent identity and data.

**Grant context**: NLnet PoC. The design is intentionally more complete than the PoC requires so that implementation choices do not paint the project into corners.

**Author**: the author (GitHub: the-author).

---

## Three packages

```
@canopy/core          Pure JS. Runs unchanged in browser, Node.js, React Native.
                        All transport logic, agent layer, protocol, security, storage.

@canopy/relay         Node.js only. Relay/rendezvous server agent.
                        WsServerTransport handles both relay routing and WebRTC signaling.

@canopy/react-native  Native extras for React Native.
                        MdnsTransport (react-native-zeroconf)
                        BleTransport  (react-native-ble-plx, bootstrap only)
                        KeychainVault (react-native-keychain, hardware-backed)
```

The old code in `sdk/` is incomplete and largely superseded by the Design/ docs. It can be read for original intent but should not be treated as authoritative.

---

## Design document map

| File | What it covers |
|------|---------------|
| `01-Overview.md` | Vision, goals, non-goals, package map, relay concept |
| `02-Architecture.md` | Full layer model; annotated module map for all three packages; agent object shape; pub-sub model |
| `03-Transport.md` | Four primitives; envelope format; SecurityLayer (hello = signed only, others = nacl.box); session keys for streaming; all transport implementations; support matrix; routing strategy |
| `04-AgentFile.md` | YAML format for single and multi-agent; blueprint inheritance; policy values; export/import semantics |
| `05-Relay.md` | Rendezvous vs relay modes; WsServerTransport; relay as first-class agent; deployment; security boundary |
| `06-Roadmap.md` | Seven phases with done-criteria; dependency graph |
| `07-Storage.md` | Vault interface + all backends; agent cache; DataSource interface + all implementations; platform summary; Internal vs Local transport |
| `08-Permissions.md` | Four-layer permission model; trust tiers 0-3; capability visibility; policy gates; capability tokens (UCAN-inspired); data source access control; multi-agent within app; developer authority ceiling |
| `09-Discovery.md` | Eight discovery routes; PeerGraph (extended AgentCache); peer record structure; query API; gossip protocol; discovery policy YAML; peer cleanup defaults; agent file loading API |
| `10-SolidPod-Identity.md` | Mnemonic seed recovery; key rotation design; SolidPod as first-class backend (vault + agent file + peer graph + data); bootstrapping flow; module additions |
| `11-Revocation-Note.md` | Out-of-scope design sketch for token/proof revocation; three propagation options; PoC mitigation via short lifetimes |

---

## Key architectural decisions (do not re-open)

### Transport layer

- **Four primitives** live directly on the `Transport` base class: `sendOneWay`, `sendAck`, `request`, `respond`. The old `PatternHandler` class is eliminated.
- **`_put(to, envelope)`** is the only method a subclass must implement. All security, envelope construction, and pending-reply management come from the base class for free.
- **SecurityLayer is not optional** and wraps every `_put()` call. It is Phase 1, not retrofitted later.

### `hello` is signed, not encrypted

The very first message between agents cannot use `nacl.box` because `nacl.box` requires the recipient's public key, which is only known after the hello exchange. The hello payload (agent card: public key, public capabilities, transport addresses) is inherently public information anyway. Decision: `hello` (`_p: 'HI'`) is **Ed25519 signed but not encrypted**. After hello, both parties have each other's public keys and all subsequent messages use full encryption.

### Two encryption modes

| Message type | Encryption | Signature |
|-------------|-----------|-----------|
| `HI` (hello) | None — plaintext | Ed25519 |
| All others | `nacl.box` (per message) | Ed25519 |
| `ST`/`SE`/`BT` (stream/bulk) | `nacl.secretbox` with session key | Ed25519 on envelope |

### Session keys for streaming

Per-chunk `nacl.box` is too expensive for streaming. After hello, both sides independently derive a shared session key:

```js
const sessionKey = nacl.box.before(peerPubKey, myPrivKey);
// Per chunk:
const nonce = buildNonce(streamId_16bytes, seqNumber_8bytes);  // 24 bytes total
const encrypted = nacl.secretbox(chunk, nonce, sessionKey);
```

`nacl.box.before()` pre-computes the X25519 shared secret from Ed25519 keys (libsodium handles the conversion). No extra handshake message needed — both sides derive the same key independently.

### Identity

Every agent has one Ed25519 keypair. The public key is the stable identity. All transport addresses (NKN, MQTT topic, relay URL) are aliases that change freely. The private key lives in the Vault, never exported.

NKN addresses are deterministically derived from the public key — no separate NKN identity.

### Identity recovery and key rotation

The Ed25519 seed is encoded as a BIP39 24-word mnemonic on first run. The user writes it down. Recovery on a new device = enter mnemonic → same keypair, same identity. This is the only recovery path that requires no external service.

Key rotation (planned keypair change) uses a signed rotation proof — signed by the old private key, naming the new public key. The proof is broadcast peer-to-peer to all known peers via `sendOneWay`. Old key stays valid for a configurable grace period (default 7 days).

### Relay architecture

The relay is a normal agent with two extra capabilities:
- **Rendezvous** (`RendezvousTransport`): WebRTC DataChannel. Signals through the relay via OW envelopes, then goes direct P2P. Relay steps aside once the DataChannel opens.
- **Relay** (`RelayTransport`): WS proxy. Always in the data path. Used when WebRTC fails or is not yet implemented. Both use the same `connections.relay.url`.

**The relay is the TURN server equivalent.** When WebRTC fails, the WS relay fallback handles it. No separate TURN infrastructure needed.

**React Native and WebRTC**: For the PoC, React Native uses `RelayTransport`. `RendezvousTransport` in React Native needs `react-native-webrtc` (native module) — deferred post-PoC. `RelayTransport` is sufficient.

### Solid Pod (first-class, not future work)

SolidPod is the primary user-owned backend for:
- Vault (encrypted private key, tokens, group proofs)
- Agent file hosting (public or private; if public, also works as a discovery endpoint)
- PeerGraph backup
- App data (DataSource)

`SolidPodSource` and `SolidVault` are in `@canopy/core`. The `@inrupt` auth libraries are peer dependencies (not bundled). See `10-SolidPod-Identity.md`.

### Revocation

Out of scope for the PoC. PoC mitigation: short token lifetimes + background renewal for legitimate holders. Design sketch for future implementation is in `11-Revocation-Note.md`. Do not implement in the PoC phases.

### Trust tiers

```
0 = Unknown      — first contact, no prior relationship
1 = Verified     — public key in local registry (accepted hello or manual add)
2 = Group member — valid, unexpired group proof for a shared group
3 = Token holder — holds a valid capability token issued by this agent
```

Tiers are additive: a peer can be Tier 1 + Tier 3 simultaneously (verified AND holds a token).

### Capability visibility

```
public         → visible to everyone including Tier 0
authenticated  → Tier 1+
group:<id>     → Tier 2 members of that group
token:<cap>    → Tier 3 holders of a valid token for that capability
private        → never revealed externally
```

Visibility is **not a one-time event** — peers re-query capability discovery as their trust tier increases.

**Discoverability** (for gossip) is a separate `discoverable: true/false` flag on the agent, independent of capability visibility. An agent with no capabilities can still be discoverable.

### Developer authority ceiling

The user file is the permission ceiling. The developer can only restrict, never expand. Runtime config mutations are validated against the user file ceiling before applying. See `08-Permissions.md`.

### Agent file

YAML format. Loaded via `AgentFile.js` which handles parsing, blueprint resolution, and defaults. The SDK provides `Agent.fromFile()`, `Agent.fromUrl()`, `Agent.fromFileObject()`, `Agent.fromSolidPod()`, `Agent.fromYaml()`, etc. How users create and manage their agent files is outside SDK scope (could be manual editing, a companion UI, or a hosted service).

### Blueprint vs Group

These are orthogonal concepts that are frequently confused:
- **Blueprint** = what kind of agent this is ("household-agent", "drone-operator"). A named, reusable preset of capability policies, resource limits, and hooks. Inheritance is allowed. It is a developer-level concept.
- **Group** = who this agent belongs to. A cryptographic membership (Ed25519-signed proof). It is a user/social concept.

### Pub-sub

Agent-as-broker pattern — no external broker needed. One agent owns a topic and maintains a subscriber list. Push: publisher sends one-way to each subscriber. Pull: subscriber calls request on publisher on demand. Subscribe/unsubscribe are standard request-response. See `02-Architecture.md`.

### mDNS / BLE

- **mDNS** (LAN discovery): React Native (`react-native-zeroconf`) and Node.js (`bonjour-service`). Not available in pure browser. Advertises `_canopy._tcp`.
- **BLE**: Full bidirectional transport, not just bootstrap. Works without internet — the primary use case is devices with no WiFi or mobile data. MTU-level chunking inside `_put()`/`_receive()` makes all patterns work; large transfers are slow (~100–300 kbps). Can still be used for bootstrap/address-exchange and handoff to a faster transport when one is available.
- **Browser agents** that need LAN-level connectivity use the WS relay as fallback.

### InternalTransport vs LocalTransport

- **InternalTransport**: same JS runtime (same browser tab or Node.js process). Uses an EventEmitter bus. Zero network. Used for unit tests and same-app multi-agent.
- **LocalTransport**: same physical machine, different processes. Uses localhost WebSocket or Unix domain socket. Desktop/server only — iOS and Android prevent inter-process localhost communication.

### Routing priority

```
Internal > Local > mDNS > Rendezvous > Relay > NKN > MQTT > BLE
```

- mDNS before Rendezvous: LAN is local and fast; Rendezvous requires internet for signaling
- Rendezvous before Relay: both need internet, but Rendezvous is direct P2P once open
- NKN/MQTT before BLE: higher bandwidth when internet is available
- BLE last: always works offline, but slowest

`RoutingStrategy` also checks `transportFilter` from the agent config — transports not in the allowed list for a given peer or group are skipped regardless of availability.

---

## Roadmap phases (summary)

| Phase | Goal | Key milestone |
|-------|------|---------------|
| 1 | Transport + security | Two agents via InternalTransport with encrypted, signed envelopes |
| 2 | Agent layer + protocol basics | Browser + Node exchange messages and tasks over NKN/MQTT |
| 3 | State + advanced patterns | 1 MB stream over NKN, session open/close, RoutingStrategy working |
| 4 | Relay agent | Browser agents exchange messages through relay, then establish direct WebRTC |
| 5 | React Native | RN app discovers desktop agent via mDNS, completes a task exchange |
| 6 | Protocol completions | File transfer, negotiation, pub-sub, GroupManager Ed25519 upgrade |
| 7 | Identity + SolidPod | Agent restored on new device from mnemonic + SolidPod; key rotation verified |

Phases 4 and 5 are parallel after Phase 3. Phase 7 requires Phase 6 (GroupManager complete).

---

## Modules that do not exist yet in old code

Everything in the Design/ docs is design only. The `sdk/` directory has partial, mostly-superseded implementations of:
- `Transport.js` (base class, needs update for new primitives)
- `NknTransport.js` (working, needs porting to new base class)
- `MqttTransport.js` (working, needs porting)
- `PatternHandler.js` (to be deleted — logic moved to Transport base)
- `Envelope.js` (needs update for new fields and HI code)

New modules not yet written (in implementation order):
```
Phase 1:  SecurityLayer.js, AgentIdentity.js, VaultMemory.js, VaultLocalStorage.js,
          InternalTransport.js (update), Envelope.js (update), Transport.js (update)
Phase 2:  Agent.js, AgentFile.js, Blueprint.js, BlueprintRegistry.js,
          PolicyEngine.js, hello.js, ping.js, messaging.js, capDiscovery.js,
          taskExchange.js, Task.js
Phase 3:  StateManager.js, session.js, streaming.js, fileSharing.js (partial),
          RoutingStrategy.js, FallbackTable.js
Phase 4:  RelayTransport.js, WsServerTransport.js, RelayAgent.js,
          RendezvousTransport.js (optional)
Phase 5:  (in @canopy/react-native) MdnsTransport.js, BleTransport.js, KeychainVault.js,
          AsyncStorageAdapter.js
Phase 6:  negotiation.js, pubSub.js, fileSharing.js (complete), GroupManager.js (upgrade)
Phase 7:  SolidPodSource.js, SolidVault.js, Mnemonic.js, KeyRotation.js,
          PeerGraph.js (replaces AgentCache), PingScheduler.js, GossipProtocol.js,
          AgentConfig.js, ConfigCapability.js
```

---

## Things to check before starting Phase 1

1. **`hello` handler stores pubKey before any encrypted message can be sent.** The SecurityLayer must check: if no pubKey is known for `_from`, and `_p !== 'HI'`, reject with a clear error (not a decrypt failure).
2. **Session key derivation happens after hello completes**, not before. The `nacl.box.before()` call needs the peer's pubKey from the hello exchange.
3. **`_from` in hello is the agent's public key** (or an NKN address derived from it). After hello, `_from` on all subsequent messages must match this key or a known transport alias.
4. **Vault never holds plaintext private key in memory longer than necessary.** The `sign()` method on AgentIdentity takes data, fetches the private key from vault, signs, and releases. It does not cache the private key.

---

## Design decisions still open (minor)

These are unresolved but not blocking Phase 1-3:

- How `discoverable: true` is conveyed in a mDNS TXT record (when an mDNS-discovered agent should or should not appear in gossip)
- `RendezvousTransport` in `@canopy/core` is pure JS (browser + Node). React Native needs `react-native-webrtc` — that variant lives in `@canopy/react-native`, deferred post-PoC.
- Exact SolidPod credential bootstrapping on very first run with no existing vault (OIDC login flow varies by platform and provider)
