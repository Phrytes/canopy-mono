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
  `renderWeb` (DOM pages/forms), `renderMobile` (RN NavModel). Same manifest, every surface. The five fall in
  **two groups**: `renderChat`/`renderSlash`/`renderGate` are **platform-agnostic input modalities** (the
  `web ≡ mobile` invariant); `renderWeb`/`renderMobile` are **platform shells** (`renderMobile` re-exports
  `renderWeb`'s NavModel — only the adapter differs).
- **Gate** — the deterministic, *pre-LLM* router: it matches common phrases ("add X", "done X") to ops via
  token rules projected from the manifest, so routine input doesn't need the model.
- **Doorgeefluik** (Dutch: "pass-through hatch") — the principle that interfaces are pass-throughs to
  functionality. AI and GUI are **peer compilers** to the waist; neither is privileged.

## Layers

- **Kernel** (`packages/core`) — the lean bottom of the stack: the `Agent`, envelope/parts, the skill registry,
  the `callSkill` security gate, identity, `InternalTransport`, and the **ports**. It holds *no concrete adapters*
  and depends *up* on nothing (fitness-fn-guarded).
- **Port** — an interface the kernel declares as its **compatibility contract**: `Transport`, `DataSource`,
  `ActorResolver`. A third-party adapter is compatible iff it *implements the port + passes its conformance harness*
  (see [`conventions/ports.md`](./conventions/ports.md)).
- **Adapter** — a concrete implementation of a port, living **outside** the kernel: network transports in
  `@onderling/transports`, Solid-pod storage + on-pod identity in `@onderling/pod-client`, the Vault family in `@onderling/vault`.
- **Platform** — the whole reusable foundation: kernel + adapters + substrates. The thing a dev builds on.
- **SDK** (`@onderling/sdk`) — **the** dev-facing front door to the platform: a *layered facade*. Low layer
  re-exports the kernel + default adapters (pass your own explicitly); high layer adds `createAgent()`
  (batteries-included run-as-agent) + `connectSkill()` (map any app function to a skill). "Import one thing, done."
- **Substrate** — a reusable building block in `packages/` that composes the kernel + adapters (e.g. `item-store`,
  `skill-match`, `notifier`). Apps compose substrates; substrates don't reinvent the kernel. *The tier is a
  **gradient**:* runtime-foundation (near-required: vault, oidc-session, pod-client) → feature (optional:
  skill-match, notifier) → facade (composes others: secure-agent, agent-provisioning).
- **Deployment / hosting layer** — server-side services outside the client apps: **pod-hosting**, relay/proxy,
  the private-LLM enclave, rollout. Placed by trust + latency; the `feedback` deployment occupies it today.
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
- **MergeContract** — the kernel's per-field merge rules that let shared-state apps replicate P2P without a pod.

## Audience & groups

- **Audience** — who can see/receive an item. A **circle** (Dutch: *kring*) is a *saved* audience — but the same
  `circleId` is worn several ways at once: the **audience**, the **storage key** (data is keyed by `circle + type`),
  the **capability-policy scope** (permissions are per-circle), and the **pod routing key**. A circle is itself an
  item-type. (See `packages/circles`.)
- **Governance** — closed groups (circles, neighbourhoods) run their own membership/roles; *create-group* is
  treated as a governance step, since there is no central trust authority.

## Capabilities (the algebra)

- **Atom** — a canonical **verb** from the fixed catalogue (`add` · `list` · `update` · `remove` · `complete` ·
  `claim` · `share` · …). Ops name an atom; capabilities are granted per atom.
- **Noun** — an **item-type** used as the object of a capability (`task`, `note`, `offer`, …). A manifest
  **declares** its nouns; the item-type registry that validates stored data supplies them.
- **Capability** — a **`(verb × noun)` = `(atom × item-type)`** pair, authorised **per circle at `callSkill`**
  (default-deny). "Who may do what" is a set of these pairs — storage, permissions, and surfaces are all
  projections of the one **`(circle, type, verb)`** space.
- **Envelope** — the inter-agent message primitive on the wire: it syncs circle stores, carries direct exchanges
  (offer→claim, request→respond), and carries identity/permission for **remote skill-acquisition** (an agent
  authenticating into another's gated skill surface over a transport).

## Reachability (transports)

- **Relay** — a `@onderling/relay` WebSocket server: rendezvous signalling (SDP/ICE only) or proxy-fallback
  (forwards sealed envelopes it can't read).
- **NKN** — the public [NKN](https://nkn.org) messaging network; no operator to run, address derived from the
  agent's Ed25519 seed.
- **Rendezvous / WebRTC** — relay-signalled DataChannel across networks; the relay drops out of the data path
  once connected.
- **Hop / peer-as-relay** — a third agent relays for two peers who can't reach each other, as a plaintext
  bridge or a sealed forward (`nacl.box` blob it can't open); hop-count + policy gating prevent abuse.

## Names

- **canopy / Onderling** — *canopy* is the engineering name (the platform ships as `@onderling/*`, apps as `@onderling-app/*`);
  ***Onderling*** is the working name in public/product material.
