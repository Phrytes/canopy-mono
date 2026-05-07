# Architecture

---

## Layer model

```
┌─────────────────────────────────────────────────────────────────┐
│                         APPLICATION                             │
│           developer code + user agent file                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                        AGENT LAYER                              │
│                                                                 │
│  Agent          identity · capabilities · peer registry        │
│  AgentFile      load + parse YAML/JSON agent definition        │
│  Blueprint      named capability + policy preset               │
│  GroupManager   cryptographic group membership                 │
│  RoutingStrategy  pick best transport per peer per action      │
│  PolicyEngine   gate inbound actions per trust tier            │
│  StateManager   session/stream/task state + dedup cache        │
└──────────┬──────────────────────────────────┬───────────────────┘
           │                                  │
           │            ┌─────────────────────▼──────────────────┐
           │            │      [future] USER CONTROL LAYER       │
           │            │  OutboundMiddleware · RuleEngine       │
           │            │  ActivityLog · ConfirmationQueue       │
           │            └─────────────────────┬──────────────────┘
           │                                  │
┌──────────▼──────────────────────────────────▼──────────────────┐
│                      PROTOCOL LAYER                             │
│               actions, run according to policy                  │
│                                                                 │
│  hello · ping · messaging · capDiscovery · taskExchange        │
│  session · negotiation · streaming · fileSharing               │
│  pubSub (agent-as-broker model)                                │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                     TRANSPORT LAYER                             │
│                                                                 │
│  Transport base class                                          │
│  ├── Four primitives (default envelope-based implementations)  │
│  │   sendOneWay · sendAck · request · respond                  │
│  ├── SecurityLayer (encrypt/sign outbound, verify/decrypt in)  │
│  ├── Inbound dispatch (OW/AS/RQ/RS/AK/PB/ST/SE/BT)            │
│  └── _put(to, envelope)  ← only method subclasses must impl.  │
└──────┬──────┬──────┬──────┬──────┬──────┬───────┬─────────────┘
       │      │      │      │      │      │       │
   Internal  Local   NKN  MQTT  Rendezvous  Relay  mDNS   BLE
  (in-app) (device)  (*)   (*)     (*)      (*)    (RN)  (RN)

(*) = pure JS, works in browser, Node, React Native
Internal  = same JS runtime (EventEmitter, no network, used for tests + in-app multi-agent)
Local     = same physical machine, different process (localhost WebSocket or Unix socket)
```

---

## Module map

