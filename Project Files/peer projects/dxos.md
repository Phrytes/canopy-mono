# DXOS — peer-project deep-dive

**Why it's relevant:** the most actively-developed peer project
in adjacent territory.  Local-first, agent-/identity-centric,
JS/TS-native, building infrastructure for collaborative apps.
Tactically pragmatic in ways that resemble this project's bets,
but with a different substrate strategy (their own platform vs.
existing standards).

---

## Their core ideas

**"Decentralized Operating System."**  That's the framing — not
a library, not an app, but infrastructure that other apps run
on top of.  They want to be the layer between "the device's OS"
and "your collaborative app," providing identity, data sync, and
peer connectivity so app builders don't reinvent those wheels.

**User sovereignty over identity, data, and compute.** Same
vocabulary you'll recognise from Solid and Holochain.  Your data
lives on your devices, your identity is cryptographic and yours,
your apps run locally and replicate peer-to-peer when you want
them to.

**Spaces as first-class collaborative objects.** A "space" is a
shared replicated database — kind of like a Slack channel, a
git repo, and a Notion workspace had a baby.  You join spaces by
invitation; everyone in a space gets the same data via CRDT
replication.  This is their key abstraction for "where shared
state lives."

**Developer infrastructure, not end-user product.** Composer
(their flagship app) is more of a *demonstration* than the point.
The point is the SDK underneath — they want other developers to
build the next Notion, the next Asana, the next Roam, on top of
DXOS.  Their pitch is essentially "Firebase, but local-first and
yours."

**Pragmatic about existing standards.** Less philosophically pure
than Holochain — they'll use existing web tech, signalling
servers, normal WebRTC.  Their "decentralization" is about user
data sovereignty, not about avoiding all centralized
infrastructure on principle.

---

## Three components (briefly, since you'll see these names)

- **HALO** — identity and device management.  Cryptographic
  identity, multi-device support, social recovery.
- **ECHO** — replicated database / knowledge graph.  CRDT-based,
  local-first, real-time.  Each user has their own; "spaces" are
  shared databases between users.
- **KUBE** — networking layer.  Signalling servers + WebRTC for
  peer connections.

Plus **Composer** — their collaborative knowledge-graph editor.

---

## Current progress and adoption

