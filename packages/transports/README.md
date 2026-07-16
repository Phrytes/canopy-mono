# @onderling/transports

Concrete network transports for Onderling agents — four adapters that all
satisfy the `Transport` port from `@onderling/core`, so an agent can switch
between them (or run several) without changing application code.

```
npm install @onderling/transports
```

Each transport lazy-imports its native library, so you only install what you
use: `ws` ships as a dependency (RelayTransport works out of the box);
`nkn-sdk` and `mqtt` are loaded on first use and must be installed by the
consumer; WebRTC primitives are injectable for React Native.

## Quick start

```js
import { Agent, AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { RelayTransport } from '@onderling/transports';

const identity = await AgentIdentity.generate(new VaultMemory());
const transport = new RelayTransport({ identity, relayUrl: 'wss://relay.example.org' });

const agent = new Agent({ identity, transport });
await agent.start();
```

## The four transports

| Transport | Carries messages over | Constructor options |
| --- | --- | --- |
| `RelayTransport` | a WebSocket relay you (or anyone) can self-host | `identity`, `relayUrl` (`ws://` or `wss://`) |
| `NknTransport` | the public NKN peer-to-peer network — no server of your own | `identity`, `identifier?`, `nknLib?` (inject `nkn-sdk`; auto-loaded if omitted), `warnAfter?`, `connectTimeout?` |
| `MqttTransport` | any MQTT broker | `identity`, `brokerUrl`, `mqttOpts?` (forwarded to `mqtt.connect()`) |
| `RendezvousTransport` | a direct WebRTC data channel, using another transport for signaling | `identity`, `signalingTransport`, `rtcLib?` (`{ RTCPeerConnection, … }` — inject on React Native), `iceServers?` |

Choosing: **RelayTransport** is the simplest start (one self-hostable relay
process). **NknTransport** removes the server entirely at the cost of the
public mesh's latency. **RendezvousTransport** upgrades a pair of peers to a
direct connection and uses any other transport only for the handshake.
**MqttTransport** fits where broker infrastructure already exists.

## Port conformance

All four extend the kernel's `Transport` base and pass the transport
conformance suite in `@onderling/core` (`src/conformance/`). Anything that
satisfies that port — including your own transport — can carry agent
traffic; these are the maintained defaults. For in-process and offline
testing use `InternalTransport` / `OfflineTransport` from `@onderling/core`
instead — no network required.

## Related packages

- `@onderling/core` — the `Transport` port, `Agent`, identity.
- `@onderling/sdk` — re-exports these under `@onderling/sdk/transports`, and
  its `createAgent()` wires a default transport for you.

## Status

`0.x` — pre-1.0; the API may move between minor versions. Versioned with
changesets. Source: [github.com/Onderling/basis](https://github.com/Onderling/basis)
(`packages/transports`).
