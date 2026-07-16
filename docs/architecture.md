# Architecture

The deep version of how canopy fits together. If you only need the summary, the one-sentence model +
invariants in [`CLAUDE.md`](../CLAUDE.md) and the [project overview](../README.md) are enough. Read this when
you need to *understand the whole system* — why it's shaped this way, and how a request actually flows.

**The model in one sentence.** Every interface — AI, GUI, slash command, deterministic gate — compiles to the
same `{opId, args}` and hands it to `callSkill`; an app's `manifest.js` is the single contract, and pure
projectors turn that one declaration into every surface. Interfaces are pass-throughs (*pass-through*); the
manifest is the contract; the functionality the op names resolves *wherever it lives*.

**How this document is organised.** Five parts, front to back — the model, then how it runs, then the domain
it models, then the system it runs on, then where it's going:

| Part | Sections | What you get |
|---|---|---|
| **1 · The model** | The one idea · The manifest is the contract | the thin waist, and the single declaration every surface reads |
| **2 · How it runs** | How a request flows · Retrieval (RAG) · Chat and screens compose | a request end to end, how answers are grounded, and how surfaces trigger each other |
| **3 · The domain** | Circles/types/capabilities · Sharing | the one `(circle, type, verb)` algebra, and how sealed sharing rides on it |
| **4 · The system** | The layers · Placement by trust+latency · Agents interacting · Reachability | kernel/adapters/substrates, where compute is placed, and the inter-agent axis |
| **5 · Direction** | Direction · Where to go next | what's being enforced next, and pointers onward |

---

## 1 · The model

*The thin waist, and why the two consequences that fall out of it are the whole architecture.*

### The one idea

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
   neither owns the logic. They are pass-throughs — *pass-through*. Adding a surface never means adding a
   `switch` over apps; it means projecting the manifest onto that surface.
2. **Where an op resolves is a separate axis from how it was invoked.** `callSkill` runs the op; the
   functionality it names can live *anywhere* — a local handler, an external agent, a model, the user's Solid
   pod, an MCP service, a scheduled job. The interface doesn't know or care.

This is the seam the repo will eventually split on: **interface clients above the waist**,
**functionality/substrate below it**, the **manifest between**.

### The manifest is the contract

An app declares its surface **once, as data**, in a `manifest.js`: its item types, operations, views, and
per-operation surface hints. It is the single source of truth every surface reads. Five pure **projectors**
(`@onderling/app-manifest`) turn that one declaration into every surface:

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
`renderWeb`'s NavModel, differing only in the platform adapter. `@onderling/manifest-host` composes *N* apps' manifests at runtime
(namespaced `appId.opId`, collision detection). Because every surface is a projection, **adding an op to a
`manifest.js` makes it reachable from chat, slash, gate, web, and mobile at once** — and the coverage snapshot
(`npm run coverage` → `apps/basis/docs/surface-coverage.md`) records which surfaces each op is wired for,
so the map can't drift from the manifests.

---

## 2 · How it runs

*The waist in motion: a request end to end, how the circle bot's answers are grounded, and how the two surface
families compose.*

### How a request flows, end to end

1. **Invocation** — the user types in chat, taps a button, runs `/command`, or hits a gate phrase ("add milk").
2. **Compile to the waist** — the interface's projector turns that into `{opId, args}`. The gate resolves
   common phrases *without* the model; anything else goes through the LLM (`renderChat`) or the GUI form.
3. **Dispatch** — `resolveDispatch` maps `{opId, args}` to a handler via the merged manifest; `runDispatch`
   invokes it.
4. **`callSkill`** — the single entry point that runs the op. This is also the **security boundary**: an op
   only runs if it's in the caller's effective capability set (see *Circles, types, and capabilities* below).
5. **Functionality resolves** — wherever it lives: a local skill handler, a peer agent over a transport, an
   LLM, a read/write against the Solid pod, an MCP tool, or a scheduled job.
6. **Result** — flows back to the invoking surface. Verify the *result*, not just that dispatch fired: a gate
   can route correctly while the op silently fails.

### Retrieval (RAG) — grounding the circle bot

Each circle has an assistant (the "circle bot"). Before it answers via the LLM, it retrieves the circle's own
relevant items and weaves them into the prompt, so answers are grounded in the circle's real data (chores,
tasks, notes, messages) rather than the model's guesses.

