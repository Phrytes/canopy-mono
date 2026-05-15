# Project-wide standardisation plan (restructured) — 2026-05-10

> **Status:** proposed restructure of
> [`standardisation-plan-2026-05-10.md`](./standardisation-plan-2026-05-10.md).
> Same decisions, same scope — different presentation. If accepted,
> this supersedes the original at lock-time.

---

# PART I — Summary

## §I.1 — TL;DR

The codebase is shared across our three apps; **storage isn't**.
Every app makes its own choices about what lives locally vs on
the user's pod, and the p2p-centric transport stack ships full
payloads to every crew member separately, which is inefficient on
mobile. This plan re-centres data on Solid pods where the user
wants pods, **preserves the no-pod path** for crews that don't,
slims p2p to notifications, gives each user a default one-pod
layout with a prominently recommended two-pod upgrade and full
freedom to remap, and bakes mobile-independence into the data
fabric. Apps converge on a substrate-first codebase shape; the
Hub track is articulated as a later set of phases (P4–P6) so the
storage/transport substrate work can land first without it; the
long-arc destination has apps becoming installable bundles of
types, interfaces, and protocols on a personal data layer —
distributed as Play-Store-shipped APKs that adapt at runtime to
a Hub they can discover via Android IPC.

## §I.2 — Why this plan

1. **Storage divergence.** Tasks, Stoop, and Folio each have
   their own opinions about what's local, what's pod, and how
   items reference each other. New apps inherit the divergence.
2. **p2p inefficiency at scale.** Broadcasting full payloads to
   N crew members on mobile costs more than necessary in the
   common case where the same content also lives on a pod.
3. **Mobile-as-single-point-of-failure.** The user's surface
   shouldn't fully depend on their phone running. A lost or
   broken phone shouldn't lose access to the data fabric.
4. **Plans drifted last month.** No uniform shape for tracking
   plan changes; phases were renumbered, files renamed
   mid-flight, contradictions accumulated.
5. **Apps could be doing less.** Each app re-implements
   helpers — display-status mapping, form payload shaping, inbox
   classification, alias resolution — that belong as substrates
   shared across apps and shells.

## §I.3 — What we're building, in 5 bullets

- **One pod per user as the default; two pods as the
  prominently-recommended upgrade.** A single Solid pod with
  `/private/`, `/sharing/`, `/sharing/public/` sub-containers
  on first-run; the Hub setting surfaces "split into two pods
  (recommended for stronger isolation)" as a one-click preset.
  Crews on top of that choose a per-team policy: centralised
  group pod, decentralised + cross-pod refs, hybrid, or
  no-pod (pseudo-pod replicated).
- **Persistent writes adapt to the crew's policy.** Pod-having
  crews use pod-primary writes + envelope notifications: a pod
  write authoritatively stores the content; a tiny p2p envelope
  tells subscribers to fetch the new ref. No-pod crews use
  pseudo-pod-replicated eager fan-out: full content goes to
  every member's pseudo-pod. Native streams (chat, audio,
  video) stay direct p2p.
- **A pseudo-pod everywhere.** Same Solid-shaped read path on
  every device. Three operating modes: cache for an attached
  real pod, standalone (single user, no pod), and
  replication-ring with peer pseudo-pods (no-pod crews).
- **Multiple agents, one WebID.** Each device, each bot is its
  own keypair-bearing agent registered on the user's pod
  (with a pointer on the WebID profile). The Hub-Android is
  the primary mobile surface; a Hub-web-console is a parallel
  browser-based management dashboard. Mobile-independence is
  a hard requirement.
- **Substrate-first codebase + a destination shape, with the
  Hub track separable.** Stop waiting for rule-of-two;
  aggressively grow substrates. The Hub (§II.14) is the natural
  endpoint, but the substrate work in P0–P3 + the Hub-free
  portion of P5 (§III.D) is independent and can ship first.

## §I.4 — Reading guide

This doc has four parts:

- **Part I — Summary** (you're here). Stakeholder-readable.
- **Part II — Per-feature descriptions.** What we're building
  and why, one section per concept. §II.14 consolidates the
  Hub track specifically since it spans multiple features.
- **Part III — Implementation.** Phases, substrates, risks,
  and the explicit Hub-free interim path (§III.D).
- **Part IV — Reference.** Glossary, changelog, source.

Two status tags appear throughout:

- **(committed)** — phases P0–P3 + the Hub-free portion of P5;
  binding once the plan locks.
- **(direction)** — phases P4–P6 + the destination shape; the
  substrate work in P0–P3 is shaped to make the Hub track
  reachable, but the Hub itself isn't on a committed schedule.

## §I.5 — Key user journeys

End-to-end journeys through the system, Hub-centric, to anchor
the abstract feature descriptions in Part II. Each is one
paragraph; the underlying mechanics live in the relevant Part II
section.

**§I.5.1 — First-time install on Android (Hub first).** Anne
installs the Hub. It detects she's new, runs one OIDC flow
against her chosen WebID provider (Inrupt by default; can be
self-hosted), and provisions her single Solid pod with the
canonical sub-containers (`/private/`, `/sharing/`,
`/sharing/public/`) in under 20 seconds. On completion, she
sees a "for stronger isolation, consider splitting your data
across two pods" suggestion she can accept now or revisit
later. When she later installs Tasks, Stoop, or any other
bundle from Play Store, they inherit the same login through
the binding protocol — no app-by-app re-authentication.

**§I.5.2 — Daily usage.** Anne opens the Hub on her phone. The
home screen is the unified inbox: everything happening across
every installed bundle, newest first. She filters to "messages
from Bob" or "everything from Tasks today." Tapping any item
dispatches to the registered renderer for its type and
deep-links her into the right detail view. The Hub renders the
"appearance" — apps just provide the renderers.

**§I.5.3 — Lost phone recovery via the web console.** Anne's
phone is gone. She opens `console.<provider>` in any browser,
OIDC-auths against her WebID, sees her agent registry, revokes
the missing phone's keypair, installs the Hub on a new phone,
OIDC-auths again from the new device, and resumes. All her data
was on the pod the whole time; the recovery is identity-level,
not data-level. The phone was never canonical.

**§I.5.4 — Adding a bot from the web console.** Anne wants a
Telegraf bot that posts to her Tasks-crew chat from a server she
runs. From the web console she declares a new bot (name, scope
"send chat messages in crew X"), the console mints an OIDC token
for the bot + a cap-token scoping its skill calls, and she pastes
both into the bot's config. The bot starts running and registers
itself in Anne's agent registry. Any device with management
access can later revoke it.

**§I.5.5 — Cross-pod sub-task in a decentralised crew.** Anne is
in a neighbourhood crew that picked the decentralised storage
policy — no group pod, members keep their own. Bob added a task
on his sharing-container. Anne wants to spawn a sub-task. Her
client writes the sub-task to her sharing-container with a ref
to Bob's parent. Bob's client receives a tiny p2p notification,
fetches the new sub-task by ref, and renders it as "Anne added
a sub-task on your task." The hard-deps gate works cross-pod
via the ref walk.

**§I.5.6 — Bundle conflict on a type.** Anne installs Stoop,
which registers itself as the default Android handler for the
`supply-offer` type. Later she installs another bundle that
also handles `supply-offer`. Android's "open with…" picker
surfaces — pick once, set as default — exactly the same UX as
two browsers competing for HTTP links. The Hub's bundle list
shows which app is currently the default for each type.
Destination-shape story; lands in P6.

**§I.5.7 — Airplane-mode resilience.** Anne's phone is in
airplane mode. Her desktop web Tasks agent is online; her
Telegraf bot is online on a server somewhere. Both keep working,
each authenticated independently against her WebID, each writing
to her pod via their own OIDC sessions. When her phone comes
back online, the pseudo-pod sync queue drains and her phone
catches up. The data fabric never depended on the phone being
alive.

**§I.5.8 — No-pod crew on a campsite.** Three friends on a
weekend trip create a Stoop crew without setting up any pods.
The crew picks the no-pod / pseudo-pod-replicated policy. They
chat, share photos, and coordinate over BLE + relay; every
member's pseudo-pod holds the full group state. When they get
back home, anyone who wants to attach a pod can — the crew
optionally upgrades to a pod-having policy, lazily migrating
content; members who don't attach pods stay in the
replication ring.

**§I.5.9 — Power user upgrades to two pods.** Anne handles
sensitive crew data and decides the recommended two-pod layout
is worth the extra setup. From the storage-mapping editor in
the Hub (web console or Android), she clicks "split into two
pods." The substrate provisions a second Solid pod (same
provider by default; she could pick a different one), updates
her WebID profile pointer, lazily migrates `/sharing/` content
into the new pod, and rewrites refs via a per-user redirect
map. Her clients pick up the new mapping on next read; no
re-onboarding.

**§I.5.10 — Installing a bundle before the Hub.** Anne installs
Tasks from Play Store first, before discovering the Hub. She
uses it standalone for a few weeks — her own pod, her own
relay socket, her own inbox. Later she installs the Hub. Tasks
re-checks on its next launch, discovers the Hub via
`PackageManager`, registers via IPC, and switches to
registered-bundle mode. Anne notices: less battery drain, one
foreground-service notification instead of one per app, a
unified inbox in the Hub that includes Tasks's items alongside
everything else.

