# Standardisation plan — impact on existing code + transition

> Companion to
> [`standardisation-plan-restructured-2026-05-10.md`](./standardisation-plan-restructured-2026-05-10.md).
> The plan describes **what we're building**; this doc describes
> **what changes for code we already have** and a **proposed
> sequencing** for getting from here to there.
>
> Status: 2026-05-11. **(direction)** until the plan locks; pinned
> details follow plan-lock.

---

## Part I — TL;DR

The standardisation plan is mostly **substrate-shaped work** —
new substrates (`pseudo-pod`, `pod-onboarding`, `pod-routing`,
`item-types`, `notify-envelope`, `agent-registry`,
`interface-registry`, `protocol`) plus targeted extensions to a
handful of existing substrates (`item-store`, `pod-client`,
`notifier`, `sync-engine`, `sync-engine-rn`, `core`'s transport
+ identity layers). A grep through `packages/` confirms more
prior art than the plan's first draft estimated:

- `local-store` exists and is the closest thing to the
  pseudo-pod V0; extend rather than build from scratch.
- `pod-search` exists and is largely the substrate §III.B of
  the plan names as a P6 deliverable; lift the contract
  earlier.
- `oidc-session-rn` exists and is what Folio's mobile shell
  already uses for WebID auth; standardise on it across all
  three apps' mobile shells.

**Design principle: preserve existing pod-independence.** Where
today's code works without pods — Stoop's `groupMirror` shape
(group state across member devices), Tasks's relay-fan-out for
ledger writes, BLE-only crews — the new substrates continue to
offer that mode through §II.2's no-pod crew policy +
`pseudo-pod` replication-ring mode + `notify-envelope` eager
fan-out mode. Where the existing code already required pods
(Folio is fully Solid-pod-attached today), the new substrates
just extend. The substrate picks the per-write wire mode from
the crew's §II.2 policy; app code is uniform.

App-side, the impact ranks:

- **Stoop** — heaviest. `groupMirror`'s work moves into the
  substrate (`notify-envelope` + `pseudo-pod`); its
  capability — group state across member devices, no pod
  required — is preserved as §II.2 policy 4. Stoop crews can
  keep operating without pods; Stoop crews that pick a
  pod-having policy gain the latency + persistence +
  cross-app-ref wins from §II.6.
- **Tasks** — medium. Ledger writes gain a pod-primary path
  for crews picking a pod-having policy; the relay-fan-out
  path stays as the substrate's no-pod mode. Cross-pod refs
  land; the bundle refactor (P7) is the biggest long-term
  work, but most of it is rename + restructure. Tasks is the
  cleanest codebase and the best candidate for the
  canonical-bundle reference.
- **Folio** — lightest. Already Solid-pod-attached via
  `oidc-session-rn`; already cache-and-sync via `sync-engine`.
  Most of the storage-layer work is already done in spirit.
  Folio didn't ship a no-pod mode, so the pod-independence
  principle doesn't constrain it. Folio is the natural first
  adopter of pseudo-pod V1 and the `agent-registry`
  substrate.

The Hub track (§II.14 of the plan) doesn't break anything in
the interim because of §III.D's Hub-free path — apps stay
self-sufficient until P4 ships and can opt into the binding
protocol when it's ready.

**Config-on-pod simplifies the interim.** Canonical config
(storage-mapping, agent-registry, audit log) lives as **pod
resources**, not Hub state. For the transition this means:

- `pod-routing` and `agent-registry` substrates read their
  config from the pod via the pseudo-pod — the same read path
  apps already need for everything else.
- The Hub never needs a "settings backup" or "migrate to new
  device" story for these — there's nothing to back up, the
  config was always on the pod.
- During the Hub-free interim, the three apps each read the
  same config from the same pod resource. They write to it
  through etag-based optimistic concurrency; the substrate
  handles retries. No coordinator needed.

---

## Part II — SDK / `core` changes

`core.Agent` is the agent foundation. Today it owns: keypair
identity (`VaultMemory`), transport stack (`TransportManager`),
skill registry, role policy (`PolicyEngine`), cap-token issuance
(`CapabilityToken`, `TokenRegistry`), per-process state. Under
the plan, core gains some responsibilities and sheds some
weight to higher-level substrates.

### §II.1 — What stays in core

- The keypair + `VaultMemory` for agent identity. The
  agent-signature half of the §II.8 dual-auth (WebID OIDC
  authorizes pod writes; agent signature on content lets
  audit say which agent authored).
- The transport stack itself (NKN, BLE, mDNS) and the
  skill-routing layer. Standalone mode (§II.13) keeps this
  load-bearing.
- The role policy + cap-tokens. Less central than today —
  WebID OIDC + per-agent signatures handle the auth layer
  for pod writes — but still useful for **scoping skill
  calls** between agents (a bot calling skills on a user's
  agent benefits from a tight cap-token scope even when
  both sides have OIDC).
- `InternalTransport` for in-process routing.
- Single-agent topology: one `core.Agent` per process,
  per-crew `CrewState`. Unchanged.

### §II.2 — What core gains

Three new responsibilities, all additive:

1. **OIDC integration alongside the keypair** (pod-having
   users only). The agent holds a WebID OIDC session in
   addition to its keypair. When writing to the user's pod,
   both authenticate: OIDC authorizes the pod, keypair signs
   the content. Token refresh is the agent's job; refresh
   tokens persist in `VaultMemory` alongside the keypair. The
   `oidc-session-rn` substrate (already exists, used by
   Folio) is the mobile reference implementation; an
   equivalent for Node/desktop currently lives inside the
   `core.identity` namespace and gets extracted into a peer
   substrate `oidc-session` (consumed by both desktop and the
   RN binding).
