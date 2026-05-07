# Holochain — peer-project deep-dive

**Why it's relevant:** closest *philosophical* neighbor to this
project.  Agent-centric, anti-platform, community-self-organizes,
local-first.  The strong resemblance is real; the tactical bets
diverge.

---

## Their core ideas

**Agent-centric, not data-centric.** Their headline.  Blockchains
are data-centric: there's one shared global ledger, everyone
agrees on it through consensus.  Holochain says no — each *agent*
has their own ledger ("source chain"), an append-only log of
their own actions.  There's no global truth; there's "what I've
done," "what you've done," and the rules we agreed on for what
counts as valid behavior in the app we're both running.
Consensus is local, between the parties who care, not global
between strangers.

**Data has integrity if its history is valid.** Validation isn't
done by miners or stakers — it's done by other agents who pick
up your data via a distributed hash table and check whether it
followed the app's rules.  If you publish an action that breaks
the rules, other agents reject it.  No Sybil-resistant consensus,
no fees, no chain reorganization.

**Cooperative economics in the DNA.** The founders (Arthur Brock,
Eric Harris-Braun) come from a mutual-credit background —
economic systems where value is relational and locally-issued,
not scarce-and-globally-rationed.  This shows up everywhere:
their reasoning about platforms is that platforms extract rent
from peer interactions that should belong to the peers; their
hosting layer (Holo / HoloFuel) is meant to let users pay each
other for compute without going through a corporation.

**Local sovereignty, peer agreement.** "You hold your own data;
we agree on shared protocols when we want to interact."  Apps
are called *hApps*.  An hApp is a set of rules + a UI; running
it means joining the network of agents who agreed to those
rules.  Communities form by adopting a common DNA.

**Recent emphasis: Neighbourhoods.** The last ~year of their
work has been pushing a "Neighbourhoods" framework — small
bounded communities (your housing co-op, your activist group,
your DAO) running their own little universes of agreed-upon
rules.  Very close in spirit to this project's use case #2
(neighborhood skill matchmaking) and #4 (multi-tenant tasks
with role-aware groups).

---

## Current progress and adoption

Honest read: **the philosophy is more mature than the adoption.**

- Active development since ~2018.  Multiple roadmap resets.
  Mainnet (the hosting layer Holo) has been "almost shipped" for
  several years; the developer-facing Holochain runtime is real
  and shipping versions, but the broader ecosystem with hosted
  apps, currency layer, etc. has been slower than promised.
- The hApps that exist are mostly experimental or
  community-scale: Acorn (project management), Sensorica
  (open-source manufacturing networks), KizunaChat, Comet,
  Neighbourhoods themselves.  Real users, but small ones —
  measured in tens to thousands, not millions.
- They've struggled to break out of the cooperative / commons
  / "there has to be an alternative to capitalism" subculture
  that birthed them.  The values resonate strongly with that
  audience and don't reach much beyond it.
- Funding has been via early token sales rather than VC, which
  has kept them independent but also kept the team small
  relative to what the vision asks for.
- The dev experience — Rust + Wasm, custom runtime — is a real
  barrier.  People who want to build small experimental apps
  find it heavy.

So: a credible body of work, a sharp philosophy, a small but
loyal community, and a pace of adoption that hasn't matched the
ambition.  Worth respecting, worth being aware of as precedent.

---

## Where this project aligns — and where it doesn't

### Aligned (the strong resemblance)

- *Agent-centric.* Both treat the agent (a person, a device) as
  the fundamental unit, not the platform.
- *Local-first.* Your data lives with you; you decide who sees
  what.
- *Skills / DNAs as community-scoped rule sets.* Holochain's
  hApp DNA defines "what valid behavior looks like in this
  community."  This project's role-aware groups + skill registry
  play a similar conceptual role — joining a group means
  agreeing on its rules.
- *No global consensus, no global ledger.* Both reject the
  blockchain framing.
