# Project-wide standardisation plan (2026-05-10)

> **Status:** ready-to-lock draft, 2026-05-10. Origin: brainstorm by
> the author, refined through clarifying questions; design decisions are
> resolved (see §12 changelog). Not yet binding — intended to flip
> to `binding` once P0's plan-tracking convention scan is complete.
>
> **Scope:** all apps under `apps/` (Tasks, Stoop, Folio, future
> apps) + the substrate layer + the Hub track. Storage, transport,
> codebase principles, developer experience, and the personal-data-
> layer destination this work is converging on (§0).
>
> **Status of related docs:**
> - Supersedes nothing yet — runs alongside existing track plans
>   (`coding-plans/track-*.md`).
> - Will, when binding, update
>   [`Substrates/policies.md`](./Substrates/policies.md) (rule-of-two
>   retirement) and seed a new
>   [`conventions/plan-tracking.md`](./conventions/plan-tracking.md)
>   (P0 below).

---

## 0. Destination — a personal data layer with pluggable apps

> **(non-binding direction)** — this section describes where the
> substrate work is heading. The binding commitments live in §1
> abstract + §7 phasing. P0–P5 build the foundation; P6 lands the
> interface registry + protocol substrate; P7+ refactors existing
> apps to fit the destination shape.

The endpoint this plan converges on, articulated explicitly so
each phase's purpose stays visible. The framing emerged from a
brainstorm comment: "*you actually want one API where you can
exchange tasks, messages, data, processes etc. with people or
groups; on your terms it decides what ends up where; that whole
infrastructure is something you plug JS apps onto, which serve as
data filters and interfaces and connect protocols to data
creation; data items can always reference other data items; for
every atomic data object you can make an interface that always
appears.*"

Translating that into the project's vocabulary:

- **One data fabric.** All your stuff — tasks, messages,
  supply/demand offers, contacts, calendar items, neighborhood
  jobs, negotiation rounds, anything else apps invent — lives as
  referenceable items on your pods (private + sharing) and on the
  group/project pods you participate in. Items reference each
  other freely across pods, apps, and domains. A Stoop
  neighborhood-job can link to a Tasks task; a Tasks task can
  link to a Folio calendar item; a calendar item can link to a
  negotiation round that produced it.

- **One API.** Every read and write goes through `pod-client`
  (a thin facade) → `pseudo-pod` (the unified cache + Solid-pod
  facade — see §3.4). Apps don't manage pod URLs, OIDC tokens,
  online/offline transitions, or sync queues. They ask for items
  by reference and get them.

- **One auth surface.** The Hub holds your WebID-based OIDC
  session and brokers authenticated fetches to apps via the
  binding protocol. Single sign-on across every installed app.

- **One taxonomy.** Items declare their `type` from a shared
  registry (`@canopy/item-types`). Anything across apps can
  recognise + filter on type — "show me all `task` items I'm
  assigned to," "show me all `supply-offer` items in this
  neighborhood," etc.

- **One per-type interface registry.** For every item type,
  there's a canonical interface (renderer + action handlers).
  Tap an item → the Hub looks up its type → shows the registered
  interface. Items move between apps without losing their UI.
  Users can override the default renderer for a type if they
  prefer another app's take on it. The registry is **per type,
  not per item** — items don't carry their preferred renderer
  inline (which would let a sender ship arbitrary UI to a
  receiver). The receiver's installed apps + their preferences
  determine what's rendered.

- **Protocols as first-class.** Multi-step processes (a
  negotiation that ends in a task; a propose-subtask flow; a
  calendar invite that needs N members to accept) are state
  machines that operate on items and emit new items. They live
  in `@canopy/protocol` substrates, are declared by apps, and
  run inside the Hub. Their state is just more items on the pod
  — no special storage layer.

- **Apps as plugins, not products.** A "Tasks app" becomes a
  bundle: declared item types (`task`, `subtask-request`,
  `subtask-proposal`) + registered interfaces for those types +
  declared protocols (`propose-subtask`, `appeal`, `force-spawn`)
  + skill bodies + filters/search views over the unified stream.
  You install a bundle the way you install a browser extension.
  Removing it removes its filters/views/protocols; the
  underlying item data on your pods stays.

The Hub becomes:

| Role | Hub V1 (P4) | Hub V2+ (P6 onward) |
|---|---|---|
| Auth + keymanager | ✓ | ✓ |
| Foreground service / sockets / BLE | ✓ | ✓ |
| Unified inbox | ✓ | ✓ + cross-type aggregation |
| Interface dispatcher | — | ✓ — looks up registered renderer per item type |
| Protocol host | — | ✓ — orchestrates state machines, persists state to pod |
| Plugin registrar | partial (binding protocol exists) | ✓ — install / uninstall bundles, manage type→interface registry, conflict UI |

In one line: **the Hub-on-mobile is the user's primary
day-to-day surface, the Hub-web-console is the device-independent
management dashboard, and apps become bundles of capabilities you
opt into.** Mobile-independence is a hard requirement — the user
must be able to manage their data fabric, revoke a misbehaving
agent, or onboard a new device entirely from a browser, without
the phone in the picture.

We don't ship the full destination in 18 weeks. We ship the
substrate that makes it inevitable.

---

## 1. Abstract

Across the three production apps the **codebase** is already
shared (substrates, single-agent topology, shared `src/ui/`
helpers, locale stack). What is **not** standardised is **storage**:
each app makes its own choices about what lives locally vs on the
user's pod, what's private vs shareable, and how items from
different apps relate to one another. At the same time, the
p2p-centric transport stack runs into an efficiency problem on
mobile: broadcasting payloads to every member of a crew separately
costs N times the bandwidth of one pod write, and the latency is
gated by the slowest hop.

This plan does five things together:

1. **Re-centre the data model on pods.** Pods become the canonical
   store for everything that isn't latency-critical. p2p/relay
   carries notifications and interactive streams (chat, audio,
   video). Persistent state goes to a pod once, not to every
   peer N times.

