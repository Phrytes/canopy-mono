# Topology — how the pieces fit together

**Status:** working document.  Captures the architectural
decomposition that emerged after pass-3 use-case design.  The
seven projects in [`../projects/`](../projects/) are *applications*
on top of this topology.

**Origin:** the author's framing (verbatim, Dutch):

> Right now I have a bit of a clearer image that splits the main
> idea into about 3.5 main parts that look like this:
>
> - priveserver (agent) met pod + llm
> - gedeelde server voor relay / llm / groepspod
> - telefoonagent voor communicatie met anderen / taken / vragen /
>   berichten / streaming / etc
> - compatibiliteit van apps met pod
> - apps kunnen als agents werken, maar dat hoeft vaak helemaal
>   niet

This document expands that decomposition, validates it against the
seven projects, identifies gaps, and lists the consequences for
how the SDK and surrounding software get built.

---

## The architectural map

The original "3.5 parts" expand cleanly to **four core pieces +
two cross-cutting concerns**:

### Core pieces

1. **Private user server** — always-on, owned by one user.  Hosts:
   - the user's Solid pod (canonical store of truth)
   - the user's primary agent (skills, capability tokens, identity)
   - optionally a local LLM (privacy-preserving intelligence)
   - relay/rendezvous endpoints for the user's own devices

   Prototypical hardware: refurb Mac mini M2 / Pi 5 / mini PC /
   spare laptop.  A real product target — see "Consequences" below.