**They're a venture-backed startup**, not a foundation or a
co-op.  Founded around 2019 (I'm not certain on the exact year);
Rich Burdon is one of the founders.  Team size is small-to-medium
(maybe 10-30 — I shouldn't claim a specific number without
checking).  They've taken VC funding through at least one
significant round.  The product is MIT-licensed open source; the
commercial play is presumably "we'll host the supporting
infrastructure (signalling, optionally storage) and sell
developer-tools or enterprise features" — but as far as I know
they haven't fully monetised yet.  Build-the-platform-and-grow-
adoption phase.

**Active development.** They've been shipping versions of the
SDK and Composer through 2024 and into 2025.  More iteration
velocity than Holochain.

**Adoption is early but real.** Some apps are being built on
DXOS by external developers; the dev community is small but
engaged.  They aren't yet at "household name in the local-first
scene" but they're a serious option people consider.

**Posture vs. Holochain:** Holochain is a foundation + a
separate hosting company (Holo); they ship slowly, partly funded
by token sales.  DXOS is a single VC-backed company with the
standard tradeoffs — faster iteration, but they answer to
investors and have a runway clock.

---

## Are they into community building?

**Yes, but the developer kind, not the movement kind.**

- Discord, GitHub discussions, a blog, public docs.
- Technical content explaining how to build local-first apps
  with their tools.
- Talks at conferences, small dev-focused events.
- Engagement with the broader local-first / Ink & Switch /
  decentralization research community.

What they don't do (compared to Holochain):

- No "movement" — no manifesto about post-capitalism or mutual
  credit.
- Audience is **app builders** ("hey developer, your
  collaborative app shouldn't depend on a centralized backend"),
  not end-users seeking liberation from big tech.
- Not running cooperative-economy workshops or recruiting people
  to ideological positions.

If Holochain is "we're building the alternative to capitalism,"
DXOS is "we're building the alternative to Firebase."  Both have
value; very different vibes.

---

## Are they just a technical solution?

**Mostly yes.** They're closer to a tools company than a cause.
Their writing is "here's how to build local-first apps better,"
not "here's why platforms are evil."  The values are present in
the *why* (user sovereignty, no platform lock-in) but the
foreground is *how to ship code*.

This shapes what kind of partner they'd be:

- A **movement** (Holochain) wants you to *join their mission*.
  They evaluate you on philosophical alignment as much as
  technical alignment.
- A **tools company** (DXOS) wants you to *use their software*.
  They evaluate you on whether you'll adopt and contribute back.

Different relationships.

---

## Where this project aligns — and where it doesn't

### Aligned

- *Local-first.* Both treat user devices as the primary compute
  + storage location.
- *Identity-centric.* Both have cryptographic per-user identity
  as the foundation.
- *JS/TS-native.* Both run in browsers, Node, RN.  Lower barrier
  for app developers than Holochain's Rust+Wasm world.
- *Collaboration-as-shared-state.* Both think in terms of
  replicated data across peers.
- *Pragmatic about existing infrastructure.* Both will use
  signalling servers, WebRTC, etc. without philosophical
  hand-wringing.

### Where this project diverges

- **This project bets on Solid; DXOS bets on ECHO.** Solid is a
  W3C standard with multiple implementations and pod hosts.
  ECHO is one team's product.  Different dependency profile
  entirely.  Picking ECHO means depending on DXOS the company;
  picking Solid means depending on a standard that DXOS isn't
  part of.
- **This project leans into multi-transport mesh including
  BLE.** DXOS is more "WebRTC + signalling-server."  No BLE
  story, no mDNS-LAN-discovery emphasis.  This project's mesh
  works in places DXOS's doesn't.
- **Skills as a universal primitive.** Not in DXOS's vocabulary.
  Their abstraction is data-replication-in-spaces; ours is
  "agents call skills on each other."  Different mental models
  for "what does cooperation look like?"
- **Identity model.** This project uses Ed25519 + Solid OIDC +
  KeyRotation.  DXOS has HALO (multi-device, social recovery,
  more polished).  Adopting HALO would be a real lift; the
  paths can also coexist.
- **Tools company vs. infrastructure project.** DXOS has
  business-cycle risk this project doesn't.  Pivots, fundraising
  pressure, leadership changes can affect their roadmap.

---

## What this means for partnering or integrating

Compared to Holochain (movement, slower, smaller, ideological
filter), DXOS is a *much easier integration partner* on paper:

- They'd probably welcome a bridge — interop between ecosystems
  gives both teams more reach.
- Their docs are oriented toward developers; faster to evaluate
  than Holochain's.
- Their community is friendly but transactional — no allegiance
  required.

Compared to using Solid + W3C standards directly:

- DXOS is more *opinionated* — adopting any of their pieces
  brings their worldview with it.
- DXOS has *roadmap risk* — their priorities can shift.
- DXOS gives you *more polish* in the areas they cover.

The four levels of integration (recap from the strategy
discussion):

- **Level A** — Composer in the OSS docs candidates for #1.
  Trivial documentation move.  Already agreed.
- **Level B** — use ECHO for shared mutable state in #1 and/or
  #4.  Real integration work; defer until use-case data-layer
  questions resolve.
- **Level C** — bidirectional bridge (interop only).  Treat
  DXOS as another protocol agents can speak.  Realistic option
  later.
- **Level D** — adopt DXOS as substrate.  Don't.

---

## What to take from them

- **Their developer-experience polish.** Their docs, examples,
  and onboarding are well-done.  Worth studying as a model for
  this project's own developer materials.
- **Their "spaces" abstraction.** A clean way to think about
  "where shared state lives."  Even if you don't use ECHO,
  borrowing the *concept* of "a space is a thing you join, with
  identity-scoped membership and replicated state" is useful.
- **Their pragmatism.** They've made trades this project has also
  made (existing-standards-where-it-works, novel-where-it-must).
  Validates the pragmatic posture.
- **Their roadmap.** Track it.  Their decisions are signals
  about what works in this space.

---

## Honest take / verdict

**Tools company doing good work in adjacent territory.** Worth
watching, worth tracking, worth small interop work (Composer in
your candidates list — level A).  Be cautious about heavy
dependencies for standard tools-company-risk reasons (pivots,
runway, roadmap shifts).

Their pragmatic posture is *easier* to integrate with than a
movement's would be.  No allegiance required.  Bridge work
would be welcome on their side.

But — they're a *substrate-builder* in a way this project
isn't.  Their answer is "use our platform"; this project's is
"glue together what already works."  Heavy DXOS adoption
partially commits this project to their bet, which dilutes the
distinct positioning.

**Verdict:** kindred spirit, possible interop partner, useful
prior art on developer experience.  Not a competitor for the
same niche (they want to be Firebase-for-collab; this project
wants to be the agent layer above existing infrastructure).
Not an upstream — too company-shaped to depend on heavily.
**Track and bridge, don't adopt as foundation.**
