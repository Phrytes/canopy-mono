# @canopy

Portable decentralized agent SDK.  Web and mobile apps that exchange
messages, data, and tasks **without a required central server**.

## Architecture — read this first

> **The codebase has three layers — apps depend on substrates, substrates
> depend on the agent SDK.  This is a project-wide invariant. Any AI or
> human working on this repo MUST keep it top-of-mind.**

```
apps/                       ←  thin compositions; per-app glue + UI
  ↓
packages/{item-store,        ← substrates (L1a–L1j); reusable building blocks
  agent-ui, skill-match,
  notifier, identity-resolver,
  sync-engine, chat-agent,
  llm-client, oauth-vault,
  pod-search}
  ↓
packages/{core, relay,       ← agent SDK; the foundation
  pod-client, react-native}
```

**The agent SDK is four packages — `@canopy/core`, `@canopy/relay`,
`@canopy/pod-client`, `@canopy/react-native`** (described below).
Substrates compose these; substrates MUST NOT reinvent SDK primitives.
Apps compose substrates; apps MAY use the SDK directly **only with an
explicit justification** in the app's README.

**Required reading before authoring code in this repo:**

- [`Project Files/conventions/architectural-layering.md`](./Project%20Files/conventions/architectural-layering.md) — the layering rule, what each layer owns, what's NOT acceptable.
- [`Project Files/conventions/app-readme-scheme.md`](./Project%20Files/conventions/app-readme-scheme.md) — every app under `apps/` MUST follow this README scheme. New apps ship with it from the first commit.
- [`Project Files/Substrates/policies.md`](./Project%20Files/Substrates/policies.md) — rule-of-two extraction policy.
- [`Project Files/Substrates/refactor/00-Overview.md`](./Project%20Files/Substrates/refactor/00-Overview.md) — substrate-vs-SDK audit (active refactor, 2026-05-04).
- [`DESIGN-navmodel-sketch.md`](./DESIGN-navmodel-sketch.md) — the **NavModel substrate** (`@canopy/app-manifest` V0.1→V0.8 / Q1–Q27). Every app declares its operations + views + surfaces in a `manifest.js`; projectors (`renderWeb` / `renderMobile` / `renderChat`) turn the declaration into NavModel for web / RN / chat-tool surfaces. Adopted by tasks-v0 / stoop / household / folio.
- [`DESIGN-tier-policy.md`](./DESIGN-tier-policy.md) — **page-tier policy (T1 / T2 / T3)**. Every user-facing page declares its tier in a comment header.  **T2 is the default** for non-list-shaped pages: hand-coded rendering but reads labels / Q27 confirm severity / slash commands from the manifest via `createOpBinding`.  T3 (fully bespoke, no manifest) requires inline justification.
- [`Project Files/Substrates/tier-c-proposals.md`](./Project Files/Substrates/tier-c-proposals.md) — record of which substrate signals were **deferred** (enabledWhen / list-within-record / multi-step wizards) and the one that landed (Q27 confirm severity). Keeps the substrate's discipline durable: "wait for the second independent need before generalising."
- [`Project Files/AgentHub/agent-hub-design-2026-05-05.md`](./Project%20Files/AgentHub/agent-hub-design-2026-05-05.md) — the per-device Agent Hub design. **Any new app that uses the Agent SDK (directly or via substrates) must be designed to be compatible with the hub** — at minimum, spawn / extend agents under the user's root identity via capability tokens, and avoid design choices that would preclude a future "lite mode" where heavy work (relay connection, pod credentials, peer/hop tables) is delegated to the hub. The hub itself is still a design exploration; current apps may run standalone, but new apps must declare their hub-attachment plan in their README (see the scheme). The same rule applies to project-level designs under `Project Files/projects/` — see [`Project Files/projects/README.md`](./Project%20Files/projects/README.md#agent-hub-compatibility--applies-to-every-agentic-project-here).
  - **2026-05-08 update.** The Hub will be a **separate phone app**, not a desktop daemon. The earlier design doc framed Hub as a desktop service (launchd / systemd-user / Task Scheduler patterns); that framing is superseded — Hub-on-phone is the direction. The hub-attachment / lite-mode rule still applies, just with a phone-side hub implied. **Lite mode is deferred** for current apps; ship `standalone` and stay hub-compatible.