**§I.5.11 — A new bundle changes the Hub's schedule.** Anne
installs a chat bundle from Play Store. On launch, it registers
with the Hub and declares tight runtime needs: 30-second
polling on chat-message events, a persistent relay socket,
foreground-service slot while the chat activity is open. The
Hub's scheduler upgrades — it was on Tasks's relaxed 5-minute
cadence; now it's on the chat bundle's 30-second. When Anne
backgrounds the chat bundle, it re-declares "I'm fine with
relaxed polling now," and the Hub downgrades back. The user
never sees this happen; battery just behaves correctly.

**§I.5.12 — Embedding a task in a chat message.** Anne is in
the chat bundle. She types a message, taps "embed item," sees
a search UI over her pods, picks "Paint the fence (task)." The
chat message goes out carrying an embedded ref to the task. On
Bob's side, the chat renderer asks the Hub's interface registry
for "render this task in compact mode"; the Tasks bundle's
registered compact renderer fetches the task and shows a small
chip — title + status pill + "open" affordance — inline in the
chat message. Tap-through opens the full task detail in Tasks.

**§I.5.13 — Embedded ref without permission.** Same setup as
§I.5.12 but Bob isn't a member of Anne's crew. The compact
renderer's fetch returns 403. The interface registry's default
permission-denied rendering kicks in: a small chip showing
"🔒 You don't have access to this task" plus a "request access"
button. Bob clicks it; the substrate sends an access-request
to Anne's pod; Anne sees a notification in her inbox and can
choose to grant.

## §I.6 — Status

- All P1–P3 + Hub-free-P5 design decisions resolved (see §C,
  changelog).
- The Hub track (§II.14, phases P4–P6) is design-mature but
  **not on a schedule** — the timing is gated on the Hub-free
  substrate work landing first.
- The destination shape (§II.13) is articulated as
  **(direction)** — P6 implements it.
- Plan flips from `(non-binding draft)` to **(binding)** once
  P0's plan-tracking scan resolves contradictions in existing
  conventions. The first deliverables after lock are P0–P3 +
  the Hub-free portion of P5; the Hub track (§III.D and §II.14)
  can begin any time after P1 ships.

---

# PART II — Per-feature descriptions

Each feature follows the same shape: **what / why / decisions
locked & open / phase**. Code is avoided unless a small example
carries genuine signal.

## §II.1 — One-pod default; two-pod recommended (committed)

**What.** Every user has, by default, a **single Solid pod**
with three sub-containers:

- `/private/` — ACPs locked to the agent. Identity vault
  export, recovery material, per-app personal state, drafts.
- `/sharing/` — per-resource ACPs, default deny. Items the
  user wants to share with specific people or crews.
- `/sharing/public/` — world-readable, owner-write. Profile
  card, public skills, announcements.

New users get this layout on first-time install — one OIDC
flow, one URL on the WebID profile, one provisioning step.

**Two pods as the prominently-recommended upgrade.** The Hub
setting (in the storage-mapping editor §II.3) surfaces a
one-click preset: "split your data across two separate pods
(recommended for stronger isolation)." Two-pod layout = a
private pod with `/private/` content and a separate sharing pod
with `/sharing/` content, potentially on different providers.
The recommendation is surfaced at first-run completion, in the
audit log, and whenever the user adds a sharing resource — not
buried in advanced settings.

**Why one pod by default.** Simpler onboarding wins for
first-time users who haven't internalised the defence-in-depth
trade-off: one less concept, one URL on the WebID, one fewer
provisioning step. The recommended-upgrade path stays
prominent so users who care about isolation are nudged toward
two pods without being forced.

**Why two pods are worth recommending.** Power users +
privacy-paranoid users do legitimately benefit from two pods,
especially on different providers (a leak of one provider
doesn't expose the other).

**Locked.** One-pod default; two-pod as the prominently-
recommended upgrade. User-configurable mapping (§II.3) supports
any other layout.

**Open.** ACP default templates for the three sub-containers
(should `/sharing/public/` automatically apply world-readable,
owner-write? Probably yes, but the substrate needs to make
this explicit during onboarding so users understand what their
public profile looks like). Migration semantics when a user
upgrades to two-pod: lazy copy + ref rewriting, or eager copy?
Defaults pinned during P1.

**Phase.** Provisioning lands in P1 (`pod-onboarding`
substrate). The upgrade-to-two-pod flow lands in P1's
onboarding substrate; the editor where it surfaces lives in
the Hub-web-console (P5) and Hub-Android (P6).

## §II.2 — Group pods + per-team policy (committed)

**What.** A crew may have a group pod with a standard container
layout — or it may not, depending on the team's chosen policy.
Four policies are supported:

- **Centralised** — group state lives on a group pod.
- **Decentralised + cross-pod refs** — no group pod; each
  member's items live on their own pods; refs link across.
- **Hybrid** — canonical ledger on the group pod; members'
  drafts/notes on their own sharing-containers with refs back.
- **No-pod / pseudo-pod-replicated** — no group pod, no
  per-member pods required. Group state lives as eagerly-
  replicated content across member pseudo-pods; addressed by
  `pseudo-pod://<device>/...` URIs. Best for crews that want
  to try the app without provisioning pods, BLE-only campsite
  crews, and crews that don't want any pod provider in the
  loop. Trade-offs: eager fan-out costs more bandwidth on
  write; durability is the union of online member devices
  (recoverable as long as at least one member device has a
  copy); profile / agent-registry / audit log all live
  pseudo-pod-side.

**The group pod can be any pod.** "Centralised" doesn't mean
"freshly-provisioned dedicated group pod." The group pod URI
can point at:

- A freshly-provisioned dedicated group pod.
- One member's existing personal pod (or a sub-container of
  it). The member becomes the de-facto host; their pod's ACPs
  grant the crew access to the relevant containers.
- A shared personal pod (couple, household) that multiple users
  already access via ACPs, with the crew designating a
  container on that pod as the group store.

