# Ink & Switch / Local-First / Automerge — peer-cluster deep-dive

**Why this gets a different shape:** Holochain and DXOS are
projects you might *partner with* or *track as competitors*.
Ink & Switch isn't either — they're a research lab whose output
shaped the vocabulary, framing, and key libraries of the entire
local-first space.  More like *upstream intellectual influence*
than peer.  Treat this entry as "the local-first cluster" — Ink
& Switch is the source, the essay is the framing, Automerge is
the canonical artifact, CRDTs are the underlying technology.

Same verdict shape as the other entries at the bottom.

---

## Ink & Switch — who they are

**Independent industrial research lab.** Founded around 2017 by
Adam Wiggins, with rotating researchers.  Operates remotely.
Funded by founders + various sources — *not* VC.  Publishes
well-written essays and prototypes; does not have a product
strategy.

The recurring people:

- **Adam Wiggins** — co-founder of Heroku.  Helped create the
  Twelve-Factor App methodology that almost every modern backend
  service follows.  Brings developer-experience and platform
  thinking.  The lab was his initiative.
- **Martin Kleppmann** — researcher at Cambridge University.
  Author of *Designing Data-Intensive Applications* (the
  standard textbook for distributed-systems engineers).  One of
  the leading thinkers on CRDTs and distributed databases.
  Created Automerge with Peter.
- **Peter van Hardenberg** — Heroku alumnus, deep distributed-
  systems engineer.  Active on Automerge and core lab projects.
- **Rotating fellows** — Geoffrey Litt, Mary Rose Cook, Mark
  McGranaghan, others.  People come in for specific research
  projects.

The structure means: no commercial pressure, no users to support,
no roadmap to maintain.  The trade is they don't ship products —
but they also don't pivot, run out of runway, or get acquired.
**Their outputs are durable in a way Heroku's products are not.**
Closer to "Bell Labs that birthed Unix" than "academic department
writing papers."  Less ambitious than Bell Labs in scope; same
flavor of "research that becomes infrastructure."

## What they actually produce

