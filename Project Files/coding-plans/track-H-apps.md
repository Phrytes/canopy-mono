# Track H — Apps

| | |
|---|---|
| **Status** | not-started |
| **Started** | — |
| **Last updated** | 2026-04-29 — initial readiness analysis + recommendation |
| **Owner** | unassigned |
| **Blocked on** | partial — see per-app readiness below.  H3 is blocked on the parked LLM-choice decision; H5/H8 are partially blocked on E2c (push integration, deferred). |

**Goal:** ship the per-app L2 work on top of the SDK's L1 substrate
(Tracks A–G).  Each app is its own sub-track with its own
dependencies, design surface, and tests.

**Refs:**
- [`../Design-v3/topology-implementation.md` §Track H](../Design-v3/topology-implementation.md#track-h--apps)
- [`../Design-v3/topology.md`](../Design-v3/topology.md) — architectural map
- [`../USE CASES.md`](../USE%20CASES.md) — the seven use cases this track ships
- [`../projects/`](../projects/) — existing per-app design notes (L2 layer)

---

## Readiness analysis (2026-04-29)

Track H is **eight independent app sub-tracks**, each gated by
different combinations of SDK tracks.  Below is the readiness state at
the end of 2026-04-29.

### App-by-app readiness

| H | App | Deps | State | Verdict |
|---|---|---|---|---|
| **H1** | #1 Notes V0 (folder ↔ pod sync) | A ✅, B ✅ | ✅ **shipped + real-device validated** (web + mobile RN, see `track-H-app-folio.md`).  Polish queue still open. | Tier 1 — done |
| **H7** | #5 Archive read-side + SQLite FTS5 | A ✅, B ✅ | partial (v0 lib + CLI shipped; Phase B web UI not yet started — plan in `track-H-app-archive.md`) | **Tier 1 — next** |
| **H6** | #3 Import bridge (Google Docs first) | A ✅, B (B5 in flight), F ✅ | Ready as soon as B5 lands | Tier 2 |
| **H4** | #4 Tasks V0 (single household) | A ✅, B (B5 in flight), D ✅ | Ready as soon as B5 lands | Tier 2 |
| **H2** | #7 Household V0 (Telegram, no LLM) | A ✅, B, F1 ✅ | Ready, but high external-ops cost | Tier 3 — defer |
| **H5** | #2 Neighborhood (non-anonymous) | A, B, D, **E (E2c deferred)** | Partial — needs E2c for push wake; Q-H5 anonymity model open | Tier 3 — defer |
| **H8** | #6 Proof of location v0 (WiFi + on-LAN) | D ✅, **E (E2c deferred)** | Partial — needs E2c for offline-peer wake | Tier 3 — defer |
| **H3** | #7 Household V1 (LLM extraction) | H2 + **LLM choice (parked)** | Blocked on parked decision | Tier 4 — blocked |

### Tiered recommendation

#### Tier 1 — first wave once B5 lands: **H1 + H7**

The topology-implementation plan itself flags #1 + #7 as the
suggested first-wave apps — and the dependency math agrees.  Why
this pair:

- **H1 (Notes V0)** is the simplest possible pod-client validator.
  Single-user.  Folder ↔ pod sync = a clean, well-understood
  pattern.  Read+write loop on real markdown files.  No
  multi-member, no discovery, no external services.  Validates
  the SDK's hot path end-to-end before committing to anything
  more complex.

- **H7 (Archive read-side)** is read-only on the pod, plus a
  SQLite FTS5 layer for search.  Validates capability-token-gated
  sharing AND the "lots of small reads" performance profile.
  Doesn't risk pod corruption if buggy.  Complements H1
  (write-heavy) with a read-heavy companion.

Together they exercise pod-client read/write, IdentityPodStore,
capability tokens, conflict events, tombstones, and the
convention helpers — all the SDK surfaces shipped through Track A
and Track B — on real product code.

#### Tier 2 — once H1 + H7 prove the patterns: **H6 + H4**

- **H6 (Import bridge / Google Docs)** turns the migration use
  case real.  Real OAuth flow (F1's OAuthVault), real LiveSync
  (F2's LiveSyncSkill).  Single-user.  High product value: gives
  users a concrete reason to set up a pod.

- **H4 (Tasks V0, single household)** is the first multi-member
  app.  Single household = small group, simpler test surface
  than #2 Neighborhood.  Exercises Track D's role-aware groups +
  merge contracts.  Confirms the hybrid-pod patterns.

#### Tier 3 — defer

- **H2 (Telegram, no LLM)** ready dependency-wise, but Telegram
  bot setup brings real-network external-ops complexity (bot
  tokens, webhook routing, rate limits).  Bad first-app surface —
  too many things outside the SDK to debug.  Build AFTER H1/H4
  prove the SDK is stable.

- **H5 (Neighborhood)** needs E2c (push wake) for proper UX.
  Q-H5 anonymity model is also open per the
  [parked-questions table](../Design-v3/topology-implementation.md#parked-questions).
  Two unresolved gates.

- **H8 (Proof of location)** needs E2c.  Specialized use case.

#### Tier 4 — blocked

- **H3 (Household V1 / LLM extraction)** blocked on the parked
  LLM-choice decision (see Q-H3 in topology-implementation.md
  §Parked questions).

### Cross-app dependencies

```
H1 (Notes)              ── independent
H7 (Archive read-side)  ── consumes content from H6 long-term but
                          ships read-only first, no hard H6 dep
H6 (Import bridge)      ── independent, produces content for H7
H4 (Tasks)              ── independent
H2 (Household Telegram) ── independent
H5 (Neighborhood)       ── independent
H8 (Proof of location)  ── independent
H3 (Household + LLM)    ── builds on H2
```

---

## Architecture for repo-extraction

Each app should live as a **self-contained package** under
`apps/<app-name>/`, designed so it can be moved to its own repo
later without rewrites.

### File layout

```
apps/
  notes-v0/                                   # H1
    package.json                              # name: "@canopy-app/notes-v0"
    src/
      ...
    test/
      ...
    README.md
  archive-v0/                                 # H7
    package.json
    src/
      ...
    test/
      ...
    README.md
```

### Per-app `package.json` shape

```json
{
  "name":        "@canopy-app/notes-v0",
  "version":     "0.1.0",
  "type":        "module",
  "main":        "src/index.js",
  "scripts":     { "test": "vitest run" },
  "dependencies": {
    "@canopy/core":         "file:../../packages/core",
    "@canopy/pod-client":   "file:../../packages/pod-client",
    "@canopy/react-native": "file:../../packages/react-native"
  },
  "devDependencies": {
    "vitest": "^2.1.0"
  }
}
```

### Extraction-friendly rules

Every app must follow these to stay extraction-clean:

1. **Never** `import { X } from '../../packages/core/src/X.js'`.
   Only via the package name (`@canopy/core`, `@canopy/pod-client`,
   `@canopy/react-native`).  This means the app uses **only the public
   API surface** that's been designed for external consumers.
2. **Never** reach into adjacent apps.  Each app is a standalone island.
3. **Tests** live within the app's own `test/` and run against the
   app — not against SDK internals.
4. **Docs** as a `README.md` in the app root.  Cross-link to
   `projects/<n>-<name>/README.md` where the L2 design notes live.
5. App-specific deps (UI libs, parsers, etc.) go in the app's own
   `package.json`.  No app-specific dep ever lands in `packages/`.

### Extraction procedure (when an app moves to its own repo)

1. Copy `apps/<name>/` to the new repo as the root.
2. Change the `file:` deps in `package.json` to published versions
   (`@canopy/core: ^0.x.y` etc.).
3. Move the README's cross-links from relative paths to absolute
   URLs into the SDK repo.
4. The app moves cleanly because nothing references the
   surrounding monorepo.

### Caveat: SDK packages aren't on npm yet

Until `@canopy/core` and friends are published to npm:
- Apps in their own repos either need a git submodule pointing back
  at the SDK monorepo, OR
- A workflow that runs `npm pack` in `packages/<name>/` and installs
  the resulting tarball.

Not a blocker for the current monorepo layout — apps stay in
`apps/<name>/` and use `file:` references.  The extraction story
becomes important the day the SDK is published.

---

## Per-app coding plans

Each app gets its own per-app coding-plan section here once we
start drafting it.  Per-app plans follow the same shape as the
SDK track plans:

- **Open questions** — app-level decisions (UI shape, data model,
  edge cases) that need locking before coding.
- **Files** — what's created / modified per app sub-task.
- **Sequence** — ordered steps with checkboxes.
- **DoD** — binding completion criteria.
- **Notes (team scratchpad)** — running context for resuming.

Drafts to be written when we kick off each:

- [x] H1 — **Folio** (Notes V0) — shipped: A + B + C (web + mobile).  Real-device validated against Inrupt 2026-04-30.  Plan: [`./track-H-app-folio.md`](./track-H-app-folio.md).
- [~] H7 — Archive V0 — v0 lib + CLI shipped; web UI plan written ([`./track-H-app-archive.md`](./track-H-app-archive.md), 2026-04-30) but Phase B not yet started.
- [ ] H6 — Import bridge V0  *(plan-not-yet-written)*
- [~] H4 — Tasks V0 — design drafted ([`./track-H-app-tasks.md`](./track-H-app-tasks.md), 2026-05-02; Q-H4.1–9 not yet locked, see companion [`./track-H-app-tasks-questions.md`](./track-H-app-tasks-questions.md)).  Implementation plan deferred until questions are answered + B5 lands.
- [~] H2 — Household V0 (Telegram + LLM): designs drafted —
  - v1 (multi-member group chat, locked Q-H2.1–14): [`./track-H-app-household.md`](./track-H-app-household.md), companion [`./track-H-app-household-questions.md`](./track-H-app-household-questions.md)
  - **v2 (1:1 DM per member, conversational LLM, going-forward design)**: [`./track-H-app-household-v2.md`](./track-H-app-household-v2.md), Q-H2.15–21 not yet locked.
  - LLM model comparison run 2026-05-01: see `apps/household/docs/LLM-MODEL-COMPARISON.md`.
- [ ] H5 — Neighborhood (non-anonymous)  *(plan-not-yet-written, blocked)*
- [ ] H8 — Proof of location v0  *(plan-not-yet-written, blocked)*
- [ ] H3 — Household V1 (LLM)  *(plan-not-yet-written, blocked on LLM choice)*

---

## Hand-off triggers

| When this completes | What it unblocks |
|---|---|
| **H1** | Pod-storage convention + capability-token flow proven on real product code; users have a working markdown-notes app |
| **H7** | Read-side patterns proven (FTS5, pod-list-walk, capability-gated sharing); receives content from H6 once H6 lands |
| **H6** | Real-world OAuth + LiveSync; users have a migration tool; produces content for H7 |
| **H4** | First multi-member app; Track D's role-aware groups + merge contracts proven |
| **H2** | External-bridge pattern proven; Telegram-as-input works |
| **H5** | Closed-group governance + skill posture + skills pubsub proven (after E2c lands) |
| **H8** | Reuses #2 skill matchmaking on a different surface (after E2c lands) |
| **H3** | First LLM-mediated agent; tool-calling pattern proven (after LLM choice locked) |

---

## Cross-track / SDK-side gaps surfaced by app planning

These are not Track H tasks, but app planning has surfaced them:

- **E2c push integration** is needed by H5 + H8 for real offline-peer
  wake.  Currently deferred per Q-E.4.
- **LLM choice** (parked) is needed by H3.
- **Q-H5 anonymity model** (open per topology-implementation.md
  §Parked questions) is needed by H5.
- **Track-I distribution** (private-server bundle) is what app
  consumers will install once it ships.  H1's "folder ↔ pod sync"
  works without it; later apps may benefit from a packaged install.

---

## Pointers

- [`../USE CASES.md`](../USE%20CASES.md) — the seven use cases.
- [`../projects/01-notes-app/README.md`](../projects/01-notes-app/README.md) — H1's L2 design notes.
- [`../projects/02-neighborhood-app/README.md`](../projects/02-neighborhood-app/README.md) — H5's L2 design notes.
- [`../projects/03-import-bridge/README.md`](../projects/03-import-bridge/README.md) — H6's L2 design notes.
- [`../projects/04-tasks-app/README.md`](../projects/04-tasks-app/README.md) — H4's L2 design notes.
- [`../projects/05-archive-app/README.md`](../projects/05-archive-app/README.md) — H7's L2 design notes.
- [`../projects/06-proof-of-location/README.md`](../projects/06-proof-of-location/README.md) — H8's L2 design notes.
- [`../projects/07-household-app/README.md`](../projects/07-household-app/README.md) — H2 + H3's L2 design notes.
