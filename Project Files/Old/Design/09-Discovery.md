# Discovery, Network Model, and Configuration

---

## Scope

This document covers three interconnected concerns:

1. **Agent discovery** — how agents find each other (multiple routes, each for a different context)
2. **PeerGraph** — the per-agent internal model of the network (who is reachable, at what latency, with which capabilities)
3. **Runtime configuration** — how agent parameters are read, changed, and protected at runtime
4. **Group peer caps** — limiting how many active connections come from a given group

For reference: capability visibility (`public / authenticated / group: / token: / private`) is fully specified in `08-Permissions.md`. Streaming and bulk transfer are defined in `03-Transport.md` and Phase 3 of `06-Roadmap.md`. This document builds on both.

---

## Discovery mechanisms

There is no single discovery mechanism — different contexts call for different routes. All routes converge at the same endpoint: a `hello` exchange that registers the peer in the local PeerGraph.

### Route overview

| Route | How | When to use |
|-------|-----|-------------|
| Static address | NKN/WS address in agent file | Known server agents, relay bootstraps |
| QR / manual entry | User scans QR or types address → `hello` | First contact with a personal agent |
| Contact forwarding | Agent A sends Agent B's card in a message to Agent C | Social introduction, "meet my colleague" |
| Group bootstrap | On group join, admin optionally shares member list | Building a workgroup automatically |
| Task-triggered | Accepting a task from an unknown sender registers them | Organic discovery through work |
| LAN (mDNS) | Automatic broadcast, no config — Node.js + React Native | Same-network use cases |
| BLE | Bootstrap only — exchange transport addresses, promote to NKN/MQTT/mDNS | First contact on mobile |
| Gossip | Background peer-list sharing between trusted peers | Expanding the network gradually |

---

### Static address

The simplest route. The agent file lists known peers directly:

```yaml
peers:
  - id:      relay-01
    pubKey:  "<ed25519-pubkey>"
    connections:
      nkn: { address: "abc123.nkn" }
      ws:  { url: "wss://relay.example.com" }
```

On startup the agent sends a `hello` to each listed peer and receives their current agent card. Static peers are always registered at Tier 0 first; trust advances through the normal tier progression.

---

### QR code / manual entry

Used when two users want to connect their agents without any shared infrastructure. The agent card (id, publicKey, transport addresses) is encoded as a QR code or a short URL-safe string. Scanning or pasting triggers a `hello` exchange over any available transport.

The QR code payload is the minimal bootstrap envelope:

```js
{
  id:      "alice-home",
  pubKey:  "<ed25519-pubkey>",
  label:   "Alice's home agent",
  transports: {
    nkn:  "abc123.nkn",
    ws:   "wss://relay.example.com"
  }
}
```

This is enough for the receiving agent to initiate contact. After the `hello` exchange the full agent card (filtered by visibility tier) is received and stored.

---

### Contact forwarding

An agent can share another agent's bootstrap card in the payload of any message. This is a protocol-level primitive, not application-specific:

```js
// Agent A introduces Agent C to Agent B
await agentA.introduce(agentB.id, agentC.card);

// Internally sends a message to B:
// { _type: 'introduction', card: agentC.bootstrapCard }
```

On receiving an introduction:
1. The receiving agent checks its own policy: `discovery.acceptIntroductions: 'from-trusted' | 'always' | 'never'`
2. If accepted, it stores the card at Tier 0 and optionally sends an automatic `hello`
3. It records _who_ made the introduction (useful for trust reasoning and audit)

The introducer is not an authority — trust still starts at Tier 0. But the introduction can carry a signed endorsement if the introducer is a group admin, which may immediately advance the peer to Tier 2.

---

### Group bootstrap

When an agent joins a group (receives a signed group proof from an admin), the admin can optionally include a partial member list in the join response:

```js
// GroupManager receives join-response from admin:
{
  groupProof: { ... },           // signed membership token
  members: [                     // optional bootstrap list
    { pubKey: "...", label: "Bob's device", transports: { nkn: "...", ws: "..." } },
    { pubKey: "...", label: "Relay-01",     transports: { ws: "wss://..." } }
  ]
}
```

