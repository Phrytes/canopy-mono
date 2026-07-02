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
deterministic path, from the same manifest. `@canopy/manifest-host` composes *N* apps' manifests at runtime
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

## Three layers

Code depends downward only. This is a project-wide invariant (full detail:
[`conventions/architectural-layering.md`](./conventions/architectural-layering.md)):

```
apps/                       thin compositions — per-app glue + UI
  ↓
packages/{substrates}       reusable building blocks — item-store, skill-match, notifier, app-manifest, …
  ↓
packages/{core, relay,      the agent SDK — identity, transports, pod client, RN platform
          pod-client, react-native}
```

- **SDK** gives every app identity + vault, security (SecurityLayer, hello handshake, capability tokens),
  transports, routing, the `Agent` class, the skill registry, and storage primitives.
- **Substrates** compose the SDK into reusable pieces and **must not reinvent its primitives**. Extracted
  under a **rule of two** — generalise on the second independent need, not the first.
- **Apps** compose substrates, and use the SDK directly only with a justification in the app README.

See [`repository-layout.md`](./repository-layout.md) for the full apps + packages map.

## Placement by trust + latency — never default-to-server

*Where* functionality runs is decided by **trust and latency, not convenience**. Sensitive compute (pod
access, sealing, the confidential LLM transport) stays client-side or in an **attested enclave** (TEE);
"server-side" means *extracting* code that is already server-side (pod-hosting, relay/proxy, private LLM), not
moving private data onto an untrusted host. Correspondingly:

- **Local-only mode is the floor; the pod is portability.** Every app works fully without an authenticated
  pod. Shared-state apps without a pod replicate P2P via SDK `MergeContracts` + relay group-publish.
- **Pod is truth, local cache is reality.** When a pod is configured it's authoritative but slow; the UI reads
  the local cache and syncs on a cadence with optimistic, queued writes. A pod outage must not break the app.

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
  app**, and **third-party apps** that build against the Solid pod + agent SDK (pod ACPs are the access
  contract) without touching this repo.

## Where to go next

- [`CLAUDE.md`](../CLAUDE.md) — the working conventions + the invariants, for agents editing code here.
- [`conventions/`](./conventions/) — the detailed project-wide rules.
- [`glossary.md`](./glossary.md) — every term used above, defined.
- [project overview](../README.md) — the apps, the status, how to run things.