2. **Shared group server** — always-on, shared by a small group
   (household, neighborhood, family, project team).  Hosts:
   - a shared pod for group state
   - optionally a shared LLM (cheaper than per-user; weaker privacy
     guarantee — group-internal trust)
   - relay for group members who can't always reach each other
     directly
   - group-administered skills (matchmaking, governance, archives)

   Optional, not required for every project.  The household app
   (#7) and neighborhood app (#2) need one; the notes app (#1)
   probably doesn't.

3. **Phone agent** — interactive, always-with-the-user.  Roles:
   - day-to-day communication with humans and other agents
   - ad-hoc skill calls ("what do we need at the supermarket?")
   - mesh-network participant (BLE, mDNS, hop-tunnel)
   - input device for content destined for the pod
   - read-side UI for content from the pod

   Lower availability and lower trust than the private server
   (battery, lost/stolen, OS sandboxes).  Should defer authoritative
   state to the private server when one exists.

4. **Apps** — purpose-built UIs and integrations on top of the
   stack.  Two flavors:
   - **App as agent**: the app itself runs an agent (registers
     skills, holds an identity, talks the protocol).  Notes app
     (#1), task app (#4), archive app (#5) likely fall here.
   - **App as pod-client**: the app is a thin UI that reads/writes
     the pod and lets the user's existing agent do the protocol
     work.  Many apps will be this — markdown editors against the
     pod, dashboards over archive content, simple browsers.

   The L2 boundary in `projects/` lives here.

### Cross-cutting (not "pieces" but real concerns)

5. **External bridges** — adapters from the agent ecosystem to
   non-`@canopy` systems: Telegram bot bridge (#7), Google Docs
   import (#3), Solid OIDC against external IdPs, MCP for AI tools.
   Each bridge is its own component but they share an L1 pattern.

6. **Identity** — Ed25519 key, capability tokens, multi-device
   continuity.  Not a "place" — it's a property the other pieces
   need to share consistently.  Important enough to track as a
   first-class concern because multi-device identity is currently
   underspecified.

### Internet-scale infrastructure

7. **Reachability infrastructure** — three layered mechanisms get
   peers in touch when direct (WebRTC / BLE / mDNS) doesn't work:

   - **Centralized relay**: WebSocket relay servers run by
     ecosystem operators.  Authenticated transport, no state.  The
     SDK has a relay implementation but no public deployment yet.
   - **NKN**: decentralized public messaging network.  No operator
     to run; routing is paid-for at the network level.  Provides a
     fallback for pairs of users with no shared relay and no
     direct path.
   - **Peer hopping**: a third user's phone or server acts as a
     relay between two peers who can't reach each other.  This
     blurs a topology line — a phone agent can *be* reachability
     infrastructure for a friend.  Trust budget per hop matters,
     and hop-count limits prevent the network from being abused
     as a general-purpose relay.

   Distinct from the shared group server: relays / NKN / hops are
   unauthenticated transport, the group server is authenticated
   state.  A user's agent may use any combination simultaneously,
   and the right choice is per-peer (closer paths preferred).

   the author's "3.5 parts" implicitly bundled all of this with the
   shared server.  Worth separating because the operational
   stories (DNS-known relay vs. NKN address vs.
   group-administered shared host vs. ad-hoc peer) and trust
   postures are all different.

So the cleaner formulation is **4 pieces + 3 cross-cutting
concerns**: private server, shared server, phone agent, apps;
plus external bridges, identity, and reachability infrastructure
(relays, NKN, peer-hopping).

---

## Deployment shapes

The seven topology pieces don't all show up in every user's setup.
A real user lives in one of a few configurations, and the SDK has
to make all of them work:

1. **Managed tier** — phone agent + hosted pod (paid or community)
   + public relay infrastructure (or NKN) + optionally a hosted
   LLM service.  No private or shared server.  The user owns no
   always-on infrastructure.  This is the default new-user path
   and the long-term shape for users who never self-host.  Trust
   posture: pod host sees everything stored, relay host sees
   metadata, hosted-LLM sees prompts.  Onboarding bar: zero.
2. **Self-hosted user** — managed tier *plus* a private server
   running the pod + LLM + the user's primary agent.  Hosted
   services drop out as the private server takes over (or stay as
   mirrors).  Trust posture: the user trusts their own hardware;
   any remaining hosted services act as backups, not primaries.
3. **Self-hosted group** — self-hosted user *plus* a shared group
   server for household / neighborhood / team state.  Trust
   posture adds group-internal trust on the shared server.
4. **Hybrid** — common in practice.  A user has their own private
   server but their group's shared server is hosted by a third
   party; or vice versa.  Each piece is independently hosted or
   self-hosted.

The progression matters because each step up the ladder is a real
onboarding event with migration consequences (where does the
identity move? what gets re-encrypted? what changes ownership?).
The SDK should support a smooth path from managed-tier all the way
to self-hosted group without forcing a re-onboarding.

---

## Hybrid pod patterns

Whenever app state is shared between members of a group, there are
two structurally different ways to hold it.  Most real apps need
**both at once**, for different parts of their state — which is
why the SDK has to support both natively rather than picking one.

- **Separate pod** — a real Solid pod with its own URL, owned by
  the group as a whole (hosted on a shared server, on one
  member's private server, or on a third-party host).  Members
  read and write directly via ACL.  Atomic operations, single-
  fetch reads, simple mental model.  Data lives in the group pod;
  members come and go via ACL changes but the data stays.

- **Projection** — no separate group store.  Each member's own
  pod holds a designated section, and the "group view" is a
  federated query across member pods that merges per a declared
  contract.  Members retain ownership of their own slice; leaving
  the group means their slice goes with them.  Reads are slower
  and have more failure modes; ownership semantics are clean.

Real apps mix the two: some app state lives in a group-owned
separate pod, some in projections across member pods.  *Which
state goes where is a per-app design decision* — interpretations
will differ between #4 (tasks), #5 (archive), #7 (household),
and others, and shouldn't be hard-coded by the SDK.  What the
SDK provides is the substrate.

### What the SDK has to provide

- `podClient.read(url)` — single resource, separate-pod case.
- `podClient.readFederated(memberPods, path)` — fetches `path`
  from each member pod, merges per a declared contract.
- A small library of **merge contracts** apps can pick from:
  set-union with timestamp dedupe, append-only event log, CRDT
  (Automerge / Yjs), last-write-wins.  Apps can supply their own.
- A convention for declaring per-field which pattern is used and
  which merge contract applies.

### What still needs deciding

- **Failure modes of federated reads.**  Member pod offline or
  unreachable — does the read partially succeed, return cached
  state, or fail?  Decide once at the SDK level rather than per
  app.
- **Per-app shape decisions.**  Each app that has shared state
  decides which fields live in a separate pod vs. project from
  member pods, and which merge contract applies.  Tracked in the
  app's own design notes.

### Related: latest-only storage with explicit delete scope

V1 keeps the storage layer simple: **the pod always holds the
latest version** of each resource.  No versioning, no history,
no retention policy at the storage layer.  Apps that want
history (e.g., the LLM conversation log in #7, audit trails in
#4) maintain their own append-only resource and decide when to
compact.

The two-tier sync model still applies, with simplified semantics:

- **User data** (notes, lists, archive items, drafts) — both
  device and pod hold the latest version.  Device-side deletes
  are **explicit per operation**: the user picks **delete
  locally** (gone from this device, untouched on the pod) or
  **delete completely** (gone from device, propagated to pod).
  No implicit propagation either way.
- **Identity-bearing state** (device authorizations, capability
  grants, revocations) — pod is canonical, device caches.
  Security-critical writes propagate atomically; divergence
  here is a security hole, not a tidying-up question.  See
  §Gaps#4.

Versioning is a **deferred design conversation** — reopen when
collaborative-editing pressure emerges (multi-user editing in
#1 notes, multi-user DAG edits in #4 tasks).  At that point the
merge-contract framing in this section becomes a versioning
model again.

---

## Recovery ethos

The project does not promise "we never lose your data."  It
promises **"we give you the tools to back up your data, and the
responsibility to use them."**  Practical implications:

- **Pod export is a first-class operation.**  "Download the whole
  pod as a portable bundle" is a product surface, not a checkbox.
  Same plumbing as the identity-export flow (§Gaps#4) and the
  notes-app sync layer (#1).  V1 format: **Solid LDP archive** as
  the primary shape, with a flat zip export as a user option.
  Encrypted at rest with a key derived from the bootstrap secret;
  latest-only content (no history, consistent with the storage
  model below); identity included by default with a `--data-only`
  flag for users who prefer not to ship it.
- **User-chosen backup destinations.**  USB stick, cloud storage
  (Dropbox / Drive / iCloud), S3, another pod, external HDD.  The
  SDK provides the bundle; the destination is the user's call.
  No mandatory cloud backup.
- **Backup cadence with reminders.**  Runs as a cron on the
  private server when one exists.  Phone-only / managed-tier
  users get periodic nudges.
- **Bootstrap-secret backup is separate.**  V1 ships **BIP-39
  seed phrase** (canonical) plus an optional **encrypted cloud
  backup** (convenience).  See §Gaps#4.  Loss of *all* of these
  *and* all pod backups is unrecoverable; users have to know
  this and choose their backup strategy accordingly.
- **The trade is explicit.**  Some users will love this; some
  will hate it.  The project's ethos prioritizes user control
  over service guarantees.

---

## Mapping the seven projects onto the topology

| Project | Private server | Shared server | Phone agent | App layer | Bridges |
|---|---|---|---|---|---|
| **#1 Notes** | pod + folder sync + agent | — | read/edit UI | markdown editor (existing) + V1 OSS docs tool | OSS-tool ↔ pod adapter |
| **#2 Neighborhood** | identity + private profile | gated relay + matchmaking | discovery + chat | request/offer UI | — |
| **#3 Import bridge** | pod (write target) + agent (orchestrator) | — | trigger + status UI | per-source mapping rules | Google / Microsoft / Apple / messaging adapters (the whole project IS bridges) |
| **#4 Tasks** | task ledger + agent | optional shared task pod | claim/complete UI | task DAG editor | — |
| **#5 Archive** | indexed pod content + agent skills | — | search UI | dashboards / browsers (later) | — |
| **#6 Proof of location** | identity + skill | optional witness-network shared host | beacon emit + verify UI | venue-side QR display | — |
| **#7 Household** | per-user pod (V1) | **household pod + LLM + Telegram bridge** | chat + completion-loop UI | shopping/repair/errand UIs | Telegram bot bridge |

Observations:

- **All seven projects use the private server.**  It's the
  load-bearing piece.  Without it, the user has no canonical state.
- **Three of seven (#2, #4, #7) use a shared server.**  The shared
  server is optional but recurring — when groups exist, you need
  one.
- **All seven need the phone agent.**  Even the household app
  whose primary input is Telegram still wants the phone agent for
  out-of-band interaction.
- **Bridges are concentrated in #3 and #7.**  Treating bridges as
  a first-class concern (not just "weird app code") matters most
  for these two.
- **Identity continuity bites everywhere.**  Key rotation already
  shipped (Group FF) is one piece; multi-device key
  agreement, lost-phone recovery, and pod-is-still-mine semantics
  remain partially unsolved.

---

## Gaps the original "3.5 parts" framing leaves implicit

These aren't disagreements with the user's framing — they're
the holes the framing reveals when stress-tested against the
projects.

1. **External / cloud bridges as a real category.**  The user's
   framing does not call out bridges, but #3 and #7 are *mostly*
   bridges.  Without an explicit bridge concept, every external-
   service adapter feels ad-hoc.  Treating bridges as L1 makes
   them composable: a Telegram bridge, a Google bridge, an MCP
   bridge all share patterns (auth handshake, webhook /
   long-polling, message-to-skill mapping).

2. **Public-web / passive HTTP access.**  Some projects publish
   read-only content (the blog in #1; share links from any pod;
   `did:web` discovery).  This isn't quite "bridge" — it's the
   pod exposing a public-web face.  Probably belongs as a
   capability of the private server, with an explicit "publish to
   web" flow.

3. **Internet relay as distinct infrastructure.**  Bundled into
   "shared server" in the original framing, but the operational
   reality is different.  Group servers are administered by group
   members; relays are administered by ecosystem operators.  A
   user's agent might use *both* — different trust posture for
   each.

4. **Multi-device identity continuity and recovery.**  Phone
   breaks, user gets a new phone — same identity, linked-device
   identity, or fresh identity authorized by the pod?  Working
   model: the user's **(private) pod is the canonical store of
   identity state** — device list, capability grants issued and
   held, authorization log, contacts, app permissions, recovery
   hints — encrypted at rest with keys derived from a bootstrap
   secret.

   The device holds the **bootstrap secret + a working cache** of
   recent identity records, so it can operate on identity *while
   offline*: decrypt local data, use existing keys to authenticate
   to external services, send messages with cached capability
   tokens.  Modifications that *change* identity (issuing a new
   grant, authorizing or revoking a device, rotating keys) are
   security-critical writes to canonical state and require pod
   reachability before they're considered effective.

   The bootstrap secret cannot itself live in the pod — it's what
   unlocks the pod.  In v1, recovery for the bootstrap is via
   **two parallel paths that recover the same secret**:

   - **BIP-39 seed phrase** — user writes 12–24 words at
     onboarding, stores them offline.  Canonical recovery path.
   - **Encrypted cloud backup** — bootstrap secret stored in
     iCloud / Drive / Dropbox, encrypted at rest.  Convenience
     recovery path.

   Both encode the same bootstrap; either works.  Hardware keys,
   social recovery, and multi-device replication are deferred to
   later phases.  Recovery from pod loss is also user-controlled,
   via the backup flow described in **Recovery ethos** above.
   Concrete protocol (including the cloud-backup encryption key)
   still to design; real users will hit this in week 2 of usage.

5. **App ↔ agent boundary.**  The user said "apps can work as
   agents but often don't have to" — true and important, but the
   boundary needs an explicit API.  When an app is a pod-client
   (not an agent), it talks to *which* agent?  The user's primary
   agent on the private server?  Via what protocol?  Likely a
   local IPC + capability-token combo, but undocumented.

---

## Consequences for development

### Direct consequences

**1. The private user server becomes a real product.**

Right now the SDK is "a thing you embed in a phone app."  The
topology says it should also be "a thing you install on a small
home server."  Implications:

- Canonical hardware target (the author's analysis recommends used Mac
  mini M2 ~€500 — see [`../projects/07-household-app/llm-cost.md`](../projects/07-household-app/llm-cost.md)).
- Software bundle: agent + Solid pod + ollama + sync + admin UI,
  pre-configured.
- Install flow: Yunohost / Umbrel / Cloudron app store, or a
  one-line script.  Distribution is its own engineering project.
- Update / backup story: someone has to handle "your private
  server failed, here's how to restore."  Not invented yet.

**2. "Apps don't need to be agents" needs an explicit API.**

If an app is just a pod-client UI, the SDK should make that
trivial.  Likely:

- A pod-client SDK (read/write the user's pod, no protocol stack)
  in addition to the full agent SDK.
- A capability-token flow so an app can prove "the user authorized
  me to do X on their pod."
- Possibly a local-IPC bridge so apps on the user's phone/desktop
  reach the user's agent without re-implementing transport.

A pragmatic strategy that drops out of this: rather than build
pod-client apps from scratch, **fork existing open-source apps
and add a Solid-pod adapter as their storage layer**.  Markdown
editors, task managers, RSS readers, photo organizers — there's
a healthy OSS pool of single-user apps that store data as files
or SQLite.  Replacing the storage backend with a pod-client is
much less work than rebuilding the UI, and gives the project
credible app surface without "we'll write seven apps from
scratch" being on the critical path.  #1 (notes) already has
this shape: the markdown editor is existing, the pod-sync layer
is the new bit.  Other projects should identify candidate apps
to embed early.

This is a different abstraction layer than the existing SDK.  It's
also probably the highest-leverage piece of L1 work — every app
in `projects/` benefits.

**3. Phone agent and private-server agent have different
priorities.**

Same SDK, but the deployment shape diverges:

- **Phone agent:** battery, intermittent connectivity, OS sandbox,
  user-facing UI.  Optimize for: fast startup, BLE/mDNS-aware,
  minimal background work.
- **Private-server agent:** always-on, plenty of CPU/RAM, no UI
  (or remote admin UI), runs the LLM, holds the canonical pod.
  Optimize for: reliability, observability, batched processing,
  long-running skills.

Today the SDK doesn't differentiate.  Probably fine for now, but
configuration profiles ("phone profile" / "server profile") will
become a real thing.

**4. Shared servers are operational territory.**

A household / neighborhood / project team ends up running a small
piece of infrastructure.  Implies:

- Self-hosting story: container image, install script, admin UI
  for the group.
- Membership lifecycle: add member, remove member, what happens
  to their data, role transitions.
- Backup / migration: shared-server fails, group needs to recover
  state.
- Hosted variants: not every group wants to self-host.  A trusted
  third party offering "your shared server, hosted" creates a
  business model and a trust problem to manage.

**5. Build order shifts toward "OS before apps."**

If the private server is the load-bearing piece, the most useful
next thing isn't another app — it's a packaged private-server
distribution that one user can install and have working.  Then:

- Notes app V0 (#1) — proves pod ↔ folder sync against a real
  server.
- Household app V0 (#7) — proves Telegram bridge + LLM + shared
  pod, the most testable use case.
- Neighborhood app (#2) — once shared-server pattern exists.
- Other apps follow.

This pushes against the temptation to ship one app first.  The
private server unblocks every app; it's the right first thing
to harden.

**6. Ecosystem partnerships become obvious.**

The topology has natural integration points:

- **Yunohost / Umbrel / Cloudron** — distribute the private-server
  bundle.
- **Inrupt / community Solid pod servers** — for users who don't
  want to self-host the pod side.
- **Ollama** — local LLM substrate, already widely deployed.
- **NextCloud / Snikket / Synapse** — adjacent self-hosting
  communities, share users + sysadmin literacy.
- **MCP ecosystem** — for the AI-tool bridge.

These aren't speculative — they're concrete projects with concrete
APIs that this topology can plug into without inventing parallel
infrastructure.

**7. Documentation surface grows along the four-piece axis.**

"Getting started" stops being one document.  It's:

- Getting started running a private user server.
- Getting started building a phone-agent app.
- Getting started building a pod-client app (no agent).
- Getting started running a shared group server.
- Getting started building a bridge.

Each has different audiences (sysadmin / mobile dev / web dev /
group admin / integrator).  The README probably becomes a
launching pad to per-piece docs rather than a single tutorial.

### Indirect consequences

- **Trust modelling becomes easier.**  Each piece has a
  default trust posture (private server: full trust; shared
  server: group-internal trust; phone: lower trust due to loss
  risk; apps: scoped via capability tokens; bridges: untrusted
  external).  The capability-token system already shipped maps
  cleanly onto these tiers.
- **Pricing / sustainability stories diverge.**  Self-hosted
  private server = zero ongoing cost beyond electricity.  Hosted
  shared server = subscription.  Bridges = often per-API-quota.
  A future "canopy-as-business" question can be reasoned about
  per piece rather than as a monolith.
- **Threat model is no longer abstract.**  Each piece has a
  different attacker.  Private server: physical access + family
  curiosity.  Shared server: group-internal politics.  Phone:
  loss/theft + OS exploits.  Bridges: third-party data leakage.
  Worth writing this up explicitly in `Design-v3/`.

---

## What's still unclear

Open questions worth tracking:

1. **Hosted vs. self-hosted shared servers.**  Plenty of friend
   groups don't have a sysadmin.  A trusted hosted-shared-server
   service is probably necessary for adoption — but adds a
   third-party trust dependency that contradicts the project's
   ethos.  No clear answer yet.

2. **Where do bridges live?**  Some bridges (Telegram bot)
   naturally run on the private server (it's always-on).  Some
   (Google Docs import) might run anywhere with internet.  Some
   might need to run on dedicated bridge infrastructure for
   rate-limit reasons.  Unclear, probably per-bridge.

3. **Pod-client API ergonomics.**  Solid's WAC/ACP gives ACLs,
   but the day-to-day "I just want to read/write some markdown"
   ergonomics aren't great.  A small wrapper SDK (pod-client)
   with idiomatic patterns probably needs designing.

4. **What runs on the private server when the user has no
   server?**  Many users will install on a phone first and add
   a server later — or never.  What's the degraded-but-usable
   shape when there's no private server?  Phone-only mode is
   important for adoption, but compromises (battery, intermittent
   connectivity, no LLM) need to be honest.

5. **Multi-private-server users.**  A user might have a Mac mini
   at home + a small VPS for internet-reachable mirroring.  Two
   "private servers" replicating one pod — like the user's own
   private cluster.  Conceptually simple, operationally not
   trivial.  Defer to a later design pass.

6. **Migration from "0 pieces" to "all pieces."**  A real user
   onboarding journey: phone-only → adds private server → adds
   shared server with friends.  Each transition needs to be
   smooth and reversible.  No design for this yet.

---

## Next steps for the SDK / architecture

Given this topology, the highest-leverage L0/L1 work falls into
these buckets, ranked roughly by impact:

1. **Pod-client API + capability flow** so apps can be just apps.
   Highest leverage — every project benefits.
2. **Private-server distribution bundle** (agent + pod + ollama
   + admin UI, packaged for self-hosting).  Unblocks real-user
   testing of every project.
3. **Bridge pattern as L1** — formalize how external-system
   adapters plug in.  Unblocks #3 and #7 cleanly.
4. **Multi-device identity continuity** — needed by every project
   in week 2 of real usage.  Currently underspecified.
5. **Configuration profiles** (phone / server / dev) so the same
   SDK boots correctly in three different deployment shapes.
6. **Hosted-shared-server experiment** — what would a small,
   ethical "we run your group's shared server" service look like?
   Probably a separate sub-project, but the topology forces the
   question.

---

## Related documents

- [`../USE CASES.md`](../USE%20CASES.md) — the seven use cases this
  topology has to support.
- [`../projects/`](../projects/) — per-app design notes (the L2
  layer in this topology).
- [`../peer projects/`](../peer%20projects/) — Holochain, DXOS,
  Ink & Switch / Local-First / Automerge — adjacent ecosystems
  whose topologies are worth comparing against.
- [`./00-Overview.md`](./00-Overview.md) — protocol-level overview;
  this topology document sits *above* the protocol layer.
- [`../projects/07-household-app/llm-cost.md`](../projects/07-household-app/llm-cost.md)
  — concrete hardware analysis underlying the "private server as
  product" claim.
