# Architecture

The deep version of how canopy fits together. If you only need the summary, the one-sentence model +
invariants in [`CLAUDE.md`](../CLAUDE.md) and the [project overview](../README.md) are enough. Read this when
you need to *understand the whole system* — why it's shaped this way, and how a request actually flows.

## The one idea

Every way a user can ask for something — a chat/LLM turn, a GUI tap, a slash command, a deterministic phrase
gate — **compiles down to the same intermediate**, `{opId, args}`, and hands it to `callSkill`. That shared
intermediate is the **thin waist**.

```
  AI (LLM)  ─┐
  GUI tap   ─┤→   { opId, args }   →  resolveDispatch → runDispatch → callSkill  →  functionality
  slash     ─┤         ▲ the manifest is the contract         (local handler · agent · model · pod · MCP · job)
  gate verb ─┘
```

Two consequences follow from the waist, and they are the whole architecture:

1. **Interfaces are peer compilers, not privileged front-ends.** AI and GUI both *compile to* `{opId, args}`;
   neither owns the logic. They are pass-throughs — *doorgeefluik*. Adding a surface never means adding a
   `switch` over apps; it means projecting the manifest onto that surface.
2. **Where an op resolves is a separate axis from how it was invoked.** `callSkill` runs the op; the
   functionality it names can live *anywhere* — a local handler, an external agent, a model, the user's Solid
   pod, an MCP service, a scheduled job. The interface doesn't know or care.

This is the seam the repo will eventually split on: **interface clients above the waist**,
**functionality/substrate below it**, the **manifest between**.

## The manifest is the contract

An app declares its surface **once, as data**, in a `manifest.js`: its item types, operations, views, and
per-operation surface hints. It is the single source of truth every surface reads. Five pure **projectors**
(`@canopy/app-manifest`) turn that one declaration into every surface:

| Projector | Produces | Half |
|---|---|---|
| `renderChat` | LLM tool definitions + system prompt | the model half |
| `renderGate` | deterministic pre-LLM token-gate rules (from each op's `surfaces.slash.match` verbs) | the deterministic half |
| `renderSlash` | `/commands` + grammar | the deterministic half |
| `renderWeb` | DOM pages + forms | GUI |
| `renderMobile` | a React Native NavModel (screens/nav) | GUI |

`renderChat` and `renderGate`/`renderSlash` are the two halves of the *input* side — the LLM path and the
deterministic path, from the same manifest. Read the five as **two groups, not a flat list**: those three are
**platform-agnostic input modalities** (identical on web and mobile — this *is* the `web ≡ mobile` invariant),
while `renderWeb`/`renderMobile` are thin **platform shells** — and `renderMobile` is literally a re-export of
`renderWeb`'s NavModel, differing only in the platform adapter. `@canopy/manifest-host` composes *N* apps' manifests at runtime
(namespaced `appId.opId`, collision detection). Because every surface is a projection, **adding an op to a
`manifest.js` makes it reachable from chat, slash, gate, web, and mobile at once** — and the coverage snapshot
(`npm run coverage` → `apps/canopy-chat/docs/surface-coverage.md`) records which surfaces each op is wired for,
so the map can't drift from the manifests.

## How a request flows, end to end

1. **Invocation** — the user types in chat, taps a button, runs `/command`, or hits a gate phrase ("add milk").
2. **Compile to the waist** — the interface's projector turns that into `{opId, args}`. The gate resolves
   common phrases *without* the model; anything else goes through the LLM (`renderChat`) or the GUI form.
3. **Dispatch** — `resolveDispatch` maps `{opId, args}` to a handler via the merged manifest; `runDispatch`
   invokes it.
4. **`callSkill`** — the single entry point that runs the op. This is also the **security boundary**: an op
   only runs if it's in the caller's effective capability set (see the capability model work).
5. **Functionality resolves** — wherever it lives: a local skill handler, a peer agent over a transport, an
   LLM, a read/write against the Solid pod, an MCP tool, or a scheduled job.
6. **Result** — flows back to the invoking surface. Verify the *result*, not just that dispatch fired: a gate
   can route correctly while the op silently fails.

## Chat and screens compose (and trigger each other)

There are two surface *families* over the waist, not one: **conversational** (chat/gate/slash) and **screen**
(the web/mobile GUI). They don't merely render the same op in parallel — they **compose and trigger each other**.
Today, in the web shell: an op that declares `surfaces.ui.screen` gets an **"Open" button** that opens a
full-screen panel (`openCircleScreenPanel`); conversely a **row action inside a screen posts `{opId, args}` back
through the same waist** (`dispatchReady`). So a chat command can open a screen, and a screen action can drive a
chat flow. Three treatments — **inline menu · full-screen panel · chat** — are chosen per user.

*Honest state:* the screen registry is still a **hardcoded `LIST_SCREENS` map**, not yet the manifest-driven
`surfaces.screen` projection; and the loop is wired in **web** — mobile has the shared pure pieces but its
panel-openers are still DOM-specific. Closing both is roadmap work.

## Circles, types, and capabilities — one algebra

A few concepts are deliberately *the same thing*, so that data, permissions, and audience line up instead of
drifting apart:

- A **circle** is one scope worn several ways at once: the **audience** of an item (who may see it), the
  **storage key** (data is keyed by `circle + type`), the **capability-policy scope** (permissions are
  per-circle), and the **pod routing key** — all one `circleId`. (A circle is itself an item-type.)
- A **capability** is a **`(verb × noun)`** pair — the **verb** is a canonical **atom** (`add` · `list` ·
  `update` · `remove` · `complete` · `claim` · `share` · …) and the **noun** is an **item-type** (`task` ·
  `note` · `offer` · `contact` · …). So "who may do what" is a set of `(atom × item-type)` pairs, authorized
  **per circle at `callSkill`** (default-deny).
- A manifest **declares** its `nouns` (its capability surface); its ops just fill in the implementing `opId`.
  The same item-type registry that validates stored data supplies the nouns.

The upshot: the **type axis** (item-types), the **verb axis** (atoms), and the **scope axis** (circles) compose
— **storage, permissions, and surfaces are all projections of one `(circle, type, verb)` space.** That is why a
new noun added to a manifest becomes storable, gate-able, and renderable at once.

## The layers — kernel, adapters, substrates, apps

Code depends downward only — a project-wide invariant (full detail:
[`conventions/architectural-layering.md`](./conventions/architectural-layering.md)):

```
apps/                        thin compositions — per-app glue + UI
  ↓
packages/{substrates}        reusable building blocks — item-store, skill-match, notifier, app-manifest,
                             pod-client, sync-engine, … (a gradient: runtime-foundation → feature → facade)
  ↓
packages/core                the KERNEL — a lean set of PORTS + kernel logic
```

- **The kernel (`packages/core`) is lean.** It holds the `Agent`, envelope/parts, the skill registry, the
  `callSkill` security gate, `InternalTransport`, and the **ports** — `Transport` · `DataSource` · `ActorResolver`.
  The ports are the **named compatibility contract**: *implement the port + pass its conformance harness =
  compatible with the kernel* ([`conventions/ports.md`](./conventions/ports.md)). The concrete **adapters** live
  OUTSIDE the kernel — network transports in **`@canopy/transports`**, Solid-pod storage + on-pod identity in
  **`@canopy/pod-client`**, the vault family in **`@canopy/vault`** — and nothing in the kernel depends *up* on an
  adapter (guarded by `test/layering.enforcement.test.js`).
- **The developer SDK is `@canopy/sdk`** — the fat, batteries-included facade, **layered**: a *low* layer
  re-exports the kernel + default adapters (pass your own explicitly → maximal clarity/compatibility), and a
  *high* layer adds `createAgent()` (run-as-agent, defaults injected) + `connectSkill(agent, name, appFn)` (map any
  app function to a skill). "Import one thing, done"; drop a layer for full control. Defaults (e.g. `VaultMemory`)
  live in the facade, never the kernel.
- **Substrates** compose the kernel + adapters into reusable pieces and **must not reinvent the kernel**. They
  form a **gradient**: *runtime-foundation* (vault, oidc-session, pod-client — near-required for a networked
  agent) → *feature* (skill-match, notifier, pod-search — optional) → *facade* (secure-agent, agent-provisioning —
  compose others). Extracted under a **rule of two** — generalise on the second independent need, not the first.
- **Apps** compose substrates (or `@canopy/sdk`), using the kernel directly only with a justification in the app
  README.

See [`repository-layout.md`](./repository-layout.md) for the full apps + packages map. *(History: `core` was a
**fat** package that also carried the concrete transports, pod-storage, and pod-identity and even depended up on
`vault`/`oidc-session`; the 2026-07-05 de-fat extracted all of that out and made the kernel a lean set of ports —
the diagram and the dependency graph now match.)*

**A fourth region the diagram omits: the deployment / hosting layer.** Client apps host nothing. Server-side
services — **pod-HOSTING**, relay/proxy, the private-LLM enclave, rollout — form a separate layer, placed by
trust + latency (below), that sits *outside* the client apps. The `feedback` deployment occupies it today (it
runs a live Solid-pod host, HTTP services, and a container stack that no client app has). This is where the
eventual repo split's server side lives.

## Placement by trust + latency — never default-to-server

*Where* functionality runs is decided by **trust and latency, not convenience**. Sensitive compute (pod
access, sealing, the confidential LLM transport) stays client-side or in an **attested enclave** (TEE);
"server-side" means *extracting* code that is already server-side (pod-hosting, relay/proxy, private LLM), not
moving private data onto an untrusted host. Correspondingly:

- **Local-only mode is the floor; the pod is portability.** Every app works fully without an authenticated
  pod. Shared-state apps without a pod replicate P2P via kernel `MergeContracts` + relay group-publish.
- **Pod is truth, local cache is reality.** When a pod is configured it's authoritative but slow; the UI reads
  the local cache and syncs on a cadence with optimistic, queued writes. A pod outage must not break the app.

## Agents interacting (the inter-agent axis)

The flow above is **intra-agent**: one interface → the waist → dispatch → functionality. Equally fundamental is
the **inter-agent** axis — agents as **peers exchanging over a transport**, carried by an **envelope**. One wire
carries three things: it **syncs circle stores** (with no pod, a write fans out to circle members as envelopes),
it carries **direct exchanges** (offer→claim, request→respond), and it enables **remote skill-acquisition** — an
agent authenticates into *another* agent's gated skill surface over a transport, with identity, permission, and
validation travelling **in the envelope**. This is what lets functionality resolve on an external agent
(consequence #2 above), and it's the substrate the developer-integration on-ramps (a connected bot, a remote
handler) build on. The paths that carry it are below.

## Reachability

Two peers exchange messages over whichever path is currently usable; a per-peer picker chooses, no app code
does. Paths: **direct** (mDNS/TCP, BLE, or relay-signalled WebRTC), **relay** (`@canopy/relay`, rendezvous or
sealed proxy-fallback), **NKN** (the public messaging network, no operator to run), and **hop** (a third agent
relays, plaintext or sealed-forward, with hop-count + policy gating). Details:
[project overview → Reachability](../README.md#reachability--transports).

## Direction (where this is going)

- **Apps dissolve into canopy-chat** (decided 2026-06-11). The manifest-per-app split is an *engineering*
  boundary, not a product one: the `manifest.js` declarations stay (they're the source of truth every
  projector reads), but the app *names* become navigation/reference labels inside one unified chat surface.
  Treat new work as **adding manifests + projectors to canopy-chat**, not standing up new app silos.
- **Enforce the model, then split** (2026-06-13). The model is settled; the active work is making it
  *self-enforcing* so the code stops drifting — turn each invariant into a CI fitness function, consolidate
  the remaining duplication, then split the repo along the now-enforced seams: thin **clients** (web + mobile),
  **substrate/functionality** (packages + already-server-side pod-hosting/proxy/private-LLM), the **feedback
  app**, and **third-party apps** that build against the Solid pod + `@canopy/sdk` (pod ACPs are the access
  contract) without touching this repo.

## Where to go next

- [`CLAUDE.md`](../CLAUDE.md) — the working conventions + the invariants, for agents editing code here.
- [`conventions/`](./conventions/) — the detailed project-wide rules.
- [`glossary.md`](./glossary.md) — every term used above, defined.
- [project overview](../README.md) — the apps, the status, how to run things.
