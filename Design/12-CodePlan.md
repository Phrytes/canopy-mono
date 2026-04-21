# Code Plan

Implementation guide. Design decisions are in the other docs — this document is about how to build it. Read `00-DesignSummary.md` first.

---

## Repository structure

```
nkn-test/
  packages/
    core/                        @canopy/core
      src/
        identity/
          AgentIdentity.js
          Vault.js               (abstract base)
          VaultMemory.js
          VaultLocalStorage.js
          VaultIndexedDB.js
          VaultNodeFs.js
          VaultKeytar.js
          Mnemonic.js            (Phase 7)
          KeyRotation.js         (Phase 7)
        security/
          SecurityLayer.js
        transport/
          Envelope.js
          Transport.js           (abstract base)
          InternalTransport.js
          NknTransport.js
          MqttTransport.js
          RelayTransport.js         (Phase 4)
          LocalTransport.js
          RendezvousTransport.js     (Phase 4, optional — WS relay is sufficient for PoC)
        routing/
          RoutingStrategy.js     (Phase 3)
          FallbackTable.js       (Phase 3)
        protocol/
          hello.js
          ping.js
          messaging.js
          capDiscovery.js
          taskExchange.js
          session.js             (Phase 3)
          negotiation.js         (Phase 6)
          streaming.js           (Phase 3)
          fileSharing.js         (Phase 6)
          pubSub.js              (Phase 6)
        policy/
          PolicyEngine.js
        permissions/             (Phase 2+, extend over time)
          PermissionSystem.js
          TrustRegistry.js
          CapabilityVisibility.js
          PolicyGate.js
          CapabilityToken.js
          TokenRegistry.js
          DataSourcePolicy.js
        groups/
          GroupManager.js        (Phase 2, upgrade in Phase 6)
        state/
          StateManager.js        (Phase 3)
          Task.js
        storage/
          DataSource.js          (abstract base)
          MemorySource.js        (Phase 1 — in-memory Map, used in tests)
          IndexedDBSource.js
          FileSystemSource.js
          FileSystemAccessSource.js
          SolidPodSource.js      (Phase 7)
          SolidVault.js          (Phase 7)
        discovery/
          PeerGraph.js           (Phase 7, stub as AgentCache earlier)
          AgentCache.js          (Phase 2, replaced by PeerGraph in Phase 7)
          PeerDiscovery.js       (Phase 2)
          GossipProtocol.js      (Phase 7)
          PingScheduler.js       (Phase 7)
        config/
          AgentConfig.js         (Phase 7)
          ConfigCapability.js    (Phase 7)
        Agent.js
        AgentFile.js
        Blueprint.js
        BlueprintRegistry.js
        Emitter.js
      index.js
      package.json

    relay/                       @canopy/relay
      src/
        WsServerTransport.js
        RelayAgent.js
      index.js
      package.json

    react-native/                @canopy/react-native
      src/
        transport/
          MdnsTransport.js
          BleTransport.js
        storage/
          AsyncStorageAdapter.js
        identity/
          KeychainVault.js
      index.js
      package.json
```

Use npm workspaces or pnpm workspaces. Each package has its own `package.json`. `core` is a dependency of `relay` and `react-native`.

---

## Module dependency order

Read bottom-up: each module depends only on things listed above it.

```
Emitter.js
  ↓
Vault.js (abstract) + VaultMemory.js
  ↓
AgentIdentity.js           needs Vault to store private key
  ↓
Envelope.js                pure data, no dependencies
  ↓
SecurityLayer.js           needs AgentIdentity (sign/verify) + Envelope
  ↓
Transport.js               needs SecurityLayer + Envelope + Emitter
  ↓
InternalTransport.js       needs Transport
NknTransport.js            needs Transport
MqttTransport.js           needs Transport
  ↓
TrustRegistry.js           needs AgentIdentity (pubKey comparisons)
GroupManager.js            needs AgentIdentity + TrustRegistry
  ↓
PolicyEngine.js            needs TrustRegistry + GroupManager
  ↓
AgentCache.js / PeerGraph  needs pluggable storage backend
  ↓
hello.js, ping.js, etc.    needs Transport + TrustRegistry + AgentCache
  ↓
Agent.js                   needs everything above
  ↓
AgentFile.js               needs Agent + Blueprint
```

