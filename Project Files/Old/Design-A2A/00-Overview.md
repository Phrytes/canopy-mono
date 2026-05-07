# Design-A2A — Overview

This directory contains the architecture for an A2A-first version of the agent SDK. The design adopts A2A concepts (skills, tasks, Parts, artifacts) as the primary model, and uses the native transport layer as an optimised, encrypted carrier for the same model.

Read `Design/00-DesignSummary.md` first for the foundation. This document only describes what changes and why.

---

## A2A-first design principle

Rather than building a native SDK and bolting on an A2A adapter, this design goes the other way: **A2A concepts are the primary API**. The native transport layer is an implementation detail that carries those concepts more efficiently and securely between native agents.

The practical result:

- Skill handlers write code once. Whether the caller is an A2A agent over HTTP or a native agent over NKN, the handler receives the same typed Parts, returns the same Parts, and never knows the difference.
- The task state machine is A2A's (submitted → working → completed | failed | cancelled | input-required). Native transports implement this same state machine over envelopes.
- Parts (TextPart, DataPart, FilePart, ImagePart) are the native payload format throughout. There is no separate "native payload" that gets translated to Parts for A2A callers.

---

## What changes vs `Design/`

| Component | Change |
|-----------|--------|
| **Capabilities → Skills** | "Capability" is retired. The unified concept is a **skill**: one definition carries both the A2A metadata (name, description, inputModes, outputModes) and our access-control metadata (visibility, policy). `defineSkill()` replaces `defineCapability()`. |
| **Agent file YAML** | `capabilities:` block renamed to `skills:`. Skill metadata and access-control metadata live at the same level — no nested `skill:` sub-block. |
| **Agent card** | Adopts A2A's `agent.json` schema. Skills are served directly; no mapping step needed. `x-canopy` extension block carries native-protocol extras. |
| **Task state machine** | A2A's state machine is primary for all agents. Offer/accept negotiation is removed as a developer-visible concept — PolicyEngine still runs internally, but callers see only `submitted → working → completed | failed`. |
| **Negotiation** | `negotiation.js` is removed. Negotiation is handled via the `input-required` task state: a skill handler yields a question as Parts, the caller responds, the task resumes. Works identically over A2A (native HTTP mechanism) and native transport (same state machine over envelopes). |
| **Parts as native format** | TextPart / DataPart / FilePart / ImagePart are the payload format everywhere — tasks, messages, stream chunks, file transfers. No translation layer needed between A2A and native. |
| **Streaming** | Streaming skills yield Parts. Over A2A: each yield becomes a SSE `TaskStatusUpdate` with `lastChunk: false`. Over native: each yield becomes an ST envelope chunk. Same handler, same caller API. |
| **`A2ATransport`** | New transport: HTTP server + client. Serves A2A endpoints, sends tasks via fetch(). Since Parts are native, A2ATransport only wraps/unwraps the HTTP task envelope — no semantic translation. |
| **Security layer** | Dual mode: nacl.box E2E for native peers, TLS-only for A2A peers. |
| **Discovery** | `a2aDiscover` fetches `/.well-known/agent.json` for A2A peers; HI envelope for native. Both result in a PeerGraph record with a `type` field. |
| **PeerGraph** | Two peer record types: `native` (pubKey-based) and `a2a` (URL-based). |

## What does NOT change

Everything below is identical to `Design/`. Refer to those docs directly.

- Transport implementations: NKN, MQTT, Relay, Rendezvous, mDNS, BLE — `Design/03-Transport.md`
- Vault and storage backends — `Design/07-Storage.md`
- Permission model, trust tiers, group proofs, capability tokens — `Design/08-Permissions.md`
- Discovery mechanisms, PeerGraph query API, gossip, ping — `Design/09-Discovery.md`
- SolidPod, mnemonic recovery, key rotation — `Design/10-SolidPod-Identity.md`
- Revocation notes — `Design/11-Revocation-Note.md`
- Blueprint system — `Design/04-AgentFile.md`
- Relay agent deployment — `Design/05-Relay.md`

---

## Files in this directory

| File | Covers |
|------|--------|
| `01-Architecture.md` | Full module map with A2A additions; updated agent object shape |
| `02-AgentCard.md` | A2A agent card format; complete agent file YAML reference |
| `03-Protocol.md` | Task model, Parts format, streaming (uni/bidirectional), file transfer, input-required, built-in skills |
| `04-Security.md` | Dual security model: nacl.box for native + A2A peers with pubKey, TLS for pure A2A |
| `05-Developer.md` | Quick-start examples for building with this SDK |
| `06-Envelopes.md` | Transport primitives, full envelope format, new codes (IR/RI/CX), task→envelope mapping |
| `07-Permissions.md` | Trust tiers, skill visibility, policy gates, capability tokens — in A2A context |
| `08-Discovery.md` | Discovery routes for native + A2A peers, PeerGraph record types, query API |