The member list is signed by the admin (same key as the group proof). Receiving agents contact new peers with a `hello` that includes their group proof, so the new peer can immediately verify Tier 2 trust.

Whether the admin shares the full member list, a partial list, or none at all is a group policy decision controlled by the admin.

---

### Task-triggered discovery

When an agent receives a task offer from a previously unknown peer, successfully completing and acknowledging the task implicitly registers that peer in the PeerGraph at Tier 0. The agent does not need to do anything explicit — the protocol handler records `_from` on every inbound envelope.

This supports organic network growth: agents discover each other through work, not through an explicit connection step.

If the agent's policy allows task offers from Tier 0 (configurable), this route works without any prior setup. If it requires Tier 1 or higher, the unknown sender will receive a rejection and need to verify first.

---

### LAN (mDNS)

Available on Node.js (`bonjour-service`) and React Native (`react-native-zeroconf`). Not available in pure browser contexts.

On startup, an agent with mDNS configured advertises a `_canopy._tcp` service record containing its agent ID, public key fingerprint, and supported transport addresses. Other agents on the same LAN receive the advertisement automatically. A `hello` exchange follows over WebSocket (mDNS opens a direct WS connection on discovery).

```yaml
connections:
  mdns:
    hostname: alice-home.local   # advertised hostname
    port: 0                      # 0 = auto-assign
```

mDNS peers are prioritised by RoutingStrategy (ahead of NKN, MQTT, relay) because they are typically lowest latency. If the LAN peer also has NKN/MQTT addresses, those are recorded as fallbacks.

---

### BLE (React Native)

Bluetooth LE is for bootstrap only — it carries no data beyond transport addresses. On discovery:

1. Agent A detects Agent B's BLE advertisement (contains B's agent ID and public key)
2. A reads a BLE characteristic on B that contains B's NKN + WS addresses
3. A promotes to mDNS or NKN using those addresses, then proceeds with `hello`

BLE is used only when mDNS is unavailable (different networks, or one party is browser-only and the other mobile). After bootstrap, BLE can be disconnected — it has done its job.

```yaml
connections:
  ble:
    advertise: true      # advertise address in BLE local name
    scan:      true      # scan for nearby agents
```

---

### Gossip

Gossip is an opt-in background protocol for expanding the network beyond directly known peers. An agent periodically requests a partial peer list from one of its trusted peers (Tier 1+). The responder filters the list before sending — it only shares peers whose cards have `public` capability visibility, or peers that are already known to both parties.

```yaml
discovery:
  gossip:
    enabled:       true
    interval:      3600        # seconds between gossip rounds
    maxPeersPerRound: 5        # how many new peers to request per round
    minTrustTier:  1           # only gossip with Tier 1+ peers
```

**Privacy rule**: an agent never reveals to peer B that it knows peer C, unless C has set `discoverable: true` in their agent file. Discoverability is independent of capability visibility — an agent with no public capabilities can still be discoverable (its card will simply show no capabilities to Tier 0 peers). Group membership and private peer relationships are never gossiped.

**Flow**:
```
Agent A  →  request('peer-list', { count: 5 })  →  Agent B (trusted)
Agent B  →  respond(filtered-public-peer-cards)  →  Agent A
Agent A  →  hello  →  each new peer
```

New peers discovered via gossip start at Tier 0. Trust advances normally.

---

### All routes converge at `hello`

Every discovery route ends with a `hello` exchange. `hello.js` is responsible for:
1. Sending the agent's own card (filtered to the current tier of the receiver)
2. Receiving the peer's card (storing in PeerGraph)
3. Setting the initial trust tier
4. Triggering a `capDiscovery` refresh if the peer's card is already stale in the graph

After `hello`, the peer is in the graph and RoutingStrategy can route to them.

---

## PeerGraph

The PeerGraph is the per-agent internal model of the network. It is the extended `AgentCache` — not just a list of known peers, but a live view of reachability, capabilities, latency, and trust state.

### Per-peer record

