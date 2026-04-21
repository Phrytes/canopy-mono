# canopy-sdk — design overview

## Overall shape

```
sdk/src/
├── Agent.js              ← the thing you actually use
├── AgentFile.js          ← load agent definition from YAML
├── Emitter.js            ← shared event system (building block)
├── protocol/
│   └── Task.js           ← task state machine
├── transport/
│   ├── Transport.js      ← abstract base class
│   ├── NknTransport.js   ← NKN implementation
│   ├── MqttTransport.js  ← MQTT implementation
│   ├── PeerJSTransport.js
│   └── BleTransport.js   ← stub
├── patterns/
│   ├── Envelope.js       ← message format
│   ├── PatternHandler.js ← wraps a transport, handles interaction patterns
│   ├── Session.js        ← stub
│   ├── Streaming.js      ← stub
│   └── BulkTransfer.js   ← stub
├── roles/
│   ├── Role.js           ← role definition + inheritance resolver
│   └── RoleRegistry.js   ← named registry of roles
├── groups/
│   └── GroupManager.js   ← cryptographic group membership
└── discovery/
    ├── AgentCache.js
    └── PeerDiscovery.js
```

---

## Layer 1 — Emitter (building block)

Everything in the SDK that can emit events extends `Emitter`. It is a minimal event system: you call `.on('event', fn)` to listen and `.emit('event', data)` to fire.

```js
transport.on('connect', () => console.log('connected'));
transport.emit('connect');   // triggers the listener above
```

**What is a Promise?** JavaScript's way of representing "a value that doesn't exist yet but will at some point." Instead of blocking and waiting, you write `await someAsyncThing()` and the runtime pauses *just that function* until the value arrives, while the rest of the browser keeps running. When it resolves (succeeds) you get the value; when it rejects (fails) it throws an error you can catch.

---

## Layer 2 — Transport

`Transport` is the abstract base class. It defines the contract every network backend must fulfil:

```
Transport
  connect()                ← open the network connection
  disconnect()             ← close it
  _rawSend(to, envelope)   ← send a message to an address
  _receive(from, envelope) ← called when a message arrives (fires 'message' event)
  canDo(pattern)           ← does this transport support a given interaction style?
  get address()            ← what address am I reachable at?
```

`NknTransport`, `MqttTransport`, etc. all fill in `_rawSend` and `connect()` with their specific network code. Everything above the transport layer never touches NKN or MQTT directly — it only talks to the `Transport` interface.

`PATTERNS` is a set of string constants naming the interaction styles:

```
ONE_WAY, ACK_SEND, REQUEST_RESPONSE, PUBSUB, STREAMING, BULK_TRANSFER
```

---

## Layer 3 — Envelope + PatternHandler

**Envelope** is the message format every message is wrapped in:

```js
{ _v: 1, _p: 'RQ', _id: 'abc123', payload: { ... } }
//        ↑ pattern code   ↑ unique message ID
```

The pattern code tells the receiver what kind of interaction this is:

| Code | Meaning |
|------|---------|
| `OW` | One-way (fire and forget) |
| `AS` | Ack-send (sender wants confirmation of receipt) |
| `AK` | Acknowledgement (the confirmation) |
| `RQ` | Request (sender wants a reply with a result) |
| `RS` | Response (the reply to a request) |
| `PB` | PubSub publish |

**PatternHandler** wraps a single Transport and implements all the interaction patterns on top of it:

```
PatternHandler
  sendOneWay(to, payload)         ← fire and forget
  sendAck(to, payload, timeout)   ← send and wait for acknowledgement
  request(to, payload, timeout)   ← send and wait for a reply
  respond(replyTo, id, payload)   ← send a reply to a specific request
  publish(topic, payload)         ← broadcast
  subscribe(topic, handler)       ← receive broadcasts
```