The substrate treats all three identically — it just resolves
`group/<crewId>/<container>` to a URI. The product UX surfaces
this flexibility during crew creation ("set up a new group pod"
vs "pick an existing pod" vs "I'll set this up later, use
no-pod for now").

No separate group private side-pod. Admin-private content goes
in two existing patterns: per-member personal containers within
the group pod (admin-provisioned, ACP locked to the member), or
on the user's own private/sharing pod.

**Mixed crews.** The substrate accommodates crews where some
members have pods and others don't — pod-having members write
to their pods + emit envelopes; pod-less members eagerly mirror
into their pseudo-pods. App code is identical in either mode.

**Policies are preferences with graceful degradation (locked
2026-05-11).** The four policies above are **preferences**, not
hard runtime rules. Even a centralised crew member loses
internet sometimes (BLE-only field trip, campsite, train
tunnel). When that happens, the substrate falls back to
pseudo-pod-replicated eager fan-out for that write — the
writer's own pod-write queue holds the resource until the
network returns, then drains. The crew "is" still centralised;
the runtime adapts per-write based on current pod reachability.

The conceptual baseline is **always replication-ring**. Pods
are *promotable members* of the ring that add durability +
ACPs when reachable. This collapses the "what happens when
my pod is unreachable" question — the answer is "the same
thing that happens for a no-pod crew, plus you owe a pod
upload when you're back online." See §II.6 for the wire
shape + queue semantics, §II.7 for the pseudo-pod's mode
semantics.

**Why.** Real teams already work in different patterns
(centralised household ledger vs decentralised neighbourhood
collaboration). Some teams legitimately want the no-pod
experience — try-before-pod, privacy from pod providers,
campsite mode. **And every team needs to work offline
sometimes.** The substrate has to support all four
preferences cleanly + degrade gracefully when connectivity
drops.

**Locked.** Four preferences supported by `pod-routing` +
`notify-envelope` together. Group pod URI is just a URI; can
point at any pod. No group private side-pod. **Graceful
degradation** between pod-mode and replication-ring-mode is
substrate-side, not per-app.

**Open.** Cross-pod ref ACP edge cases (a reader without
permission to fetch a referenced parent — accept the failure,
show a placeholder).

**Open (V2, deferred 2026-05-11) — upload-on-behalf.** When
member A writes a resource offline (BLE-only), the resource
fan-outs through the replication ring. Member B receives it,
is online, and could in principle upload it to A's pod on
A's behalf — closing the gap immediately. V1 doesn't do
this; A's own queue drains when A comes back online. V2 is
where this gets designed. The hard questions:

- **Authority model.** Who has the right to write to A's pod?
  A "pod-shepherd" role per crew? A per-resource grant
  (A signed-off-by-B-on-A's-behalf cap-token)?
- **Conflict resolution.** A writes offline; B writes
  online; both touch the same logical resource at different
  times. When A comes online, whose version wins, and how
  does the loser's content surface?
- **ACP semantics for proxy uploads.** When B uploads A's
  content, whose ACPs apply — A's intent, or B's
  authorisation?
- **Product question.** Is upload-on-behalf even desirable
  in the project's value system? Or is "everyone manages
  their own pod" the durable answer? Probably yes for
  buurt-style crews where some members never get a pod; pin
  during V2 design with stakeholder input.

**Phase.** P1 ships the layout + the routing substrate; P2
extends the cross-pod ref shape on `item-store`.

## §II.3 — User-configurable storage mapping (committed)

**What.** Storage location is a user policy, not a substrate
assumption. The substrate exposes a list of **storage functions**
(things that need a target URI):

- `private/identity-vault`
- `private/state/<app>`
- `private/drafts/<app>`
- `sharing/profile-public`
- `sharing/<resource>`
- `group/<crewId>/<container>`
- `personal-in-group/<crewId>`

Each maps to a URI. The **default policy** routes `private/*`
to `<pod>/private/`, `sharing/*` to `<pod>/sharing/` (with
`sharing/profile-public` going to `<pod>/sharing/public/`),
and `group/*` to the matching crew's group pod — all on one
Solid pod by default per §II.1. **Users can override any
mapping** via the Hub setting. Concrete one-click presets:

- **Default (one pod).** Single pod with sub-containers as
  above.
- **Two pods (recommended for stronger isolation).** Splits
  `private/*` onto a private pod and `sharing/*` onto a
  separate sharing pod.
- **Custom.** Free-form mapping — per-app pods, mixed
  providers, three or more pods, etc.

**Where the config lives — on the pod, not in the Hub.** The
mapping config is a **pod resource** at a well-known path under
the user's anchor pod (default:
`<anchor-pod>/private/storage-mapping`). Reads + writes go
through the pseudo-pod (§II.7) like any other item. The WebID
profile carries a small **pointer** (a `storage-mapping-uri`
predicate) telling clients where to fetch the config. This
split is load-bearing:

- The WebID profile stays small and public — pointers, not
  fat state.
- The config resource has its own ACPs (private by default).
- The config follows the user, survives device changes, and
  is editable from **any** pod-aware tool — not just the Hub.
  The Hub is the editor *surface*; the config doesn't *live*
  in the Hub. A user could edit the resource via a CLI, a
  script, or a third-party Solid editor.

Recovery (mnemonic restore) re-attaches by walking the WebID
profile, following the `storage-mapping-uri` pointer, and
reading the resource via the pseudo-pod. Cross-user lookups
(when Bob's agent needs to find Anne's sharing storage) resolve
the same way: walk Anne's WebID profile to the pointer, fetch
the resource (subject to ACPs), read.

The same "pod resource + WebID pointer" pattern holds for the
**agent registry** (§II.8) and the **audit log**. Each lives at
its own pod path with its own ACPs; the WebID profile carries
pointers. The Hub is **stateless on the device** for all of
these configs.

**Why.** Different users have legitimately different needs:
power users want fine-grained control over which provider hosts
which data; testers want try-without-a-pod simplicity;
security-paranoid users want multiple pods on different
providers; simplicity-minded users want one pod. The substrate
shouldn't bake one shape in.

**Locked.** Storage-function abstraction; default policy is
one-pod with sub-containers; two-pod preset as the
prominently-recommended upgrade; user-configurable via Hub
setting; mapping config is a pod resource at
`<anchor-pod>/private/storage-mapping`, pointed at from the
WebID profile, accessed via the pseudo-pod; Hub is the
editor surface, never a state owner.

**Open.** UX for the custom editor — first-run onboarding stays
opinionated (one tap, one pod); the editor is in advanced
settings with the two-pod preset hoisted to one-click status.
The exact set of storage functions is finalised during P1
implementation as concrete substrates surface their needs.

**Phase.** P1 ships the substrate + default policy + the
upgrade-to-two-pod preset. The custom editor in the
Hub-web-console lands in P5; the Hub-Android gets the same
surface in V2 (P6).

## §II.4 — Cross-pod references (committed)

**What.** Items can reference other items by URI, including
across pods, apps, and domains. A Stoop neighbourhood-job can
link to a Tasks task; a Tasks subtask can live on the spawner's
pod with a ref to the parent on someone else's pod.

**Why.** This is what makes "decentralised + cross-pod refs"
viable as a per-team policy, and what makes the destination
shape (apps as bundles linking to each other's items) work.

**Locked.** Item IDs gain URI semantics; the substrate resolves
refs via the routing layer; permission checks happen on both
ends.

**Open.** None at the architectural level. Specific cross-pod
edge cases get pinned during P1 implementation.

**Phase.** P1 (substrate shape); P2 (cross-app ref usage).

## §II.5 — Pod onboarding + WebID-discovery (committed)

**What.** A one-tap "create my pod" flow that provisions the
one-pod default layout via a pre-tested provider list,
registers the pod on the user's WebID profile, and binds the
Hub or desktop agent to it via a single OIDC flow. The
provisioning UI also surfaces the two-pod upgrade as the
recommended option for users who want stronger isolation, with
a one-click "split now" or "stay on one pod (default)."
Mnemonic restore re-attaches by walking the WebID profile and
re-reading the storage mapping pointer.

**Why.** Without easy onboarding, the data layer ships behind a
wall. With easy onboarding, every app inherits a working store.

**Locked.** WebID-discovery is the single source of truth for
"what pods does this user have" (when a user has pods at all).
Hub-as-keymanager (in the softened sense — see §II.8) brokers
tokens. Default flow provisions one pod; two-pod is a
one-click upgrade on the same screen. No-pod users skip this
entirely and run on pseudo-pod (§II.7) alone.

**Open.** Multi-IDP edge cases when pods come from different
providers; profile docs that don't follow the standard layout.

**Phase.** P1 ships the substrate; both Hub-Android (P4) and
Hub-web-console (P5) consume it.

## §II.6 — Persistent-write patterns (committed)

**What.** Three patterns coexist for moving content between
agents, picked **per-write** by the substrate (`notify-envelope`
+ `pod-routing`) based on **three inputs**:

1. The content's nature (ephemeral vs persistent).
2. The crew's §II.2 policy *preference* (centralised /
   decentralised / hybrid / no-pod).
3. **Current pod reachability for this writer + their
   recipients** (added 2026-05-11).

App code is identical in all three; the substrate handles
the picking + graceful degradation.

- **Relay-fan-out of full content** — for ephemeral,
  latency-critical, online-only content: live chat messages,
  presence / typing indicators, audio + video streams,
  skill-match broadcasts + claim races, hello handshake.
  Archived to pod after the fact when durability matters
  (chat archives, audit-log mirrors).
- **Pod-primary writes + envelope notifications** — for
  persistent, reference-able, ledger-shaped content in crews
  with at least one pod (centralised, decentralised, or hybrid
  policy per §II.2): task ledger writes, supply/demand items,
  calendar emissions, profile changes, audit log entries,
  MemberMap updates, protocol state. The writer writes to the
  appropriate pod; emits a small envelope
  (`{kind, ref, etag, timestamp, fromActor}`) via the relay;
  recipients fetch by ref when they want to.
- **Pseudo-pod-replicated eager fan-out** — for persistent
  content in no-pod crews (§II.2 policy 4) **AND** for any
  write where the writer's pod (or the crew's group pod) is
  currently unreachable. The writer writes to their own
  pseudo-pod; the relay (or BLE / mDNS in fully-local mode)
  fan-outs the full payload eagerly to every reachable
  member; recipients store it in their own pseudo-pod and
  write an envelope into their local store. Durability is
  the union of online member devices; recoverable as long as
  at least one member has a copy.

The envelope wire format and item shape are the **same** across
the pod-primary and pseudo-pod-replicated modes; the difference
is the canonical store and the eagerness of the transfer.

### Graceful degradation across pod / no-pod modes

When a pod-having crew's writer can't reach the pod
(offline; BLE-only; train tunnel; pod provider down), the
substrate falls back to **pseudo-pod-replicated eager
fan-out for that write** and the writer's own
*pending-pod-upload queue* keeps the resource until the
network returns. On reconnect, the queue drains: each
pending resource is written to the pod, and a fresh
envelope is emitted to crew members so they can switch
their local cache entry from "ring-replicated" to
"pod-canonical."

Recipients receiving a ring-replicated payload don't know
or care whether the writer was offline by choice (no-pod
crew) or by circumstance (pod-having crew, momentarily
offline) — the wire shape and the receiver-side behaviour
are identical. Pseudo-pod's replication-ring mode is
therefore the **universal baseline**; the pod is a
*promotable ring member* whose participation is gated by
reachability.

This makes the four §II.2 policies **runtime-soft**: a
pod-having crew never loses offline capability. The pod is
where durability + ACPs come from when it's reachable; the
ring is what keeps the crew functioning otherwise.

**Why pod-primary (when a pod exists).** The wins aren't
bandwidth-shaped:

- **Persistence.** Relay queues are bounded; pods aren't. A
  member who joins later or rebuilds a device walks history
  off the pod.
- **Multi-device coherence.** A user with phone + desktop gets
  one canonical store both devices read from.
- **Deferred reading.** The envelope says "look at this when
  convenient"; the content downloads only when the recipient
  actually opens it.
- **Privacy from the relay.** The relay sees envelopes (refs),
  not payloads. Content stays on the user's own pod.
- **Cross-ref resolution.** Pod URIs are how cross-app refs
  work natively. Relay fan-out would need a parallel fetch
  protocol.
- **Granular permissions.** Pod ACPs are per-resource. Relay
  fan-out is per-message-to-recipient-list — less expressive.
- **Deduplication.** Recipients who already have the resource
  cached skip the download.

**Why pseudo-pod-replicated (when no pod).** Crews can ship
without anyone provisioning a pod. Group state survives across
the union of member devices. The trade-off — eager fan-out
costs more bandwidth, durability is bounded by member uptime —
is the cost of pod-independence.