2. **Standardise pod layout: two pods per user, plus group
   pods, with policy freedom for crews.** A user has a **private
   pod** and a **sharing pod** (which can host world-readable
   resources where appropriate). Defence-in-depth — even though
   ACPs technically cover the same ground, real-world safety
   issues (misconfigured ACPs, leaked URLs, server bugs) make
   the split worth keeping. Crews choose their own
   data-distribution policy (centralised, decentralised with
   cross-pod refs, or hybrid). No separate group private
   side-pod — per-member containers in the group pod or
   private content on the user's own pods cover that need.

3. **Unify the cross-app data surface.** Messages, tasks,
   supply/demand, contacts, calendar items live under a shared
   taxonomy on the pod side, so any app — or the Hub — can
   present a single filterable view (sender, app of origin,
   kind, time window, crew). Items reference each other across
   apps and pods.

4. **Codify a substrate-first policy with discipline.** Drop the
   conservative rule-of-two; aggressively grow substrates
   whenever a helper looks reusable and its API is stable on
   first authoring. **Data structures and communication
   protocols are always substrate material.** Each app shrinks
   to (app-core packages on substrates) + (web UI) + (RN UI).
   Plan-tracking and phase-naming get a uniform shape.

5. **Resume the Hub track on Android only, with the Hub as
   keymanager and (eventually) plugin registrar.** Hub V1
   ships in P4 with auth, sockets, BLE, and the unified inbox.
   Hub V2 (P6) lands the interface registry + protocol host,
   making the destination shape (§0) reachable.
   **Desktop continues to use the web apps directly** — no
   desktop Hub for now. The local **pseudo-pod** is the unified
   read path everywhere: it's both the cache for online pods
   AND the standalone store when no real pod is attached. One
   read pattern, online or offline, mobile or web.

---

## 2. Storage — standardise the pod surface

### 2.1 Local vs pod, by type

Default routing for each cross-app type. Apps may opt to keep
something local-only by configuration; the default makes the
pod authoritative. Reads always go through the **pseudo-pod**
(see §3.4) which transparently handles cache, fetch, and
write-through to a real pod when one is attached.

| Type | Local store | Pod | Rationale |
|---|---|---|---|
| Chat messages (live) | full (cache) | append-only mirror | latency-critical → p2p stream; pod is durability + cross-device sync + offline replay |
| Task ledger | cache | canonical | low-frequency edits; pod cohabits the audit log + cross-device replay |
| Supply / demand items | cache | canonical | searchable across crews; pod is the discovery surface |
| Contacts (MemberMap) | cache | canonical (per-crew + per-user) | pod is roster of record |
| Calendar items | cache | canonical (per-user write-out, per-crew read-merge) | already half-implemented (Tasks V2.1) |
| Identity / device settings | local + sharded `device.<id>.json` | shared `shared.json` | matches existing cross-app-settings convention |
| Inbox notifications | local 24h hot tier | pod long-tail | local for badge/quick-read; pod for cross-device replay |
| Streams: audio, video | not stored | optional pod recording (if user opts in) | latency-critical → p2p direct; pod only if recording is requested |
| Protocol state (V2+) | cache | canonical | a "negotiation in progress" is items like everything else; the protocol substrate just gives them lifecycle |

### 2.2 Two pods per user

| Pod | Default ACP posture | Contents |
|---|---|---|
| **Private** | `agent-only` | identity vault export, recovery material, per-app personal state, drafts, mastered tasks I haven't shared yet |
| **Sharing** | per-resource ACP, default deny | items I want to make available to others. World-readable resources (profile card, public skills, service announcements) live under a `public/` sub-container with `world-readable, owner-write`. Other resources have explicit ACPs granting access to specific people or groups |

Why not one pod (collapsed): even though ACPs technically
cover both postures, real-world safety bugs (misconfigured
ACPs, server-side leaks, URL leakage) mean the
private/sharing split is worth the small additional cost.
The boundary is "data the agent uses internally" vs
"data I might share." Identity material never crosses it.

Why not three pods (collapsed back from earlier draft):
public-vs-sharing is a per-resource ACP detail, not a
per-pod boundary. Folding world-readable resources into
the sharing pod under a `public/` container is simpler:
fewer pods to provision, fewer URLs to register on the
WebID, one fewer indicator in the Hub UI.

### 2.3 Group / project pods + per-team policy

The canonical model is **one group pod per crew** with a
standard container layout. **No separate group private
side-pod**; admin-private content is handled via two existing
patterns:

- **Per-member personal containers within the group pod**
  (optional, per-crew policy). Admin can provision
  `<group-pod>/members/<webid>/personal/` with ACP locked to
  that webid. Useful when a member wants their crew-related
  work to live alongside the canonical group ledger but with
  personal-only visibility.
- **Personal pod for crew-related material** (always
  available, no admin setup needed). The user keeps their
  crew-related notes / drafts / sensitive scratch on their
  **own** private or sharing pod. A user may write to their
  sharing pod without granting any share rule, just to keep
  the private pod uncluttered. Same pod, different posture
  per resource.

The choice between these two is per-user-per-crew. Either way,
the substrate resolves cross-pod refs (§2.4) — no new
substrate work for this case.

### 2.4 Cross-pod references — a first-class concept