```js
{
  pubKey:           "<ed25519-pubkey>",    // stable identity
  id:               "alice-home",         // human slug from their card
  label:            "Alice's home agent", // display name
  blueprint:        "household-agent",    // declared blueprint (if any)

  trustTier:        2,                    // current tier (0-3)
  groupMemberships: ["home", "work"],     // groups in common (verified proofs held)

  capabilities:     {                     // filtered card at current trust tier
    "summarise":  { style: "request-response", policy: "group:home" },
    "live-feed":  { style: "streaming",         policy: "negotiated" }
  },

  transports: {
    nkn:  { address: "abc123.nkn",              lastLatencyMs: 120,  lastSeen: timestamp },
    mqtt: { address: "a3f9d2b0",                lastLatencyMs: 210,  lastSeen: timestamp },
    ws:   { url:     "wss://relay.example.com", lastLatencyMs: 45,   lastSeen: timestamp }
  },

  reachable:        true,
  unreachableSince: null,               // set when all transports fail
  lastSeen:         timestamp,          // last successful interaction
  lastPing:         timestamp,

  discoveredVia:    "gossip",           // route that added this peer
  introducedBy:     "<pubKey>",         // if via introduction
}
```

### Keeping the graph current

**Passive updates** (on every successful interaction):
- `lastSeen` refreshed
- Latency updated in FallbackTable
- If peer sent a card (`hello` or `capDiscovery` response), capabilities updated

**Active updates** (background):
- Periodic ping to each known peer (configurable interval)
- On ping failure: mark transport as degraded, try next transport
- On all transports failing: set `reachable: false`, `unreachableSince: timestamp`
- On recovery: set `reachable: true`, clear `unreachableSince`, re-run `hello` to refresh card

**Capability refresh**:
- `capDiscovery` is re-issued when a peer's trust tier increases (they may now reveal more capabilities)
- The card has a short TTL (configurable, default 1 hour): after expiry, the next interaction triggers a background refresh

### Query API

```js
agent.peers.all()
// → PeerRecord[]

agent.peers.reachable()
// → PeerRecord[]  (reachable: true)

agent.peers.withCapability('summarise')
// → PeerRecord[]  (current tier's card includes 'summarise')

agent.peers.inGroup('home')
// → PeerRecord[]  (groupMemberships includes 'home')

agent.peers.get(pubKey)
// → PeerRecord | null

agent.peers.fastest(n)
// → top-n PeerRecord by min latency across transports

agent.peers.on('added',       (peer) => {})   // new peer discovered
agent.peers.on('removed',     (peer) => {})   // peer explicitly removed
agent.peers.on('reachable',   (peer) => {})   // peer came back online
agent.peers.on('unreachable', (peer) => {})   // peer went offline
agent.peers.on('tiered',      (peer, old, new) => {})  // trust tier changed
```

### Storage and export

PeerGraph uses the same pluggable `AgentCache` storage backends as defined in `07-Storage.md` (localStorage, IndexedDB, AsyncStorage, JSON file, SQLite). The graph persists across restarts.

`agent.peers.export()` serialises the current graph as JSON (no secrets, no private keys). `agent.peers.import(json)` merges an external graph — useful for bootstrapping a new installation from a known state.

---

## Discovery policy

How aggressively the agent discovers new peers is configurable in the agent file:

```yaml
discovery:
  discoverable:        true           # whether this agent appears in gossip lists
  acceptIntroductions: from-trusted   # 'always' | 'from-trusted' | 'never'
  acceptHelloFromTier0: true          # whether unknown agents can initiate hello
  gossip:
    enabled:          false           # off by default
    interval:         3600            # seconds between gossip rounds
    maxPeersPerRound: 5
    minTrustTier:     1               # only gossip with verified peers
  ping:
    interval:         300             # seconds between background pings
    timeout:          5000            # ms before marking a ping as failed
    failuresBeforeUnreachable: 3      # consecutive failures before marking offline
  capRefreshTtl:      3600            # seconds before a capability card is stale
  peerCleanup:
    unreachableAfterDays:  30         # remove peer from graph if unreachable this long
    expiredProofGraceDays:  7         # keep peer after group proof expires for this long
    maxGraphSize:        1000         # hard cap on total peers in graph; prune oldest/unreachable first
```