**Flow.** The pre-LLM gate (`tokenGate.js`) routes each message: a deterministic command (`/done milk`) fires
directly with no model; anything else takes the `via:'llm'` path, where the gate calls `retrieve(text, ctx)`,
slices to `maxContext` (5), and injects the results as context.

**Two tiers** (`circleRetriever.js`):
- **Tier-1 lexical** — keyword match, always available, no model needed.
- **Tier-2 semantic** — ranks by meaning (a query for "car" finds "automobile"). Needs an embedder.

**Engine.** Tier-2 is backed by a per-circle `@onderling/pod-search` hybrid index (`makePodSearchRetriever`),
scoped `circle-rag/<circleId>` so circles never bleed into each other. Items are embedded once (content-hash
cache — unchanged items are never re-embedded) and each turn runs `query({mode:'hybrid'})` — reciprocal rank
fusion (k=60) over the lexical and cosine rankings. A `vectorStore` seam holds the vectors: both shells inject
a **persistent** one — web via `pickWebBackend` (IndexedDB, `@onderling/pseudo-pod/browser`), mobile via
`createAsBackend` (RN AsyncStorage) — scoped `circle-rag/<circleId>`, with an in-memory fallback under SSR / the
test env. So vectors (and the circle **items** they index, on the same persistent backend) **survive a hard
restart** instead of re-embedding; within a session, retriever rebuilds hydrate from the store (embed-once).
This closes cross-restart survival on the standalone (no-pod) posture. The other persistence path — a real
**signed-in Solid pod** — is **live-validated** too, against a local Community Solid Server: an infra-gated
`.css.test.js` (runs when a CSS is present, skipped from the default suite) confirms a circle with its items
survives an app restart on a signed-in pod, and exercises the ACP grant path against real CSS.

**Policy & privacy** (an instance of placement by trust — see Part 4):
- Gated by `llmTool: 'off'` ⇒ no LLM and no semantic retrieval.
- The embedder is policy-resolved (local Ollama / attested enclave); no embedder ⇒ tier-1 lexical only, zero
  embed calls — a graceful degrade, never an error.
- Retrieval is local; embeddings run only through the configured provider, so nothing leaves the device unless
  that provider's base URL says so. Vectors live under `private/state/search-index/`, never under `sharing/`.

### Chat and screens compose (and trigger each other)

There are two surface *families* over the waist, not one: **conversational** (chat/gate/slash) and **screen**
(the web/mobile GUI). They don't merely render the same op in parallel — they **compose and trigger each other**.
Today, in the web shell: an op that declares `surfaces.ui.screen` gets an **"Open" button** that opens a
full-screen panel (`openCircleScreenPanel`); conversely a **row action inside a screen posts `{opId, args}` back
through the same waist** (`dispatchReady`). So a chat command can open a screen, and a screen action can drive a
chat flow. Three treatments — **inline menu · full-screen panel · chat** — are chosen per user.

*Current state:* the flat **list** surface (contacts/prikbord) is manifest-projected on both platforms — the
hardcoded `LIST_SCREENS` map is **retired**; `openCircleScreenPanel` reads its config from the projected
`NavModel.sections`. **Nav chrome has dissolved the same way and is now complete:** both the **tab bar** and the
**detail action-bar** project from one nav-chrome `NavModel` kind — `manifest.tabs[]` → `NavModel.tabs[]` and
`manifest.actions[]` → `NavModel.actions[]`, a small shared `NavItem`/`NavTarget` vocabulary (`tabProjection.js`
· `actionProjection.js`) that both shells render from. Every consumer reads the *same* roster: web's tab bar
(`web/v2/circleTabBar.js`), web's circle detail *and* the **live web kring ⋯ menu** (`circleDetail.js` ·
`circleKring.js`), and the mobile tab bar + **live mobile kring ⋯ menu** (`CircleTabBar.js` ·
`CircleLauncherScreen.js` via `circleTabsMobile`/`circleActionsMobile`) — the duplicated `TABS`/action literals
are gone, and each shell only *filters* the identical roster by an action's `platforms` + `requires` gate.
A tested generic side-panel (`openPagePanel`) is the live renderer for simple `surfaces.page` ops on **web**
(e.g. the docked `set-relay` panel); the RN sibling that maps `surfaces.page` to native nav screens is still
pending (mobile has the per-op page *header* projection but not the generic side-panel yet).
Still bespoke **by design**: the settings-hub panels (my-data, advisor) and the **circleFolio browser** (a
separate surface KIND, parked). The compose/trigger loop (open-screen button ↔ `dispatchReady`) is wired in
**web**; mobile now shares the projected nav chrome but keeps its own screen renderers.