**Locked.** Three patterns; substrate picks per-write based
on (content-nature, crew policy preference, current
reachability). Graceful degradation between pod-primary and
ring-replicated is substrate-side, not per-app. App code is
the same across modes.

**Open.** Latency tuning on real devices, especially the
envelope-to-fetch round trip for users who genuinely want
zero-deferred reading. Bandwidth tuning for no-pod crews at
scale (eager fan-out is O(N) per member device).
Reachability-check heuristics — how does the substrate decide
"my pod is unreachable" cheaply enough to gate every write?
Pin during P1 implementation; default proposed is "last
successful pod request within N seconds + currently no
transport-level disconnect event since."

**Open (V2, deferred 2026-05-11) — upload-on-behalf.** V1's
graceful degradation drains the writer's *own* pending queue
to the writer's *own* pod on reconnect. V2 considers letting
**a different member** upload the writer's content on the
writer's behalf — closing the durability gap when the writer
themselves stays offline for an extended period. See §II.2's
"Open (V2)" block for the design questions (authority model,
conflict resolution, ACP semantics for proxy uploads,
product fit).

**Phase.** P1 ships the three patterns under `notify-envelope`
+ `pod-routing`. P3 retires the legacy app-specific
fan-out paths.

## §II.7 — The pseudo-pod (committed)

**What.** A Solid-shaped local store hosted by the agent.
Single read path everywhere, three operating modes (same API
in all three):

- **Cache for a real pod.** Write-through queue against the
  user's pod when attached; transparent caching of reads.
- **Standalone.** No upstream pod; pseudo-pod is the canonical
  store for one user on one device. Try-before-pod;
  single-user testing.
- **Replication ring with peer pseudo-pods.** For no-pod
  crews (§II.2 policy 4). The pseudo-pod is the canonical
  store for content authored on this device, and the cache
  for content authored on peer devices. Inbound full-payload
  eager fan-out (§II.6) writes resources into the local
  pseudo-pod; outbound writes get fan-outed.