All discovery settings have safe defaults: introductions accepted only from trusted peers, gossip off, pings every 5 minutes, peers cleaned up after 30 days unreachable.

---

## Runtime configuration

The agent has a `config` object that provides runtime read/write access to all operational parameters. This enables the app, the user, and authorised remote agents to adjust the agent's behaviour without restarting.

### Layer model

Configuration is layered, same as the permission ceiling rule from `08-Permissions.md`:

```
user file (ceiling)
    ↓
blueprint defaults
    ↓
developer code overrides (at instantiation)
    ↓
runtime mutations (agent.config.set)
```

Each layer can only restrict, never expand beyond the layer above. A runtime `set` that would exceed the user file ceiling is rejected with a validation error.

### API

```js
// Read
agent.config.get('resources.maxConnections')
// → 20

agent.config.get('discovery.gossip.enabled')
// → false

agent.config.get('resources.perGroup.home.maxPeers')
// → 10

// Write (within ceiling)
agent.config.set('resources.perGroup.home.maxPeers', 5)
// → ok (5 ≤ user-file ceiling)

agent.config.set('resources.maxConnections', 200)
// → throws ConfigCeilingError (user file says 50, 200 > ceiling)

// Events
agent.config.on('changed', (path, oldValue, newValue) => {
  console.log(`${path}: ${oldValue} → ${newValue}`);
});

// Export current effective config (no secrets, no private key)
const snapshot = agent.config.snapshot();

// Reset a runtime override back to the layer-below default
agent.config.reset('resources.perGroup.home.maxPeers');
```

### Remote configuration via capability

The `agent-config` capability exposes read/write access to other agents. It is `private` and `never` by default — the user must explicitly open it:

```yaml
capabilities:
  agent-config:
    visibility: group:admin   # only admin group members can see it
    policy:     group:admin   # only admin group members can call it
    access:
      write: [group:admin]    # can change params
      read:  [group:admin, group:home]  # can read params
```

The capability handler receives `{ op: 'get' | 'set' | 'reset', path, value? }` and enforces the ceiling check before applying any change. Admin agents in a different location (not local, not even on the same network) can thus tune operational parameters remotely within the scope the user permitted.

```js
// Remote admin agent adjusting a parameter:
await adminAgent.call(targetAgent.id, 'agent-config', {
  op:    'set',
  path:  'resources.perGroup.neighborhood.maxPeers',
  value: 2
});
```

All remote config changes are logged in the activity log (future: `ActivityLog` from the user control layer in `02-Architecture.md`).

### What is configurable at runtime

Not everything is runtime-mutable. Some values are load-time only (vault backend, transport addresses); others can be changed live:

| Category | Examples | Runtime-mutable? |
|----------|----------|-----------------|
| Transport addresses | NKN address, WS relay URL | No — change requires restart |
| Resource limits | maxConnections, maxPendingTasks, maxPeers | Yes |
| Discovery policy | gossip.enabled, ping.interval, capRefreshTtl | Yes |
| Policy gates | capability policy (always/on-request/group/never) | Yes, within ceiling |
| Capability visibility | public/authenticated/group/private | Yes, within ceiling |
| Vault backend | keytar, indexeddb, memory | No — load-time only |
| Group memberships | adding/removing groups | Via GroupManager, not config |
| Blueprint | which blueprint is active | No — load-time only |

---

## Group peer caps

The existing `resources.perGroup` block (from `02-Architecture.md`) is extended with `maxPeers`:

```yaml
resources:
  maxConnections: 50        # total active connections across all peers

  perGroup:
    home:
      maxPendingTasks: 5
      maxPeers:        20   # at most 20 active peers from the 'home' group

    neighborhood:
      maxPendingTasks: 1
      maxPeers:        3    # DB can only manage 3 connections from this group
                            # extra agents with this group membership are refused

    work:
      maxPendingTasks: 10
      maxPeers:        0    # 0 = unlimited (default)
```