Items can carry refs to other items on other pods. Concrete
shape (reusing Solid's URI semantics):

```js
{
  id: "https://anne.solid/.../tasks/t-42.json",
  type: "task",
  text: "Paint the fence",
  // Cross-pod parent ref:
  parent: "https://bob.solid/.../tasks/t-17.json",
  // Cross-app/cross-domain ref (Stoop neighborhood-job that
  // produced this task — destination shape, §0):
  source: "https://anne.solid/.../stoop/jobs/j-91.json",
  // ... rest of item
}
```

Substrate consequences:

- `item-store` IDs gain URI semantics (already partially the
  case). Lookups by ID resolve via `pod-routing`.
- The item's owner is implicit in the URI (the pod of origin).
- Permission checks happen on **both ends**: writer's pod ACP +
  reader's permission on the referenced item's pod.
- The unified inbox follows refs to render context ("Anne added
  a sub-task on your task X" — works regardless of which app
  produced the original task).

Crews choose their distribution pattern:

- **Centralised.** Everything on the group pod. Simplest;
  fastest cross-member queries; single point of failure.
- **Decentralised + cross-pod refs.** Each member's items live
  on their own pods. Refs link across. Natural for ad-hoc
  collaboration; resolution requires walking refs.
- **Hybrid.** Some types on the group pod (canonical ledger),
  others on individual sharing pods (drafts, notes).
  Configurable per type.

The **`pod-routing` substrate** (new — see §6) owns this
policy. It maps `(crew, type, owner) → target pod URI` and
rewrites writes / lookups consistently.

### 2.5 Pod onboarding and Hub-as-keymanager

Setting up pods must be one tap, and apps never juggle
tokens themselves.

- **One OIDC flow against the user's WebID.** The user
  authenticates the Hub once; the Hub stores the OIDC
  tokens.
- **WebID-discovery.** The Hub reads the user's WebID profile
  document to discover the user's pods (private + sharing).
  This is the existing Solid pattern, just consumed by the
  Hub instead of each app.
- **First-time provisioning.** If the user has no pods yet,
  the Hub provisions both via a pre-tested provider list
  (Inrupt, Solid Community Server self-host, our own
  optional default) and writes the canonical containers.
  The new pods get registered on the WebID profile.
- **Apps don't manage tokens.** Via the Hub's binding
  protocol, an app asks the Hub for an authenticated `fetch`
  bound to a specific pod URI. The Hub returns a function
  (or proxies the request, depending on the security
  model). Single sign-on across every installed app.
- **Recovery.** Mnemonic restore re-attaches to existing
  pods by walking the WebID profile.
- **Migration.** Changing provider preserves stableId +
  container layout; refs that pointed to the old pod URLs
  get rewritten via a per-user redirect map written to the
  WebID profile.

**Substrate candidate:** `@canopy/pod-onboarding` — the
provisioning + WebID-discovery flow, reusable by the Hub
and (pre-Hub) by the standalone apps.

### 2.6 Unified types + filterable inbox

A shared taxonomy in `@canopy/item-types` (new substrate)
enumerates the cross-app types. The Hub's unified inbox view
can:

- list everything the user has from every app,
- filter by `senderWebid`, `appOfOrigin`, `kind`, time
  window, `crewId`,
- de-duplicate when the same event reaches the user via
  multiple apps.

The per-user inbox at `mem://user/inbox/<id>.json` already
exists (cross-app, per memory of inbox skills). What's
missing is a first-class consumer that treats the inbox as a
unified surface — the Hub will be that consumer (V1 in P4;
extended with type-aware rendering in V2/P6).

---

## 3. Communication — pod-primary, p2p for live + notify

### 3.1 The pattern

Outgoing flow per write:

1. App writes the item to its target pod (per `pod-routing`
   policy). The write goes via the **pseudo-pod** which is
   the unified read/write path — see §3.4. When a real pod
   is attached, the pseudo-pod write-through queue flushes
   to it.
2. Once the pod write returns, the app emits a tiny p2p
   **notification envelope** to subscribers:
   `{kind, ref, etag, timestamp, fromPod, fromActor}`. No
   payload.
3. Subscribers receive the envelope → fetch the new resource
   from the referenced pod (pseudo-pod cache hit on
   already-synced data; otherwise one read upstream).

Net effect:

- **Bandwidth**: O(payload + N × envelope-size) instead of
  O(payload × members).
- **Latency**: "p2p-fast" awareness, "pod-durable" content.
  Pseudo-pod cache makes subsequent reads instant.
- **Catch-up**: members who were offline pick up via normal
  pod sync, no separate replay protocol.
- **Cross-device**: my second device reconciles via the pod, not
  by re-deriving from peers.

### 3.2 What stays p2p

- Live chat messages (with append-mirror to pod for durability).
- Typing indicators / "is online" / presence.
- Audio + video streams (not stored unless the user opts to
  record; opt-in recording goes to a pod).
- Skill-match broadcasts + claim races.
- Onboarding handshake (invite redeem, hello).
- Notifications: short envelopes that say "go look at your pod".

### 3.3 What moves to pod-primary

- All persistent ledger writes (tasks, supply/demand, calendar
  emissions, audit logs, profile changes).
- History rehydration after offline period.
- Cross-device sync.
- Chat-message archives (the live channel is p2p; the archive
  is the pod).
- Protocol state (V2+) — a negotiation's current round,
  participant offers, etc., persisted to the pod between steps.

### 3.4 The pseudo-pod — unified read path everywhere

The pseudo-pod is **both** the local cache for online pods
**and** the standalone store when no real pod is attached. It
replaces the previous two-tier `pod-client → CachingDataSource
→ Solid pod` chain with a single layer:

```
app → pod-client (thin facade) → pseudo-pod
                                   ├─ if backed by real pod: cache + write-through
                                   └─ if not: standalone (campsite mode)
```

Properties:

- **Single read path.** Every read of shared content goes
  through the pseudo-pod. Apps don't branch on "are we
  pod-attached." The pseudo-pod handles the decision.
- **Cache + Solid-pod facade.** What `CachingDataSource` does
  today, with a Solid-pod-protocol shim wrapping it.
- **Write-through when backed.** Writes go to the pseudo-pod
  immediately; a sync queue drains to the real pod when
  online. Online/offline transitions are one concept (the
  queue starts/stops draining), not two.
- **Standalone when not backed.** Same API, no upstream sync.
  Crews on local-only mode (solo testing, ad-hoc households,
  campsites) work the same way the rest of the system reads.
- **Built on existing local-store.** Pseudo-pod uses
  `@canopy/local-store`'s CachingDataSource internally;
  it's a re-shape, not a rewrite.

### 3.5 Pseudo-pod hosting

How the pseudo-pod is reached from outside the agent process:

- **Mobile, pre-Hub.** Skill-based fetch. The agent serves a
  `fetchPodResource({ref})` skill on its existing transport
  stack (BLE / relay / InternalTransport). `pod-client`
  checks the URI scheme: real `https://` pod → use `fetch()`;
  `pseudo-pod://<agent-address>/<path>` → invoke the skill on
  that agent. No separate HTTP listener, no extra native dep,
  integrates with the transport stack we already have.
- **Mobile, post-Hub (P4).** The Hub Android app hosts the
  pseudo-pod centrally; other apps on the same device reach it
  via the Hub's binding protocol. Pre-Hub mode (skill-based)
  remains as the fallback for apps that don't bind.
- **Desktop web.** Same scheme `pseudo-pod://<address>/<path>`,
  served via the agent's transport.

The same agent reading **its own** pseudo-pod data never goes
through the skill — it's just a function call into the
pseudo-pod module. Skill-based fetch only matters for **other
peers** reaching this agent's data and **other apps on the
same device** (the Hub case on Android).

---

## 4. Codebase — substrate-first, with discipline

### 4.1 Replace rule-of-two with substrate-first

Current rule
([`Substrates/policies.md`](./Substrates/policies.md)): wait for
two consumers before lifting. The new rule:

- **Always-substrate**: data structures and communication
  protocols. These don't get to live in an app. Items, refs,
  envelopes, taxonomy enums, status mappings, role tables —
  substrate or it doesn't ship.
- **Substrate when API is stable on first authoring**: a
  helper becomes a substrate when (a) it's pure of its
  caller's UI/platform context AND (b) you can write its
  jsdoc + tests without referencing the caller. If both hold,
  lift it on the first consumer.
- **App-local until evidence**: helpers that are tightly
  coupled to a specific app's screens or one app's domain
  vocabulary stay app-local until a second consumer trips.

Trade-off: the new rule risks shaping a substrate around
exactly one caller. Mitigation: substrates ship with strict
tests + small surface; refactoring later is cheap.

### 4.2 App package skeleton (canonical, pre-bundle-refactor)

```
apps/<product>/                 ← desktop shell + shared UI helpers
  src/
    skills/                     ← skill bodies (already shared with mobile)
    ui/                         ← pure-fn UI helpers (consumed by both shells)
    storage/                    ← pod-layout + container conventions
    rolePolicy.js / dag.js / …  ← app-specific logic
  locales/{shared,en,nl}.json   ← shared bundle + desktop additions
  web/                          ← desktop-only HTML/CSS/JS

apps/<product>-mobile/          ← mobile shell only
  src/{screens, components, lib} ← thin re-exports from apps/<product>/ui
  locales/{en,nl}.json          ← mobile-only additions
```

This shape is already in place for Tasks; Stoop and Folio
align to it during P5. **In the destination shape (§0), apps
become bundles** — see §4.6 for the bundle skeleton (P7+
target).

### 4.3 Plan-tracking convention (P0 work)

The brainstorm flagged that plans kept changing last month
without a uniform shape, making it hard to audit progress.
**P0 deliverable** of this plan: scan the project for relevant
rules across `Project Files/conventions/`, `Substrates/`, and
the existing `coding-plans/track-*.md` headers; consolidate
into `Project Files/conventions/plan-tracking.md`. At minimum:

- Every plan doc lives at a stable path with `_<YYYY-MM-DD>.md`
  on first authoring; subsequent edits append a CHANGELOG
  section at the top, **never rename the file**.
- Phase numbers monotonic per track. **No re-numbering.**
- Each phase has a status table (`pending | in-progress |
  shipped | abandoned`) and a `superseded-by` link when
  abandoned.
- Brainstorm/sketch docs explicitly tagged `(non-binding)`;
  coding plans tagged `(binding once approved)`; vision
  sections tagged `(non-binding direction)`.
- Decisions made during execution that change the plan get
  appended as decision-log entries; the original phase text
  stays intact for audit.

### 4.4 Hub roadmap — Android primary surface + web console

The Hub functionality splits along a device-dependence line. The
**Hub-Android** is one of the user's agents (the primary mobile
one) and additionally owns the mobile-only transport stack. The
**Hub-web-console** is a device-independent management surface
that any browser can reach after OIDC-auth against the user's
WebID. Mobile-independence is a hard requirement: the user must
be able to manage the data fabric without the phone.