**Why.** One read path everywhere — apps don't branch on "are
we pod-attached." Online/offline transitions are one concept
(the pseudo-pod's write-through queue starts/stops draining).
A user testing the app for a week without a Solid provider has
the full surface. A campsite crew on BLE only also works.

**Hosting.** On mobile pre-Hub, the agent serves a "fetch
resource" skill on its existing transport stack; peers reach
the pseudo-pod the same way they'd reach a real pod. Post-Hub,
the Hub-Android hosts a single pseudo-pod the device's bundles
share. On desktop web, each agent process hosts its own
pseudo-pod for its own crew.

**Locked.** Single read path; three modes in one substrate;
skill-based hosting on agents.

**Open.** Auth semantics for pseudo-pod reads when the requester
is a third-party app (cap-token bridges); pinned during P1.

**Phase.** P1 ships V0 (read-path facade, standalone +
replication-ring). P3 ships V1 (real-pod backend + write-through
queue + sync semantics).

## §II.8 — Identity model: multiple agents, one WebID (committed)

**What.** A user is anchored by their WebID. Each device, each
bot is its own agent with its own keypair. Pod writes carry
both the WebID's OIDC authorization *and* the agent's
signature on the content — the WebID authorizes the write to
the pod, the agent's signature lets audit say which agent
authored it.

**Where the agent registry lives — same pattern as
storage-mapping (§II.3).** The agent registry is a **pod
resource** at a well-known path under the user's anchor pod
(default: `<anchor-pod>/private/agent-registry`), accessed via
the pseudo-pod. The WebID profile carries a small **pointer**
(an `agent-registry-uri` predicate). Each agent's keypair,
role, and capability-requirements declarations are entries in
that resource; the WebID profile itself stays small. Agents
register themselves by writing to a pod resource, not by
editing the WebID profile directly — which both keeps the
public profile tidy and matches the Hub-stateless story.

Bots have their own OIDC tokens issued via a management
surface. Per-bot revocation works by deleting the bot's
registry entry + revoking its tokens. The bot itself holds its
own refresh token so it doesn't depend on a phone or desktop
being alive to keep writing.

**Why.** Audit precision (which agent wrote it) without losing
the simple pod-ownership model (the WebID owns the pod). Bots
become first-class without faking the user's identity.
Cap-tokens stay useful for scoping skill calls. The WebID
profile becomes a small **pointer document** every device reads
on first connect — names, pointers to heavy resources, nothing
fat. The Hub never holds canonical identity state either; the
agent registry on the pod is the source of truth.

**Locked.** Agents are first-class signers; no "the Hub holds
master tokens" — each device authenticates independently and
brokers for itself + the bundles installed on it.

**Open.** WebID-profile contention (two surfaces editing
concurrently) handled via etag-based optimistic concurrency on
the agent-registry substrate. **Multi-app concurrency** is a
sharper version of this: in the Hub-free interim path (§III.D),
three separate apps may write to the registry to register their
agents — the substrate's etag story needs a design pass during
P5 to make sure multi-writer-without-single-coordinator works
cleanly.

**Phase.** P5 ships `agent-registry`. The Hub V1 (P4) registers
itself on first run. Personas (a third tier above agents)
deferred — viable to layer on later.

## §II.9 — Mobile-independence + the Hub split (committed)

**What.** The Hub functionality splits along a device-dependence
line.

- **Hub-Android** — the user's primary mobile agent + the
  device's foreground-service slot, relay socket, BLE/mDNS
  scanners, pseudo-pod host. Agent-shaped.
- **Hub-web-console** — a browser-reachable management
  dashboard. Same management views as the Android Hub (agent
  registry, bundle list, audit log, profile editor, recovery,
  storage-mapping editor), no transport stack, no foreground
  service. Not an agent — a console.

A user with a dead phone can OIDC-auth on the web console from
any browser, revoke the phone's keypair, and continue.

**Why.** Mobile-independence is a hard requirement. Solid pods
make it feasible (server-side canonical store; per-device
sessions are normal). Without it, "phone dies → data fabric
becomes unmanageable" is a real failure mode.

**Locked.** Two surfaces; no "canonical user agent" privileged
above the others. The Android Hub is special only because of
the mobile-only transport role, not because it owns identity.

**Open.** Drift between the two surfaces is a risk — both must
stay feature-aligned for management views. Mitigation: shared
`agent-registry` substrate underneath; UI is the only thing
that differs.

**Phase.** Hub-Android V1 lands in P4; Hub-web-console V1 in
P5. In the Hub-free interim path (§III.D), neither has shipped
yet — lost-phone recovery is workable but not ergonomic;
mobile-independence is partial (data is accessible from any
device with the app installed, but management of agents/bundles
isn't yet on a dedicated surface).

## §II.10 — Unified taxonomy + cross-app inbox (committed)

**What.** A shared taxonomy enumerates cross-app item types
(message, task, supply-offer, demand-offer, contact, calendar,
…). The unified inbox surfaces every notification flowing
through the user's pods, filterable by sender, app of origin,
type, time, crew. Messages are stored on the pod in an
**app-independent** shape so any consumer can render them.

In the Hub-free interim path (§III.D), the taxonomy substrate
ships and each app uses it for its own inbox; cross-app
aggregation is deferred — that's the Hub's job once V1 ships.

**Why.** The user has one stream of stuff happening, not three
streams (one per app). A unified surface is the natural shape;
per-app inboxes are an implementation accident.

**Locked.** Taxonomy substrate; app-independent message shape;
unified inbox as a Hub surface (V1) and web console surface
(V1).

**Open.** Conflict resolution when two apps think they own the
same type — covered by the destination's interface registry
(§II.13). Pre-destination, the unified inbox lists by type and
apps render their own items.

**Phase.** P2 (substrate + per-app adoption). P4 brings the
cross-app aggregation in the Hub UI.

## §II.11 — Substrate-first codebase + plan-tracking (committed)

**What.** A substrate-first rule replaces the older
rule-of-two policy:

- **Always-substrate**: data structures and communication
  protocols. Items, refs, envelopes, taxonomy enums, status
  mappings, role tables — substrate or it doesn't ship.
- **Substrate when API is stable on first authoring**: a
  helper becomes a substrate when it's pure of platform context
  AND its jsdoc + tests can be written without referencing the
  caller. If both hold, lift on the first consumer.
- **App-local until evidence**: helpers tightly coupled to one
  app's screens or vocabulary stay app-local until a second
  consumer trips.

A canonical app skeleton (desktop shell + sibling mobile shell
re-exporting from `src/ui/`, shared/desktop/mobile locale
bundles) is documented and applied to all three apps.

**Plan-tracking convention** (P0): scan the project for
existing rules; consolidate into `conventions/plan-tracking.md`.
Stable file paths (no renames mid-flight); monotonic phase
numbers (no re-numbering); explicit status tags
(`pending | in-progress | shipped | abandoned`); decision logs
appended, original phase text preserved.

**Why.** Substrates have been doing the load-bearing work this
whole project. Drag is in the helpers kept app-local out of
caution. Plan drift came from absent conventions; encode them
explicitly.

**Locked.** The three-tier substrate-first rule; the canonical
app skeleton; plan-tracking convention authored in P0.

**Open.** Substrate-first creep — every lift looks reasonable
in the moment. Code review pushes back actively. Mitigation:
strict substrate tests + small surface; refactor later if wrong.

**Phase.** P0 (plan-tracking convention); P5 (substrate-first
policy roll-out + Stoop/Folio align). Both are Hub-independent.

## §II.12 — Developer experience (mixed)

**What.** Two parts:

- **(committed, P5 — V0 shipped 2026-05-14)** A scaffolder CLI
  that generates the canonical app skeleton + wires standard
  substrates. Each substrate ships a metadata module describing
  its public API in a shape the scaffolder can read — doc-driven,
  but immediately useful. **V0 shipped 2026-05-14** as
  `scripts/scaffold-app.mjs` (hard-coded templates; Node-side
  hello-world that boots `core.Agent` + InternalTransport + one
  `hello` skill; the scaffolded app's `npm test` passes out of
  the box; 10 scaffolder tests in
  `packages/integration-tests/test/scenarios/scaffolder/`).
  Per-substrate `SCAFFOLDER_META` exports + flag-driven substrate
  wiring + RN/Expo + web templates remain V1+ work.
- **(direction, post-P6)** A successor scaffolder for the
  bundle shape (§II.13). The longer arc — "developer sketches a
  functional surface in JS and the SDK generates web + RN
  scaffolding" — is tracked as a successor plan, not committed
  here.

**Why.** Friction shapes adoption. Scaffolding a new app today
requires reading a dozen substrate READMEs and copying
skeletons from existing apps. A CLI that does it right cuts the
first-day cost dramatically.

**Locked.** P5 scaffolder. Bundle scaffolder is direction-only.

**Open.** API stability of the bundle shape (decided at P6 time
based on what the interface registry + protocol substrate
need).

**Phase.** P5 ships the first scaffolder. P7+ ships the
bundle one.

## §II.13 — Destination: interface registry + protocols + bundles (direction)

This section is the largest in the doc because the destination
shape touches several concerns at once. Sub-headers below split
the body; the standard "Locked / Open / Phase" tags appear at
the end. The Hub-track consolidation (§II.14) presents this
content alongside the operational view.

**What.** Three substrate-level concepts that turn the platform
from "shared codebase" into a personal data layer with
pluggable apps:

- **Per-type interface registry.** For every item type, there
  is a canonical interface (renderer + action handlers). Tap
  an item → the Hub looks up its type → shows the registered
  interface. **Per-type, not per-item** — items don't carry
  their preferred renderer inline, because that would let a
  sender ship arbitrary UI to a receiver. Conflicts between
  multiple bundles registering for the same type are resolved
  by Android's standard "default app for type" picker
  (§I.5.6), not by Hub-internal settings.
- **Protocols as a substrate.** Multi-step processes (a
  negotiation, a propose-subtask flow, a calendar invite that
  needs N members to accept) are state machines that operate
  on items and emit new items. State persisted as items on the
  pod. Hub orchestrates lifecycle.
- **Apps as bundles.** A bundle is an Android-installable
  package declaring (item types + registered interfaces +
  declared protocols + skill bodies + locales). Install is a
  Play Store install; registration is automatic on first
  launch via Android IPC. Uninstall removes the bundle's
  entries from the Hub's registries; the underlying item data
  on the pods stays.

**Why.** The destination is a personal data layer where the
user owns the data and apps are lenses + protocols layered on
top. The user's day-to-day surface is the Hub; "opening Tasks"
means filtering the Hub's stream by app and using the Tasks-
registered renderers + protocols. Clean install / uninstall
semantics. Cross-app data linking (a Stoop neighbourhood-job
that concludes with a Tasks task) becomes natural.

### How bundles ship on Android

Bundles are normal Android APKs distributed via Play Store. The
Hub-as-loader-of-arbitrary-JS shape that the
[Play Store risk audit](./play-store-risk-2026-05-07.md) rates
as **🛑 blocked-as-designed** is explicitly avoided — the
prohibited pattern is "webview with added JavaScript Interface
that loads untrusted web content or unverified URLs." Separate
APKs talking to a Hub via Android IPC sit comfortably outside
that policy and are well-precedented (Tasker + AutoApps,
F-Droid client, launcher integrations).

Each bundle ships as a single APK that works **either**
standalone (when the Hub isn't installed) **or** as a
registered bundle (when the Hub is). The runtime mode is
detected at launch via `PackageManager`. Install size doesn't
change between the two modes — the APK ships both code paths.
What changes at runtime is battery draw, memory footprint, and
the number of background processes per device. With the Hub
present, one foreground service is shared across all bundles
instead of one per app. Shrinking install size further is
explicitly deferred — revisit only if real users complain.

### How bundles communicate with the Hub (IPC surface)

The Hub exports a **bound Service** with an AIDL-defined
interface. Bundles discover the Hub via
`PackageManager.queryIntentServices()` looking for a well-known
intent action, bind, and call methods on the resulting binder.
Standard Android pattern; no native dependencies beyond the
platform's IPC machinery.

The interface is small and declarative. Bundles call into the
Hub to:

- **Register** their manifest (declared item types, registered
  interfaces, declared protocols, skill bodies).
- **Declare capability requirements** (polling cadence,
  wake-on-event subscriptions, foreground-service expectations,
  socket retention). The Hub aggregates across all installed
  bundles and picks the tightest schedule that satisfies the
  union.
- **Read / write** pod resources via Hub-brokered authenticated
  fetches — the bundle never sees OIDC tokens, just calls
  `fetchResource(uri)` / `writeResource(uri, bytes)`.
- **Publish** notification envelopes — the Hub fans out via
  relay.
- **Search** across the user's pods (`pod-search` substrate;
  see §III.B).

Reverse direction (Hub → bundle): the bundle registers an
incoming-event callback at bind time; the Hub invokes it when
relevant envelopes arrive.

Bundle access is gated by a Hub-declared custom Android
permission plus signature verification of the binding app — a
malicious app can't masquerade as a bundle. The AIDL surface is
versioned (`IHub_V1`, `IHub_V2`, …); graceful degradation in
both directions.

### Two-mode rendering

Every type's registered interface ships **two** rendering modes,
not one:

- **Compact mode** (chip / row / card). A small fixed-shape
  preview, used when the item appears *inside* another item —
  as a link in a chat message, as an attachment to a task, as
  a row in a search result. Bounded size, bounded layout.
- **Full mode** (detail view). The complete UI for the item,
  used when the user opens it.

This is how Slack / Discord / Telegram / Notion render embedded
links: a small unfurled card inline; a full page when you
click through. A chat-message renderer doesn't have to know
how to render a task — it asks the interface registry for
"render this ref in compact mode," and the registered task
renderer handles it. The interface registry contract requires
both modes from any bundle that registers a type.

### Cross-bundle data — search, embed, graceful permissions

Three small, related capabilities make cross-bundle linking
useful: cross-pod search (`pod-search` substrate, lives inside
the pseudo-pod), embed-by-ref (every item type's schema has a
standard `embeds: [{type, ref}, …]` field), and graceful
permission failure on the recipient side (when fetching an
embedded ref returns 403/404, the interface registry's default
permission-denied rendering kicks in — same pattern Google
Docs / Notion / Linear use). The sender doesn't pre-check
permissions; an opt-in "grant access on send" lets them widen
ACPs as an explicit side effect.

### F-Droid future track for dynamic-loaded bundles

The brainstorm's truly-tiny-plugins dream — paste a URL, get a
new bundle running — is **not Play-distributable**. F-Droid
(and direct sideload) operate outside Google's Device and
Network Abuse policy. A Hub variant distributed through F-Droid
could allow the dynamic-bundle-loading shape Google prohibits.
Same codebase as the Play variant; different feature flags. Not
committed to a date; tracked as a long-arc distribution-channel
addition.

### Locked / Open / Phase

**Locked.** Per-type registry (not per-item) for security.
Compact + full rendering modes contract. Protocols as
substrate-level (not app-private, not user-level). Apps as
separately-installed Android bundles distributed via Play
Store; runtime detection of the Hub via `PackageManager`;
binding via AIDL-defined bound service with custom permission
+ signature verification. Embed-by-ref as a standard field on
every type. Send-anyway with graceful permission failure on
the receiver side. F-Droid track parked as future direction.

**Open.** Protocol substrate API stability (state machines are
notoriously hard to design abstractly); P6 ships V0 with one
consumer (Tasks `propose-subtask`) so the API gets shaped
against a real load-bearing case. AIDL surface versioning
discipline (locking V1's shape is load-bearing — V2 has to be
additive). Capability-requirements default values. Compact-mode
taxonomy (chip/row/card now; banner/hero/miniature later if
needed). Embed-depth limits (probably 1 level of nesting to
start). Bundle-refactor scope sized at "as long as it takes,"
done one app at a time starting with the smallest.

**Phase.** P6 ships interface-registry + protocol substrates +
the AIDL surface + Hub V2. P7+ refactors existing apps into
bundle shape, rolling.

## §II.14 — The Hub: consolidated view (mixed: committed for V1; direction for V2)

The Hub spans multiple features (mobile-independence in §II.9,
identity in §II.8, destination shape in §II.13, pod hosting in
§II.7, inbox aggregation in §II.10). This section is the
**consolidated reference** — what the Hub is operationally,
what V1 vs V2 ship, and where it sits in the phasing relative
to the Hub-free interim path (§III.D).

**Status of the Hub track.** Functional design is substantial:
the [Hub functional sketch](./AgentHub/hub-functional-sketch-2026-05-07.md)
pins the architecture (single Android foreground-service host;
binding protocol for installed apps; audit-timeline home;
FG-service multiplexing). The Hub-Android + Hub-web-console
split (§II.9), Hub-as-keymanager in the softened sense
(§II.8), and AIDL bound-service IPC (§II.13) round out the
design. The track is **design-mature**; what's not committed
is the **timing** — gated on the substrate work in P0–P3
landing first.

**What the Hub is, in one paragraph.** A single Android app
that owns the user's relay socket, BLE/mDNS scanners,
foreground-service notification slot, and (in V2) the
device-wide pseudo-pod hosting + interface dispatcher +
protocol orchestrator. The user's primary mobile surface.
Installed apps (bundles) detect the Hub via Android
`PackageManager` and bind via AIDL; in absence, they run
standalone. A companion **Hub-web-console** lives at a known
URL (`console.<provider>` or similar); browser-reachable, no
transport stack, no foreground service — its job is
device-independent management of the agent registry, bundle
list, audit log, profile editor, recovery flow,
storage-mapping editor.

**The Hub is stateless on the device for all canonical state.**
Storage mapping, agent registry, audit log, and bundle list all
live as **pod resources** (§II.3, §II.8) accessed via the
pseudo-pod. The Hub provides editor UIs over those pod
resources; it doesn't replicate or own them. A user could in
principle manage any of them via a CLI, a third-party Solid
editor, or a competing Hub implementation — the Hub is a
privileged client, not a source of truth. This is what makes
lost-phone recovery and cross-device coherence work without
resync ceremony: nothing on the phone was canonical.

### Hub-Android V1 (P4) — what ships

- **Auth.** One OIDC flow against the user's WebID; per-device
  tokens.
- **Foreground-service slot** for the device, multiplexed
  across registered bundles.
- **Relay socket multiplexing** — one connection shared.
- **BLE / mDNS scanners** — one set per device, not per app.
- **Unified inbox UI** — aggregates from registered bundles via
  the IPC surface.
- **AIDL surface V1.** Methods: register-bundle,
  declare-capabilities, fetch-resource, write-resource,
  publish-envelope, register-incoming-callback. Versioned.
- **Custom Android permission** for binding; signature
  verification of binding apps.
- **Hub-side pseudo-pod hosting.** Bundles on the device share
  one pseudo-pod.
- **Pod-onboarding flow.** First-run provisioning per §II.5.

Deferred from V1 (lands in V2 or later): persona switcher
(personas tier deferred per §II.8); audio/video stream UIs;
the destination shape (interface registry, protocols,
bundles-as-renderable-units).

### Hub-web-console V1 (P5) — what ships

- **Browser app at a known URL.** No native code, no transport
  stack, no foreground service.
- **OIDC-auth** against the user's WebID; reads the profile.
- **Agent registry view + revoke + add-a-bot flow.** Per §II.8.
- **Bundle list** (read-only on V1: shows which bundles are
  registered with the user's Hub-Android, if any).
- **Audit log per agent.**
- **Profile editor.**
- **Recovery flow** (mnemonic restore).
- **Storage-mapping editor** (§II.3, including the one-click
  two-pod upgrade preset).

### Hub V2 (P6) — direction

Both surfaces extend with the destination shape (§II.13):

- **Interface registry** (per-type, compact + full rendering
  modes).
- **Protocol substrate** orchestration (state machines).
- **Plugin registrar** (bundles register types, interfaces,
  protocols).
- **Web console** adds: read-view of registered interfaces +
  protocol state.
- **AIDL V2** — additive extensions for protocol orchestration
  + interface registration.

### How the Hub track relates to the Hub-free interim

The substrate work in P0–P3 + the non-Hub portion of P5 lands
**before** the Hub track. During that interim:

- Apps continue to provision their own pods, hold their own
  OIDC tokens, run their own foreground-service slot, render
  their own inbox.
- The substrate foundation is in place (storage standardisation,
  pseudo-pod, persistent-write patterns, cross-pod refs,
  taxonomy, agent-registry).
- When the Hub V1 (P4) starts, it consumes those substrates;
  it doesn't build them.

The Hub-free interim path is articulated in §III.D. The Hub can
begin any time after P1 ships; realistically starting after P3
+ non-Hub P5 gives the cleanest base.

### Open questions specific to the Hub

- **Bundle discovery UX** without dynamic loading. Curated list
  in the Hub? Federated index? Friend shares a Play link in a
  message? Project-run "recommended bundles" page?
- **AIDL versioning discipline.** Locking V1 is load-bearing —
  V2 has to be additive; deprecation policy needs design.
- **Capability-requirements defaults.** Conservative (5-minute
  polling, no socket) vs permissive (always-on socket). Battery
  vs UX trade-off; revisit on real-device measurements.
- **Lost-phone-without-web-console UX.** During the Hub-free
  interim, recovery has no dedicated surface. Workable via
  direct API calls or other apps, but the dedicated UX lives
  in Hub-web-console (P5).
- **Migration when the Hub becomes available** to users who
  ran standalone apps for months. State migration from per-app
  pseudo-pods to the Hub-hosted device pseudo-pod is a one-time
  op; pin during P4 design.

### Reference docs

- Functional sketch:
  [`AgentHub/hub-functional-sketch-2026-05-07.md`](./AgentHub/hub-functional-sketch-2026-05-07.md)
- Earlier design:
  [`AgentHub/agent-hub-design-2026-05-05.md`](./AgentHub/agent-hub-design-2026-05-05.md)
- Monitoring design:
  [`AgentHub/monitoring-design-2026-05-07.md`](./AgentHub/monitoring-design-2026-05-07.md)
- Weight & cost impact:
  [`AgentHub/weight-and-cost-impact-2026-05-07.md`](./AgentHub/weight-and-cost-impact-2026-05-07.md)
- Distribution sketch (merged into §II.13):
  [`bundle-distribution-android-2026-05-11.md`](./bundle-distribution-android-2026-05-11.md)

---

# PART III — Implementation

## §III.A — Phasing

Phases tagged **(Hub-free)** can ship without the Hub track
having started. Phases tagged **(Hub track)** are part of
§II.14's Hub deliverable. The Hub track can begin any time
after P1 ships; realistic ordering is "after P3 + non-Hub P5."

| Phase | Window | Track | Deliverables | Substrates introduced | Exit |
|---|---|---|---|---|---|
| **P0** | 1 wk | Hub-free | Scan project for plan-tracking rules; author `conventions/plan-tracking.md`; backfill existing tracks | — | Every plan doc parses against the convention; this plan flips to (binding) |
| **P1** | ≈4 wk | Hub-free | One-pod default + sub-container layout; two-pod upgrade preset; storage-function abstraction; cross-pod refs on item-store; pseudo-pod V0 (all three modes); Tasks ledger routes through `notify-envelope` per crew policy | `pod-onboarding`, `pod-routing`, `pseudo-pod`, `notify-envelope` | Tasks works against the new layout; one cross-pod sub-task with hard-deps gate; campsite mode works via standalone pseudo-pod; one no-pod crew round-trips writes via pseudo-pod-replicated mode; users can opt up to two-pod via one click |
| **P2** | ≈3 wk | Hub-free | Cross-app taxonomy; per-app inbox using shared types; Stoop + Folio writes through the same taxonomy | `item-types` | Per-app inboxes across Tasks/Stoop/Folio show entries shaped consistently (cross-app aggregation lands later with the Hub) |
| **P3** | ≈4 wk | Hub-free | Pseudo-pod V1 (real-pod backend + write-through + sync); Stoop's `groupMirror` work absorbed into `notify-envelope` + `pseudo-pod` (no-pod crew capability preserved); chat-archive mirror | (extends `pseudo-pod`) | All three apps pod-primary on real device pair for pod-having crews; no-pod crews still work via pseudo-pod-replicated mode; latency parity with current local-only; campsite → online drains queue cleanly |
| **P5 (non-Hub portion)** | ≈3 wk | Hub-free | `agent-registry` substrate (pod-resource backed); substrate-first policy locked; Stoop + Folio align to canonical skeleton; first scaffolder CLI | `agent-registry` (incl. capability-requirements field) | All three apps fit canonical skeleton; CLI scaffolds working hello-world; agents register on the pod from any app (multi-writer-without-Hub design pass complete) |
| — | — | — | **Hub-free interim path complete here (see §III.D)** | — | — |
| **P4** | ≈6 wk | Hub track | Hub-Android V1 (auth + sockets + BLE + inbox + AIDL surface V1 + pseudo-pod hosting); existing apps gain runtime detection + register-as-bundle path | (consumes existing) | Tasks + Stoop run Hub-attached; one foreground-service slot owns the relay socket; bundles detect the Hub on launch and bind |
| **P5 (Hub portion)** | ≈2 wk | Hub track | Hub-web-console V1 (incl. storage-mapping editor with two-pod upgrade preset) | (consumes `agent-registry`) | Lost-phone recovery works via console; storage-mapping editable from a browser |
| **P6** *(direction)* | ≈5 wk | Hub track | Interface registry (compact + full modes contract); protocol substrate; cross-pod search; AIDL surface V2 (additive); Hub V2 on both surfaces; refactor one item type + one protocol as canonical references | `interface-registry`, `protocol`, `pod-search` | Hub renders a `task` via registered interface; propose-subtask flow runs as declared protocol with state on the pod; one bundle (Tasks) embeds + renders refs of another's type |
| **P7** *(direction)* | rolling | Hub track | Apps-as-bundles refactor, one at a time; bundle scaffolder CLI | (none new) | All three apps shipped as bundles; binding protocol is the only entry into the Hub |

## §III.B — Substrate inventory

Names are **suggestions for roles**, not commitments — final
names follow [`Substrates/policies.md`](./Substrates/policies.md).

| Role | Suggested name | Status | Phase | Hub-coupled? |
|---|---|---|---|---|
| Solid-compatible local read/write surface with three modes: cache-for-real-pod, standalone, replication-ring-with-peers | `pseudo-pod` | new | P1 V0, P3 V1 | no |
| Default-layout provisioning (one pod with sub-containers) + two-pod upgrade preset + WebID-discovery + recovery walk | `pod-onboarding` | new | P1 | no |
| Storage-function → URI mapping; user-policy layer; reads canonical config from the pod resource `<anchor-pod>/private/storage-mapping` via pseudo-pod; WebID profile carries pointer only | `pod-routing` | new | P1 | no |
| Cross-app type taxonomy + filter primitives | `item-types` | new | P2 | no |
| Tiny `{kind, ref, etag, …}` envelope shape + p2p encoding; picks per-write wire mode (pod-primary lazy envelope, pseudo-pod-replicated eager full-payload) from crew's §II.2 policy | `notify-envelope` | new | P1 | no |
| Agent list + cap-token issuance + capability-requirements aggregation + etag concurrency; canonical state is a pod resource (`<anchor-pod>/private/agent-registry`); WebID profile carries pointer only | `agent-registry` | new | P5 (non-Hub portion) | no (consumed by Hub) |
| Per-type renderer registry; compact + full modes contract; default permission-denied rendering | `interface-registry` | new (direction) | P6 | yes |
| State-machine substrate (input items → output items, pod-persisted) | `protocol` | new (direction) | P6 | yes |
| Cross-pod search across user-accessible pods (lives inside pseudo-pod for cache reuse) | `pod-search` | new (direction) | P6 | yes |
| URI-scheme-routed pod facade (`https://...` vs `pseudo-pod://...`) | (extends `pod-client`) | changed | P1 | no |
| URI-shaped IDs + cross-pod lookup; standard `embeds: [{type, ref}, …]` field on every type schema | (extends `item-store`) | changed | P1 / P6 | partly |
| Slim push payloads to envelope shape | (extends `notifier`) | changed | P3 | no |
| Cache-warming follows refs across pods | (extends `sync-engine` / `sync-engine-rn`) | changed | P3 | no |

## §III.C — Risks

| Risk | Owning phase | Mitigation |
|---|---|---|
| Cross-pod ref ACP gotchas — reader can't fetch a referenced parent | P1 | Accept the failure; show "permission needed" placeholder; measure how often this hits |
| Pseudo-pod auth for third-party readers / cap-token bots | P1 | Design pass at P1 implementation; substrate carries auth-bridge primitives |
| WebID-discovery edge cases — multi-IDP, non-standard profile shapes, post-migration redirects | P1 | One-week design pass before substrate ships |
| User overrides default storage mapping into an unsafe layout (e.g. private data on a less-trusted pod, or one-pod with mis-set ACPs) | P1 / P5 | Hub setting shows the trade-off on each change; default stays one-pod with sensible sub-container ACPs; warning on save when the new layout reduces isolation |
| Default ACPs on `/sharing/public/` accidentally too permissive | P1 | Onboarding explicitly shows what's in the public container; substrate ships conservative defaults; user has to confirm if they want broader |
| Multi-writer-without-Hub concurrency on the agent-registry pod resource (three apps writing in interim) | P5 (non-Hub portion) | Design pass on `agent-registry`'s etag concurrency before substrate ships; explicit conflict-retry semantics; substrate has no implicit "single coordinator" assumption |
| Substrate-first creep — every lift looks reasonable in the moment | P5 | Active code-review pushback; strict tests + small surface; cheap to refactor later if wrong |
| Plan-tracking convention takes longer than 1 week | P0 | Time-box; ship v0 with explicit "this contradicts X" markers if over-running |
| Hub-Android V1 scope creep | P4 | Pin V1 surface tight (auth + sockets + BLE + inbox + binding + pseudo-pod hosting); defer pretty wrappers to V2 |
| Drift between Hub-Android and Hub-web-console management views | P5 (Hub portion) | Shared `agent-registry` substrate; UI is the only difference; co-developed |
| Bundle ↔ Hub IPC version drift (apps and Hub update on separate cycles) | P4 / P6 | AIDL surface versioned (`IHub_V1`, `IHub_V2`); Hub exports all known versions; bundles request highest they understand; explicit deprecation policy |
| Protocol substrate API instability | P6 | Ship V0 with one real consumer (Tasks `propose-subtask`) before opening to other apps |
| Apps-as-bundles refactor scope balloons | P7 | One app at a time; start with Folio (smallest); use it as the reference |
| Pseudo-pod-replicated mode latency / durability parity (no-pod crews) | P3 | Dual-run during transition; parity tests + latency benchmarks before flipping read preference |
| Default capability-requirements values mis-tuned (battery vs UX trade-off) | P6 | Ship conservative defaults (5-minute polling, no persistent socket); bundles that need more declare it explicitly; tune based on real-device measurements |
| Lost-phone recovery UX is rough during Hub-free interim (no web console yet) | P5 (Hub portion) | Document the workaround (direct API call from another device); communicate that mobile-independence is partial in the interim |

## §III.D — Hub-free interim path (committed)

The substrate work in P0–P3 + the non-Hub portion of P5 is
**independent of the Hub track** and can be shipped as a
coherent interim before any P4 work begins. This subsection
articulates what the system looks like at that checkpoint.

**What apps gain in the interim:**

- Standardised storage layout: one-pod default with
  sub-containers; two-pod upgrade preset; group pods +
  per-team policy including the no-pod option.
- Pseudo-pod as the unified read path (cache-for-real-pod +
  standalone + replication-ring with peers).
- Persistent writes adapt per crew: pod-primary + envelope for
  pod-having crews; pseudo-pod-replicated eager fan-out for
  no-pod crews.
- Cross-pod refs as a first-class concept on `item-store`.
- Cross-app taxonomy (`item-types`); each app's own inbox uses
  it.
- Substrate-first codebase shape across all three apps.
- Identity model: each app's agent registered in the pod's
  agent-registry resource.
- Standardised app skeleton + scaffolder CLI.

**What apps DON'T gain in the interim (deferred with the Hub):**

- **Cross-app unified inbox view.** Each app keeps its own
  inbox; items are shaped consistently (`item-types`) but no
  Hub aggregates them.
- **Single foreground-service slot for the device.** Each app
  keeps its own — N apps = N service notifications.
- **Hub-as-keymanager.** Each app keeps doing its own OIDC
  flow (when pod-having); users may end up with multiple
  per-app sessions against the same WebID.
- **Hub-web-console.** No dedicated lost-phone recovery; no
  storage-mapping editor in a browser; no audit log view.
  Workable via direct API calls or by going through one of
  the installed apps.
- **Destination shape.** No interface registry, no protocol
  substrate, no apps-as-bundles refactor.

**Why this path makes sense.** The substrate foundation is
load-bearing for the Hub — without it, the Hub work would be
harder, not easier. The interim gives apps the real-user wins
(storage standardisation, transport efficiency, cross-pod data,
codebase coherence) without taking on the heaviest single phase
(Hub V1). When the Hub does ship later, it consumes the
substrate work rather than rebuilding it.

**Risk to watch.** §II.8's identity model assumes the
`agent-registry` substrate handles multi-writer concurrency
cleanly. In the interim, three separate apps may write to the
registry (each registers its own agent) without a single
coordinator. Design pass during P5 (non-Hub portion) to ensure
the etag-based concurrency works without surprises.

**Transition to Hub work.** Hub V1 (P4) can start any time
after P1 ships (since the substrates it consumes — `pseudo-pod`
V0, item-store with URI semantics, `pod-routing`,
`notify-envelope` — are P1 deliverables). Realistically,
starting Hub work after P3 + non-Hub P5 gives the cleanest base.

---

# PART IV — Reference

## §A — Glossary

- **Agent** — process-level instance of `core.Agent` with its
  own keypair. Each device runs at least one. Bots are agents.
  Registered in the user's agent-registry pod resource.
- **AIDL surface** — the Android-IDL-defined interface the Hub
  exports for bundles to bind to. Versioned per Hub release.
  Bundles call into it; the Hub calls back via a registered
  callback.
- **Anchor pod** — the pod whose URL is the user's primary
  storage URL on their WebID profile. Holds the canonical
  config resources (storage-mapping, agent-registry, audit
  log) for pod-having users. In a two-pod layout it's the
  private pod; in a one-pod layout it's the only pod.
- **Bundle** *(direction)* — an app expressed as a Play
  Store-installed Android APK declaring item types, interfaces,
  protocols, skills, and locales. Registers with the Hub via
  Android IPC on launch when the Hub is installed; otherwise
  runs standalone.
- **Compact mode** — small fixed-shape rendering of an item
  (chip / row / card). Used when an item appears embedded
  inside another item.
- **Cross-pod ref** — an item field whose value is a URI
  pointing to another item, possibly on another pod, possibly
  authored by another agent.
- **Default storage policy** — the substrate-shipped mapping
  that routes `private/*` to `<pod>/private/`, `sharing/*` to
  `<pod>/sharing/` (with `public` going to
  `<pod>/sharing/public/`), and `group/*` to the matching
  crew's group pod — all on a single Solid pod by default.
  Users may override; the prominent recommended override is
  the two-pod preset.
- **Full mode** — the complete UI for an item type. Used when
  the user opens an item directly.
- **Hub** — the product surface for the personal data layer.
  Two flavours: Hub-Android (mobile primary surface + transport
  stack) and Hub-web-console (browser-based management
  dashboard). Phasing in §II.14 + §III.A.
- **Hub-free interim path** — the system state after P0–P3 +
  the non-Hub portion of P5 has shipped but P4 hasn't started.
  See §III.D.
- **Interface registry** *(direction)* — per-type mapping
  `(item type, installed bundle) → renderer`; ships compact +
  full rendering modes; resolves cross-bundle conflicts via
  Android's "default app for type" picker.
- **Item type** — a string in the shared taxonomy declaring an
  item's shape. Items declare their type; renderers and
  protocols register against types.
- **No-pod crew** — a crew that has picked the
  pseudo-pod-replicated policy (§II.2 policy 4). Members may
  individually still have personal pods; the crew just doesn't
  require any.
- **Pod** — Solid pod. Owned by a WebID. Default layout: one
  pod per user with sub-containers; two-pod layout as the
  recommended upgrade; group/project pods on top. Group pods
  can be freshly-provisioned, a member's personal pod, or a
  shared personal pod.
- **Protocol** *(direction)* — state machine over items, hosted
  by the Hub.
- **Pseudo-pod** — agent-hosted Solid-compatible local pod;
  three modes (cache-for-real-pod, standalone, replication-
  ring-with-peer-pseudo-pods). Unified read path everywhere.
- **Pseudo-pod-replicated mode** — §II.2's fourth crew policy.
  No group pod, no per-member pods required; group state lives
  as eagerly-replicated content across member pseudo-pods.
- **Registered-bundle mode** — runtime mode a bundle enters
  when the Hub is detected on launch. The bundle defers
  always-on infrastructure to the Hub via the AIDL surface.
- **Standalone mode** — runtime mode a bundle enters when the
  Hub is absent. The bundle runs its own embedded substrate
  set.
- **Storage function** — a named slot the substrate needs to
  store something into (e.g. `private/identity-vault`,
  `sharing/profile-public`). Each maps to a URI via the
  routing layer's policy.
- **Storage mapping** — the user-configurable policy that maps
  storage functions to URIs. Default-routed unless the user
  overrides. Lives as a pod resource at
  `<anchor-pod>/private/storage-mapping`, accessed via the
  pseudo-pod; the WebID profile carries a pointer
  (`storage-mapping-uri`). The Hub is the editor surface, not
  a state owner.
- **Sub-container** — a path within a Solid pod with its own
  ACPs (e.g. `<pod>/private/`, `<pod>/sharing/`,
  `<pod>/sharing/public/`). The default one-pod layout uses
  these to separate concerns within a single pod.
- **WebID** — the user's canonical identity URI. Anchors pod
  ownership and points at the agent registry + storage-mapping
  resources.
- **WebID profile pointer pattern** — heavy state (storage
  mapping, agent registry, audit log) lives as dedicated pod
  resources with their own ACPs; the WebID profile carries
  small pointer predicates (`storage-mapping-uri`,
  `agent-registry-uri`, `audit-log-uri`). Every device walks
  the profile on first connect, follows the pointers, and
  fetches the resources via the pseudo-pod. Keeps the public
  profile small + the Hub stateless.

## §B — Source

This doc consolidates a Dutch brainstorm by the author, refined
through clarifying questions during chat sessions on 2026-05-10
and 2026-05-11. The brainstorms are preserved verbatim in
those sessions.

The original linear presentation lives at
[`standardisation-plan-2026-05-10.md`](./standardisation-plan-2026-05-10.md);
this restructured version supersedes it. The bundle-distribution
sketch at
[`bundle-distribution-android-2026-05-11.md`](./bundle-distribution-android-2026-05-11.md)
has been merged into this plan (§II.13 and adjacent sections)
and is preserved as a historical artifact.

The companion doc
[`standardisation-transition-2026-05-11.md`](./standardisation-transition-2026-05-11.md)
covers consequences + transition for `sdk/core`, the existing
substrates, and the three apps (Tasks, Stoop, Folio).

## §C — Changelog

### 2026-05-11 — graceful degradation between pod / no-pod modes

- §II.2 reframed: the four crew policies are **preferences,
  not hard runtime rules**. Even pod-having crews lose
  connectivity sometimes; the substrate falls back to
  pseudo-pod-replicated eager fan-out for that write, and the
  writer's pending-pod-upload queue drains on reconnect.
  Replication-ring is the **universal baseline**; pods are
  *promotable ring members* whose participation is gated by
  reachability.
- §II.6 reframed: per-write mode picking now considers three
  inputs (content nature, crew preference, current pod
  reachability). New "Graceful degradation across pod /
  no-pod modes" subsection. Pending-upload queue + envelope
  re-emission on reconnect locked.
- **Open question (V2, deferred):** upload-on-behalf —
  another member uploading an offline writer's content to
  the writer's pod. Authority / conflict / ACP / product-fit
  questions documented in §II.2 + §II.6.

### 2026-05-11 — consolidated revision

Multiple revisions during 2026-05-10 → 2026-05-11 sessions,
collapsed here for readability:

- **One-pod default; two-pod recommended (§II.1).** Onboarding
  ships one pod by default with sub-containers; two-pod is a
  one-click upgrade preset surfaced prominently in first-run
  and the storage-mapping editor.
- **Four crew policies (§II.2).** Centralised / decentralised
  + cross-pod refs / hybrid / no-pod (pseudo-pod-replicated).
  The no-pod policy preserves the pre-standardisation
  capability of running a crew without provisioning any pods.
  Group pod URIs can point at any pod (freshly-provisioned,
  one member's personal pod, or a shared personal pod) — the
  substrate doesn't care.
- **Three persistent-write patterns (§II.6).** Relay fan-out
  of full content for ephemeral; pod-primary + envelope
  notifications for persistent content in pod-having crews;
  pseudo-pod-replicated eager fan-out for persistent content
  in no-pod crews. App code is identical across modes;
  substrate picks per-write mode from the crew's §II.2 policy.
- **Pseudo-pod has three modes (§II.7).** Cache for a real
  pod, standalone, replication-ring with peer pseudo-pods.
- **Config-on-pod, Hub-stateless (§II.3, §II.8, §II.14).**
  Storage mapping + agent registry + audit log live as pod
  resources with WebID-profile pointers. The Hub is the editor
  surface, never a state owner.
- **Hub track separable (§II.9, §II.14, §III.A, §III.D).**
  P0–P3 + non-Hub-portion of P5 ship without the Hub; the
  Hub-free interim path is explicit. The Hub V1 (P4), Hub-web-
  console V1 (P5 Hub portion), and Hub V2 (P6) are
  design-mature but timing-deferred.
- **Destination shape (§II.13).** Apps become Play-Store-
  shipped APKs that adapt at runtime: standalone when the Hub
  isn't installed, registered-bundle when it is. AIDL bound
  service for IPC. Two-mode rendering (compact + full).
  Cross-bundle search + embed-by-ref + graceful permission
  failure. F-Droid track parked for dynamic-loaded bundles.
- **§II.14 added.** Consolidated Hub view: positioning, V1/V2
  surfaces, relation to the interim, Hub-specific open
  questions, reference doc cross-links.
- **§III.D added.** Hub-free interim path: what apps gain,
  what they don't, why this path makes sense, transition to
  Hub work.
- **Design principle locked: preserve existing
  pod-independence.** Where today's code works without pods,
  the substrate continues to offer that mode. New substrates
  *add* pod-attached capabilities; they don't *subtract*
  no-pod capabilities. Drives the no-pod-crew policy + the
  pseudo-pod replication-ring mode.

### 2026-05-10 — restructured

- Original linear plan restructured into Part I (summary) /
  II (per-feature) / III (implementation) / IV (reference) per
  reviewer critique. TL;DR added. (committed) vs (direction)
  tags introduced. Substrate names presented as
  role-with-suggested-name in a table.

### Original decision log

- WebID-discovery + per-device OIDC for auth.
- Skill-based pseudo-pod hosting on agents.
- Pseudo-pod doubles as the unified local cache.
- No group private side-pod.
- Identity model B + softened C: each agent has its own
  keypair and own line on the agent-registry; bots have their
  own OIDC tokens for per-bot revocation.
- Mobile-independence is a hard requirement; Hub-Android +
  Hub-web-console split (§II.9).
- Personas (D) deferred — viable to layer on later as a third
  tier above agents.
- Destination shape locked as direction: per-type interface
  registry (not per-item, for security), protocols as
  substrate, apps as bundles.
- User-configurable storage mapping. Default is one pod with
  sub-containers; two-pod model is the prominently-recommended
  upgrade.
- Hub track is design-mature but timing-deferred.