```
@canopy/core
  src/
    Agent.js
      The main object a developer instantiates. Owns transports, capability
      registry, peer registry, and routes inbound protocol actions to the
      right handler. Developer registers JS functions as capabilities here.

    AgentFile.js
      Parses and validates the user's YAML/JSON agent definition file.
      Resolves blueprint inheritance, fills defaults, returns a plain object
      that Agent.js can consume. Also handles agent.export() serialisation.

    Blueprint.js + BlueprintRegistry.js
      A blueprint is a named, reusable preset of capability policies, resource
      limits, and hooks — think of it as a "type label" for an agent. Blueprints
      can extend other blueprints (inheritance). They are orthogonal to groups:
      a blueprint describes what kind of agent this is ("household-agent",
      "drone-operator"); a group describes who it belongs to.

      BlueprintRegistry holds all known blueprints. Apps can register built-in
      blueprints at startup; users can define custom ones in their agent file.

      Resolution: capability lists MERGE up the chain (child adds to parent).
      Scalar fields (policy, resources) OVERRIDE (child wins). Circular
      inheritance is rejected at parse time.

    identity/
      AgentIdentity.js
        Generates an Ed25519 keypair on first run. The public key is the
        agent's stable identity — all group proofs, signatures, and NKN
        addresses are anchored to it. Exposes sign() for envelope signing.

      Vault.js  (abstract base)
        Stores private key material. Never holds plaintext keys in memory
        longer than needed. Pluggable — swap the backend per platform.
        Interface: get(key), set(key, value), delete(key), has(key).

      VaultMemory.js       In-memory map. Tests and ephemeral server agents.
      VaultLocalStorage.js Browser localStorage. PoC-level security.
      VaultIndexedDB.js    Browser IndexedDB. Better for larger secrets.
      VaultNodeFs.js       Node.js encrypted file on disk (AES-256-GCM).
                           Used by relay server and Node.js desktop agents.
      VaultKeytar.js       Node.js OS keychain via `keytar` npm package.
                           Wraps macOS Keychain, Windows Credential Manager,
                           Linux libsecret. Best security for desktop.
      — React Native: KeychainVault.js in @canopy/react-native —
      — Online vaults: OnlineVaultAdapter.js — see Storage doc —

    security/
      SecurityLayer.js
        Wraps every _put() call on every transport.
        Outbound: encrypt payload with nacl.box(recipientPubKey), add _sig.
        Inbound: verify _sig, check _ts window, check dedup cache, decrypt.
        Not optional — always active. Relay sees ciphertext only.

    transport/
      Transport.js
        Abstract base class. Provides the four primitives as default
        envelope-based implementations. Pending-reply map lives here.
        Inbound dispatch by _p code. Subclasses only implement _put().

      Envelope.js
        Envelope format definition and mkEnvelope() factory. Sets _from,
        _to, _id, _ts at construction time (not per-transport injection).

      InternalTransport.js
        In-process EventEmitter. Two instances share an InternalBus object.
        No network, synchronous delivery. Used for unit tests and for
        multiple agents within the same JS app instance.

      LocalTransport.js
        Connects two agents on the same physical machine but in different
        processes. Uses a localhost WebSocket or Unix domain socket.
        Use case: a browser tab agent talking to a Node.js relay running
        on the same machine, or a desktop app talking to a local IoT daemon.

      NknTransport.js      Pure JS. Browser + Node + React Native.
      MqttTransport.js     Pure JS. Browser + Node + React Native.
      RelayTransport.js      WebSocket client → relay server. Always in path.
                             Pure JS — browser, Node, React Native.
      RendezvousTransport.js WebRTC DataChannel via native RTCPeerConnection.
                             Signaling sent as OW messages through any available
                             transport (typically RelayTransport). Once DataChannel
                             opens, relay is out of the path. Pure JS (browser/Node).
                             React Native needs react-native-webrtc — deferred to
                             post-PoC. Optional — RelayTransport is sufficient for PoC.

    routing/
      RoutingStrategy.js
        Given a peer address and a required pattern, picks the best
        transport. Default priority:
        Internal > Local > mDNS > Rendezvous > Relay > NKN > MQTT > BLE
        Falls back automatically on failure. mDNS preferred over Rendezvous
        (local LAN vs internet). Rendezvous preferred over Relay (direct P2P
        vs always-relayed). NKN/MQTT above BLE (higher bandwidth when internet
        available). BLE last — always works, but slowest.
      FallbackTable.js
        Per-peer cache of {transport → last latency, pattern support}.
        Updated after every interaction. Prevents re-probing on every send.

    policy/
      PolicyEngine.js
        Gates every inbound protocol action against the peer's trust tier
        (unknown / verified / group-member) and the action's declared
        policy (always / on-request / negotiated / group:<id> / never).

    state/
      StateManager.js
        Dedup cache (envelope ID → ts, TTL 5 min).
        Session registry (sessionId → {peer, handler, state}).
        Stream registry (streamId → {chunks, expected, handler}).
        Task registry (taskId → Task instance).

    protocol/
      hello.js         Exchange agent cards on connect. Two-way.
      ping.js          sendAck round-trip, measures latency.
      messaging.js     sendAck with fallback to sendOneWay.
      capDiscovery.js  Request a peer's agent card explicitly.
      taskExchange.js  Task offer → accept/reject → working → done/fail.
      session.js       Stateful multi-message exchange (needs StateManager).
      negotiation.js   Multi-turn request-response (needs StateManager).
      streaming.js     Async iterable → chunked ST/SE envelope sequence.
      fileSharing.js   File offer → BulkTransfer → Blob/Buffer delivery.
      pubSub.js        Agent-as-broker: subscribe/publish/unsubscribe.

    groups/
      GroupManager.js
        Ed25519-signed group membership proofs. Admin signs a token
        containing memberPubKey, groupId, issuedAt, expiresAt. Any peer
        can verify against the admin's public key — no server needed.
        Handles expiry checks, revocation cache, and background renewal.

    storage/            (see Storage doc for full detail)
      DataSource.js     Abstract base for app data sources.
      IndexedDBSource.js
      FileSystemSource.js   Node.js only.
      SolidPodSource.js     
      GoogleDriveSource.js  Future.

    discovery/
      PeerDiscovery.js  Gossip-based peer discovery over any transport.
      AgentCache.js     Known-peer cache. Pluggable storage backend
                        (localStorage / AsyncStorage / IndexedDB / file).

  index.js

@canopy/relay
  src/
    RelayAgent.js
      Agent subclass. Starts WsServerTransport and Rendezvous alongside
      its normal transports. Registers relay and rendezvous capabilities.
      Can act as group admin. Deployable as a Docker container.
    WsServerTransport.js
      WebSocket server. Map<agentId, socket>. Routes envelopes by _to.
      Optional offline queue per peer (configurable TTL).
      Also handles WebRTC signaling — since signaling is just envelope
      forwarding, no separate signaling server is needed.
  index.js

@canopy/react-native
  src/
    transport/
      MdnsTransport.js    react-native-zeroconf. LAN discovery + WebSocket.
      BleTransport.js     react-native-ble-plx. Full bidirectional transport.
                          MTU-level chunking inside _put()/_receive() — transparent
                          to all layers above. Works without internet. All patterns
                          supported; large transfers are slow (~100-300 kbps).
    storage/
      AsyncStorageAdapter.js  Drop-in replacement for localStorage in
                              AgentCache and other core storage uses.
    identity/
      KeychainVault.js    react-native-keychain. Hardware-backed secure
                          storage on iOS (Secure Enclave) and Android (Keystore).
  index.js
```