Internally it keeps a `Map` of pending requests — when you call `request()`, it stores `{ resolve, reject, timer }` under the message ID. When the matching response arrives, it pulls that entry out of the map and calls `resolve(payload)`, which wakes up whoever was `await`-ing.

---

## Layer 4 — Agent

`Agent` is what you actually instantiate. It owns:

- a list of `Transport` instances (one or more)
- a `PatternHandler` for each transport
- a `Map` of capabilities (skill name → async handler function)
- a `Map` of known peers (address → transport + agent card)
- a `Map` of pending tasks

**`agent.start()`** — calls `connect()` on all transports in parallel, resolves as soon as the first one connects.

**`agent.capability('echo', fn)`** — registers a skill. When a remote agent sends a `skill_request` for `'echo'`, the Agent calls `fn(params)` and sends the result back.

**`agent.request(to, skill, params)`** — sends a `skill_request` envelope via the best available transport and returns a Promise that resolves when the reply comes back.

**`agent.submitTask(to, skill, params)`** — like `request` but uses the task state machine: the remote agent replies with `submitted → working → completed/failed` state updates, so you can track long-running operations.

**`agent.connect(peerAddress)`** — sends the peer an `agent_card_request`. The peer replies with their card (name, capabilities, addresses), which gets stored and emitted as a `'peer'` event.

**`#bestHandler(peerAddress)`** — picks which `PatternHandler` to use for a given peer. If we have talked to them before, use the same transport we already have a relationship on; otherwise use the first connected transport.

---

## Layer 5 — Roles

A **Role** is a named bundle of capabilities with optional inheritance:

```js
registry.define('assistant', {
  extends:      'base-agent',        // inherits its capabilities
  capabilities: ['greet', 'calculate'],
  policy:       { mode: 'accept_all' },
});
```

`Role.resolve(registry)` walks the inheritance chain, merges capability lists (parent first, child appends), and applies policy (child overrides parent). It tracks visited nodes to prevent infinite loops if someone defines a cycle.

`RoleRegistry` is a named store: `define(name, def)` to register and `resolve(name)` to look up.

---

## Layer 6 — GroupManager

Groups let you restrict which agents an agent will accept tasks from. Membership is proved cryptographically using **HMAC-SHA256** — a standard algorithm that produces a fixed-length fingerprint of data using a secret key. Only someone who knows the secret can produce a valid fingerprint.

```js
// Admin side — generates a proof token
const proof = await GroupManager.sign('my-group', agentId, adminSecret);

// Verifier side — checks the token without trusting the claimer
const ok = await GroupManager.verify(proof, adminSecret);
```

The proof is a small JSON object containing the group ID, agent ID, expiry time, and the HMAC signature. The `verify` call recomputes the HMAC from the data and checks it matches — if someone tampers with the data, the signature will not match.

---

## Layer 7 — Stubs

`Session`, `Streaming`, and `BulkTransfer` are placeholders. They have doc comments explaining the intended protocol but no implementation yet. `AgentFile` parses YAML agent definitions. `AgentCache` and `PeerDiscovery` are scaffolding for finding agents without knowing their address upfront.

---

## How it all fits together for a single `request()` call

```
agent.request(peerAddr, 'echo', { message: 'hi' })
  → #bestHandler(peerAddr)           picks the right PatternHandler
  → handler.request(to, payload)     wraps in { _p:'RQ', _id:'x', payload }
  → transport._rawSend(to, envelope) sends JSON over NKN / MQTT / etc.
                                     ... network ...
  ← remote transport receives it
  ← remote PatternHandler unwraps envelope, sees _p:'RQ'
  ← fires 'request' event on remote Agent
  ← Agent calls capability handler: echo({ message: 'hi' }) → { echo: 'hi' }
  ← remote PatternHandler sends { _p:'RS', _id:'x', payload: { echo:'hi' } }
                                     ... network ...
  → local PatternHandler receives RS, looks up _id:'x' in pending map
  → calls resolve({ echo: 'hi' })
  → your await resolves with { echo: 'hi' }
```