---

## Key interfaces

These are the contracts every module works against. Get these right and the modules are swappable.

### Vault

```js
class Vault {
  async get(key)           // → string | null
  async set(key, value)    // → void
  async delete(key)        // → void
  async has(key)           // → bool
  async list()             // → string[]
}
```

### Transport (what subclasses must implement)

```js
class Transport extends Emitter {
  get address() {}                      // this agent's address on this transport

  async connect() {}
  async disconnect() {}

  // THE ONLY METHOD SUBCLASSES MUST IMPLEMENT:
  async _put(to, envelope) {}           // send raw envelope bytes to `to`

  // Called by subclass on inbound message:
  _receive(envelope) {}                 // SecurityLayer verifies, then dispatches

  // These are provided by base class — do not override unless optimizing:
  async sendOneWay(to, payload) {}
  async sendAck(to, payload, timeout) {}
  async request(to, payload, timeout) {}
  async respond(to, replyToId, payload) {}
}
```

### DataSource

```js
class DataSource {
  async read(path)           // → Buffer | string | null
  async write(path, data)    // → void
  async delete(path)         // → void
  async list(prefix)         // → string[]
  async query(filter)        // → object[]  (optional)
}
```

### StorageBackend (for AgentCache / PeerGraph)

```js
class StorageBackend {
  async get(key)             // → any | null
  async set(key, value)      // → void
  async delete(key)          // → void
  async keys()               // → string[]
}
```

---

## Phase 1 — what to build first

Goal: two agents talk through InternalTransport with full security. No network needed.

**Build in this order:**

1. `Emitter.js` — tiny EventEmitter, 10 lines. Already exists in `sdk/`, check if it works as-is.

2. `VaultMemory.js` — Map-backed Vault. Simple.

3. `AgentIdentity.js`:
   ```js
   // On construction: check vault for existing key, else generate + store
   // Exposes:
   this.publicKey    // Uint8Array, Ed25519 public key
   async sign(data)  // fetch privKey from vault, sign, release
   static async create(vault)
   ```
   Use `@noble/ed25519` (audited, zero-dependency, works browser+Node+RN).

4. `Envelope.js`:
   ```js
   // Pattern codes as constants: HI OW AS AK RQ RS PB ST SE BT
   function mkEnvelope(p, payload, from, to, extra = {}) {
     return { _v: 1, _p: p, _id: uuid(), _re: null, _from: from, _to: to,
              _topic: null, _ts: Date.now(), _sig: null, payload, ...extra }
   }
   ```

5. `SecurityLayer.js`:
   ```js
   // Wraps a Transport instance. Intercepts _put and _receive.
   // Outbound:
   //   if _p === 'HI': sign only (payload stays plaintext)
   //   else: nacl.box encrypt payload, then sign
   // Inbound:
   //   verify sig
   //   check _ts window (±5 min)
   //   check dedup cache
   //   if _p !== 'HI': nacl.box.open
   //   dispatch
   ```
   Use `tweetnacl` (`nacl` in npm). Works browser+Node+RN without native modules.

6. `Transport.js` — abstract base. Pending-reply Map. Default implementations of the four primitives. `_receive` dispatches by `_p` code.

7. `InternalTransport.js`:
   ```js
   // Two instances share an InternalBus (EventEmitter).
   // _put: bus.emit('msg:' + to, envelope)
   // connect: bus.on('msg:' + this.agentId, (env) => this._receive(env))
   ```

8. **Test**: two InternalTransport agents, `request()` / `respond()`, encrypted envelopes, verified signatures. This is the Phase 1 done-criterion.