| Capability | Hub-Android | Hub-web-console |
|---|---|---|
| Foreground service slot | ✓ | — |
| Relay socket multiplexing | ✓ | — |
| BLE / mDNS scanners | ✓ | — |
| Local pseudo-pod hosting | ✓ (when running) | — (each desktop agent hosts its own) |
| Unified inbox UI (read + write) | ✓ | ✓ (read view + management actions) |
| Pod onboarding | ✓ | ✓ |
| Agent registry view + manage (revoke, add bot) | ✓ | ✓ |
| Bundle install / uninstall / configure | ✓ | ✓ |
| Audit log per agent | ✓ | ✓ |
| WebID profile editor | ✓ | ✓ |
| Recovery / mnemonic / key rotation | ✓ | ✓ |

**Hub-Android V1 (P4)** — per the existing
[functional sketch](./AgentHub/hub-functional-sketch-2026-05-07.md):
the mobile-only transport stack + the management surface.

**Hub-web-console V1 (P5, parallel to substrate-first roll-out)**
— a web app deployed at a known URL (e.g. `console.<provider>`).
Features the management surface only; no transport stack, no
foreground-service equivalent, no pseudo-pod hosting. Each desktop
web app's own agent continues to host its own pseudo-pod
independently.

**Hub V2 (P6, both surfaces)** — extends both the Android Hub and
the web console into the destination shape:

- **Interface dispatcher.** Looks up the registered renderer
  for an item's type and shows it.