### Platform support — iOS deliberately out of scope (locked 2026-05-08)

This project targets **Android + Web** for V1. iOS support is
acknowledged as out-of-scope: Apple's restrictions on background
tasks, Web Push (PWA-installed-only on Safari), peer-to-peer
networking (no MdnsTransport, restricted BLE), and the App Store
review process compound to make iOS V1 economics not worthwhile
for a research-preview / closed-beta. Apps that happen to run on
iOS via Expo are welcome to; the project does not add iOS-specific
code paths, does not test on iOS, and does not block on iOS bugs.
- [`Project Files/conventions/localisation.md`](./Project%20Files/conventions/localisation.md) — every app with a user-facing surface ships translatable from the first commit; substrates emit error codes, not user-facing strings.
- [`Project Files/conventions/cross-app-settings.md`](./Project%20Files/conventions/cross-app-settings.md) — every app's pod-side settings split into `shared.json` (user-portable) + `devices/<deviceId>.json` (per-install, local-only). Sibling apps may seed first-run defaults from each other's `shared.json`. Stoop V2.5 is the canonical example.

> **Coding-plan location policy (2026-05-05):** new coding plans
> live next to the project they belong to (e.g.
> `Project Files/Stoop/coding-plan-v1-2026-05-05.md` for Stoop V1).
> The old `Project Files/coding-plans/` directory is **deprecated
> for new plans** and kept read-only for ongoing tracks (track-H,
> H5-V2, etc.). Don't add new files to that directory.

### Project-wide engineering practices

Three patterns apply across every agentic project in this repo and
are worth knowing before authoring any of them:

