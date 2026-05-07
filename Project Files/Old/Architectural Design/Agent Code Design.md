# Agent SDK — Architecture Design Sketch

**Project**: Portable Decentralized Agents (NLnet PoC)
**Date**: 2026-04-10
**Status**: Design / pre-implementation — decisions locked in, ready to build

---

## Layer Model

```
┌──────────────────────────────────────────────────────────────┐
│                        Agent Layer                           │
│  Agent object · capabilities · groups · policy · export      │
├──────────────────────────────────────────────────────────────┤
│                      Actions Layer                           │
│  ping · request · send · stream · negotiate · task · file    │
├──────────────────────────────────────────────────────────────┤
│                 Interaction Pattern Layer                     │
│  RequestResponse · OneWay · AckSend · PubSub ·               │
│  Streaming · BulkTransfer · Session                          │
├──────────────────────────────────────────────────────────────┤
│                 Transport Abstraction Layer                   │
│  Transport interface — same API regardless of transport       │
├──────────────────────────────────────────────────────────────┤
│               Transport Implementations                      │
│  NknTransport  │  MqttTransport  │  BleTransport  │  ...     │
└──────────────────────────────────────────────────────────────┘
```

---

## Agent Object

```js
const agent = new Agent({
  role:       'advanced-assistant',    // role label — see Roles section
  name:       'the author Bot',
  transports: [nknTransport, mqttTransport],
  policy:     { mode: 'group_only', group: 'dev-team' },
  groups:     [{ id: 'dev-team', proof: '<signed-token>' }],
});

// Capability decorator — any function becomes an agent capability
agent.capability('echo',      async ({ message })  => ({ echo: message }));
agent.capability('calculate', async ({ a, b, op }) => ...);

// Dynamic — capabilities can be added/removed at runtime even after start().
// A capability change is broadcast to all currently connected peers automatically.
agent.addCapability('weather', async ({ city }) => fetch(...));
agent.removeCapability('weather');

// Extend from another agent's exported definition
agent.extend(importedAgentJson);

await agent.start();                      // connects all transports

// Export / import — developer controls what is included
const json       = agent.export();                    // full snapshot (no seed)
const withSeed   = agent.export({ includeSeed: true });  // developer opts in
const copy       = Agent.from(json);                  // reconstruct anywhere
const copy2      = Agent.from(withSeed);              // with transport identity restored
```

---

## Transport Interface

Each transport implements what it can. The agent layer detects capability gaps and degrades gracefully.

```js
class Transport {
  get address()   { }           // this client's address on this transport
  async connect() { }
  async disconnect() { }

  // — Interaction patterns (implement where applicable) —
  canDo(pattern)  { }           // returns bool — lets agent layer check before calling

  async send(to, data)                  { } // OneWay
  async sendAck(to, data, timeout)      { } // AckSend
  async request(to, data, timeout)      { } // RequestResponse
  async respond(replyTo, data)          { } // RequestResponse reply side

  subscribe(topic, handler)             { } // PubSub
  publish(topic, data)                  { } // PubSub

  async *stream(to, source)             { } // Streaming (async generator)
  async bulkSend(to, buffer, chunkSize) { } // BulkTransfer
  async openSession(to, handler)        { } // Session (stateful)
}
```

---

## Interaction Patterns — Transport Support Matrix

| Pattern            | NKN        | MQTT          | BLE                  | WiFi Direct |
|--------------------|------------|---------------|----------------------|-------------|
| One-way Send       | ✓          | ✓             | ✓                    | ✓           |
| Acknowledged Send  | ✓ (ACK msg)| ✓ (QoS 1)    | ✓                    | ✓           |
| Request–Response   | ✓          | ✓             | partial              | ✓           |
| Pub–Sub            | ✓ (topics) | ✓ (native)   | ✗                    | ✗           |
| Streaming          | ✓          | ✓             | ✗ (MTU too small)    | ✓           |
| Bulk Transfer      | ✓ (chunked)| ✓ (chunked)  | ✓ (chunked, slow)    | ✓           |
| Session            | ✓          | ✓             | ✗                    | ✓           |

### Discovery & State Sync

Not a separate transport primitive. It is an **agent-level concern** built on top of the other patterns:

- **Discovery**: `PubSub` (broadcast presence) + `RequestResponse` (exchange agent cards)
- **State sync**: `Session` or `RequestResponse` (align peer lists, capability changes)