**Dependencies for Phase 1** (add to `core/package.json`):
```json
"@noble/ed25519": "^2.0.0",
"tweetnacl":      "^1.0.3",
"uuid":           "^9.0.0"
```

---

## Phase 2 additions

9. `AgentFile.js` — YAML parser (`js-yaml`). Reads agent definition, resolves blueprints, fills defaults. Returns plain object.

10. `Blueprint.js` + `BlueprintRegistry.js` — Blueprint is a plain object with capability presets. BlueprintRegistry is a Map with `register(name, blueprint)` and `resolve(name)` (walks inheritance chain, merges).

11. `TrustRegistry.js` — Map from pubKey → `{ tier, proofs[], tokens[] }`. Simple at first; extended in later phases.

12. `GroupManager.js` (v1) — sign and verify group membership proofs. Ed25519 sign over `{ memberPubKey, groupId, issuedAt, expiresAt }`. Expiry check. No revocation yet.

13. `PolicyEngine.js` (v1) — given peer tier and capability policy string, return allow/deny. Simple switch statement.

14. `AgentCache.js` — known peers, localStorage/IndexedDB/Map backend. Add/get/remove peers by pubKey. Will be replaced by `PeerGraph.js` in Phase 7 but the interface stays the same.

15. Protocol handlers: `hello.js`, `ping.js`, `messaging.js`, `capDiscovery.js`, `taskExchange.js`.

16. `Agent.js` — the developer-facing object. Owns transports, capability registry, peer registry. Routes inbound requests to capability handlers.

    Three equivalent registration styles, all mapping to the same internal registry:

    ```js
    // Style 1: inline registration
    const agent = new Agent({ id: 'home-agent' });
    agent.register('summarise',
      async ({ text }) => ({ summary: text.slice(0, 100) }),
      { visibility: 'group:home', policy: 'on-request' }
    );
    agent.registerStream('live-feed',
      async function* ({ topic }) { for await (const e of events(topic)) yield e; },
      { visibility: 'public', policy: 'negotiated' }
    );
    await agent.start();
    await agent.call(peerId, 'summarise', { text: '...' });

    // Style 2: defineCapability — importable, testable units
    import { defineCapability, defineStream, Agent } from '@canopy/core';

    const summarise = defineCapability('summarise',
      async ({ text }) => ({ summary: text.slice(0, 100) }),
      { visibility: 'group:home', policy: 'on-request' }
    );
    const liveFeed = defineStream('live-feed',
      async function* ({ topic }) { for await (const e of events(topic)) yield e; }
    );
    const agent = new Agent({ id: 'home-agent', capabilities: [summarise, liveFeed] });

    // Style 3: TypeScript decorators (optional TS-only layer, same result)
    class HomeAgent extends Agent {
      @capability({ visibility: 'group:home', policy: 'on-request' })
      async summarise({ text }) { return { summary: text.slice(0, 100) }; }

      @stream({ visibility: 'public' })
      async *liveFeed({ topic }) { for await (const e of events(topic)) yield e; }
    }
    ```

    `defineCapability(name, handler, opts)` returns `{ name, handler, opts }`. `agent.register()` and `@capability` both call the same internal `_registerCapability()`. Handler signature is always `(payload, context) => result` where `context` carries `{ peer, agent, token? }`.

---

## Phase 3 additions

17. `StateManager.js` — dedup cache (Map + TTL), session registry, stream registry, task registry. Inject into Transport base class.

18. `streaming.js` — uses session key (`nacl.box.before` + `nacl.secretbox`). Sender: async iterable → ST chunks → SE. Receiver: reassemble by `_seq`, yield chunks or deliver complete.

19. `RoutingStrategy.js` + `FallbackTable.js` — pick best transport per peer. Priority: `Internal > Local > mDNS > Rendezvous > Relay > NKN > MQTT > BLE`. Checks `transportFilter` from AgentConfig before ranking — skips transports not allowed for this peer/group. Automatic fallback on failure.

---