2. **WebID-discovery on connect** (pod-having users only). On
   agent start, read the user's WebID profile to learn
   pointers — `storage-mapping-uri`, `agent-registry-uri`,
   `audit-log-uri` — then follow each to fetch the canonical
   config resource via the pseudo-pod. The WebID profile
   itself stays small; the heavy state lives on dedicated pod
   resources (§II.3 + §II.8 of the plan). Cache the resolved
   resources; refresh on a small heartbeat. New module:
   `core.identity.webid`.
3. **Agent-registry registration.** First-run: register self
   by writing into the `agent-registry` substrate — which
   writes a pod resource for pod-having users
   (`<anchor-pod>/private/agent-registry`) and a pseudo-pod
   resource for no-pod users (synced across the user's own
   devices via pseudo-pod's replication-ring mode). The
   substrate handles etag-based optimistic concurrency
   cleanly without a single coordinator (multiple apps may
   write in the Hub-free interim).

### §II.3 — What core sheds (eventually)

Two responsibilities move out of core, both **deferred to
P4–P6** so the interim path doesn't disturb existing code:

1. **Transport-socket ownership** (when bound to a Hub).
   `TransportManager` gains a mode flag: own its own NKN
   socket (standalone) vs delegate to the Hub via AIDL
   (registered-bundle). Mode is set by the bundle-discovery
   shim at startup; everything inside `core` stays the same
   downstream of the manager. Standalone mode is the **only**
   mode during the Hub-free interim.
2. **Pseudo-pod hosting.** Individual agents currently host
   their own caching DataSource (a per-app instance of
   `local-store` semantics). When the Hub is present, a single
   device-wide pseudo-pod hosted by the Hub serves all
   bundles. Core gains a "delegate pseudo-pod reads to the
   Hub" path via AIDL (P4); the in-process pseudo-pod path
   stays for standalone mode.

### §II.4 — Breaking changes in core

Two non-additive shifts the apps will see. Both are
deliberately landed late (P5+) so the interim is non-disruptive:

- **Cap-token issuance signature changes** when agent IDs
  become URI-shaped (P5). Cap-tokens currently carry pubKey
  identifiers; they later carry agent-URIs (which include the
  WebID's host for pod-having agents, or a pseudo-pod
  identifier for no-pod agents). Tokens issued before the
  migration remain valid; a one-off shim translates pubKey →
  agent-URI using the agent-registry.
- **`PolicyEngine` actor-resolution** consumes the
  `agent-registry` substrate (P5) for `pubKey ↔ webid ↔ role`
  mapping, deprecating the bespoke alias-table approach Tasks
  shipped 2026-05 (the `actorAliases` field on `CrewState` in
  `apps/tasks-v0/src/skills/index.js`). Apps continue passing
  `aliases` through `buildStandardRolePolicy` until the
  agent-registry rollout completes; then the alias-table arg
  becomes a no-op and gets removed.

### §II.5 — Transition for core

Phases align with the plan:

| Phase | Core work | Compatibility |
|---|---|---|
| P0 | none directly; plan-tracking convention covers core | non-breaking |
| P1 | gain WebID-discovery module; gain OIDC session alongside keypair (mobile uses `oidc-session-rn`, desktop uses extracted `oidc-session`); pseudo-pod-V0 client wiring (calls the new substrate via skill) | additive |
| P2 | none — taxonomy lives in `item-types`, consumed by apps directly | non-breaking |
| P3 | pseudo-pod-V1 write-through-queue client; `TransportManager` envelope-emit path | additive |
| P5 | `agent-registry` consumption; PolicyEngine actor-resolution rewrite; cap-token URI-shaped IDs | breaking, with shim |
| P4 (Hub track) | `TransportManager` gains delegate-to-Hub mode; pseudo-pod hosting toggles to "Hub-served" when bound | additive (apps detect at runtime) |
| P6 (Hub track) | core consumes `interface-registry` + `protocol` substrates; AIDL surface plumbing | additive |

---

## Part III — Existing substrates: per-substrate impact

A row per substrate in `packages/`. **Status** tag values:
**extends** (additive), **changes** (some breaking surface),
**absorbs** (this substrate's role migrates into a new
substrate), **stays** (no immediate change).

### `item-store` — **changes** (P1 for refs; P5 for IDs)

Today: items have local IDs (`item:abc...`); stored on Solid
pods via DataSource abstractions; hard-deps gate works within
a single pod. The `apps/tasks-v0/src/dag.js` extension
(`effectiveStatus`, `unmetDeps`, `openDeps[]`) sits at the
consumer level today.

Changes:

- **P1.** Add a standard `embeds: [{type, ref}, …]` field to
  the type schema (cross-pod refs §II.4 of the plan). Refs may
  point to resources on other pods. `treeOf` and the
  hard-deps gate walk refs cross-pod; permission failures
  yield a placeholder.
- **P5.** Item ID format becomes URI-shaped. Migration:
  dual-resolve during a deprecation window (substrate accepts
  either format on read; emits URI-shaped on write). Existing
  data on pods stays at-rest in the legacy shape; rewrites
  happen lazily on next write to a given resource.

Cross-cutting: hard-deps logic lifted out of
`apps/tasks-v0/src/dag.js` into the substrate during P1 (the
plan's substrate-first rule, §II.11, says data structures +
comm protocols are always substrate). Tasks-v0
`effectiveStatus` + `unmetDeps` move with it.

### `pod-client` — **extends** (P1)

Today: low-level Solid pod CRUD against real pods.

Changes:

- **P1.** Routes by URI scheme: `https://...` goes to the
  real-pod backend (today's path), `pseudo-pod://...` goes to
  the local pseudo-pod skill. Same API surface; the scheme
  dispatcher is a small frontend.
- No breaking changes for existing real-pod calls.

### `sync-engine` + `sync-engine-rn` — **extends** then **absorbs** (P3)

Today: cache-and-sync for items between Solid pod and local;
RN binding sets up background tasks. Folio-mobile already uses
this; Tasks/Stoop don't, because they're not pod-primary yet.

Changes:

- **P1.** Cache-warming follows refs across pods (when an
  envelope arrives, the engine pre-fetches the referenced
  resource).
- **P3.** Pseudo-pod V1 ships with a write-through queue that
  subsumes the sync-engine's role. Sync-engine becomes the
  **plumbing inside** pseudo-pod V1 rather than a parallel
  layer. Folio continues working through the
  Folio→sync-engine→pod path with sync-engine internally
  delegating to pseudo-pod; eventually Folio talks directly
  to pseudo-pod and sync-engine becomes pseudo-pod-internal
  only.

### `notifier` — **changes** (P1 for envelope; P3 for retirement of legacy paths)

Today: full payloads broadcast via p2p / push.

Changes:

- **P1.** Recognise envelope-shape payloads (the new
  `notify-envelope` substrate). Routing layer learns "this is
  an envelope — emit the small wire shape; recipients fetch
  the resource by ref." Also recognises the pseudo-pod-
  replicated eager full-payload mode for no-pod crews.
- **P3.** App-specific full-payload broadcast paths
  (Stoop's `groupMirror`, Tasks's relay-fan-out helpers)
  retire — their work routes through the substrate's
  per-crew mode picker.
- API: backward-compatible. Old call sites broadcasting full
  payloads keep working through the substrate; new call sites
  use the substrate's writeItem API directly.

### `identity-resolver` — **extends** (P5)

Today: maps pubKey → webid → role via a static alias table
passed in by the consumer.

Changes:

- **P5.** Backend swaps to consume `agent-registry`. The
  resolver becomes a thin wrapper that reads the canonical
  agent-registry pod resource (pointed at from the WebID
  profile) via the pseudo-pod, rather than relying on a
  per-call alias arg.
- API surface stays similar; consumers stop passing `aliases`
  once the migration completes (Tasks-v0 `actorAliases` field
  becomes vestigial).

### `react-native` (RN-shell substrate) — **extends** (P4)

Today: shared RN primitives — theme, hooks, picker, qr,
mnemonic, push, i18n.

Changes:

- **P4.** New module: `hub-discovery` — wraps
  `PackageManager.queryIntentServices()` to detect the Hub on
  launch. Returns `{ hubInstalled: bool, hubVersion?: string
  }`. Apps key off this to switch between standalone and
  registered-bundle modes.
- **P4.** New module: `hub-binding` — AIDL binding client for
  talking to the Hub. Wraps the binder into a promise-based
  API.
- No breaking changes to existing modules.

### `online-cadence` — **stays** through P3; **extends** (P4)

Today: heartbeat / online-status detection per agent.

Changes:

- **P4.** When the Hub is present, the per-agent cadence
  signal feeds **upward** into the Hub's capability-aggregator
  instead of driving the agent's own polling. Standalone mode
  stays unchanged.

### `local-store` — **absorbs** into pseudo-pod (P1 V0 + P3 V1)

Today: in-memory + persistent store. The closest existing
substrate to the pseudo-pod the plan calls out.

Changes:

- **P1.** Becomes the storage backend for pseudo-pod V0 (all
  three modes — standalone, replication-ring, cache). The
  pseudo-pod is `local-store` + Solid-shaped query API + mode
  selector.
- **P3.** Pseudo-pod V1 wraps `local-store` with a
  write-through queue against the real pod (via `pod-client`)
  for cache mode.
- Existing consumers of `local-store` keep working; new
  consumers use pseudo-pod.

### `pod-search` — **stays** (already in place); **adopted earlier** (P3)

Today: pod-side search substrate (already exists per
`packages/pod-search/`).

Changes:

- The substrate already exists; the plan's "ship in P6"
  framing was an over-estimate. Lift the contract into the
  pseudo-pod's read path during P3, so search-across-the-
  user's-pods becomes a pseudo-pod feature, not a separate
  client concern. Then it's available across all bundles in
  P6 without further substrate work.

### `oidc-session-rn` — **stays** (already in place); **standardised on** (P1)

Today: RN-side OIDC session helper. Already used by Folio.

Changes:

- Tasks-mobile + Stoop-mobile adopt this during P1 for the
  WebID OIDC flow (for users picking a pod-having crew
  policy). No API changes to the substrate itself.
- A `oidc-session` peer for Node/desktop gets extracted from
  `core.identity` during P1 to give the desktop shells the
  same surface.

### `core.permissions` (`PolicyEngine`, `CapabilityToken`, `TokenRegistry`) — **extends** (P5)

Covered in Part II §II.4. Cap-token signatures change when
agent IDs go URI-shaped; PolicyEngine actor-resolution swaps
to agent-registry.

### `core.transport.InternalTransport` — **stays**

In-process routing; no changes.

### `core.identity.VaultMemory` — **extends** (P1)

Today: local identity vault for keypairs.

Changes:

- **P1.** Stores OIDC refresh tokens alongside the keypair
  (pod-having users).
- **P1.** When `private/identity-vault` storage function maps
  to a pod URI (default policy for pod-having users routes it
  there), VaultMemory writes through via `pod-client`. For
  no-pod users, the vault lives in the local pseudo-pod
  (replicated across the user's own devices via the
  replication-ring mode). Recovery (mnemonic restore) walks
  whichever store applies.

### New substrates to author

Per the plan's §III.B; recapped here so the substrate inventory
is in one place:

| New substrate | Phase | Built from / extends |
|---|---|---|
| `pseudo-pod` | P1 V0 / P3 V1 | wraps `local-store` + `pod-client` + `sync-engine` |
| `pod-onboarding` | P1 | uses `pod-client` + `oidc-session` |
| `pod-routing` | P1 | canonical storage-mapping config is the pod resource `<anchor-pod>/private/storage-mapping`; pointer on WebID profile; pod-routing reads via pseudo-pod |
| `notify-envelope` | P1 | extends `notifier`; per-write mode (envelope-lazy for pod-having crews, full-payload-eager for no-pod crews) picked from §II.2 policy |
| `item-types` | P2 | new (cross-app type taxonomy) |
| `agent-registry` | P5 | reads + writes the pod resource `<anchor-pod>/private/agent-registry` via the pseudo-pod (pod-having users) or the pseudo-pod replication ring (no-pod users); WebID profile carries `agent-registry-uri` pointer when applicable; consumed by `identity-resolver` + `core` |
| `interface-registry` | P6 *(direction)* | new |
| `protocol` | P6 *(direction)* | new |

---

## Part IV — Per-app consequences + transition

A section per app. Each one follows: **today / what changes /
phase-by-phase work / risk / proposed sequencing within the
app.**

### §IV.1 — Tasks (medium impact)

**Today.** The cleanest of the three codebases. Hard-deps
shipped, single-agent topology shipped, Phase 41.x mobile
shell shipped. Ledger writes happen via relay-fan-out of full
payloads; the substrate's `enforceDependencies` works
within-process. Mobile uses React Native via
`@canopy/react-native`; desktop is a small Express + static
site at `web/`. No Solid pod attachment in current data path
— all storage is local-relay-fan-out via `item-store`.

**Significant cross-cutting work that lives in Tasks.** The
`effectiveStatus` / `unmetDeps` / `openDeps[]` logic in
`apps/tasks-v0/src/dag.js` is doctrinally substrate-shaped —
it lifts out of Tasks into `item-store` during P1.

The shared UI helpers at `apps/tasks-v0/src/ui/` (taskStatus,
composeArgs, inboxClassify, effectiveActor, i18nMerge,
dagFlatten) plus the `_scope` field for crewId routing already
match the canonical app skeleton — Tasks is the closest of the
three to the destination shape on the codebase axis.

**What changes per phase.**

- **P1.** Ledger writes (`addTask`, `addSubtask`,
  `proposeSubtask`, `claim`, `complete`, etc.) route via the
  substrate's per-crew §II.2 policy. **Pod-having crews**
  (centralised / decentralised / hybrid) get the pod-primary
  + envelope path. **No-pod crews** (§II.2 policy 4) use the
  substrate's pseudo-pod-replicated mode — same eager
  fan-out shape Tasks already runs today. So Tasks operating
  today without any pods keeps working unchanged after P1;
  users who attach a pod get the cross-pod refs + lazy-fetch
  + multi-device coherence wins. Items gain URI-shaped IDs
  (in the substrate; Tasks doesn't care). Cross-pod refs
  land — propose-subtask across crews where members live on
  different pods works natively. Hard-deps cross-pod walk:
  the substrate handles it; Tasks's `dag.js` extension moves
  with it.
- **P2.** Item-types taxonomy adoption. Tasks's items have an
  implicit shape (`{id, text, status, ...}`); they declare
  type `task` via the substrate and Tasks's inbox filters use
  the canonical taxonomy primitives. Per-app inbox stays
  Tasks-specific until P4 (Hub-aggregation).
- **P3.** Pseudo-pod V1 migration: the local-only path
  becomes a cache layer in front of the real pod for
  pod-having crews; write-through queue drains on reconnect.
  No-pod crews continue on the replication-ring mode. Tests
  against real-pod backends added to the integration suite.
- **P5.** Tasks's mobile shell adopts `oidc-session-rn`
  (today's mobile doesn't do OIDC at all — gains the
  capability for pod-having crews). Agent registers in the
  agent-registry resource via `agent-registry`. `actorAliases`
  argument disappears from `buildStandardRolePolicy` (the
  substrate reads from agent-registry). Substrate-first rule
  applied: any remaining lift candidates in
  `apps/tasks-v0/src/` get moved.
- **P4 (Hub track).** Tasks gains `hub-discovery` +
  `hub-binding` checks. When the Hub is installed, Tasks
  defers transport ownership to the Hub. The same Tasks APK
  operates in two modes: standalone and registered-bundle.
- **P6 (Hub track).** Tasks registers its `task` type's
  compact + full renderers in the `interface-registry`. The
  propose-subtask flow expressed as a declared `protocol`
  (the plan's canonical first protocol). The rest of Tasks's
  surface is largely the renderers, which are already RN
  components — small refactor to fit the registry contract.
- **P7 (Hub track).** Bundle refactor. Tasks is proposed as
  the **canonical first bundle reference** because the
  codebase is cleanest. Most work is rename + restructure
  (the bundle manifest declaring types + interfaces +
  protocols + skills + locales) plus the AIDL surface wiring.

**Risk.** Lowest of the three. The codebase is in shape; the
P1 routing change is small in code-LOC terms. Test suites
already cover the hard-deps / DAG / claim flows; integration
tests against real pods are the main test-infrastructure
addition.

**Proposed sequencing within Tasks.**

1. **Land P1 first on Tasks.** Tasks's ledger writes are the
   easiest substrate to convert (well-typed; well-tested; one
   item shape). Use it as the proving ground for pseudo-pod
   V0 + notify-envelope + pod-primary writes.
2. **Stoop and Folio land P1 in parallel after Tasks
   demonstrates the pattern works end-to-end.**
3. Tasks remains the canonical reference through P6/P7.

### §IV.2 — Stoop (heaviest impact)

**Today.** The biggest existing app. V3 mobile shipped
2026-05-08; V2 features (Phases 23–30) shipped 2026-05-07.
Group state distributed via `groupMirror` — a substrate that
fan-outs **full content** over p2p to every crew member.
Supply/demand items + neighbourhood-job flow built on top of
the V2 shape. Stoop-mobile is the most-shipped mobile shell
(more screens, more flows than Tasks-mobile).

**The `groupMirror` story.** `groupMirror` solves an
interesting problem: crews work without sending people to pods
first. The plan preserves that capability by making it §II.2's
**fourth crew policy** (no-pod / pseudo-pod-replicated). The
substrate's `notify-envelope` picks eager full-payload fan-out
for no-pod crews; the receiving pseudo-pods operate in
replication-ring mode. Stoop's no-pod-crew UX after the
transition is the same as today's `groupMirror` UX; the work
that used to live in the `groupMirror` substrate moves into
`notify-envelope` + `pseudo-pod`.

For Stoop crews that pick a pod-having policy (centralised,
decentralised, or hybrid), the substrate's pod-primary +
envelope path is the new option — content lives canonically on
the relevant pod and recipients fetch by ref.

**What changes per phase.**

- **P1.** Stoop's storage layout migration: crew data
  (memberMap, supply/demand items, neighbourhood-jobs, audit
  log) routes through `pod-routing` per the crew's §II.2
  policy. **Centralised** household crews: group pod holds
  canonical state. **Decentralised + cross-pod refs**
  neighbourhood crews: members keep their own data on their
  own sharing-containers with refs across. **Hybrid**:
  canonical ledger on group pod + members' drafts on own
  containers. **No-pod**: group state lives as eagerly-
  replicated content across member pseudo-pods. Crew picks
  policy at creation time; default for new crews can be no-
  pod (try-before-pod) with a one-tap "upgrade this crew to
  a pod-having policy" affordance.
- **P2.** Stoop's supply/demand items get types in the
  shared taxonomy. Cross-app dream: a Stoop supply item links
  to a Tasks task ("borrow X to do Y") via the shared
  `embeds` field. No-pod crews use `pseudo-pod://` URIs in
  refs; cross-crew refs resolve via peer fetch.
- **P3.** **`groupMirror`'s substrate work absorbed** into
  `notify-envelope` + `pseudo-pod`. Persistent ledger writes
  route through `notify-envelope` in either pod-primary mode
  (pod-having crews) or eager-fan-out mode (no-pod crews).
  Chat messages (latency-critical, ephemeral) stay on the
  relay-fan-out pattern with archive-to-pod for durability
  when a pod exists; archive-to-pseudo-pod for no-pod crews.
  The PostCard / PushPolicy fixes (2026-05-08 / 2026-05-10
  commits) hint at the same shape — separate ephemeral feed
  traffic from persistent content. P3 generalises that split
  substrate-wide.
- **P5.** Stoop adopts canonical app skeleton (lift `src/lib/`
  UI-glue helpers per
  [`conventions/architectural-layering.md`](./conventions/architectural-layering.md);
  apply the `export *` shim pattern). Stoop-mobile already
  supports WebID-aware auth via `oidc-session-rn`. Agent
  registration via `agent-registry`.
- **P4 (Hub track).** Same `hub-discovery` + `hub-binding`
  pattern as Tasks.
- **P6 (Hub track).** Stoop registers types: `chat-message`
  (with archive-to-pod mode), `supply-offer`, `demand-offer`,
  `neighbourhood-job`. The neighbourhood-job lifecycle
  becomes a declared protocol.
- **P7 (Hub track).** Bundle refactor. Largest of the three
  apps; do it second (after Tasks proves the pattern).

**Risk.** Highest of the three. The substrate work that
absorbs `groupMirror` is load-bearing and the place where
existing behaviour is most likely to regress. Two distinct
regression risks to watch:

- **Pod-having mode regressions** — the new pod-primary path
  may have unfamiliar latency / consistency edges that
  `groupMirror`'s eager fan-out hid.
- **No-pod mode regressions** — the substrate's
  pseudo-pod-replicated mode has to reproduce `groupMirror`'s
  user-perceived latency + durability. The semantic
  equivalence isn't free; the substrate has to do what
  `groupMirror` did, expressed differently.

Mitigation: keep `groupMirror` running in parallel during P3
transition (writes go both ways for a period; reads prefer the
substrate-side path); cut over when integration tests against
multi-device crews — both pod-having and no-pod — all pass.

**Proposed sequencing within Stoop.**

1. **P1 storage-layout migration first**, behind a feature
   flag that defaults off. Tasks lands P1 first; Stoop
   follows once Tasks's pattern is proven.
2. **P3 substrate cut-over** is the cliff. Plan two weeks of
   dual-path runtime before flipping the read preference to
   the substrate side; one more week of writes-to-both before
   removing the standalone `groupMirror` writer. Crews are
   migrated per-crew: no-pod crews flip to pseudo-pod-
   replicated mode; pod-having crews flip to pod-primary.
   Both must pass parity tests before cut-over.
3. **P5 skeleton alignment** in parallel with the storage
   work, since it's mostly substrate-side and helper-lifting.

### §IV.3 — Folio (lightest impact)

**Today.** Markdown notes mirrored into the user's Solid pod.
Already pod-primary (the whole app is). Uses `sync-engine` for
cache-and-sync; uses `oidc-session-rn` for mobile OIDC; uses
`pod-client` directly. Has desktop (chokidar file-watch +
Express + systray) and mobile (Expo + screens + auth) shells.

**Significant observation.** Folio is already mostly where the
plan wants apps to be on the storage axis. The plan's
pseudo-pod is a generalisation of what Folio's sync-engine
layer already does; the plan's `oidc-session-rn` mention is a
substrate Folio is the first consumer of. Folio is the **best
first adopter of the destination substrates** even though
Tasks is the canonical bundle reference codebase-wise.

**What changes per phase.**

- **P1.** Minimal. Folio's existing path (sync-engine against
  pod-client) becomes pseudo-pod-backed internally; from
  Folio's perspective nothing visible changes. Storage-function
  abstraction means Folio declares "I need
  `private/notes/<filename>`" instead of constructing paths;
  the substrate routes per the user's policy.
- **P2.** Folio adopts `item-types` for the `note` type;
  notes become first-class for the cross-app inbox / search.
- **P3.** Folio is the natural **first consumer of pseudo-pod
  V1's write-through queue** because its existing sync-engine
  code can be retired in favour of the substrate.
- **P5.** Skeleton alignment (lift Folio-specific UI helpers
  to `apps/folio/src/ui/`; mobile re-exports). Agent
  registration via `agent-registry`.
- **P4 (Hub track).** Same `hub-discovery` + `hub-binding`
  pattern. Folio-as-registered-bundle gives it the unified
  inbox without Folio changing.
- **P6 (Hub track).** Folio registers `note` type's compact
  + full renderers. Folio already has the "open in Solid
  app via URI" pattern; registering with the interface
  registry generalises that.
- **P7 (Hub track).** Bundle refactor. Smallest of the three;
  do it **last** as a confidence check on the bundle shape —
  by then Tasks and Stoop have shaken out the edges.

**Risk.** Lowest. Existing patterns already match the plan's
direction. The biggest surprise might be that the
`sync-engine` → pseudo-pod-V1 retirement (P3) changes Folio's
data-path internals; existing tests should catch regressions.

**Proposed sequencing within Folio.**

1. **Let Tasks land P1 first; then Folio adopts the new
   substrates in parallel with Stoop's P1.** Folio gets them
   almost for free.
2. Folio is the **first consumer of pseudo-pod V1** (P3) —
   its sync-engine layer is the part of the plan that most
   directly maps to existing code.
3. Bundle refactor last (P7), as a confidence test.

### §IV.4 — Cross-app sequencing summary

| App | P1 timing | P3 (heaviest semantic) | P7 bundle order |
|---|---|---|---|
| Tasks | First (proves pattern) | Light (already ledger-shaped) | First (canonical reference) |
| Stoop | After Tasks | **Heavy** — substrate absorbs `groupMirror`'s work (no-pod capability preserved as §II.2 policy 4) | Second |
| Folio | Parallel with Stoop | Light (sync-engine → pseudo-pod V1) | Last (confidence test) |

---

## Part V — Cross-cutting concerns

### §V.1 — Breaking changes catalogue

Surfaces that change non-additively. All deliberately deferred
past P3 so the storage-layer transition (the easiest to
regress) doesn't have other variables moving.

| Change | Phase | Migration shape |
|---|---|---|
| Item ID format → URI-shaped | P5 | Substrate dual-resolves during a deprecation window; rewrites lazy on next write |
| Cap-token signatures embed agent-URI instead of pubKey | P5 | One-off shim translates old tokens via agent-registry; legacy tokens accepted on read |
| `PolicyEngine` reads from `agent-registry` instead of `aliases` arg | P5 | `aliases` arg becomes a no-op after P5; removed in P5+1 |
| `notifier` recipients see envelope shape (no full payload) for **pod-having-crew** ledger writes | P3 | No-pod crew writes continue to use full-payload eager fan-out via the substrate; pod-having-crew recipients fetch-by-ref |
| `groupMirror` substrate retires (work moves into `notify-envelope` + `pseudo-pod`) | P3 | Stoop dual-runs `groupMirror` + substrate during P3 transition; flip per-crew when parity tests pass |
| `actorAliases` on `CrewState` becomes vestigial | P5 | Apps remove the arg incrementally during P5 |

### §V.2 — Test strategy

- **Today's test suites stay.** Tasks 412/412, Stoop's test
  count, Folio's vitest suite all stay green throughout. No
  regression on existing surface is the acceptance bar for
  each phase.
- **New integration-test harness** in P1, with **two test
  matrices** to exercise both crew policy classes:
  - Pod-having tests: write to real pod via pseudo-pod, read
    back, envelope round-trip, cross-pod refs, hard-deps walk
    across pods.
  - No-pod tests: write to pseudo-pod in replication-ring
    mode, eager fan-out to peers, peer pseudo-pods receive
    the resource, durability across the union of online
    devices, recovery when individual devices drop offline.
- **`groupMirror` substrate cut-over (Stoop P3)** gets a
  dual-path test mode that runs both the substrate and the
  standalone `groupMirror` and asserts read-equivalence
  across a multi-device crew simulation. Both crew shapes
  (pod-having and no-pod) covered — no-pod parity is the
  load-bearing test that proves the substrate reproduces
  `groupMirror`'s capability.
- **Hub-track tests** (P4+) live in
  `packages/integration-tests/hub/` and use an Android
  emulator + a stub Hub APK; the AIDL surface gets
  contract-tested both ways.

### §V.3 — Rollout sequencing (one-line)

P0 → P1 (Tasks first; Stoop + Folio follow) → P2 (parallel
across apps) → P3 (Tasks light; Folio adopts pseudo-pod V1 via
sync-engine retirement; **Stoop's substrate cut-over absorbs
`groupMirror` — this is the cliff**) → P5 non-Hub portion
(skeleton alignment + agent-registry; all three apps in
parallel) → **Hub-free interim path complete** (§III.D in the
plan) → P4 (Hub-Android V1; existing apps gain
`hub-discovery`) → P5 Hub portion (Hub-web-console V1) → P6
(interface-registry + protocols + Hub V2) → P7 (bundle
refactor; Tasks first, then Stoop, then Folio).

### §V.4 — Risks the plan doesn't surface, that arise from existing code

- **`groupMirror`'s implicit semantics.** It's been the
  substrate that makes Stoop's no-pod group flows feel
  coherent; the substrate's pseudo-pod-replicated mode has to
  match it on perceived latency + durability. Two facets:
  - The substrate's no-pod mode must do what `groupMirror`
    did. Same eager fan-out timing, same durability
    characteristics, same behaviour on member churn.
    Mitigation: dual-run during P3 transition + parity tests
    + latency benchmarks before flipping read preference.
  - The pod-having modes (centralised, decentralised,
    hybrid) introduce new behaviours unfamiliar to
    `groupMirror`-trained users — lazy fetch, envelope
    latency, ACP edge cases. Mitigation: flip per-crew, not
    all-at-once; surface a "this crew uses pod storage; X
    happens differently" affordance during the transition.
- **VaultMemory recovery semantics.** Mnemonic restore today
  reconstitutes the keypair from a seed. Under P1, for
  **pod-having users**, restore also has to fetch the
  encrypted vault blob from the pod's
  `/private/identity-vault` container. New failure mode: seed
  restores but pod-side blob isn't reachable (offline, or
  provider lost it). Recovery flow in the web console (P5)
  handles this gracefully. For **no-pod users**, the vault
  lives in the local pseudo-pod (replicated across the user's
  own devices via the pseudo-pod-replicated mode); restore is
  local-only and the pod-side failure mode doesn't apply.
- **Cross-app `actorAliases` arg removal.** Tasks-v0 ships
  this arg on the role policy substrate
  (`apps/tasks-v0/src/rolePolicy.js`'s
  `buildStandardRolePolicy(roles, opts)`); any other app
  that's started consuming it (none today) will need a
  migration. Document the deprecation in P5 release notes.
- **Multiple OIDC sessions per WebID during Hub-free
  interim** (pod-having users only). Three apps each running
  their own OIDC flow means three refresh tokens, three
  session-expiry races. WebID providers have rate limits;
  collectively the three apps could thrash. P5 design pass
  on `agent-registry` has to consider whether to encourage
  one provider, one per app, or some other shape. No-pod
  users don't have this risk — no OIDC at all.
- **Concurrent writes to the agent-registry + storage-mapping
  pod resources** during the Hub-free interim. The
  config-on-pod design means three apps may concurrently
  write the same pod resource — etag-based optimistic
  concurrency has to work without a single coordinator.
  Failure mode looks like an etag-conflict loop if two
  devices change settings near-simultaneously. Mitigation:
  substrate ships conflict-retry with bounded backoff; on
  persistent conflict, surface a "config changed on another
  device, reload?" UI affordance to the user. For **no-pod
  users**, the same resources live in the pseudo-pod
  replication ring; the equivalent concurrency surface is
  between the user's own devices, which the replication-ring
  substrate handles via the same etag pattern.
- **Discoverability of the config resource for tools other
  than the Hub.** The config-on-pod design promises a user
  can edit storage-mapping via any pod-aware tool. In
  practice they need to know the path. Mitigation: P1 pins
  the path conventions in `conventions/storage-layout.md`;
  the WebID profile pointer is the canonical lookup so a
  third-party tool that knows the WebID can always find the
  resource.

### §V.5 — Documentation deliverables

Concrete docs that need to exist alongside the substrate work:

- `conventions/plan-tracking.md` (P0).
- `conventions/storage-layout.md` describing the one-pod
  default + sub-containers + two-pod preset (P1).
- `conventions/cross-pod-refs.md` describing the `embeds`
  field + permission-failure rendering (P1).
- `conventions/pod-independence.md` (P1) — pins the design
  principle from §V.6 below; documents which capabilities
  must work without pods + the substrate's mechanism for
  delivering them.
- Updates to existing convention docs:
  `architectural-layering.md` already has the shared-UI-glue
  section; add a section on bundle manifest shape during P6.
- Per-app READMEs updated to reflect each phase's app-level
  changes (per `conventions/app-readme-scheme.md`).

### §V.6 — Design principle: preserve existing pod-independence

The plan must not regress **capabilities that today's code
already delivers without pods**. The audit below documents
what's preserved and how; future substrate decisions are
constrained by this principle.

**What's preserved (and how):**

| Today's capability | Tomorrow's mechanism |
|---|---|
| Stoop's `groupMirror` shape — group state across member devices, no pod needed | §II.2 policy 4 (pseudo-pod-replicated); §II.6 third pattern (pseudo-pod-replicated eager fan-out); §II.7 third pseudo-pod mode (replication ring with peers) |
| Tasks's relay-fan-out of ledger writes — task ledger across crew, no pod needed | Same substrate (`notify-envelope` + `pseudo-pod`) for no-pod crews; pod-primary path is the alternative, not the replacement |
| Try-the-app-for-a-week-before-pod-provisioning | Pseudo-pod standalone mode (§II.7); no-pod crew policy (§II.2 policy 4) |
| BLE-only campsite crews | Pseudo-pod replication ring works over BLE skill calls; no internet required |
| Mnemonic restore reconstructing identity locally | For no-pod users, restore is local-only (vault in the local pseudo-pod, optionally replicated across user's own devices) |

**What's not constrained:**

- Folio is already fully pod-attached; no no-pod mode to
  preserve. Folio's transition simply extends.
- New capabilities being *added* (cross-pod refs, OIDC-auth
  for cross-user pods, web console recovery) can require
  pods — they're net new, not regressions of existing
  function.

**The substrate-side mechanism:**

- The crew's §II.2 policy is a **preference** set at crew
  creation; can be upgraded later via the storage-mapping
  editor.
- App code calls `substrate.writeItem(...)` without knowing
  the policy.
- The substrate picks the wire format and persistence target
  per-write based on **three inputs**: content nature, crew
  preference, **current pod reachability**.
- Receiver-side: every mode deposits items into the local
  pseudo-pod. Apps read uniformly.

**Graceful degradation simplifies the migration** (locked
2026-05-11). Because the §II.2 policies are preferences with
graceful degradation (plan §II.6 §4.4.5a), pod-having crews
**don't lose offline capability** when they migrate from
pre-standardisation app behaviour (groupMirror /
relay-fan-out). The substrate's replication-ring mode is
the universal baseline; the pod is a promotable ring member
whose participation is gated by reachability. Apps that
attached a pod to a crew during the transition keep working
offline; the data syncs when connectivity returns.

**Audit trigger:** any future plan revision that proposes
retiring a substrate must explicitly state whether the
substrate's capability was already pod-independent today, and
if so, how the new design preserves that capability. See
§IV.2 (Stoop) for the worked example.

### §V.7 — Open V2 question: upload-on-behalf

Documented 2026-05-11 for later resolution. **Not blocking
V1.** V1's graceful degradation drains the writer's *own*
pending-upload queue to the writer's *own* pod on
reconnect. V2 considers letting a different member upload
the writer's content on the writer's behalf — closing the
durability gap when the writer themselves stays offline for
extended periods.

The hard design questions (carried across plan §II.2 + §II.6
+ substrates §4.4.6):

1. **Authority model.** Who has the right to write to another
   member's pod? Options: a "pod-shepherd" role per crew;
   per-resource grant cap-tokens; opt-in flag per member.
2. **Conflict resolution.** Member A writes offline; member B
   writes online; both touch the same logical resource at
   different times. Last-write-wins by timestamp? Surface a
   conflict?
3. **ACP semantics for proxy uploads.** When B uploads A's
   content, whose ACPs apply — A's intent (the substrate
   knows what A wanted) or B's authorisation (B is the actual
   writer)?
4. **Product fit.** Is upload-on-behalf desirable in the
   project's value system? Or is "everyone manages their own
   pod" the durable answer? Likely *yes* for buurt-style
   crews where some members are tech-shy and never provision
   a pod; pin during V2 design with stakeholder input.

These questions should be revisited once V1 has been running
long enough to surface real "this person's content is stuck
on their phone for two weeks" scenarios in the field.

---

## Part VI — Source

Companion to
[`standardisation-plan-restructured-2026-05-10.md`](./standardisation-plan-restructured-2026-05-10.md);
authored 2026-05-11 in the same session. Grep through
`packages/` confirmed existing substrates (`local-store`,
`pod-search`, `oidc-session-rn`) that the plan's substrate
inventory under-counted. Per-app impact derived from current
state of `apps/tasks-v0/`, `apps/tasks-mobile/`, `apps/stoop/`,
`apps/stoop-mobile/`, `apps/folio/`, `apps/folio-mobile/` as
of 2026-05-11.

## Part VII — Changelog

### 2026-05-11 — graceful degradation across pod / no-pod modes

- §V.6 mechanism reframed: the §II.2 policies are
  **preferences with graceful degradation**, not hard runtime
  rules. The per-write reachability check makes pod-having
  crews keep functioning offline (writes go to the ring +
  queue for pod-upload on reconnect).
- Pseudo-pod's replication-ring mode locked as the **universal
  baseline** — pods are promotable ring members whose
  participation is gated by reachability.
- New §V.7 — open V2 question: upload-on-behalf (a different
  member uploading an offline writer's content). Four design
  questions documented for later resolution (authority,
  conflict resolution, ACP, product fit).

### 2026-05-11 — initial

First draft. Authored alongside the restructured plan's
2026-05-11 revisions:

- Part I TL;DR articulates the design principle (preserve
  pod-independence) and the config-on-pod simplification.
- Part II core changes: WebID-discovery, OIDC integration,
  agent-registry registration. Cap-token + PolicyEngine
  breaking changes deferred to P5 with shims.
- Part III: row per existing substrate; new-substrate table.
- Part IV: per-app sections for Tasks (medium), Stoop
  (heaviest — `groupMirror` substrate work absorbed; no-pod
  capability preserved), Folio (lightest — already
  pod-attached).
- Part V: breaking-changes catalogue, test strategy with
  pod-having + no-pod matrices, rollout sequencing, risks
  arising from existing code, documentation deliverables,
  and the design-principle audit table.
