# Glossary

The vocabulary that recurs across canopy. Plain definitions; see the [project overview](../README.md) for how
they fit together.

## The model

- **Manifest** (`manifest.js`) — an app's surface declared **once, as data**: its item types, operations,
  views, and per-operation surface hints. The single source of truth every projector reads.
- **Op / `opId`** — one named operation an app exposes (e.g. `addTask`, `claim`). Apps are addressed by
  `{opId, args}`, not by function calls.
- **The thin waist — `{opId, args}`** — the one intermediate every interface compiles down to. Chat, GUI,
  slash, and gate all produce `{opId, args}` and hand it to `callSkill`. This is the seam the repo will
  eventually split on: interface clients above it, functionality/substrate below, the manifest between.
- **`callSkill`** — the single entry point that runs an op. *Where* the op resolves is a separate axis: a
  local handler, an external agent, a model, the pod, an MCP service, or a scheduled job.
- **Projector** — a pure function that turns the one manifest into one surface: `renderChat` (LLM tools +
  system prompt), `renderSlash` (`/commands` + grammar), `renderGate` (deterministic pre-LLM token-gate),
  `renderWeb` (DOM pages/forms), `renderMobile` (RN NavModel). Same manifest, every surface.
- **Gate** — the deterministic, *pre-LLM* router: it matches common phrases ("add X", "done X") to ops via
  token rules projected from the manifest, so routine input doesn't need the model.
- **Doorgeefluik** (Dutch: "pass-through hatch") — the principle that interfaces are pass-throughs to
  functionality. AI and GUI are **peer compilers** to the waist; neither is privileged.

## Layers

- **SDK** — the foundation packages (`core`, `relay`, `pod-client`, `react-native`): identity, transports,
  pod access, RN platform.
- **Substrate** — a reusable building block in `packages/` that composes the SDK (e.g. `item-store`,
  `skill-match`, `notifier`). Apps compose substrates; substrates don't reinvent the SDK.
- **Agent** — one `core.Agent` per service-context. Transports are routes plugged into that one agent;
  multi-scope state lives in per-scope stores *outside* it. N agents for N scopes is an anti-pattern
  (the **single-agent rule**).

## Data & storage

- **Item / item-type** — the cross-app data taxonomy (`task`, `note`, `chat-message`, `offer`, `request`,
  `claim`, `contact`, `calendar-event`, …), project-namespaced under `https://canopy.org/ns#`.
- **Pod (Solid pod)** — the user's personal, standards-based data store. In canopy it's the **portability
  layer, not a runtime dependency**: every app runs fully local; the pod is opt-in.
- **WebID** — a stable identity URI for a user, hosted at their pod; the network keypair can rotate while the
  WebID stays fixed.
- **ACP** — Access Control Policy on a pod; the access contract third-party apps build against.
- **Local-first** — local cache is reality (fast, always available); the pod is truth (authoritative but
  slow). Writes are optimistic and queued; a pod outage must not break the app.
- **MergeContract** — the SDK's per-field merge rules that let shared-state apps replicate P2P without a pod.

## Audience & groups

- **Audience** — who can see/receive an item. A **circle** (Dutch: *kring*) is a *saved* audience — the same
  primitive at two granularities (see `packages/circles`).
- **Governance** — closed groups (crews, neighbourhoods) run their own membership/roles; *create-group* is
  treated as a governance step, since there is no central trust authority.

## Reachability (transports)

- **Relay** — a `@canopy/relay` WebSocket server: rendezvous signalling (SDP/ICE only) or proxy-fallback
  (forwards sealed envelopes it can't read).
- **NKN** — the public [NKN](https://nkn.org) messaging network; no operator to run, address derived from the
  agent's Ed25519 seed.
- **Rendezvous / WebRTC** — relay-signalled DataChannel across networks; the relay drops out of the data path
  once connected.
- **Hop / peer-as-relay** — a third agent relays for two peers who can't reach each other, as a plaintext
  bridge or a sealed forward (`nacl.box` blob it can't open); hop-count + policy gating prevent abuse.

## Names

- **canopy / Onderling** — *canopy* is the engineering name (SDK ships as `@canopy/*`, apps as `@canopy-app/*`);
  ***Onderling*** is the working name in public/product material.