## Phase 4 additions (relay package)

20. `RelayTransport.js` (client) — WebSocket client to relay URL. `_put`: `ws.send(JSON.stringify(envelope))`. Auto-reconnect. Pure JS (browser, Node, React Native).

21. `WsServerTransport.js` — WebSocket server. `Map<agentId, WebSocket>`. On inbound: route by `_to`. Handles both relay mode (permanent proxy) and rendezvous signaling (forward SDP/ICE envelopes, then steps aside when DataChannel opens).

22. `RelayAgent.js` — extends `Agent`. Starts `WsServerTransport` on `agent.start()`.

23. `RendezvousTransport.js` (optional) — native `RTCPeerConnection`. Sends `webrtc-offer/answer/ice` payloads as OW messages through `RelayTransport`. Once DataChannel opens, `_put` uses it directly. Skip for PoC if relay latency is acceptable.

---

## Phase 5 additions (react-native package)

24. `KeychainVault.js` — `react-native-keychain` wrapper.
25. `AsyncStorageAdapter.js` — drop-in for `AgentCache` storage backend.
26. `MdnsTransport.js` — `react-native-zeroconf` wrapper. Advertises `_canopy._tcp`. On peer found: open WS to peer's address, then `_put` via that socket.
27. `BleTransport.js` — bootstrap only. Advertise agent address. On discover: read characteristic → get NKN/WS address → promote to higher transport.

---

## Phase 6 additions

28. `negotiation.js` — multi-turn RQ/RS. StateManager tracks negotiation ID + round.
29. `fileSharing.js` — file offer → BulkTransfer. StateManager reassembly.
30. `pubSub.js` — agent-as-broker. Subscriber list in StateManager. Push on update.
31. **GroupManager upgrade** — replace HMAC-SHA256 proofs with Ed25519 (if not already done). Expiry check, background renewal.

---

## Phase 7 additions

32. `Mnemonic.js` — `@scure/bip39` wrapper. `generateMnemonic()` → string. `mnemonicToSeed(str)` → Uint8Array.
33. `SolidPodSource.js` + `SolidVault.js` — LDP HTTP via `@inrupt/solid-client`. WebID-OIDC auth via `@inrupt/solid-client-authn-browser` / `*-node`.
34. `KeyRotation.js` — build/sign/verify rotation proof. Broadcast to peers. Publish to pod.
35. `PeerGraph.js` — replaces `AgentCache`. Full peer record (see `09-Discovery.md`). Same storage backend interface.
36. `PingScheduler.js` — background ping loop with exponential backoff.
37. `GossipProtocol.js` — peer list exchange. Respects `discoverable` flag.
38. `AgentConfig.js` — layered config store with ceiling enforcement.

---

## Testing strategy

**Unit tests** (fast, no network): always use `InternalTransport`. Two agents on a shared bus. Test protocol logic, security layer, policy engine.

**Integration tests** (slower): two Node.js processes, one real transport (NKN or MQTT). Test that envelopes survive the wire, security layer rejects tampered messages, routing fallback works.

**React Native**: manual testing on device or emulator for native modules. Automate what you can with Jest + `react-native-testing-library` for the pure-JS parts.

**Platform smoke tests**: run the same basic `request/respond` test in a browser (via a simple HTML page), in Node.js, and in React Native. If all three pass, the core is portable.

---

## Coding conventions

- Every module that is a class exports the class as default. No singleton instances exported from modules.
- Async everywhere. No sync I/O.
- Errors thrown, not returned. Protocol-level errors (policy rejected, unknown peer) use a typed `AgentError` with a `code` field so callers can distinguish.
- Platform detection: check `typeof window`, `typeof process`, `typeof navigator` — do not import platform-specific modules at the top of `core` files. Use dynamic imports or constructor injection (e.g. pass the vault backend in, don't hardcode it).
- `@canopy/core` must have zero native dependencies. If a module needs a native capability, it is in `react-native` or `relay` package, injected via interface.