- **Protocol host.** Orchestrates declared state machines
  end-to-end; persists their state as items on the user's pod.
- **Plugin registrar.** Apps register their item types,
  interfaces, and protocols on install.
- **Conflict UI.** When two apps register interfaces for the
  same type, a Hub setting lets the user pick the default.

Desktop is explicitly out of scope as a *transport center*.
Desktop users keep using the web apps directly; the agent in the
desktop process hosts its own pseudo-pod. The Hub-web-console
sits alongside the desktop web apps, **not** as their host.

### 4.5 Developer experience — easier now, full vision later

The end state is "developer writes a JS sketch of the
functional surface and the SDK generates web + RN scaffolding."
This is a long arc; this plan ships intermediate
quality-of-life improvements:

- **In this plan**: every substrate ships a metadata module
  describing its public API in a shape a future scaffolder
  can read. Doc-driven, but already useful for app authors
  pasting from a checklist.
- **In this plan**: `create-canopy-app` CLI that generates
  the canonical app skeleton (§4.2) + wires the standard
  substrates + emits a working "hello world" agent + UI.
- **Post-P6**: `create-canopy-bundle` CLI that scaffolds an
  app *as a bundle* (§4.6) — declared types, registered
  interfaces, declared protocols, no platform-specific
  scaffolding because the Hub does the rendering.
- **Long term**: design-by-screen helpers (form-shape
  primitives, list/detail/modal patterns) so a sketch
  describes screens functionally and the scaffolder picks
  the right RN/web rendering. Successor plan.

### 4.6 App bundle skeleton (P7+ target)

> **(non-binding direction)** — concrete shape only locks once
> §0's destination is reached. Today's apps live as in §4.2;
> P7 begins refactoring them toward this shape one at a time.

```
bundles/<product>/
  bundle.js                     ← declarative manifest (types, interfaces, protocols)
  src/
    interfaces/<type>.jsx       ← per-type renderer (web + RN via shared primitives)
    protocols/<name>.js         ← state-machine declaration
    skills/                     ← skill bodies (unchanged)
  locales/{en,nl}.json
```

The bundle's `bundle.js` declares:

```js
export default {
  id:        'tasks',
  itemTypes: ['task', 'subtask-request', 'subtask-proposal'],
  interfaces: {
    task:               () => import('./interfaces/Task.jsx'),
    'subtask-request':  () => import('./interfaces/SubtaskRequest.jsx'),
    'subtask-proposal': () => import('./interfaces/SubtaskProposal.jsx'),
  },
  protocols: {
    'propose-subtask': () => import('./protocols/proposeSubtask.js'),
    'appeal':          () => import('./protocols/appeal.js'),
    'force-spawn':     () => import('./protocols/forceSpawn.js'),
  },
  skills: () => import('./skills/index.js'),
};
```

Removing a bundle removes its entries from the registries;
the underlying item data on the pod stays, and another
bundle that handles the same type can render it from then on.

---

## 5. User stories

1. **As a user installing the Hub for the first time** — the
   Hub detects I'm new, runs one OIDC flow against my chosen
   WebID provider, provisions my private + sharing pods, and
   any installed bundles just work without asking me for
   credentials. Bundles I install later inherit the same login.

2. **As a user, I open the Hub's unified inbox** — I see
   notifications from every installed bundle in one stream;
   I can filter to "messages from Anne" or "everything from
   Tasks today"; tapping any item dispatches to the registered
   renderer for its type.

3. **As a household admin, I create a crew** — the Hub creates
   the group pod with the canonical container layout, sets
   ACPs from the crew config, and registers the crew in my
   private pod's "memberships" list.

4. **As a member, I send a chat message in a fast-moving
   conversation** — the message goes p2p directly to peers;
   once delivered, my client mirrors it to the group pod for
   offline cross-device replay.

5. **As a crew picking decentralised storage** — we don't
   create a group pod at all. Each member's tasks live on
   their own sharing pod. When I make a sub-task on Bob's
   task, it lives on **my** sharing pod with a ref to Bob's
   parent task; Bob's client sees the ref via a p2p
   notification + renders it as "Anne added a sub-task on
   your task." V2.7 hard-deps work cross-pod via the
   ref-walking machinery in §2.4.

6. **As a crew picking centralised storage** — we have one
   group pod; everyone's writes land there. Closer to the
   current Tasks V2.8 desktop shape; familiar.

7. **As a hybrid crew** — the canonical task ledger lives on
   the group pod; members' working drafts and personal notes
   go to their own sharing pods with refs to the canonical
   ledger entries.

8. **As a member who wants my crew-related notes private** — I
   keep them on my own private or sharing pod (per the per-user
   patterns in §2.3). No admin setup needed; refs from the
   group pod entries to my notes resolve only for me.

9. **As a user moving to a new phone** — I restore from my
   mnemonic; the Hub re-attaches my two pods via WebID-discovery,
   all installed bundles re-hydrate from the pseudo-pod cache,
   no re-onboarding per app.

10. **As a household at a campsite without internet** — no real
    pod, no relay. The pseudo-pod stands in as the local store;
    peers connect via BLE; everything works through the same
    read path. When the network comes back, the pseudo-pod's
    write-through queue drains to a real pod and the crew
    transitions seamlessly.

11. **As a user opening the desktop web app** — the desktop
    agent hosts its own pseudo-pod that backs onto my Solid
    pods (online cache) or stands alone (offline). I see the
    same architecture as on Android, no "desktop is special"
    code path.

12. **As a developer building a new bundle** — I scaffold from
    `create-canopy-bundle`, declare my types in the shared
    taxonomy, register my interfaces, and my data shows up in
    the unified inbox without writing inbox code. (Pre-P6:
    `create-canopy-app` scaffolds the §4.2 skeleton; the
    bundle CLI lands in P7+.)

