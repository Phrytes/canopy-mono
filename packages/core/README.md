# @canopy/core

> **Layer: SDK foundation.** This is part of the agent SDK that substrates build on. Substrates and apps compose primitives from here — they MUST NOT reinvent transports, vaults, auth, merge contracts, push, skill registries, identity, emitters, or ULID; apps MUST justify any direct dependency in their README's `## Direct SDK use` section. See [`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md).

Pure-JS core of the @canopy SDK.  Runs in browser, Node, and React
Native (no native deps in this package).  Provides:

- **`Agent`** — composition root; skill registry, dispatch, hello/task
  protocols, identity rotation.
- **Identity + vault** — Ed25519 keypairs, BIP39 mnemonics, pluggable
  vault backends (memory, Node FS, IndexedDB, localStorage).
- **`SecurityLayer`** — `nacl.box` payload encryption + Ed25519
  envelope signatures, replay window, key rotation grace period.
- **Transports** — see below.
- **Routing** — `RoutingStrategy`, `FallbackTable`, hop tunneling.
- **Skills + protocols** — task exchange, streaming, file sharing,
  pubsub, key rotation, reachability oracle.
- **A2A bridge** — JSON-RPC over HTTPS interop with non-`@canopy`
  agent frameworks.

For the bigger picture see the repo root
[`README.md`](../../README.md), [`QUICKSTART.md`](../../QUICKSTART.md),
and `ARCHITECTURE.md`.

---

## Layers

The codebase is layered top-down:

```
Agent           ←  composition root + skill registry
  ↑
Protocol        ←  hello, taskExchange, streaming, keyRotation, …
  ↑
SecurityLayer   ←  encrypt + sign every envelope
  ↑
Transport       ←  sendOneWay / sendAck / request / respond
```

Every `_put()` is wrapped by `SecurityLayer` from Phase 1 — there is
no "bypass" path.  Routing picks a transport per-peer via
`transportFor()`; replies pin to the channel the request arrived on
(`envelope._transport`).

---

## Transports

The four transport families used in practice:

| Class | Family | Notes |
|---|---|---|
| `LocalTransport` | Direct (in-realm) | Same-process pub/sub bus.  Tests, browser tabs. |
| `InternalTransport` | Direct (in-realm) | `InternalBus`-backed; pair-test friendly. |
| `RendezvousTransport` | Direct (cross-network) | WebRTC DataChannel; needs a signalling channel (relay) for SDP/ICE.  Wire via `agent.enableRendezvous(...)`. |
| `RelayTransport` | Centralized relay | WebSocket to `@canopy/relay`.  Two server-side modes: rendezvous (signalling) + proxy fallback. |
| `NknTransport` | Decentralized network | NKN public messaging.  No operator; identity-derived address.  Needs `nkn-sdk`. |
| `MqttTransport` | Centralized broker | MQTT over WS.  Optional alternative to the WS relay. |
| `OfflineTransport` | Sentinel | Always-fail clean-error fallback.  Used as "primary" by `createMeshAgent` so a missing network never blocks `agent.start()`. |
| `Transport` (base) | — | Subclass to add a transport.  Tags `envelope._transport` on receive. |

LAN transports (`MdnsTransport`, `BleTransport`) live in
`@canopy/react-native` because they need native modules.

### Hop / peer-as-relay

Hop tunneling is **not** a transport.  It runs at the routing layer:
a third agent calls `enableTunnelForward({ policy })` (plaintext
bridge) or `enableSealedForwardFor(groupId)` (sealed `nacl.box`
forward — bridge can't read content).  Callers reach the destination
via `agent.invokeWithHop(peer, skill, parts, { group })`.  See
`Design-v3/hop-tunnel.md` and
`Design-v3/blind-forward.md`.

---

## Entry points

```js
import {
  Agent, AgentIdentity, VaultMemory,
  RelayTransport, NknTransport,
  TextPart, Parts,
} from '@canopy/core';
```

Phone factory (`createMeshAgent`) lives in `@canopy/react-native`.
Quickstart snippets are in [`QUICKSTART.md`](../../QUICKSTART.md).

---

## Tests

```bash
npm run test:core
```

Test files live under `test/` and end in `.test.js`.  Vitest.

---

## See also

- `Design-v3/topology.md` — topology +
  reachability framing.
- `ARCHITECTURE.md` — code map across all
  three packages.
- `coding-plans/` — current work tracks.