- **Local-only mode is the floor; pod is portability.** Every app
  must work fully without an authenticated pod. The pod is the
  cross-device / cross-install portability layer, not a runtime
  dependency. Apps that need *shared state across users* (household,
  closed-group archives) and don't have a pod fall back to SDK
  `MergeContracts` + `@canopy/relay`'s `group-publish` for P2P
  state replication, or to a designated state-keeper peer. Full
  pattern in
  [`Project Files/projects/README.md`](./Project%20Files/projects/README.md#local-only-mode-is-the-floor--applies-to-every-agentic-project-here).
- **Pod is truth, local cache is reality.** When a pod *is*
  configured, it is authoritative — but slow / sometimes flaky. Apps
  must read from local cache for UI rendering and sync to / from the
  pod separately on a cadence. Writes are queued + optimistic; pod
  outages must not break the app. Full pattern in
  [`Project Files/projects/README.md`](./Project%20Files/projects/README.md#pod-is-truth-local-cache-is-reality--applies-to-every-agentic-project-here).
- **Network identity rotation by default.** `Agent.rotateIdentity()`
  in `@canopy/core` (Group FF) rotates the agent's Ed25519 keypair
  with grace-period broadcasts. Pod WebID stays stable; network
  pubKey rotates. Default cadence: 30 days. Reduces long-term
  relay-traffic correlation. Full pattern in
  [`Project Files/projects/README.md`](./Project%20Files/projects/README.md#network-identity-rotation--applies-to-every-agentic-project-here).

### Decentralised disclaimer — applies to every agentic project

There is no central support desk, no abuse team, no trust authority
that can resolve problems for users — this is a structural property
of the SDK, not a bug. Every agentic project must ship a clear
disclaimer in onboarding (named operator, group-admin moderation,
how-conflict-is-handled, why-this-is-the-deal) and treat
"create-group" as a governance step, not a technical one. Full
guidance: [`Project Files/projects/README.md`](./Project%20Files/projects/README.md#decentralised-disclaimer--every-agentic-project-ships-with-one).

### Engineering practice — feedback loops on UX-load-bearing parameters

Some user-facing parameters cannot be pre-tuned from a spec — push
notification cadence is the canonical example: too aggressive →
spam + churn; too cautious → matches die unanswered. The right
setting depends on group size, time of day, message kind, and
individual preference. **Plan a feedback loop instead of a guess.**
Concretely:

- Ship sensible defaults (Stoop V1: push only for `humanInTheLoop` matches, ≤ 3 / day, batched into digests beyond that).
- Provide per-user and per-group dials.
- Instrument metrics from day 1 (notifications received vs. dismissed, vragen answered after push vs. without).
- Adjust defaults in V1.5 / V2 from real data.

Apply the same loop pattern to: lend-return reminder cadence,
proximity-ping rate, group-membership re-key TTL, prikbord fetch
cadence, and any other parameter sitting in the UX-load-bearing
critical path. See `Project Files/Stoop/advice-2026-05-05.md` §
"Engineering practice — feedback loop" for the worked example.

---

## Single-agent rule — apps own ONE `core.Agent`

> **Every app builds one `core.Agent` per service-context. Transports
> are routes plugged into that agent, not parallel agent instances.**

A `core.Agent` owns identity, the `RoutingStrategy`, the `PeerGraph`,
the SecurityLayer, the skill registry, and one mDNS service
registration / one relay WebSocket per registered transport. Apps
that need multi-scope semantics (multiple groups, crews, accounts,
…) keep per-scope state — `ItemStore` / `MemberMap` / `SkillMatch` /
mirror — outside the agent and dispatch to the right scope at the
**skill** level via a `getBundle(args, ctx)` resolver. Skills
register on the shared agent **once**.

Spinning up N agents to model N scopes is an anti-pattern: it
creates duplicate mDNS registrations under the same identity,
ambiguous relay routing, fragmented `PeerGraph`s, and confusing
transport-level logs. Concrete reference implementation:
`apps/stoop-mobile`'s `ServiceContext` + `buildGroupState`.

Full rationale + correct/anti-pattern code sketches:
[`Project Files/conventions/single-agent.md`](Project%20Files/conventions/single-agent.md).

---

## Pinned versions — DO NOT bump without explicit approval

> **Expo 52 is the ceiling.** `expo@^52.0.0` + the SDK-52-compatible
> `expo-asset@~11.0.5`, `expo-constants@~17.0.8`, `expo-dev-client@~5.0.20`,
> `expo-file-system@~18.0.12`, `expo-font@~13.0.4`, `expo-keep-awake@~14.0.3`,
> `expo-notifications@~0.29.14`, `expo-status-bar@~2.0.1`,
> `expo-modules-autolinking@^2.0.8`. **React Native 0.76.9. React 18.3.1.**
>
> `npm audit fix --force` will try to bump Expo past 52 — **do not run it**.
> The bring-up traps in
> [`packages/react-native/docs/BRING-UP-NOTES.md`](./packages/react-native/docs/BRING-UP-NOTES.md)
> are calibrated against this matrix; any Expo bump invalidates the
> trap fixes and re-opens problems that took weeks to land.
>
> If a fresh `npm install` hits `ERESOLVE` on `react-native-get-random-values`,
> use `--legacy-peer-deps` (matches `apps/mesh-demo`) or pin to `^1.11.0`
> (matches `apps/folio-mobile`).

The full version matrix lives at
[`packages/react-native/docs/VERSION-MATRIX.md`](./packages/react-native/docs/VERSION-MATRIX.md).

---

## The agent SDK — four packages

- **`@canopy/core`** — pure JS, runs in browser, Node, and React Native.
  Identity + vault, security, transports (Relay / Local / Mqtt / Nkn /
  Rendezvous / Offline / Internal), routing, agent class, skill registry +
  `defineSkill`, protocols (pubSub / SkillsPubSub / taskExchange / messaging /
  …), permissions (PolicyEngine, CapabilityToken, GroupManager), storage
  primitives (SolidPodSource, MergeContracts, FederatedReader,
  PodStorageConvention), A2A.
- **`@canopy/relay`** — Node-only WebSocket relay server. Rendezvous +
  proxy fallback + multi-recipient fan-out + group auth + push wake (E2c).
- **`@canopy/pod-client`** — high-level Solid pod client: read, write,
  list, conflict resolution, tombstone tracking.
- **`@canopy/react-native`** — RN platform layer: BLE, mDNS,
  KeychainVault, MobilePushBridge, `createMeshAgent` factory, polyfill
  + Metro preset (see `packages/react-native/docs/BRING-UP-NOTES.md`).

The full surface — every public symbol with its file:line — is mapped in
[`Project Files/Substrates/refactor/SDK-surface-map.md`](./Project%20Files/Substrates/refactor/SDK-surface-map.md).

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
on the roadmap.  Today the relay is suitable for trusted networks
(personal devices, group infrastructure, dev).

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