---

## Agent object shape

```js
{
  id:         "alice-home",          // user-facing slug (not an address)
  blueprint:  "household-agent",     // named preset label
  label:      "Home assistant",      // display name
  publicKey:  "<ed25519-pubkey>",    // stable identity — all security anchors here

  capabilities: {
    "summarise": {
      handler:    <fn>,
      style:      "request-response",
      visibility: "group:home",      // public | group:<id> | private
      policy:     "on-request"       // always | on-request | negotiated
    },
    "live-feed": {
      handler:    <fn>,
      style:      "streaming",
      visibility: "public",
      policy:     "negotiated"
    }
  },

  connections: {                     // transport addresses — change freely
    nkn:      { address: "abc123.nkn" },
    mqtt:     { broker: "wss://...", address: "a3f9d2b0" },
    ws:       { url: "wss://relay.example.com" },
    mdns:     { hostname: "alice-home.local" },   // RN only
  },

  groups: [
    { id: "home",         adminPubKey: "...", proof: "<signed-token>" },
    { id: "neighborhood", adminPubKey: "...", proof: "<signed-token>" }
  ],

  policy: {
    ping:       "always",
    messaging:  "on-request",
    streaming:  "negotiated",
    taskAccept: "negotiated"
  },

  resources: {
    maxPendingTasks: 5,
    maxConnections:  20,
    perGroup: {
      home:         { maxPendingTasks: 5 },
      neighborhood: { maxPendingTasks: 1 }
    }
  },

  storage: {
    cache:      "memory",
    persistent: "local-encrypted",
    sources: [
      { label: "private", type: "solid-pod",  url: "https://..." },
      { label: "app",     type: "indexeddb",  name: "myapp-db"  }
    ]
  },

  hooks: {
    onTask:    ["log-locally"],
    onMessage: ["log-locally"]
  }
}
```

`agent.export()` serialises this without runtime state, secrets, or resolved credentials. `Agent.from(json)` re-hydrates it. Private key stays in the Vault, never in the export.

---

## Pub-sub model

Pub-sub is not a separate infrastructure concern. It is an **agent-as-broker** pattern:

- One agent owns a topic and maintains a subscriber list
- **Push**: publisher sends one-way to each subscriber when topic has new data
- **Pull**: subscriber calls `request` on the publishing agent on demand

Subscribe/unsubscribe are standard request-response exchanges. The publishing agent applies its normal visibility and policy rules to each subscriber. If the publisher goes offline, subscribers fall back to polling via another transport — the same resilience logic used for any unreachable peer.

This requires no external broker and is fully P2P-compatible.