### Enforcement

`maxPeers` is enforced at connection time — when a Tier 2 peer from group X tries to send a `hello` or any first message, the agent checks the current peer count for that group against the cap.

If the cap is reached:

```js
// Response sent back to the connecting peer:
{
  error:   'group-peer-limit-reached',
  group:   'neighborhood',
  limit:   3,
  current: 3
}
```

The connecting peer receives this as a standard error response and can retry later or use a different group membership. The capped agent does not add them to its PeerGraph. The refusal is logged.

The peer count used for enforcement is the count of peers **currently in the PeerGraph at Tier 2 for that group** — peers marked unreachable are still counted until they are explicitly removed or their group proof expires. This prevents a reconnect storm from temporarily exceeding the cap.

### Combined with maxConnections

`maxConnections` is the global cap across all peers; `maxPeers` per group is an additional group-specific cap. Both must pass for a connection to be accepted. The stricter limit wins.

---

## Agent file loading

The SDK provides `AgentFile.load()` with platform-appropriate methods. How users create or manage their agent files is out of scope for the SDK (could be manual editing, a companion UI, or a hosted service). The SDK only defines the loading interface.

```js
// Node.js — from local filesystem path
const agent = await Agent.fromFile('/home/alice/.agent/home.yaml');

// Browser — from a URL (could be a SolidPod URL, a local server, or a hosted file)
const agent = await Agent.fromUrl('https://alice.solidpod.example/agents/home.yaml', {
  credential: 'vault:solid-pod-token'   // resolved from vault if auth required
});

// Browser — from a File object (drag-drop or <input type="file">)
const agent = await Agent.fromFileObject(fileInputEvent.target.files[0]);

// Browser — from File System Access API (user picks file once, permission persisted)
const [fileHandle] = await window.showOpenFilePicker({ types: [{ accept: { 'text/yaml': ['.yaml', '.yml'] } }] });
const agent = await Agent.fromFileHandle(fileHandle);

// Any platform — from an already-parsed plain object or YAML/JSON string
const agent = await Agent.from({ id: 'my-agent', blueprint: '...', ... });
const agent = await Agent.fromYaml(yamlString);
const agent = await Agent.fromJson(jsonString);

// SolidPod — loads agent file from pod root (see Design/10-SolidPod-Identity.md)
const agent = await Agent.fromSolidPod('https://alice.solidpod.example/', {
  credential: 'vault:solid-pod-token'
});
```

`AgentFile.js` handles YAML parsing, blueprint resolution, and default filling for all of these. The developer never needs to call the YAML parser directly.

On first run with no existing file, the SDK can generate a minimal default agent file:

```js
const agent = await Agent.createNew({
  id:        'my-agent',
  blueprint: 'default',
  vault:     { backend: 'indexeddb' }   // or 'keytar', 'memory', etc.
});
// Generates a keypair, stores private key in vault, saves agent file to configured location
```

---

## Module additions

```
discovery/
  PeerDiscovery.js       Orchestrates all discovery routes (gossip, introduction,
                         group bootstrap). Calls PeerGraph on new peer data.
  PeerGraph.js           Replaces AgentCache. Stores full peer records with
                         reachability, latency, trust tier, capabilities.
                         Provides query API. Persists via pluggable storage backend.
  GossipProtocol.js      Background peer-list exchange. Enforces privacy rules.
                         Runs on a configurable interval.
  PingScheduler.js       Background connectivity checks. Updates reachability
                         state in PeerGraph. Exponential backoff on failure.

config/
  AgentConfig.js         Layered config store (user ceiling → blueprint → developer
                         → runtime). Enforces ceiling on set(). Fires change events.
  ConfigCapability.js    The 'agent-config' capability handler. Validates remote
                         set() requests against ceiling and visibility rules.
```

`AgentCache.js` in the current design is replaced by `PeerGraph.js`. The underlying storage backend interface is unchanged.

`PolicyEngine.js` gains a `checkGroupPeerCap(peer, group)` check that consults `AgentConfig` for `resources.perGroup[group].maxPeers` and the current count from `PeerGraph`.
```