Slight correction to the easy caricature ("research lab — they
don't build anything"):

- **Automerge** — the CRDT library that almost every local-first
  project today uses (or borrows ideas from).  Real shipped
  software, used in production by many apps.
- **Cambria** — a schema-migration system for local-first data.
  Less widespread than Automerge but the most thought-through
  approach to "how do you evolve data schemas when you can't
  run a centralized migration."
- **PushPin, Trellis, Patchwork, several other prototypes** —
  research artifacts that did real work, just weren't sold as
  products.
- **Essays** — well-written technical-design pieces published
  on inkandswitch.com.  Among the best technical writing in
  this field.

So they're more like: **a research lab that ships canonical
building-block libraries plus the vocabulary everyone uses.**
Not "they didn't build anything" — they just didn't build a
*product*.  The libraries and the vocabulary are arguably more
durable.

---

## The Local-First Software essay (2019)

The single most influential piece of writing in this space.
Authored by Martin Kleppmann, Adam Wiggins, Peter van Hardenberg,
and Mark McGranaghan.  Coined the term "local-first" and laid
out the **seven ideals**:

1. **No spinners.** Apps respond instantly because everything
   relevant is on the local device.  No round-trip to a server
   for primary functionality.
2. **Multi-device.** Your data follows you across phone, laptop,
   tablet — without a single cloud being canonical.
3. **Network is optional.** The app works offline.  Sync is a
   bonus, not a requirement.
4. **Collaboration.** Multiple people can edit the same data;
   conflicts merge gracefully.
5. **Long-term data preservation.** The user's data outlives any
   specific app.  Open formats, accessible storage, no
   lock-in.
6. **Privacy & security by default.** End-to-end encryption is
   the floor, not a feature.
7. **The user retains ultimate ownership and control.** No
   platform can revoke access, change terms, or hold data
   hostage.

**This project hits all seven naturally.** That's not a
coincidence — both the author's project and the Ink & Switch agenda
are reactions to the same problem (platforms appropriating
peer-to-peer interactions and data ownership).

If this project ever needs a manifesto or one-page positioning
doc, the seven ideals are gift-wrapped.  Saying "we're building
local-first agent infrastructure, in the Ink & Switch sense of
local-first" gives readers a credible reference point in one
phrase.

---

## CRDTs — what the technology is

**Conflict-free Replicated Data Type.** A class of data
structures designed for the offline-edit-and-sync problem.

The problem they solve, by example:

You and a friend both have an offline copy of "Hello world."
You change it to "Hello **beautiful** world"; she changes it to
"Hello **cruel** world."  Both come back online.

- *In a normal database:* a server decides — usually "last
  write wins" by timestamp, which means one of you loses your
  edit.
- *With a CRDT:* the data structure is designed so that *both*
  edits merge automatically without a server.  When you sync,
  you both end up with the same result — perhaps "Hello
  beautiful cruel world" — and neither edit is lost.  The result
  might be awkward, but it's *predictable* and *automatic*.

The mathematical trick: CRDT operations are associative,
commutative, and idempotent — meaning order doesn't matter, you
can apply the same update twice without harm, and any two
replicas that have seen the same set of changes end up
identical.  No central coordinator required.

Different CRDTs handle different data shapes:

- **Counter that only goes up** (page views): each replica
  counts locally; merge = sum.
- **Set you can add to** (tags on a post): each replica tracks
  adds; merge = union.
- **Set with adds and removes** (TODO list with deletions):
  needs tombstones for removed items so a concurrent re-add
  doesn't accidentally undelete.
- **Text** (collaborative document): every character gets a
  unique ID and a position relative to other characters;
  concurrent inserts get ordered deterministically.

CRDTs are *not* magic.  The merged result is always consistent
across replicas but might not always be what humans would have
wanted (CRDTs can't tell that "beautiful" and "cruel" are
semantically incompatible adjectives).  Humans still have to
deal with the weird-but-predictable result.  The win is that
*the system never loses data* and *the system never gets stuck
waiting for a server*.

### Quick CRDT-jargon glossary

- **Convergence** — guarantee that all replicas eventually
  reach the same state.
- **Causality** — tracking which changes happened "before"
  which others (Lamport clocks, vector clocks).
- **Tombstone** — a marker that an item was deleted (necessary
  so concurrent re-adds don't undelete).
- **Operation log** — the full history of changes; what gets
  replayed on merge.
- **State-based vs. operation-based** — two implementation
  styles.  Most real systems are hybrid.

---

## Automerge — the canonical artifact

**A JavaScript library that gives you CRDTs for JSON-like
data.**  Most CRDT theory papers focus on a single data type —
a counter, a set, a piece of text.  Automerge gives you the
whole shebang: nested objects, arrays, maps, text, all
automatically CRDT-replicated.  You write code that *looks like*
you're editing a normal JS object, and Automerge silently
tracks the changes as CRDT operations behind the scenes.

```js
// What it looks like to use:
let doc = Automerge.from({ tasks: [], title: 'My list' });

doc = Automerge.change(doc, d => {
  d.tasks.push({ name: 'buy milk', done: false });
  d.title  = 'My grocery list';
});

// Now sync `doc` to another device.  Both devices can edit
// independently, even offline.  Sync happens later.
doc = Automerge.merge(doc, otherDeviceDoc);
// → both devices end up with the same merged document
```

Built by Martin Kleppmann + Peter van Hardenberg + others.  Now
used by dozens of local-first projects.

The mental model: **Git, but continuous and automatic.** Every
device has a full copy.  Every change is recorded with
causality info.  When devices sync, they merge automatically
using CRDT rules.  There's also a full history you can replay
or branch.

### What Automerge is good at

- Real-time collaboration on rich documents.
- Offline-first apps where you can edit any time and sync when
  convenient.
- Multi-device sync without a server arbitrating.
- Small-to-medium amounts of structured data that multiple
  users edit.

### What Automerge is *not* good at

- Truly large data (the full history accumulates; document
  size grows over time).
- Strict consistency (two replicas can briefly disagree before
  they sync; eventual consistency is the model).
- Hard schema migrations (changing data shape across existing
  CRDT documents is tricky — which is why Cambria exists).
- Anything with bounds or constraints that require global
  coordination ("this counter can never go above 100" — CRDTs
  can't enforce this).

### Alternative: Yjs

The other major CRDT-for-JS-data library.  Differences:
- Yjs is **faster** for large text documents.
- Automerge has a **cleaner mental model** (the API feels like
  editing plain JS objects; Yjs has explicit shared-types).
- Yjs is more **production-tested** in shipping apps (Notion-
  shaped products use it).
- Both are good; both will be around for years.  Pick on
  performance vs. ergonomics.

---

## Where this cluster maps to this project

Two concrete places it might land:

### Use case #1 — collab docs (probably indirect)

The pass-3 decision was "integrate with an OSS docs tool that
brings its own sync."  So you probably don't touch Automerge
directly.  But many of those OSS tools (Cryptpad, HedgeDoc
plugins) use Automerge / Yjs / similar internally.  So you're
indirectly downstream of CRDTs whether you import the library
or not.

### Use case #4 — task ledger (more likely)

Multiple agents (humans on phones, devices) editing a shared
list of tasks, going offline often, syncing when they reconnect.
Each task has state (claimed-by, status, dependencies).  CRDTs
are exactly what this needs.  Automerge would handle:
concurrent task creation, concurrent claims (two people grab
the same task — needs care), task completion, dependency
updates, all without a server.

If #4 ever needs CRDT replication for medium-size groups,
Automerge is the default choice; Yjs is the runner-up; ECHO is
also possible if you also adopt DXOS infrastructure (see
`dxos.md`).

### Use case #2 + #4 — generally

The skill-broadcast / matchmaking primitive doesn't need CRDTs
(it's request-response, not replicated state).  But anywhere a
group of agents needs to share *evolving* state — a project
plan, a shopping list, a meeting agenda — CRDTs are the obvious
tool.

---

## Honest take / verdict

**Upstream intellectual influence, not a peer or competitor.**

Different from Holochain and DXOS in kind, not just degree:

- *Holochain* is a movement you could join.
- *DXOS* is a tools company you could partner with.
- *Ink & Switch / Local-First* is a body of research and
  artifacts you should *use*.

Concretely:

- **Use their vocabulary.** "Local-first," "the seven ideals,"
  "no spinners."  These terms have community recognition.
  Borrowing them costs nothing and gains positioning.
- **Read their essays.** Among the best technical writing in
  this field.  Worth real time.  Suggested order:
  1. *Local-First Software: You Own Your Data, in spite of the
     Cloud* (2019).  The founding essay.
  2. *A unifying theory of distributed programming* (2021) —
     Martin Kleppmann's broader framing of where CRDTs fit.
  3. *Cambria: A Lens-Based Approach to Schema Evolution* — if
     and when schema migration becomes a real problem.
  4. The various prototype write-ups (PushPin, Trellis,
     Patchwork) — for design wisdom rather than direct
     applicability.
- **Use Automerge if you need CRDTs.** The default choice.
  Yjs as the runner-up.  Don't roll your own.
- **Don't try to be them.** They're a research lab; you're
  building something users will use.  Different goal, different
  shape of work.

**Verdict:** upstream intellectual ancestor, default-choice
library supplier, vocabulary source.  Not a peer, not a
competitor, not a partner in the usual sense.  Background
radiation that shaped the field — like the Twelve-Factor App
methodology shaped backend engineering.  You don't "partner
with" Twelve-Factor; you absorb it.  Same here.

What this project owes them: read their essays, credit their
vocabulary, use Automerge when CRDTs are needed.  That's the
relationship.