13. **As a user, I install Stoop alongside Tasks** — Stoop's
    "neighborhood-job" type registers with the Hub. When a
    neighborhood-job results in a task (via a negotiation
    protocol Stoop declared), the new task appears in my
    Tasks-filtered inbox view, with a back-ref to the
    neighborhood-job. Tapping the back-ref opens Stoop's
    registered renderer. (V2+/P6 destination; user story
    sketches the end-state, not the P4 shape.)

14. **As a user, two bundles register interfaces for the same
    type** — the Hub's settings shows me the conflict and lets
    me pick the default renderer. Per-item override is also
    possible if the user explicitly invokes "open with…".

---

## 6. Substrates — what's new, what changes

### New substrates (P1–P5)

| Substrate | Owns | First consumer | Promote to L? |
|---|---|---|---|
| `@canopy/pseudo-pod` | Solid-compatible local read/write surface; cache + write-through queue + standalone fallback | Tasks pod-primary refactor (P1); Hub (P4) | L1 |
| `@canopy/pod-onboarding` | Two-pod provisioning + WebID-discovery + provider selection + recovery walk | Hub bring-up; pre-Hub apps in P1 | L1 |
| `@canopy/pod-routing` | `(crew, type, owner) → pod URI` policy + ref resolution | Tasks (refactor); Stoop migration | L1 |
| `@canopy/item-types` | Cross-app type taxonomy + filter primitives | Hub unified inbox | L1 |
| `@canopy/notify-envelope` | The tiny `{kind, ref, etag, …}` envelope shape + p2p encoding | Tasks pod-primary refactor | L1 |
| `@canopy/agent-registry` | The list-of-agents-per-WebID surface (read/write the WebID profile section); cap-token issuance for new agents (e.g. bots); etag-based concurrency for cross-surface edits | Hub-Android V1 + Hub-web-console V1 (P4–P5) | L1 |

### New substrates (P6 — destination shape)

| Substrate | Owns | First consumer | Promote to L? |
|---|---|---|---|
| `@canopy/interface-registry` | Per-type renderer registry: `(type, app) → component`; user override; conflict resolution policy. **Per-type, not per-item** — items don't carry their preferred renderer inline. | Hub V2 (P6) | L1 |
| `@canopy/protocol` | State-machine substrate for multi-step processes (negotiations, propose-flows, approval chains). State persisted as items on the pod; UI rendered via interface-registry. | Hub V2 (P6); Tasks `propose-subtask` refactor | L1 |

### Changed substrates

- `@canopy/pod-client` — becomes a thin facade. URI scheme
  decides the backend: `https://...` → `fetch()`; `pseudo-pod://...`
  → invoke the `fetchPodResource` skill on the addressed agent.
  Apps and other substrates always call `pod-client` regardless of
  whether they're hitting a real pod or a pseudo-pod.
- `@canopy/item-store` — IDs gain URI semantics; lookups
  resolve cross-pod via `pod-routing`. Most call sites unchanged.
- `@canopy/notifier` — push payloads slim down to the
  notify-envelope shape; full content fetched from pod by the
  receiver.
- `@canopy/local-store` — keeps its CachingDataSource;
  pseudo-pod uses it internally rather than apps using it
  directly.
- `@canopy/sync-engine` / `sync-engine-rn` — cache-warming
  walks now follow refs across pods.

---

## 7. Phasing

Each phase has an explicit exit criterion. Sized in calendar
weeks for one engineer at the current pace; parallelism
welcome where dependencies allow.

### P0 — Plan-tracking + scan the project for rules (1 week)

- Scan all `Project Files/` markdown for plan-tracking-related
  rules.
- Author `Project Files/conventions/plan-tracking.md`.
- Backfill the existing track docs to the new shape.
- **Exit:** every existing plan doc parses against the
  convention; this plan flips from `(non-binding draft)` to
  `(binding)` once the scan resolves any contradictions.

### P1 — Storage standardisation foundations (≈4 weeks)

- Lift `@canopy/pod-onboarding` substrate (two-pod model
  + WebID-discovery + provider selection).
- Define + ship the two-pod ACP templates + container layout.
- Define + ship the cross-pod ref shape on `item-store`.
- Ship `@canopy/pseudo-pod` V0: read-path facade backed by
  CachingDataSource; standalone (no real-pod write-through
  yet). Pseudo-pod hosts via skill-based fetch (mobile + web).
- `@canopy/pod-client` becomes a thin facade routing on URI
  scheme.
- Convert Tasks to write its task ledger pod-primary through
  the new path.
- **Exit:** Tasks works against the new layout; one crew of
  two members on two real pods, sub-tasks span pods, the V2.7
  deps gate works cross-pod; campsite mode (no real pod) works
  via the standalone pseudo-pod.

### P2 — Unified taxonomy + cross-app inbox (≈3 weeks)

- `@canopy/item-types` substrate with the shared taxonomy.
- `@canopy/notify-envelope` shape locked.
- Extend the existing inbox surface so it can filter cross-app.
- Wire Stoop + Folio writes through the same taxonomy.
- **Exit:** a single mobile inbox surface (still inside the
  Tasks app for now, until the Hub ships) shows entries from
  Tasks + Stoop + Folio with filtering.

### P3 — Pseudo-pod V1 + retire payload broadcasts (≈4 weeks)

- `@canopy/pseudo-pod` V1: real-pod backend + write-through
  queue + sync semantics + online/offline handling.
- Slim p2p envelopes to notify-only on every write path.
- Retire the `groupMirror`-style payload broadcast in Stoop
  (largest remaining offender).
- Wire chat archives to pod-mirror.
- **Exit:** Tasks + Stoop + Folio all pod-primary on a real
  device pair; latency measurements show no regression vs
  current local-only mode; campsite-mode → online transition
  drains the pseudo-pod queue cleanly.

### P4 — Hub V1 (≈6 weeks)

- Single Android app per the existing functional sketch.
- Foreground service multiplexer.
- Hub-as-keymanager: one OIDC flow, app token brokerage via
  the binding protocol.