- *Communities self-organize.* Both visions are explicitly
  about giving small groups the ability to run their own
  coordination without big-platform mediation.

### Where this project diverges — and the bets are different

- **This project builds on existing standards; they built a
  new substrate.**  Solid for storage.  WebSockets / WebRTC /
  BLE for transport.  Web platform APIs everywhere.  JS/RN
  runtimes.  *They* built their own DHT, their own source
  chains, their own Wasm-sandboxed runtime — beautiful ideas,
  but the cost is that you can't just open a browser tab and
  use a hApp.  You can open a browser tab and use a `@canopy`
  agent.  That difference compounds over years.  This project
  is betting that "good enough on existing infrastructure"
  beats "perfect on new infrastructure"; Holochain bet the
  other way and it has been hard.

- **This project doesn't have a currency layer.** Holochain's
  vision includes HoloFuel as the way agents pay each other for
  compute and hosting.  This project hasn't gone there.  That's
  *probably* good — currency design is its own swamp, and
  entangling protocol design with monetary design has slowed
  Holochain's progress significantly.  Payment can always be
  added later as a skill; they would have to rip out a lot to
  remove it.

- **This project's privacy story is more layered.** Holochain
  has a strong "you own your data" story but it's somewhat
  binary — you publish or you don't.  This project's stack has
  sealed-forward, hop tunnels, anonymous-with-mutual-consent
  (parked), capability tokens, group-visibility.  More dials,
  more nuance.  Real-world peer interactions don't divide
  cleanly into "public" and "secret"; they're full of "this
  person knows my name but not my address" gradations.

- **Skills as a universal primitive — they don't quite have
  this.** Their model is more "shared validated data + entry
  types."  This project's "every agent registers skills,
  callable by other agents under permission policies, with
  humans and devices unified" is a cleaner abstraction for
  human/device coordination use cases.  Holochain can express
  it but doesn't lead with it.

- **This project integrates with the existing world; they
  wanted to replace it.** This project imports from Google Docs
  into Solid (#3); exposes A2A endpoints; meshes with Bluetooth
  and Wi-Fi.  Holochain's posture has historically been "we're
  building the alternative" — which makes it harder for users
  to migrate gradually.  "Your agent works with the messy
  real-world tools you already use, plus better ones" is a
  softer landing.

---

## What to take from them

- **The framing.** "Agent-centric not data-centric" is a
  one-line position they've polished.  If this project ever
  needs a tagline against blockchains or platforms, theirs is
  well-tested.  Variations are fine; the underlying frame is
  earned.
- **Neighbourhoods.** Read their recent writing on
  Neighbourhoods — the philosophy of *bounded communities
  running their own rule-sets* is exactly use case #2 + #4.
  They've thought about it longer.
- **Their failure modes.** Watch what didn't work for them
  (currency entangled with protocol; novel-substrate slowed
  adoption; small team carrying big vision).  Avoid those traps
  deliberately.
- **Their community.** The cooperative / mutual-credit / commons
  scene is this project's natural early-adopter pool.  People
  in that orbit will *want* what's being built here.

---

## Honest take

Philosophically these projects are in adjacent territory — close
enough that someone reading both manifestos would mistake them
for cousins.  Tactically they make different bets, and on
balance this project's bets look better-suited to actually
shipping.

Holochain went deep on first principles and built a beautiful
but heavy thing; this project is going pragmatic and using what
already works.  The world has changed enough since 2018 (Solid
matured, web standards caught up, AI agents became a thing) that
the right move now isn't a new substrate — it's smart glue
between the existing pieces.  That's what this SDK is.

If you ever talk to Holochain folks, you'd find them kindred
spirits.  Not competitors for the same niche — they're trying
to be the new infrastructure; you're trying to be the agent
layer on top of the infrastructure that already exists.  Both
can be right.

**Verdict:** kindred spirit, possible community-bridge, useful
prior art.  Not a competitor.  Not an upstream.  Read their
public writing; don't repeat their mistakes.