It belongs in the Agent layer, not the Transport layer. The agent runs discovery automatically on connect; the developer does not implement it manually.

---

## Actions Layer — Mapping to Patterns

| Action            | Primary pattern              | Fallback                          |
|-------------------|------------------------------|-----------------------------------|
| `ping`            | AckSend                      | OneWay × 2 (send + listen)        |
| `requestCapabilities` | RequestResponse          | OneWay + PubSub reply             |
| `send` (message)  | AckSend                      | OneWay                            |
| `stream`          | Streaming                    | BulkTransfer in chunks            |
| `shareFile`       | BulkTransfer                 | Streaming                         |
| `negotiate`       | RequestResponse (multi-turn) | Session                           |
| `openSession`     | Session                      | RequestResponse loop              |
| `submitTask`      | RequestResponse + Session    | RequestResponse                   |
| `discover`        | PubSub + RequestResponse     | OneWay broadcast                  |

Graceful degradation is **automatic** — the agent checks `transport.canDo(pattern)` per peer and picks the best available path. The "screaming one-way" fallback (repeated sends when request-response is unavailable) is a last resort the developer can opt into per action.

```js
agent.send(peerId, data, {
  prefer: ['ack-send', 'request-response', 'one-way'],  // try in order
  retryOnFallback: 3,                                   // screaming fallback
});
```

---

## Agent Actions API

```js
// — Discovery (automatic on connect, but also callable manually) —
await agent.connect(peerId);        // full handshake on best transport
await agent.discover();             // broadcast + collect agent cards

// — Communication —
await agent.ping(peerId);
await agent.send(peerId, payload);
const reply = await agent.request(peerId, 'skill', params, { timeout: 10_000 });
const task  = await agent.submitTask(peerId, 'calculate', { a: 3, b: 4 });

// — Session —
const session = await agent.openSession(peerId);
await session.send(data);
session.on('message', handler);
await session.close();

// — File / Stream —
await agent.shareFile(peerId, buffer, { mimeType: 'image/png' });
await agent.stream(peerId, asyncIterable);

// — Group —
agent.joinGroup('dev-team', proof);
agent.leaveGroup('dev-team');
```

---

## Roles

A role is a named, reusable set of properties — capabilities, policy, and defaults. Roles can inherit from other roles with selective overrides. Multiple agents can share the same role. Roles are orthogonal to groups (a role is a type; a group is a membership).

```js
// Define roles (typically in a shared config or YAML file)
Role.define('base-assistant', {
  capabilities: ['echo', 'ping'],
  policy: { mode: 'accept_all' },
});

Role.define('advanced-assistant', {
  extends: 'base-assistant',          // inherits echo, ping, accept_all
  capabilities: ['calculate'],        // adds calculate on top
  policy: { mode: 'group_only', group: 'dev-team' },  // overrides policy
});

Role.define('strict-calculator', {
  extends: 'advanced-assistant',      // chains further
  capabilities: ['divide'],           // adds divide
  // policy inherited from advanced-assistant (group_only, dev-team)
});
```

Resolution order: own properties win over parent, which wins over grandparent (same as class inheritance). Capability lists **merge** (not replace) up the chain. Policy, name, and other scalar fields **override**.

In YAML:

```yaml
roles:
  - name: base-assistant
    capabilities: [echo, ping]
    policy: { mode: accept_all }

  - name: advanced-assistant
    extends: base-assistant
    capabilities: [calculate]         # merged with inherited [echo, ping]
    policy: { mode: group_only, group: dev-team }

  - name: strict-calculator
    extends: advanced-assistant
    capabilities: [divide]            # merged: [echo, ping, calculate, divide]
```

---

## Group Membership & Proof

Groups use a signed token. The group admin holds a keypair; membership is a token signed with the admin's private key, verifiable by anyone who has the admin's public key.

```js
// Admin side (done once, offline or in app)
const proof = groupAdmin.sign({ agentId: agent.id, group: 'dev-team', expiry: '...' });

// Agent carries the proof — others verify without contacting admin
agent.joinGroup('dev-team', proof, groupAdmin.publicKey);
```

NKN is a natural fit here: NKN addresses are derived from public keys, so the admin's NKN address IS their verifiable public key.

---

## Agent Definition File (YAML)

Single agent:

