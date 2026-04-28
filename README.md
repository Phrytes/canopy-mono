# @canopy

Portable decentralized agent SDK.  Web and mobile apps that exchange
messages, data, and tasks **without a required central server**.

Three packages:

- **`@canopy/core`** — pure JS.  Runs in browser, Node, and React Native.
- **`@canopy/react-native`** — RN-specific bits: BLE, mDNS, KeychainVault,
  the `createMeshAgent` factory.
- **`@canopy/relay`** — Node-only WebSocket relay server (rendezvous +
  proxy fallback).

Hands-on minimal agent: see [`QUICKSTART.md`](./QUICKSTART.md).
Code map: see [`ARCHITECTURE.md`](./ARCHITECTURE.md).
Topology + design intent: see [`Design-v3/topology.md`](./Design-v3/topology.md).

---

## Reachability — three layered mechanisms

Two peers exchange messages over whichever path is currently usable.
The SDK ships **four** transport families and an automatic per-peer
picker (`RoutingStrategy`).  No app code chooses the path; the picker
does, based on which transports have a live link to the peer.

### 1. Direct connections

When the two peers have a path to each other.  Smallest latency, no
third party in the loop.

| Transport | When it's preferred | Class |
|---|---|---|
| **mDNS / TCP** | Same Wi-Fi LAN | `MdnsTransport` (`@canopy/react-native`) |
| **BLE** | Out of Wi-Fi range, in Bluetooth range (≈10 m) | `BleTransport` (`@canopy/react-native`) |
| **WebRTC DataChannel** | Across networks, after rendezvous signalling completes | `RendezvousTransport` (`@canopy/core`) |
| **In-process** | Same JS realm (tests, browser tabs) | `InternalTransport`, `LocalTransport` |

WebRTC needs a signalling channel (typically the relay) to exchange
SDP/ICE; once the DataChannel opens, the relay is no longer in the data
path.

### 2. Centralized relay

`@canopy/relay` is the SDK's WebSocket relay implementation.  Two modes:

- **Rendezvous** — PeerJS-style signalling for WebRTC.  No application
  messages cross the relay; it only carries the initial SDP/ICE.
- **Proxy fallback** — if direct fails, the relay forwards `nacl.box`
  encrypted envelopes between peers.  The relay can't read them.

Authentication, rate limiting, and a public deployment story are still
on the roadmap (see `TODO-GENERAL.md`).  Today the relay is suitable
for trusted networks (personal devices, group infrastructure, dev).

### 3. NKN

`NknTransport` (`@canopy/core`) connects to the
[NKN](https://nkn.org) public messaging network.  No operator to run;
routing is paid-for at the network level.

Useful when no shared relay exists between two peers — both ends only
need NKN access.  Addresses are deterministic from the agent's Ed25519
seed, so a peer's NKN address is just its identity-derived address.

### 4. Hop / peer-as-relay

A third agent (a phone, a server) can relay between two peers who
can't reach each other.  This is what makes "no shared relay, no NKN"
still work: borrow a friend's reachability.

Two modes:

- **Plaintext bridge** — `enableTunnelForward({ policy })`.  The bridge
  sees envelope content (skill ID, parts).  Use within trust groups
  where the bridge is acceptable as a witness.
- **Sealed forward** — `enableSealedForwardFor(groupId)`.  The bridge
  receives an opaque `nacl.box` blob; only the destination can open
  it.  Skill ID and parts are invisible to the bridge.

Hop-count limits + group/policy gating prevent the SDK from being
abused as a general-purpose open relay.

> See [`Design-v3/topology.md` §Reachability infrastructure](./Design-v3/topology.md#internet-scale-infrastructure)
> for the canonical framing.  Track G in the coding plans tightens
> classifier surface and operator picks.

---

## Quick-start — enabling each transport

The `createMeshAgent` factory (RN) wires mDNS + BLE + relay + offline
out of the box.  The snippets below show how to add the additional
mechanisms.

### Direct via rendezvous (WebRTC)

The signalling relay is for SDP/ICE only — once the DataChannel opens,
the relay is out of the data path.

```js
agent.enableRendezvous({
  signalingTransport: relay,   // any transport that can signal both peers
  auto: true,                   // auto-upgrade on capability match
});
```

The other peer must also call `enableRendezvous(...)`; capability
exchange happens via the hello handshake.

### Centralized relay (WS proxy fallback)

`RelayTransport` is added automatically when the agent is constructed
with a `relayUrl`:

```js
import { RelayTransport } from '@canopy/core';

const relay = new RelayTransport({ identity, relayUrl: 'wss://relay.example' });
agent.addTransport('relay', relay);
```

Or with the RN factory: pass `relayUrl` to `createMeshAgent({ ... })`.
Auth + policy gating live on the relay side; the client just
connects.

### NKN — decentralized public messaging

```js
import { NknTransport } from '@canopy/core';

const nkn = new NknTransport({ identity });
await nkn.connect();
agent.addTransport('nkn', nkn);
```

Node: `npm install nkn-sdk` first.  Browser: load nkn-sdk from CDN and
pass it as `{ nknLib }`.  No operator credentials needed — the
identity seed gives you a deterministic NKN address.

### Hop / peer-as-relay

Enable on the *bridge* (the agent in the middle):

```js
agent.enableTunnelForward({ policy: 'authenticated' });    // plaintext
// or, for content privacy:
agent.enableSealedForwardFor('my-group');
```

Callers reach a peer through a bridge with `agent.invokeWithHop(...)`.
The routing layer picks a bridge automatically; sealed mode is
selected per-call by passing `{ group: 'my-group' }`.  See
[`Design-v3/hop-tunnel.md`](./Design-v3/hop-tunnel.md) and
[`Design-v3/blind-forward.md`](./Design-v3/blind-forward.md).

---

## Running things

```bash
# Install (monorepo root)
npm install

# Test everything
npm test                              # all three packages
npm run test:core
npm run test:rn
npm run test:relay

# Start the relay
npm run relay:start                   # listens on :8787 by default

# Mesh demo (Expo phone app)
cd apps/mesh-demo && npx expo start

# Browser demo
open packages/core/mesh-chat.html
```

---

## Status

NLnet PoC.  Core is in active development; package boundaries are
stable; vault adapters and operational hardening (relay auth,
production deployment) are on the roadmap.  See
[`ARCHITECTURE.md`](./ARCHITECTURE.md) for the feature index +
`coding-plans/` for the current work tracks.
