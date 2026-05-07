# Portable Decentralized Agent SDK — Overview

**Date**: 2026-04-14
**Status**: Design v2

---

## Vision

A minimal open standard and JavaScript package for turning any web or mobile app into an agent that can participate in a decentralized agent network — exchanging messages, data, and tasks with other agents, without a required central server.

The core tension being solved: agent networks on the web are currently dominated by closed, centralized platforms. This project builds the tooling for a user-owned alternative.

---

## Goals

1. **Portable agent definition** — a user-owned file (YAML/JSON) that defines one or more agents: their identities, transport addresses, group memberships, and policies. Any conforming runtime can load any conforming file.

2. **Developer SDK** — a JavaScript package that lets a developer turn their app's functions into agent capabilities, connect to the network, and participate in the standard interaction protocols.

3. **Transport independence** — the same agent logic works over NKN, MQTT, WebRTC, WebSocket relay, mDNS/WiFi, and BLE. New transports can be added without changing anything above the transport layer.

4. **Security by design** — every payload is E2E encrypted with the recipient's public key. Every envelope is signed by the sender. Private keys never leave the device vault. This is not a Phase 4 concern — it is part of the foundation.

5. **Relay agent** — a server-deployable agent that acts as a stable bootstrap peer, a WebSocket relay (fallback), and a rendezvous server (WebRTC signaling). It runs the same SDK as any other agent. It is not special infrastructure — it is just an always-on peer.

6. **React Native** — the SDK is pure JS and runs in browser, Node.js, and React Native. Native-only transports (mDNS, BLE) are packaged separately for React Native.

---

## Non-goals (for PoC)

- Complete safety/audit tooling
- Solid Pod storage integration (designed as a slot, not built)
- Production-hardened key management
- A2A protocol strict compliance (compatible in spirit, not formally)
- Exhaustive documentation

---

## Package map

```
@canopy/core          Pure JS — browser, Node, React Native
                        Agent, Transport base, envelope, security,
                        NKN transport, MQTT transport, WS transport,
                        agent file parser

@canopy/relay         Node only — relay + rendezvous server
                        WsServerTransport (handles both relay and WebRTC signaling),
                        relay agent with routing capability

@canopy/react-native  React Native native modules
                        MdnsTransport (react-native-zeroconf)
                        BleTransport (react-native-ble-plx)
                        AsyncStorage adapter
                        Keychain vault
```

All three packages share the same agent, transport, and envelope model. `@canopy/react-native` only adds native transports and storage adapters on top of `@canopy/core`.

---

## What "relay agent" means

A relay agent is a normal agent running on a server. It participates in the network like any peer and additionally provides two services:

- **Rendezvous** — WebRTC signaling: helps two browser/mobile agents establish a direct WebRTC DataChannel by forwarding SDP/ICE messages as regular encrypted envelopes. Server steps aside after handshake. Preferred.
- **Relay** — WebSocket proxy: routes encrypted envelopes between agents connected to it. Server stays in path. Fallback when direct P2P fails (strict NAT, mobile network).

In both modes, the relay never reads payload content — it routes ciphertext. It sees only routing metadata (`_from`, `_to`), which is an accepted metadata risk documented in the security model.

Multiple relay agents can be deployed independently. Each gets its own identity from its keypair. They can connect to each other via NKN or MQTT, forming a federated mesh.
