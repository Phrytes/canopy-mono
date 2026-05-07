# A2ATransport and A2A Integration

`A2ATransport` is a transport implementation that carries the native protocol over HTTP, following the A2A spec. It sits alongside NKN, MQTT, Relay, and the other transports. The rest of the SDK — interaction patterns, skill registry, PolicyEngine, trust tiers — works identically regardless of which transport delivers a message.

---

## A2ATransport as a transport

Like every other transport, `A2ATransport` extends the `Transport` base class and implements `_put()`. The base class provides the four primitives, pending-reply management, and inbound dispatch — all unchanged.

```
NKN:            _put → nkn.Client.send()
MQTT:           _put → mqtt.publish()
RelayTransport: _put → ws.send()
A2ATransport:   _put → POST /tasks/send  (or /tasks/sendSubscribe for streams)
                     → HTTP response or SSE → _receive()
```

The difference: A2ATransport is bidirectional at the HTTP level. It both sends (fetch client) and receives (HTTP server). The server side calls `_receive()` on inbound tasks, exactly as NKN or MQTT would call `_receive()` on inbound envelopes.

### Server side (receiving A2A tasks)

```
GET  /.well-known/agent.json    → AgentCardBuilder.build(agent)
POST /tasks/send                → _receive(envelope built from A2A task)
POST /tasks/sendSubscribe       → _receive() → response via SSE
GET  /tasks/:id                 → task status from StateManager
POST /tasks/:id/cancel          → cancel signal → _receive()
```

### Client side (sending to A2A agents)

```
_put(to, envelope):
  1. Extract pattern code from envelope._p
  2. Map to A2A HTTP call (see pattern mapping below)
  3. Send via fetch()
  4. On response: call _receive() with constructed reply envelope
```

---

## Security layer for A2ATransport

Native transports use `SecurityLayer` (nacl.box + Ed25519 signatures). A2ATransport uses a separate `A2ATLSLayer` instead.

```
Native transports:   SecurityLayer wraps _put()
                     nacl.box encryption + Ed25519 signature on every envelope
                     SecurityLayer verifies on _receive()

A2ATransport:        A2ATLSLayer wraps _put()
                     TLS on the channel (HTTPS enforced, HTTP rejected by default)
                     Bearer JWT on outbound requests (from Vault)
                     JWT validation on inbound requests (A2AAuth)
```

`A2ATLSLayer` is a thin wrapper. Its job:
- Outbound: attach `Authorization: Bearer <token>` header if a token is stored for the target URL
- Inbound: validate Bearer JWT, map to trust tier, reject if invalid
- Enforce HTTPS (`agent.a2a.allowInsecure: true` overrides for development)

The nacl.box SecurityLayer is not applied to A2ATransport. TLS is the security boundary for A2A peers.

```js
// In agent startup:
if (transport instanceof A2ATransport) {
  transport.useSecurityLayer(new A2ATLSLayer(agent));
} else {
  transport.useSecurityLayer(new SecurityLayer(agent));
}
```

---

## Pattern code → A2A HTTP mapping

`_put()` in A2ATransport translates envelope pattern codes to A2A HTTP calls:

| Envelope `_p` | A2A HTTP call | Notes |
|--------------|--------------|-------|
| `RQ` | `POST /tasks/send` | Standard task. Response envelope built from returned artifacts. |
| `ST` + `SE` | `POST /tasks/sendSubscribe` | Streaming task. SSE events become `_receive()` calls per chunk. |
| `OW` | `POST /tasks/send` (no wait) | Fire-and-forget: task submitted, response ignored. |
| `AS` | `POST /tasks/send` (wait for `working` state) | Treat `working` state as delivery ACK. |
| `CX` (cancel) | `POST /tasks/:id/cancel` | Cancel an in-progress task. |
| `HI` | Not sent via A2ATransport | Discovery is via card fetch, not hello. |

The reverse mapping (A2A HTTP → envelope) happens in `_receive()`:

| Inbound A2A event | Envelope constructed |
|------------------|---------------------|
| `POST /tasks/send` | `RQ` envelope, payload = Parts from message |
| `POST /tasks/sendSubscribe` | `RQ` envelope flagged for streaming response |
| `POST /tasks/:id/cancel` | `CX` envelope |
| Task reply message | `RI` envelope (input-required reply) |

---

## A2A protocol handlers

These three handlers are called by RoutingStrategy when the target peer is an A2A peer. The native protocol handlers (messaging, taskExchange, session, streaming, etc.) are unchanged and continue to handle native peers.

### `a2aDiscover.js`

First contact with an A2A agent. Replaces the native `hello` exchange for A2A peers.

```
1. Fetch GET {url}/.well-known/agent.json
2. Validate required A2A fields (name, url, skills[])
3. Parse x-canopy block if present
4. Build PeerGraph record:
     { type: 'a2a', url, name, skills, authScheme,
       pubKey?,    ← from x-canopy.pubKey (if present)
       nknAddr?,   ← from x-canopy.nknAddr (if present)
       lastFetched, reachable }
5. Store in PeerGraph
6. If x-canopy.pubKey + native transport address present:
   → attempt native hello upgrade (see below)
```

Card is cached. Re-fetched only when `lastFetched` is stale (default: 1 hour).

### `a2aTaskSend.js`

Handles task exchange with an A2A peer. Called when `agent.call(a2aUrl, skillId, payload)` resolves the peer as `type: 'a2a'`.

