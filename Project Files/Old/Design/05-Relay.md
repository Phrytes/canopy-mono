# Relay Agent

A relay agent is a normal agent that runs on a server. It participates in the network as a peer and additionally provides two infrastructure services: **rendezvous** and **relay**. Both are optional capabilities on top of a standard agent — not a separate codebase.

---

## Two modes

### Rendezvous (preferred)

The relay forwards WebRTC SDP/ICE signaling messages between two agents. Once the handshake completes, a direct DataChannel is established and the relay steps aside.

```
A ──WSS──→ relay ──WSS──→ B      (SDP/ICE signaling only)
A ←──────────────────────→ B     (WebRTC DataChannel, direct P2P)
```

- **Server load**: low — only handles handshake
- **Privacy**: relay never sees data; only sees "A wants to connect to B"
- **Implementation**: no separate signaling server needed. The relay already forwards envelopes by `_to` field. WebRTC signaling is just regular messages with a `webrtc-offer`, `webrtc-answer`, or `webrtc-ice` type in the payload. Client uses `RendezvousTransport` which calls the browser-native `RTCPeerConnection` API directly — no PeerJS dependency.

Signaling flow:
```js
// Alice initiates
await transport.sendOneWay(bobId, { type: 'webrtc-offer', sdp: offer.sdp });
// Bob responds
await transport.sendOneWay(aliceId, { type: 'webrtc-answer', sdp: answer.sdp });
// Both exchange ICE candidates as further OW messages
// DataChannel opens → RendezvousTransport takes over for all subsequent messages
```

### Relay (fallback)

The relay acts as a WebSocket message proxy. Agents connect to it and send envelopes addressed to other agents. The relay reads `_to` and forwards to the right connected peer. The relay stays in the data path permanently.

```
A ──WSS──→ relay ──WSS──→ B      (always, for all messages)
```

- **Server load**: proportional to traffic
- **Privacy**: relay sees routing metadata (`_from`, `_to`) but not payload (E2E encrypted)
- **Use case**: agents behind strict NATs or mobile networks where WebRTC hole-punching fails
- **Implementation**: `WsServerTransport` — a Map of `agentId → WebSocket`, routes by `_to`

---

## Relay as a first-class agent

The relay is not special infrastructure — it is just an agent with extra capabilities. It:
- Has its own Ed25519 identity
- Participates in gossip discovery (helps mobile/browser agents find peers)
- Can be a group admin (issues and renews group proofs)
- Can cache peer lists for offline agents
- Can connect to other relay agents via NKN or MQTT, forming a federated mesh
- Can be deployed with one `docker run` and discovered by address

```js
import { RelayAgent } from '@canopy/relay';

const relay = new RelayAgent({
  name:   'relay-01',
  port:   8080,
  policy: { mode: 'accept_all' },
  // optional: restrict to group members only
});

await relay.start();
// relay.address → relay's NKN + WSS addresses for the agent file
```

---

## WsServerTransport

The server-side counterpart to `RelayTransport`. Listens for WebSocket connections and routes envelopes.

```
incoming envelope from A:
  envelope._from = A's agentId   → register socket for A
  envelope._to   = B's agentId   → look up B's socket, forward envelope unchanged
```

The payload is never parsed — the server forwards raw JSON. It has no access to decrypted content.

For peers not currently connected (offline), the relay can optionally queue envelopes up to a configurable TTL (default: 5 minutes) and deliver when the peer reconnects.

---

## Routing strategy for clients

On the client side, `RelayTransport` is the last entry in the RoutingStrategy fallback chain:

```
Internal > BLE > mDNS > NKN > MQTT > WS-relay
```

The agent tries to establish a direct connection first (RendezvousTransport → WebRTC DataChannel). If that fails, falls back to relayed delivery via RelayTransport. Both use the same relay URL, configured in the agent file under `connections.relay.url`.

---

## Deployment

The relay is a plain Node.js process. No special dependencies beyond the SDK.

```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 8080
CMD ["node", "relay.js"]
```

Deploy to Railway, Fly.io, Render, or any VPS. TLS is terminated by the platform, so Node.js listens on plain port 8080. Multiple relays can be deployed independently — each gets a unique identity from its keypair and can be bootstrapped into each other's peer list.

---

## Security boundary

| Layer | What relay sees | What relay cannot see |
|-------|----------------|----------------------|
| WSS channel | encrypted bytes | nothing extra |
| Envelope | `_from`, `_to`, `_id`, `_ts`, `_p` | `payload` (ciphertext), `_sig` content |
| Payload | nothing | everything (E2E encrypted to recipient) |

The relay's ability to see routing metadata (`_from`, `_to`) is an accepted, documented risk. It is equivalent to a postal service knowing sender and recipient addresses — not the letter contents. Mitigations:
- Use rendezvous mode (relay sees only signaling, not ongoing messages)
- Use multiple relay agents (no single relay sees all traffic)
- Future: onion routing / mix network (out of scope for PoC)