```yaml
version: 1

agent:
  id: "abc123"
  name: "the author Bot"
  description: "Helpful assistant"
  role: "advanced-assistant"          # role label — inherits role's capabilities/policy

capabilities:
  # Declares capabilities this instance adds on top of the role.
  # App-defined capabilities are declared here but implemented in code.
  - name: echo
    description: "Echoes input back"
    params: { message: string }
  - name: calculate
    description: "Math operations"
    params: { a: number, b: number, op: string }

connections:
  nkn:
    address: "56cb429b...64hex"
    # seed: "abc...64hex"   # only present when developer explicitly exports with includeSeed: true
  mqtt:
    broker: "wss://broker.hivemq.com:8884/mqtt"
    address: "a3f9d2b0"
  # bluetooth, wifi-direct: added when available

groups:
  - id: "dev-team"
    admin_pubkey: "abc...pubkey"
    proof: "base64-signed-token"

policy:
  mode: group_only          # accept_all | group_only | manual | skill_whitelist
  group: "dev-team"
  allowed_skills: []

extends:
  - role: "logger-v1"       # this agent also inherits from logger-v1
```

Multiple agents + role definitions in one file (defining a system):

```yaml
version: 1

roles:
  - name: base-assistant
    capabilities: [echo, ping]
    policy: { mode: accept_all }

  - name: advanced-assistant
    extends: base-assistant
    capabilities: [calculate]
    policy: { mode: group_only, group: dev-team }

agents:
  - role: base-assistant
    agent: { name: "Bot A" }
    connections:
      nkn: { address: "abc...64hex" }

  - role: advanced-assistant
    agent: { name: "Bot B" }
    connections:
      mqtt: { address: "def456" }
      nkn:  { address: "ghi...64hex" }
    groups:
      - id: dev-team
        admin_pubkey: "abc...pubkey"
        proof: "base64-signed-token"
```

---

## Package Structure

```
canopy-sdk/
  src/
    Agent.js                 # agent object, capability registry, export/import
    AgentFile.js             # YAML/JSON parser and validator

    roles/
      Role.js                # role definition, inheritance resolution, override merging
      RoleRegistry.js        # global registry of named roles

    actions/
      ping.js
      messaging.js
      task.js
      session.js
      file.js
      stream.js
      negotiate.js

    patterns/
      RequestResponse.js
      OneWaySend.js
      AckSend.js
      PubSub.js
      Streaming.js
      BulkTransfer.js
      Session.js

    transport/
      Transport.js           # abstract base + canDo() registry
      NknTransport.js        # uses nkn.Client, noReply:true, RTCDataChannel retry
      MqttTransport.js       # extracted from demo.html
      BleTransport.js        # future

    discovery/
      Discovery.js           # built on PubSub + RequestResponse
      StateSync.js

    groups/
      GroupManager.js        # join/leave, sign/verify proofs

  index.js                   # exports everything
```

---

## NKN Transport — Implementation Notes

Based on working implementation in `demo.html`:

- Use `nkn.Client` (not `MultiClient`) from `https://unpkg.com/nkn-sdk/dist/nkn.js`
- Pass `{ noReply: true }` on every `send()` — our protocol uses separate response messages, not NKN SDK-level replies
- On RTCDataChannel error: retry once after 2 seconds (WebRTC channel is set up asynchronously)
- Persist seed in `localStorage` for stable address across reloads; validate seed is exactly 64 hex chars on load
- If `connect` event does not fire within 20 seconds: clear seed, restart with fresh keypair (self-healing)
- `nkn.Client` works in browser on both desktop and mobile (tested)

---

## Resolved Design Decisions

| # | Decision |
|---|---|
| 1 | `agent.capability()` is callable after `agent.start()`. Adding or removing a capability broadcasts the updated agent card to all currently connected peers automatically. |
| 2 | Transport priority is configurable per agent instance. Default: NKN > MQTT > BLE. Developer can override per agent or per action. |
| 3 | Seed export is the developer's responsibility. `agent.export()` omits the seed by default. `agent.export({ includeSeed: true })` includes it. Import respects whatever is present. |
| 4 | The concept is **role** (not blueprint). Roles support inheritance with overrides. Capability lists merge up the chain; scalar fields (policy, name) override. Roles are orthogonal to groups. |
| 5 | Both `request()` (synchronous, single-turn) and `submitTask()` (long-running state machine: submitted → working → completed/failed/rejected) are kept as distinct actions. |