```
1. Wrap payload as Parts if not already (auto-wrap rules — see 02-Parts.md)
2. Resolve skill id on the remote peer's card
3. Build A2A message: { role: 'user', parts: [...] }
4. Call A2ATransport._put() with RQ envelope
   → A2ATransport translates to POST /tasks/send
5. Wait for response
6. Unwrap returned artifacts → return Parts (or unwrap to plain object for native callers)
7. Handle input-required: emit 'input-required' event on the task, await caller reply,
   send RI envelope → A2ATransport translates to POST /tasks/:id/send
```

### `a2aTaskSubscribe.js`

Handles streaming interactions with an A2A peer.

```
1. Same steps 1–4 as a2aTaskSend, but envelope flagged for streaming
   → A2ATransport translates to POST /tasks/sendSubscribe
2. Open SSE connection
3. For each TaskStatusUpdate event:
     → construct ST envelope with artifact Parts as payload
     → call _receive() → triggers 'stream' event on agent
4. On final event (lastChunk: true):
     → construct SE envelope
     → call _receive() → triggers stream completion
5. On SSE error or disconnect: emit stream failure
```

The streaming skill handler and the caller's `for await` loop work identically whether the underlying transport is NKN (ST envelopes) or A2A (SSE events).

---

## PeerGraph — two peer record types

`PeerGraph.js` (see `Design/09-Discovery.md` for the full native peer spec) gains a second record type.

### Native peer record (unchanged)
```js
{
  type:       'native',
  pubKey:     '<ed25519-base64url>',
  id:         'alice-home',
  label:      'Alice Home Assistant',
  trustTier:  1,
  groups:     ['home'],
  skills:     [{ id, name, inputModes, outputModes, streaming }],
  transports: { nkn: {...}, relay: {...}, mdns: {...} },
  reachable:  true,
  lastSeen:   1712345678000,
  latency:    { nkn: 120, relay: 45 },
}
```

### A2A peer record (new)
```js
{
  type:        'a2a',
  url:         'https://other.example.com',
  name:        'Other Agent',
  description: 'Does things.',
  skills:      [{ id, name, inputModes, outputModes, streaming }],
  authScheme:  'Bearer',
  pubKey:      '<ed25519-base64url>',  // only if x-canopy.pubKey present
  nknAddr:     'xyz.nkn',              // only if x-canopy.nknAddr present
  localTrust:  { tier: 2, groups: ['home'] },  // set by admin, optional
  lastFetched: 1712345678000,
  reachable:   true,
}
```

### Updated query API

Existing native peer queries are unchanged. New additions:

```js
agent.peers.a2aAgents()              // all A2A peer records
agent.peers.withSkill('summarise', { includeA2A: true })  // native + A2A

// canHandle is unchanged — A2A peers included by default if they have the skill
// Skills that require native-only patterns (session, bidirectional streaming)
// are automatically excluded from A2A peer results
agent.peers.canHandle({ skill: 'summarise' })
```

---

## RoutingStrategy — updated

`RoutingStrategy` gains a peer-type check before the existing transport priority logic:

```
1. Look up peer in PeerGraph
2. If type === 'a2a':
     → use A2ATransport
     → call a2aTaskSend or a2aTaskSubscribe as appropriate
     → done (no transport priority chain)
3. If type === 'native':
     → existing priority chain: Internal > Local > mDNS > Rendezvous > Relay > NKN > MQTT > BLE
     → transportFilter from agent config applied as before
4. If peer not in PeerGraph:
     → if peer ID looks like a URL: attempt a2aDiscover first
     → if a2aDiscover fails or ID is not a URL: attempt native hello
```

The developer calls `agent.call(peerId, skillId, payload)` with no knowledge of whether the peer is native or A2A. The routing layer handles everything.

---

## Upgrading A2A peers to native

If an A2A peer's card contains `x-canopy.pubKey` and a native transport address (`nknAddr`, `relayUrl`), the SDK attempts a native hello after the card fetch:

```
1. Store A2A peer record with pubKey + transport addresses
2. Attempt hello on best available transport
3. If hello succeeds:
   → re-record peer as { type: 'native', pubKey, ... }
   → future calls use native path (E2E encrypted, all patterns available)
   → A2A path kept as fallback if native becomes unreachable
4. If hello fails:
   → keep as A2A record, retry on next interaction
```

This is entirely transparent. The developer's `agent.call()` call does not change.

---

## A2A discovery route

A ninth discovery route is added to the eight from `Design/09-Discovery.md`:

| Route | How | Converges on |
|-------|-----|-------------|
| A2A URL | `GET /.well-known/agent.json` | A2A peer record in PeerGraph (not hello) |

Triggered by:
- `agent.call('https://...')` with unknown URL
- `agent.discoverA2A('https://...')` explicitly
- A URL entry in the `peers:` block of the agent file
- QR/manual entry of an HTTPS URL

A2A peers are **not gossiped** to other native peers. If you want to introduce an A2A peer to a native peer, use contact forwarding explicitly:

```js
await agent.introduce(nativePeerId, {
  type: 'a2a',
  url:  'https://other.example.com'
});
```

---

## Trust tiers for A2A peers

Native trust tiers are established through Ed25519 identity and group proofs. A2A peers cannot participate in those mechanisms. Trust is established through JWT claims and local admin decisions instead.

```
Tier 0  — No Bearer token (unauthenticated A2A request)
Tier 1  — Valid Bearer JWT
Tier 2  — JWT with x-canopy-groups claim verified against GroupManager,
           OR local trust assignment by admin:
           agent.peers.assignTrust('https://other.example.com', { tier: 2, groups: ['home'] })
Tier 3  — JWT carrying a capability token issued by this agent
```

Capability tokens for A2A peers are issued as JWTs (signed with our Ed25519 key, delivered out-of-band, presented as Bearer tokens).

The PolicyEngine runs identically for native and A2A peers — it only sees a trust tier and a skill id.