---

## 3 · The domain

*What the system actually models: one algebra of circles, types, and capabilities — and how every kind of
sharing is a move over a single sealed resource.*

### Circles, types, and capabilities — one algebra

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

### Sharing — in place, across circles, and beyond them

Sealed circles (postures p2/p3) encrypt content under a per-circle **group key**, kept in a *versioned*
**group-key resource** on the pod — each version wrapped to the then-current members' keys. Membership **is**
the gate: a member proves they belong by unwrapping the current version; a revoked/never member can't, so
they're denied (`readGroupKey` throws — they never see ciphertext, let alone plaintext). Every kind of sharing
is a move over this one resource, so it never copies data it needn't and revocation is real.

- **Canonical (in-place) sharing.** To share an item to another *circle* without minting a copy, the origin
  re-wraps the item's group key to the recipient and grants ACP read on the canonical resource; the recipient
  reads the single copy in place through a `shared-ref` pointer. **Revoke = rotate**: a fresh group-key version
  is wrapped to the *remaining* recipients — forward secrecy, since content sealed after revocation is
  unreadable to the dropped member. One resource, one copy, revocable.
- **Historic keys, cross-version read.** A rotation *retains* the outgoing version (appended to the resource's
  `history[]`, still wrapped to its own recipients) instead of discarding it, so an entitled member can open
  content sealed under an older version they lived through — resolved by *authenticated trial* across the
  versions their key can unwrap. Forward secrecy is untouched: a revoked member is absent from every later
  envelope, and the live reader is gated on *current* membership — so a drop-out gets **no** historic access.
- **Out-of-circle sharing (to a person).** A recipient who is in *no* circle can be granted access, identified
  by their **published network key**. No new cipher: their X25519 sealing key is derived from their Ed25519
  network identity via the same `ed2curve` map the agent already uses for `nacl.box`, then the same re-wrap
  primitive applies. A per-circle **`shareOutOfCircle` policy** governs it — `prohibit` (blocked), `notify` (a
  revocable canonical grant **plus** a notice to the circle: its admins, or a `permission-log`-tagged pinboard
  post), or `silent` (a **copy** sealed to the recipient, leaving no ACP/pointer trace in the circle — more
  private). Pre-grant history is never handed to a new out-of-circle recipient unless explicitly opted in.
- **The receiver — "shared with me".** A silent copy is pushed over the relay straight to the recipient's peer;
  their device receives it into a per-user, *tiered* store (local, mirrored to the pod when signed in) surfaced
  on the **Mij** screen. Opening it needs the device's own sealing key — derived from its network secret, which
  stays **encapsulated** in the agent identity: the kernel exposes only an opener *closure* (`sharedCopyOpener`
  hands the secret to an injected builder internally and returns just the closure), and the pod-client adapter
  supplies the derivation. The secret never leaves the identity.

---

## 4 · The system

*What it all runs on: the layer stack, the rule for where compute is placed, and the inter-agent axis with the
paths that carry it.*

### The layers — kernel, adapters, substrates, apps

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
  OUTSIDE the kernel — network transports in **`@onderling/transports`**, Solid-pod storage + on-pod identity in
  **`@onderling/pod-client`**, the vault family in **`@onderling/vault`** — and nothing in the kernel depends *up* on an
  adapter (guarded by `test/layering.enforcement.test.js`).
- **The developer SDK is `@onderling/sdk`** — the fat, batteries-included facade, **layered**: a *low* layer
  re-exports the kernel + default adapters (pass your own explicitly → maximal clarity/compatibility), and a
  *high* layer adds `createAgent()` (run-as-agent, defaults injected) + `connectSkill(agent, name, appFn)` (map any
  app function to a skill). "Import one thing, done"; drop a layer for full control. Defaults (e.g. `VaultMemory`)
  live in the facade, never the kernel.
