# Project: @canopy — Portable Decentralized Agent SDK

## What this is
An open-source JS SDK that turns web and mobile apps into decentralized agents
that exchange messages, data, and tasks without a required central server.
Built as an NLnet PoC grant deliverable. Ships as three npm packages:
`@canopy/core` (pure JS, runs in browser + Node + React Native),
`@canopy/relay` (Node-only rendezvous/relay server), and
`@canopy/react-native` (mDNS, BLE, Keychain vault). The canonical demo
surface is `apps/mesh-demo` (Expo) plus `packages/core/mesh-chat.html`.


## Goals
- independence of centralized players
- open source
- safe and reliable
- re-usability of user data
- easy interface for users/communities/teams to add/remove agents to their networks from anywhere
- compatibility with different device types (pc/mobile/IoT)
- easy integration of agents with (web) apps
- easy storage of agent definitions for users

## Non-goals
- Not requiring a central server; 
- 

## Architecture at a glance
The core is layered: Transport → SecurityLayer → Protocol → Agent. Transport
exposes four primitives (`sendOneWay`, `sendAck`, `request`, `respond`); there
is no PatternHandler. Every `_put()` is wrapped by SecurityLayer from Phase 1
(not retrofitted). Routing picks a transport per-peer via `transportFor()`;
replies are pinned to the channel the request arrived on (`envelope._transport`).
Trust is tiered (0=unknown, 1=verified, 2=group member, 3=token holder) and
capabilities are UCAN-inspired signed, attenuated, delegatable tokens. Key
modules: `packages/core/src/{transport,security,protocol,identity,discovery}`.

## Decisions already made (don't relitigate)
- **React Native for mobile.** Capacitor/Electron/Tauri were considered and
  rejected.
- **Transport primitives are fixed at four.** Don't reintroduce PatternHandler
  or a generic message bus.
- **SecurityLayer wraps every `_put()`** — don't add a "bypass" path for perf.
- **Relay has two modes:** Rendezvous (PeerJS signaling, WebRTC P2P) +
  Relay (WS proxy fallback). Don't add a third.
- **Mesh demo stack is pinned:** Expo 52 / RN 0.76.9 / React 18.3.1 /
  rn-webrtc 124.0.7. The Expo 52 downgrade was costly to reach; don't bump
  without an explicit ask.
- **Phone rendezvous is parked.** Three unexplored paths listed in
  `CODING-PLAN.md §DD4`, but default to `rendezvous: false` on phone.
- **Vault is pluggable per platform.** Online adapters (Bitwarden, SolidPod)
  are planned but not built.
- **Design-first workflow.** `Design/01`–`08` is the spec; code follows docs.

## Conventions
### Code style
- ES modules (`"type": "module"` at the monorepo root). `.js` only — no TS yet.
- Vitest for tests. Files end in `.test.js` and live under `packages/*/test/`.
- Private class fields (`#foo`) are in use (e.g. `Agent.#routing`); respect
  that convention when extending.
- Filenames: `PascalCase.js` for classes (`RelayTransport.js`), `camelCase.js`
  for modules/helpers (`taskExchange.js`).

### Patterns we use
- **Transport wiring:** see `packages/core/src/transport/Transport.js` — base
  class tags `envelope._transport` on receive so replies go back the same way.
- **Task exchange:** `packages/core/src/protocol/taskExchange.js` for the
  request/response pattern including streaming + input-required.
- **Agent construction:** `createMeshAgent` in the core index is the intended
  entry point; `apps/mesh-demo/src/agent.js` shows the phone wiring.

### Patterns we avoid
- Don't introduce new top-level dependencies without asking.
- Don't mutate `agent._routing` and expect it to take effect — constructor
  `#routing` is authoritative.
- Don't add `agent.transport` direct-access paths; use `transportFor(peerId)`.
- No new globals, no clever metaprogramming.
- Don't rewrite files in `sdk/` or `Architectural Design/` — reference only.

## How to run things
```bash
# Install (monorepo root)
npm install

# Test everything
npm test
# or per-package
npm run test:core
npm run test:rn
npm run test:relay

# Start the relay
npm run relay:start

# Mesh demo (phone)
cd apps/mesh-demo && npx expo start
# dev build is already installed on the phone — avoid `npx expo run:android`
# unless a native dep changed

# Browser demo
open packages/core/mesh-chat.html
```

## Testing philosophy
- Unit tests for protocol/security logic in `packages/core/test/`.
- E2E/integration tests live alongside (e.g. `keyRotation.e2e.test.js`).
- Transport behavior that depends on real sockets is verified via the demo
  surfaces (mesh-demo + mesh-chat.html), not mocked in unit tests.
- Design docs and throwaway session notes don't need tests.

## Definition of done
- [ ] `npm test` passes across all three packages.
- [ ] New behavior is covered by a test unless it's purely a UI/demo change.
- [ ] `Design/` docs updated if the architecture changed.
- [ ] No new top-level dependencies unless we agreed on them.
- [ ] Demo surfaces still reach `ready` with WiFi+BT off, BT-only, WiFi-only.
- [ ] Commit message explains the "why".

## Gotchas
- **`agent.#routing` vs `agent._routing`:** private constructor field is
  authoritative; the public one set by `setupRouting` is NOT used by
  `transportFor()`.
- **Relay peer discovery:** the relay broadcasts `peer-list`, never
  `peer-joined`. `RelayTransport` handles this; don't strip that path.
- **Replay window is ±10 min.** Clock skew larger than this rejects all
  messages with `REPLAY_WINDOW`.
- **BLE GATT is single-write-at-a-time per connection.** Writes are queued
  per-peer in `BleTransport`; don't parallelize them.
- **Metro caches aggressively.** Restart with `-c` after SDK changes.
- **`node_modules` and `react-native/android/build/`** are gitignored locally
  but appear as untracked — don't commit them.

## Out of scope for autonomous work
Stop and ask before doing any of these:
- Implementing a feature. Design first — only write code when I explicitly ask.
- Bumping Expo / RN / rn-webrtc versions in `apps/mesh-demo`.
- Re-enabling `rendezvous: true` on phone.
- Adding a new transport, a new trust tier, or a new token claim.
- Anything in `Design/` — treat as spec; edits are a design conversation.
- Adding dependencies to any `package.json`.
- Changes to the public API surface of `@canopy/core`.
- Running `npx expo run:android` — the phone's dev build is already installed.
