# Design-v3 — Synthesis

This design takes `Design/` as its foundation and adds A2A compatibility on top. Read `Design/00-DesignSummary.md` first — everything there applies here unless explicitly overridden.

---

## Design philosophy

**Native P2P is primary. A2A is a compatible extension.**

The transport system, interaction pattern layer, security model, and identity system from `Design/` are kept intact. A2A compatibility is achieved by:

1. Adopting A2A's skill/card format as the agent's external face (replacing capability terminology)
2. Adding Parts as a typed payload layer that all patterns can use
3. Adding `A2ATransport` as one more transport implementation alongside NKN, MQTT, etc.
4. Adding A2A-specific protocol handlers for interactions with A2A peers
5. Extending PeerGraph with a second peer record type for A2A peers

An agent built with this SDK can interact natively with other native agents (full protocol, E2E encrypted, offline-capable) and with any A2A-compliant agent (HTTP/TLS, tasks/SSE, agent card). The developer's API is largely the same for both — the routing layer handles the difference.

---

## What changes from `Design/`

| Component | Change |
|-----------|--------|
| **Capabilities → Skills** | Renamed. Skill definitions unify A2A metadata (description, inputModes, outputModes, tags) with our access-control metadata (visibility, policy). 1-to-1 with A2A agent card skills. `defineSkill()` replaces `defineCapability()`. |
| **Agent card** | Adopts A2A's `/.well-known/agent.json` format. Built automatically from skill registry. `x-canopy` extension block carries native-protocol extras (pubKey, transport addresses, group memberships). |
| **Agent file YAML** | `capabilities:` block renamed to `skills:`. Skill metadata and access-control live at the same level. New `a2a:` config block for HTTP server settings. |
| **Parts** | New typed payload layer: TextPart, DataPart, FilePart, ImagePart. Available throughout all interaction patterns. Required when communicating with A2A peers; optional but recommended for native peers. Plain objects still work for native-to-native. |
| **A2ATransport** | New transport implementation (HTTP server + client). Implements the same `_put()` interface as all other transports. Has its own TLS security layer instead of nacl.box. |
| **A2A protocol handlers** | `a2aDiscover`, `a2aTaskSend`, `a2aTaskSubscribe` — called by RoutingStrategy when the target peer is an A2A peer. Native interaction patterns (messaging, taskExchange, session, etc.) are unchanged and used for native peers. See `04-Patterns.md`. |
| **Task model** | A2A task state machine (`submitted → working → completed/failed/cancelled/input-required`) is now the unified model. Three new envelope codes: `IR` (input-required), `RI` (reply-input), `CX` (cancel). See `04-Patterns.md`. |
| **Negotiation** | `negotiation.js` offer/accept pre-task flow removed. Negotiation now happens mid-task via `input-required` state. Handlers yield `task.requireInput(parts)`; callers reply with `task.send(parts)`. A2A-native. |
| **Streaming modes** | Two explicit modes: `streaming: 'unidirectional'` (A2A + native, server push) and `streaming: 'bidirectional'` (native only, dual ST streams). `streaming: true` is treated as `'unidirectional'`. |
| **PeerGraph** | Extended with a second record type: `{ type: 'a2a', url, skills, ... }`. Native peer records unchanged. |
| **RoutingStrategy** | Gains awareness of peer type. A2A peers always route to A2ATransport. Native peers use existing priority order unchanged. |

## What does NOT change

Everything below is identical to `Design/`. Refer to those docs directly.

- The four transport primitives and `_put()` override model — `Design/03-Transport.md`
- Envelope format and all existing pattern codes (HI/OW/AS/AK/RQ/RS/PB/ST/SE/BT) — `Design/03-Transport.md`
- SecurityLayer (nacl.box + Ed25519) for native transports — `Design/03-Transport.md`
- All native transport implementations (NKN, MQTT, Relay, Rendezvous, mDNS, BLE, Internal, Local) — `Design/03-Transport.md`
- Interaction pattern implementations (messaging, taskExchange, session, streaming, fileSharing, pubSub) — `Design/` protocol handlers; v3 changes summarised in `04-Patterns.md`
- Trust tiers 0–3, group proofs, capability tokens, policy gates — `Design/08-Permissions.md`
- Vault interface and all storage backends — `Design/07-Storage.md`
- PeerGraph (native peers), gossip, ping, 8 native discovery routes — `Design/09-Discovery.md`
- SolidPod, mnemonic recovery, key rotation — `Design/10-SolidPod-Identity.md`
- Relay architecture and WsServerTransport — `Design/05-Relay.md`
- Blueprint system — `Design/04-AgentFile.md`
- Routing priority: Internal > Local > mDNS > Rendezvous > Relay > NKN > MQTT > BLE — `Design/03-Transport.md`

---

## Files in this directory

| File | Covers |
|------|--------|
| `00-Overview.md` | This file. What changes and why. |
| `01-Skills.md` | Skill definitions: unified A2A metadata + access-control. Agent card format. Agent file YAML. |
| `02-Parts.md` | Parts as a typed payload layer. Integration with interaction patterns. |
| `03-A2ATransport.md` | A2ATransport implementation. TLS security layer. A2A protocol handlers. PeerGraph extension. RoutingStrategy update. |
| `04-Patterns.md` | Interaction patterns in v3: task model, input-required negotiation, streaming modes, file transfer, pub-sub, sessions. A2A compatibility per pattern. |