- **Substrates** compose the kernel + adapters into reusable pieces, building on kernel primitives rather
  than reinventing them — a parallel transport or vault implementation would drift away from the security and
  compatibility guarantees the kernel carries. They form a **gradient**: *runtime-foundation* (vault, oidc-session, pod-client — near-required for a networked
  agent) → *feature* (skill-match, notifier, pod-search — optional) → *facade* (secure-agent, agent-provisioning —
  compose others). Extracted under a **rule of two** — generalise on the second independent need, not the first.
- **Apps** compose substrates (or `@onderling/sdk`), using the kernel directly only with a justification in the app
  README.

See [`repository-layout.md`](./repository-layout.md) for the full apps + packages map.

**A fourth region the diagram omits: the deployment / hosting layer.** Client apps host nothing. Server-side
services — **pod-HOSTING**, relay/proxy, the private-LLM enclave, rollout — form a separate layer, placed by
trust + latency (below), that sits *outside* the client apps. The `feedback` deployment occupies it today (it
runs a live Solid-pod host, HTTP services, and a container stack that no client app has). This is where the
eventual repo split's server side lives.

### Placement by trust + latency

*Where* functionality runs is decided by **trust and latency, not convenience** — the default is never
"put it on a server". Sensitive compute (pod
access, sealing, the confidential LLM transport) stays client-side or in an **attested enclave** (TEE);
"server-side" means *extracting* code that is already server-side (pod-hosting, relay/proxy, private LLM), not
moving private data onto an untrusted host. Correspondingly:

- **Local-only mode is the floor; the pod is portability.** Every app works fully without an authenticated
  pod. Shared-state apps without a pod replicate P2P via kernel `MergeContracts` + relay group-publish.
- **Pod is truth, local cache is reality.** When a pod is configured it's authoritative but slow; the UI reads
  the local cache and syncs on a cadence with optimistic, queued writes, so a pod outage never breaks the app.

### Agents interacting (the inter-agent axis)

The flow above is **intra-agent**: one interface → the waist → dispatch → functionality. Equally fundamental is
the **inter-agent** axis — agents as **peers exchanging over a transport**, carried by an **envelope**. One wire
carries three things: it **syncs circle stores** (with no pod, a write fans out to circle members as envelopes),
it carries **direct exchanges** (offer→claim, request→respond), and it enables **remote skill-acquisition** — an
agent authenticates into *another* agent's gated skill surface over a transport, with identity, permission, and
validation travelling **in the envelope**. This is what lets functionality resolve on an external agent
(consequence #2 above), and it's the substrate the developer-integration on-ramps (a connected bot, a remote
handler) build on. The paths that carry it are below.

### Reachability

Two peers exchange messages over whichever path is currently usable; a per-peer picker chooses, no app code
does. Paths: **direct** (mDNS/TCP, BLE, or relay-signalled WebRTC), **relay** (`@onderling/relay`, rendezvous or
sealed proxy-fallback), **NKN** (the public messaging network, no operator to run), and **hop** (a third agent
relays, plaintext or sealed-forward, with hop-count + policy gating). Details:
[project overview → Reachability](../README.md#reachability--transports).

---

## 5 · Direction

*Where this is going, and where to read next.*

### Direction (where this is going)

- **Apps consolidate into the Basis shell.** The manifest-per-app split is an *engineering*
  boundary, not a product one: each `manifest.js` stays the source of truth every projector reads,
  while the app names become navigation labels inside one unified surface. New functionality means
  adding manifests and projectors to Basis, not standing up new app silos.
- **The platform is a published surface.** The kernel and substrates ship as versioned
  `@onderling/*` packages on npm, consumed by external applications — the
  [feedback app](https://github.com/Onderling/feedback) is the first external tenant and the
  permanent proof that the public surface suffices. More packages publish as their APIs settle;
  the invariants above are enforced by CI fitness functions rather than review discipline.
  Settled choices and their reasoning live in [`decisions.md`](decisions.md).

### Where to go next

- [`CLAUDE.md`](../CLAUDE.md) — the working conventions + the invariants, for agents editing code here.
- [`conventions/`](./conventions/) — the detailed project-wide rules.
- [`glossary.md`](./glossary.md) — every term used above, defined.
- [project overview](../README.md) — the apps, the status, how to run things.