- Pod-onboarding flow.
- Unified inbox UI.
- Hub-hosted pseudo-pod (apps on the device bind to the Hub's
  pseudo-pod instead of running their own).
- Binding protocol for installed agent-SDK apps.
- **Exit:** Tasks + Stoop run as Hub-attached on Android;
  unified inbox works; one foreground-service slot owns the
  relay socket; one OIDC session covers all installed apps.

### P5 — Hub-web-console V1 + substrate-first roll-out + Stoop/Folio align (≈4 weeks, rolling)

- Ship `@canopy/agent-registry` substrate (WebID-profile
  read/write for agent list; cap-token issuance for bots;
  etag-based concurrency for cross-surface edits).
- Hub-web-console V1: management surface only (no transport
  stack). OIDC-auth → agent registry view + revoke + bot
  add + bundle list + audit log + profile editor + recovery.
- Update [`Substrates/policies.md`](./Substrates/policies.md)
  with the substrate-first rule.
- Audit existing app-local helpers in Stoop + Folio for
  substrate-extraction candidates.
- Align Stoop + Folio repo shape to the canonical app skeleton
  (§4.2).
- Author + ship `create-canopy-app` CLI (DX intermediate
  step from §4.5).
- **Exit:** all three apps fit the canonical skeleton; the
  CLI scaffolds a working hello-world app on first run; a
  user with a dead phone can OIDC-auth on the web console
  and revoke their phone's keypair.

### P6 — Interface registry + protocol substrate (Hub V2) (≈5 weeks)

- Ship `@canopy/interface-registry` substrate (per-type
  registry, user override, conflict resolution policy).
- Ship `@canopy/protocol` substrate (state-machine
  declaration, pod-persisted state, lifecycle hooks).
- Hub V2: interface dispatcher + protocol host + plugin
  registrar.
- Refactor one existing protocol (Tasks `propose-subtask`) to
  the new substrate as the canonical reference.
- Refactor one existing item type (Tasks `task`) to register
  its interface via the registry.
- **Exit:** the Hub renders a `task` item via the registered
  interface, not via Tasks-app-direct screens; the
  propose-subtask flow runs end-to-end as a declared protocol
  with state on the pod.

### P7 — Apps-as-bundles refactor (rolling, post-P6)

> **(non-binding direction)** — sized at "as long as it
> takes"; the existing apps refactor incrementally to bundle
> shape. No commitment to a date here; this is the long arc.

- Author + ship `create-canopy-bundle` CLI (the §4.6
  shape).
- Refactor Tasks → Tasks bundle.
- Refactor Stoop → Stoop bundle.
- Refactor Folio → Folio bundle.
- Document the bundle authoring guide.
- **Exit (informational):** all three apps shipped as bundles;
  the binding protocol becomes the only entry point into the
  Hub; bundles are install/uninstall units.

---

## 8. Non-goals (deliberately out of scope)

- **Desktop Hub.** Web apps stay direct.
- **Audio/video recording UI.** Streams stay p2p; storage
  hooks are present but the recording UI is a follow-up.
- **Replacing Solid.** Pods remain Solid pods; the
  pseudo-pod implements the same surface, doesn't replace it.
- **DSL / code-generator phase of DX.** §4.5's long-term
  vision is tracked as a successor plan.
- **Migrating away from NKN / current relay.** The relay
  stack stays; this plan only changes what flows through it.
- **Three-pod model.** Public is folded into sharing under a
  `public/` sub-container; we don't ship a separate public
  pod.
- **Group private side-pod.** Per-member containers in the
  group pod or the user's own pods cover the same need.
- **Per-item interface refs.** The interface registry is
  per-type, not per-item — items don't carry inline renderer
  references (a sender could ship malicious UI to a receiver
  otherwise).
- **Date commitment for P7.** Apps-as-bundles is
  destination-shape work; the schedule depends on what P6
  surfaces.

---

## 9. Open risks

1. **Cross-pod ref ACP gotchas.** A user shares a sub-task
   from their pod referencing a parent on another pod — what
   if the reader has no permission to fetch the parent? The
   plan accepts the read may fail and the UI shows a
   "permission needed" placeholder. Worth measuring how often
   this hits in real use.

2. **Pseudo-pod auth semantics.** A real pod has WebID-OIDC
   tokens. The pseudo-pod is reached via the agent's
   transport, which has its own auth (peer keys, group
   membership proofs). The plan assumes the substrate hides
   this; in practice, edge cases (cap-token bots, third-party
   app reads) need design at P1 time.

3. **WebID-discovery edge cases.** Pods from different
   providers (different OIDC issuers) on the same WebID; pod
   URLs that change after migration; profile docs that have
   non-standard layout. P1 has to make a design pass on each.

4. **Substrate-first creep.** The discipline language is
   strong but lifts always look reasonable in the moment.
   Code review needs to push back actively.

5. **Plan-tracking convention takes longer than estimated.**
   The scan in P0 may surface contradictions in existing
   conventions that need resolving before the convention
   itself can be written. Time-box at one week; if we
   over-run, the convention ships v0 with explicit "this
   contradicts X, will resolve in v1" markers.

6. **Hub V1 scope creep.** The functional sketch covers
   ambitiously. P4 should pin the V1 surface tight (own
   pods + sockets + BLE + inbox + binding protocol; nothing
   else) and defer pretty wrappers.

7. **Interface registry conflict UX.** When two bundles
   register for the same type, the user has to pick. P6's
   default-picker UI matters more than usual — bad design
   here means users feel the data fabric is fragile.

8. **Protocol substrate API stability.** State machines are
   notoriously hard to design in the abstract. P6 ships V0
   with **one** consumer (Tasks `propose-subtask`) so the
   API gets shaped against a real load-bearing case before
   being opened to other apps.

9. **Apps-as-bundles refactor scope (P7).** The refactor of
   three real apps into bundle shape can balloon. Plan: do
   one app at a time, start with the smallest (Folio), use
   it as the reference; only after that's stable take on
   the bigger ones.

---

## 10. Status / next steps

- All five P1–P5 design decisions are now resolved (see §12
  changelog).
- The destination shape (§0) is articulated as **non-binding
  direction**; P6 + P7 implement it.
- The plan is **ready to lock** once P0's scan completes and
  the open risks in §9 have been triaged into the appropriate
  phases (mostly P1 for pseudo-pod auth, WebID-discovery
  edge cases; P6 for interface-registry / protocol risks; P7
  for the bundle-refactor scope).
- Once locked, this plan becomes the binding spine; phase
  exits become acceptance gates; substrate names in §6 lock
  in the next round of `Substrates/refactor/L1*.md` updates.

---

## 11. Glossary

- **Bundle** — an app expressed as a manifest of (item types
  + interfaces + protocols + skills + locales). Installs into
  the Hub. Destination shape (§0); P7+ work.
- **Interface registry** — per-type mapping `(item type,
  installed bundle) → renderer component`. Hub looks this up
  to render an item.
- **Item type** — a string in the shared taxonomy
  (`@canopy/item-types`) declaring the shape of a piece of
  data. Items declare their type; renderers + protocols
  register against types.
- **Personal data fabric** — the union of the user's two pods
  + the group/project pods they participate in + the refs
  between them. The "where my stuff lives" layer.
- **Plugin / bundle / app** — interchangeable in the
  destination shape. "App" is the legacy name; "bundle" is
  the new shape; "plugin" emphasises the registration model.
- **Protocol** — state machine declaration: input items,
  output items, transitions. Lives in `@canopy/protocol`;
  hosted by the Hub.
- **Pseudo-pod** — agent-hosted Solid-compatible local pod;
  cache + standalone in one. Unified read path everywhere.

---

## 12. Changelog

### 2026-05-10 — mobile-independence + identity model

- Identity model locked: **B + softened C**. Each agent has its
  own keypair and its own line on the WebID profile; agents
  sign their own writes; the MemberMap maps agent keys → WebID.
  No "canonical user agent." Each device authenticates against
  the WebID-OIDC issuer independently; tokens are per-device.
  Personas (D) deferred.
- Mobile-independence locked as a hard requirement. The data
  fabric must be fully usable from a browser-only management
  surface, no phone in the picture.
- Hub roadmap (§4.4) reshaped: Hub-Android (the user's primary
  mobile agent + transport stack) and Hub-web-console (a
  browser-reachable management dashboard, no transport role).
  Both consume the same agent-registry substrate.
- Bots get their own OIDC tokens (Q3 confirmed) so per-bot
  revocation works. Pod-write authorization for bot writes goes
  via the bot's own token; the cap-token system stays for
  scoping skill calls.
- WebID-profile contention (Q4 confirmed) handled via etag-based
  optimistic concurrency on the agent-registry substrate.
- Messages-as-app-independent (Q1 confirmed) — the unified inbox
  stores messages in a cross-app shape; both the mobile Hub and
  the web console render from it without per-app schema.
- Offline + pod-free usage (Q2 confirmed) — full standalone
  operation supported via the pseudo-pod, on both mobile and
  desktop.
- New substrate added: `@canopy/agent-registry`. Phasing
  updated: Hub-web-console lands in P5 alongside the
  substrate-first roll-out.

### 2026-05-10 — destination narrative integrated

- §0 added: "Destination — a personal data layer with
  pluggable apps." Explicit articulation of where the
  substrate work is heading; tagged `(non-binding direction)`.
- §6 substrate list extended with `@canopy/interface-registry`
  and `@canopy/protocol` (P6 work).
- §7 phasing extended with P6 (interface registry + protocol
  substrate) and P7 (apps-as-bundles refactor, rolling).
- §4.4 Hub roadmap split into V1 (P4) and V2 (P6).
- §4.5 DX section extended with `create-canopy-bundle`
  (post-P6).
- §4.6 added: bundle skeleton sketch.
- User stories #13 + #14 added (cross-bundle data sharing;
  interface-registry conflict UX).
- Risks 7–9 added (interface-registry conflict UX; protocol
  API stability; bundle-refactor scope).
- §11 glossary added.
- Non-goals updated: per-item interface refs explicitly
  excluded; P7 date commitment explicitly deferred.

### 2026-05-10 — first draft + decisions resolved

- Initial draft authored from a Dutch brainstorm by the author.
- Five clarifying questions resolved through iterative
  discussion:
  - **Q1:** Two-pod model (private + sharing-with-public-part)
    chosen over three-pod or one-pod. Defence-in-depth
    rationale ("ACPs technically suffice but real-world safety
    issues mean we need to split") drove the call.
  - **Q2:** WebID-discovery + Hub-as-keymanager confirmed as
    the auth pattern. One OIDC flow per user; apps ask the Hub
    for authenticated fetches via the binding protocol.
  - **Q3:** Pseudo-pod transport: skill-based fetch on mobile
    pre-Hub; Hub-hosted post-Hub. Same scheme on desktop web.
    The earlier `mountLocalUi` reference was a confused
    shorthand and is removed.
  - **Q4:** Pseudo-pod doubles as the unified local cache for
    online pods. Single read path everywhere; replaces the
    two-tier `pod-client → CachingDataSource → Solid pod`
    chain.
  - **Q5:** No group private side-pod. Per-member containers
    within the group pod OR personal content on the user's own
    pods cover the same need.
- Substrate list (§6) updated: `pseudo-pod` absorbs the
  unified-cache role; `pod-client` becomes a thin facade.
- Phasing (§7) reshaped around the merged pseudo-pod work:
  P1 ships V0 (standalone), P3 ships V1 (real-pod-backed +
  write-through). Hub (P4) consumes the substrate.

---

*Source brainstorm (Dutch): preserved verbatim in the chat
session that produced this doc, 2026-05-10. Translated +
refined into this English plan per the project's
[design docs English-only convention](./conventions/architectural-layering.md).*
