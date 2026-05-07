---
status: proposal — needs your decisions before any work starts
author: drafted by Claude on 2026-04-30
---

# Repo cleanup & split — proposal

You asked for a plan to:

1. Split the giant `nkn-test` repo into smaller repos — one per package in
   `packages/` (with `integration-tests` flagged as awkward).
2. Give each app (`archive`, `folio`, `mesh-demo`, `sdk-smoke`) its own
   space — possibly its own repo too.
3. Group all of these under one project on GitHub.
4. Clean up the giant pile of loose docs scattered across the root.

This document is a **proposal you read and respond to**, not a script
I'll run.  It has three parts:

- **§1** — what's actually in the repo right now (so we agree on the inventory).
- **§2** — the decisions you need to make, with my recommendation and
  rationale for each.  This is the part to read carefully.
- **§3** — the step-by-step plan, only filled in once §2 is settled.
  Includes "what I do" vs "what you do".

There's also a **§4 Loose ends** at the bottom for things that need to be
flagged but don't fit a clean step.

---

## §1.  Inventory — what's actually here today

### `packages/` (the SDK)

| Package | Internal deps | Notes |
|---|---|---|
| `@canopy/core` | none | pure JS lib, browser+Node+RN |
| `@canopy/pod-client` | `core` | Solid pod helper |
| `@canopy/relay` | `core` (peerDep) | Node-only relay/rendezvous server, has `bin/relay.js` |
| `@canopy/react-native` | `core` (peerDep) + RN host deps | mDNS, BLE, Keychain |
| `@canopy/integration-tests` | `core` + `pod-client` + `relay` | private, never published; cross-package scenarios |

The dependency graph is a clean DAG.  Everything funnels into `core`.

### `apps/` (consumers of the SDK)

| App | Depends on | Type |
|---|---|---|
| `archive` | core, pod-client | web |
| `folio` | core, pod-client (likely more) | web |
| `folio-mobile` | **`apps/folio`**, core, pod-client, react-native | RN |
| `mesh-demo` | core, react-native | RN demo (Expo 52 — pinned) |
| `sdk-smoke` | core, pod-client, react-native | smoke test rig |
| `mesh-demo (17 april)/` | — | backup copy, not used |

The big surprise: **`folio-mobile` depends on `apps/folio`** (sibling).
That's a tight coupling: if they end up in different repos,
`folio-mobile` needs published artifacts from `folio`, or they stay
together.
> me: they stay together

### Top-level docs (the mess)

**Root markdown** (12+ files, much overlap):

```
ARCHITECTURE.md          ARCHITECTURE-REVIEW.md
CLAUDE.md                CONTRIBUTING.md
CODING-PLAN.md           IMPLEMENTATION-PLAN.md   EXTRACTION-PLAN.md
HANDOFF.md               (Electron-era, stale)
QUICKSTART.md            README.md
LOCAL LLM OVERVIEW.md    TASK_SPEC.md
TODO-GENERAL.md          TODO-GROUPS-HI.md   TODO-GROUPS-KL.md
USE CASES.md
```

Plus a leftover LibreOffice lock file `.~lock.SDK_DESIGN.md#` from a
file that no longer exists.

**Design folders** (three generations of design specs):

```
Design/                 14 files, "Design v1"
Design-A2A/             9 files, A2A-protocol-specific
Design-v3/              17 files (the current one per CLAUDE.md)
Architectural Design/   PDF proposal + .txt drafts (oldest)
```

**Plan folders**:

```
coding-plans/           track-A through track-K launch prompts + plans
                        + this file.  Active.
projects/               README per future-app-idea (00 through 07).
                        Mostly product-y, not coding plans.
                        Has its own README.md.
peer projects/          competitor notes (dxos, holochain, local-first)
session-notes/          empty
examples/mesh-demo/     parallel to apps/mesh-demo (purpose unclear)
```

**Heavy ballast**:

```
old/                    84 MB of old prototype code (client.html,
                        signaling/, demo.html, etc.)
node_modules/           gitignored; appears as untracked sometimes
.obsidian/, .vercel/    editor/tooling state
```

### Git state

- **Remote**: `Phrytes/canopy-mono` — a personal repo, not an org.
- **Branch**: `track-H-folio` (default `master`).
- Repo size is mostly history + the `old/` directory.

---

## §2.  Decisions you need to make

Five forks, each with a recommendation.  Pick a row in each table and
the §3 plan adjusts accordingly.

### 2.1  How far to split the SDK packages

You proposed: **one repo per package** (5 repos).  I want to flag the
trade-offs honestly because this is a one-way door.

| Option | What it looks like | Pros | Cons |
|---|---|---|---|
| **A.  Five repos** (one per package) | `canopy-core`, `canopy-pod-client`, `canopy-relay`, `canopy-react-native`, `canopy-integration-tests` | Clean ownership boundary per package.  Each can have its own release cadence and CI. | `file:../core` becomes `^x.y.z` from npm registry → every change in `core` means: bump version, publish, then bump-and-test in 4 downstream repos.  Cross-cutting refactors become 5 PRs.  Integration-tests in particular is awful here. |
| **B.  One SDK monorepo** (current `packages/` becomes its own repo) + per-app repos | One `canopy` repo with all 5 packages; apps split out separately. | Cross-cutting refactors are one PR.  `file:../core` keeps working internally.  Releases per package via tooling (Changesets / Lerna).  This is what most SDK monorepos do (Vercel AI SDK, AWS SDK v3, etc.). | Still one repo for the SDK side — slightly less "clean separation" than A. |
| **C.  Two-tier monorepo** (SDK monorepo + apps monorepo) | `canopy` repo (packages) + `canopy-apps` repo (all apps). | Same monorepo benefits twice.  Apps share tooling. | Two repos to keep in sync version-wise. |

**My recommendation: B.**

Reason: `integration-tests` is by definition cross-package; isolating
each package into its own repo turns one PR into five.  Most pain you
were feeling is from **the docs**, not from packages being co-located —
the dependency graph between packages is small and clean, and the SDK
ships as a coherent unit anyway.

If you still prefer A, the work is doable but I want you to commit to
it eyes-open: "I accept that every `core` change is a 5-step dance."

**Decision: B.

### 2.2  How far to split the apps

Same fork, but for apps:

| Option | What it looks like | Pros | Cons |
|---|---|---|---|
| **App-A.  One repo per app** (4 repos: archive, folio, mesh-demo, sdk-smoke) | Each app stands alone. | True per-app independence. | `folio-mobile` depends on `folio` → either they stay co-located or you have to publish `folio` as an npm package.  `mesh-demo` and `sdk-smoke` are tiny demos; a whole repo each is overkill. |
| **App-B.  One apps monorepo** (`canopy-apps`) | All apps in one place. | `folio-mobile` ↔ `folio` works via `file:..`.  Demos and smoke rigs stay lightweight. | Less isolation — but the apps already share dev tooling. |
| **App-C.  Folio gets its own repo** (with `folio-mobile`); the rest live in `canopy-apps` (or stay as demos in the SDK repo) | Folio is the "real product"; the rest are demos. | Folio gets product-grade independence; demos stay close to the SDK they demo. | One more repo to track. |

**My recommendation: App-C.**

Reason: Folio is the only app with users-in-mind; the others are
demos for the SDK and benefit from co-location with it.  But this is a
softer call — App-B is also fine if you don't want to special-case
Folio.

**Decision needed:** App-C.

### 2.3  GitHub layout — what does "one project" mean to you

This term has two meanings on GitHub and they're very different:

- **A GitHub Organization** (`github.com/canopy/*`) — a namespace that
  holds multiple repos.  This is what you usually want.  Free for public
  repos.  Migrating means moving the current repo from `the-author/...` to
  `canopy/...` (preserves stars/issues/PRs via redirect).
- **A GitHub Project** (the kanban/board feature, "Projects v2") — a
  cross-repo issue tracker.  Independent of the org concept.  You can
  have one of these whether your code is in 1 repo or 20.

**My recommendation:**

- Create a **GitHub Organization** named `canopy` (or whatever you
  want — the npm scope is `@canopy` so matching feels right).
- Move the current repo into it.  Then any new split-out repos live
  there too.
- Optionally add a Projects-v2 board that tracks issues/PRs across
  every repo in the org.  That gives you the "one place to see all
  work" feeling.

**Decision needed:** what's the org name, and do you want a Projects-v2
board on top.

### 2.4  Git history — preserve per-package, or start fresh

When you split a repo you choose between:

| Option | How | Result |
|---|---|---|
| **Hist-A.  Preserve per-package history** | Use `git filter-repo` (or `git subtree split`) to extract `packages/core/` history into its own repo, etc. | Each new repo has the full history of just its files.  Blame still works.  Slightly involved. |
| **Hist-B.  Fresh start with a single squashed commit per repo** | `git init` in each new repo, copy current state, single "Initial extraction from monorepo" commit. | Simple.  Loses history.  Acceptable if you never look at `git blame` for old work. |
| **Hist-C.  Hybrid — keep monorepo as archive, new repos start fresh** | Don't delete the current repo; archive it.  New repos start fresh with a link back. | Best of both — history is preserved (in archive) and new repos are clean. |

**My recommendation: Hist-C.**

Reason: `git filter-repo` works but is fiddly and `old/` is 84 MB of
ballast that bloats every extraction.  Easiest path: archive the
current repo (rename to `canopy-monorepo-archive`, mark read-only),
start the new ones fresh.  If we ever want history we know where to
find it.

**Decision needed:** Hist-A, Hist-B, or Hist-C.

### 2.5  When does the cleanup happen, vs when does the split happen

These are genuinely separable:

- **Phase X: Docs/cleanup only** — no repo split, just clean the mess
  in the current repo.  Low risk, fully reversible (it's just `git
  mv` and `git rm`).  Buys you a saner repo to work in even if you
  defer the split.
- **Phase Y: The split** — actually creating new repos.  One-way door.
  Requires §2.1–2.4 to be settled.

**My recommendation:** **Do Phase X first, get one or two weeks of
working in the cleaner layout, then decide if the split is still
worth it.**  Often once the docs are tidy the "this repo is too big"
feeling shrinks a lot.

**Decision needed:** do X then Y, or do them together.

---

## §3.  The step-by-step plan

Filled in **assuming my recommendations are accepted** (B, App-C,
org named `canopy`, Hist-C, X then Y).  If you pick differently,
I'll rewrite the relevant phase before we start.

Each step is labelled:

- **[claude]** — I do it (file edits, git commands in this repo).  Safe.
- **[you]** — you do it (GitHub web UI, npm, anything that touches
  external services).
- **[both]** — collaborative; I prepare, you approve before commit.

### Phase X — Docs cleanup (current repo, no split yet)

Roughly half a day of edits.  All reversible.

#### X.1  Audit pass [both]

I produce one short doc that for each loose `*.md` says:
"keep / merge into Y / delete / archive".  You veto/approve in
one pass.  Deliverable: `coding-plans/docs-audit.md`.

Specific decisions I'll need from you in that doc:

- **`Design/` vs `Design-A2A/` vs `Design-v3/`** — `Design-v3/` is the
  current one (per CLAUDE.md).  Are the older two safe to move into
  an `archive/design/` folder?
- **`Architectural Design/`** — the PDF is the original NLnet proposal;
  worth keeping.  The .txt drafts: archive?
- **`old/`** — 84 MB of dead prototype.  Move to a separate
  `canopy-archive` repo (or just delete; the git history of the
  current repo still has it)?
- **Root planning docs** — `CODING-PLAN.md`, `IMPLEMENTATION-PLAN.md`,
  `EXTRACTION-PLAN.md` are all >30 KB and overlap.  My read: roll
  whatever's still relevant into `coding-plans/`, archive the rest.
- **`HANDOFF.md`** (root) — Electron-era, superseded by
  `coding-plans/HANDOFF-NEXT-SESSION.md`.  Delete or archive?
- **`projects/`** — these are app-idea README's, not coding plans.
  Move under `Design-v3/apps/` or keep at root?
- **`peer projects/`** — competitor research.  Keep, but rename (the
  space in the directory name is a hassle).  Move to
  `Design-v3/peer-projects/`?
- **`examples/mesh-demo/`** vs **`apps/mesh-demo/`** — what's the
  difference?  I genuinely don't know which is canonical.  You tell me.
- **`session-notes/`** — empty.  Delete.
- **`.~lock.SDK_DESIGN.md#`** — leftover lock file.  Delete.
- **`apps/mesh-demo (17 april)/`** — backup with a date in the name.
  Delete or archive?

#### X.2  Apply the audit [claude]

Single commit per logical group:

- `chore(docs): archive Design v1 + A2A; Design-v3 is current`
- `chore(docs): consolidate root planning docs into coding-plans/`
- `chore(docs): delete dead prototypes from old/ (moved to archive repo)`
- `chore(docs): tidy projects/ + peer-projects/`
- `chore(docs): remove stale lock + dated backup directories`

After this commit set, root-level `*.md` should be: `README.md`,
`CLAUDE.md`, `CONTRIBUTING.md`.  Maybe `QUICKSTART.md`.  Everything
else lives in a designated subfolder.

#### X.3  Update CLAUDE.md and README [claude]

CLAUDE.md currently says "`Design/`01–08 is the spec; code follows
docs."  After cleanup that's wrong.  I update to point at `Design-v3/`
and refresh the file tree section.

#### X.4  Sanity check [both]

`npm test` still passes (cleanup shouldn't have touched code, but I
verify anyway).  You glance at the new layout and say "yes this feels
better" or "redo X".

**Phase X stop point — pause here, work in the cleaner repo for a
week or two, then decide whether to go to Phase Y.**

### Phase Y — The split (one-way door)

Only start once Phase X has settled and you've decided yes on §2.1–2.4.

#### Y.1  Create the GitHub org [you]

- Create org `canopy` (or whatever you decided).
- Set up team, basic settings, default branch protection.
- Create empty repos: `canopy` (the SDK), `folio` (Folio + Folio
  mobile), `canopy-apps` (mesh-demo + sdk-smoke + archive), and
  `canopy-archive` if going Hist-C.

#### Y.2  Archive the current repo [you]

- Rename `Phrytes/canopy-mono` → `the-author/canopy-monorepo-archive`
  (or transfer to the new org under that name).
- Mark it as archived (read-only) on GitHub.
- Pin a notice in the README pointing at the new repos.

#### Y.3  Push the SDK monorepo [claude + you]

- I prep a clean tree containing just `packages/` + tooling +
  top-level docs.
- I scaffold a Changesets-based release workflow (or pnpm workspaces +
  npm publish — your call).
- You create the empty `canopy/canopy` repo on GitHub.
- I `git init` + first commit + push.
- We verify CI runs and `npm test` passes there.

#### Y.4  Push the Folio repo [claude + you]

- Tree: `apps/folio/` + `apps/folio-mobile/`, with their `file:../`
  paths rewritten to `^0.1.0` from npm.
- This means **the SDK monorepo must publish to npm first** so Folio
  can install from the registry.  → Order: Y.3 must publish before Y.4.
- Same dance: scaffold, push, verify.

#### Y.5  Push the apps repo [claude + you]

- Tree: `apps/archive/` + `apps/mesh-demo/` + `apps/sdk-smoke/`.
- Same dance.

#### Y.6  Tear down the local monorepo [both]

- Once all three new repos are working, my local `nkn-test/` becomes
  redundant.  We probably want to keep it around locally for a while
  as a fallback — but stop committing to it.
- Update `~/.claude/projects/.../memory/` to point at the new repos.

### Phase Y caveats

- **Publishing to npm**: `@canopy/core` etc. are currently `0.1.0`
  and almost certainly not on the public registry.  First publish is
  user-attended (you need to log in, decide public/private, decide
  unscoped vs scoped, etc.).  If we want to delay public publishing,
  we could use a private registry (Verdaccio) or GitHub Packages.
- **Mesh-demo's pinned versions**: per CLAUDE.md, `apps/mesh-demo` is
  on Expo 52 / RN 0.76.9, and the dev build is already on the phone.
  Splitting it into its own location is fine; bumping versions during
  the split is **not** fine — keep the lockfile and `node_modules`
  layout identical.
- **`folio-mobile` ↔ `folio` link**: simplest to keep them in the same
  repo (`folio` repo).  Then they share `file:..` and don't depend on
  the npm registry for that link.

---

## §4.  Loose ends — things that need to be flagged

These don't fit cleanly into a step but you should know about them
before you commit to the plan.

### 4.1  npm scope ownership

`@canopy` is currently used as a scope in package.json files but I
don't know if it's been claimed on npmjs.com.  If someone else owns
the scope, we have a naming problem.  → **You should check
`https://www.npmjs.com/package/@canopy/core` (404 = scope is free or
package not published; scope claim is a separate signup) before we
commit to that name in public repos.**

### 4.2  CLAUDE.md and AGENT-RULES.md need a content review

Both reference the current monorepo layout in detail.  After the split
they'll need rewrites — and probably one CLAUDE.md per new repo.  I'll
draft these as part of Y.3–Y.5 but you should expect to read three
short CLAUDE.md files instead of one.

### 4.3  The current branch (`track-H-folio`) is not on master

It carries the most recent work (Folio C1+C2, the handoff pivot).
Before any of this, we should merge it to master so the cleanup work
isn't sitting on a feature branch.  → Mini-step before Phase X: **merge
`track-H-folio` to master.**

### 4.4  GitHub Actions workflows

`.github/` exists.  Whatever's in it works against the current repo
layout — it will break on split.  Each new repo needs its own minimal
workflow; I can scaffold these but you should expect a few iterations
of "CI is red" before things settle.

### 4.5  CHANGELOG / release notes

The packages have no CHANGELOGs today.  If we're going public on npm,
this is the moment to introduce Changesets (or similar) so future
releases get proper changelogs from day one.  Otherwise we end up
publishing `0.1.0`, `0.1.1`, `0.1.2` with no context.

### 4.6  License files

I didn't see a `LICENSE` at root.  If the goal is open-source (per
CLAUDE.md), each new repo needs one.  → Pick a license now (MIT?
Apache-2.0? MPL?) so the new repos all get the same file from day one.

### 4.7  The `old/` directory and history bloat

84 MB of `old/` is in the current git history forever.  If we go
Hist-C (archive the current repo) this is fine — only the archive
carries the bloat.  If you ever change your mind and want history
preserved per-package via `git filter-repo`, `old/` is a non-issue
because `filter-repo` extracts only the paths you ask for.

### 4.8  `Architectural Design/` has a PDF

`202603 Proposal NLnet0-2.pdf` is the original NLnet grant proposal.
Treat this as load-bearing — it's the source-of-truth for what was
promised.  Whatever final layout we end up with, that PDF needs to
survive (probably in an `nlnet/` subfolder of the SDK repo, or in the
archive repo).

### 4.9  Mobile is on hold (per the most recent handoff)

This means the urgency on `react-native` package isolation and on
`folio-mobile` repo separation is **low** right now.  We can ship Phase
X without touching anything mobile, and Phase Y can defer the
mobile-related splits if we want.

---

## §5.  TL;DR — what I need from you

Before any work starts, I need answers to these questions:

1. **Split granularity for packages** — A (5 repos) / **B (1 SDK repo)** / C (2 monorepos)?
2. **Split granularity for apps** — App-A / App-B / **App-C (Folio its own repo, rest co-located)**?
3. **GitHub org name** — `canopy`?  Something else?
4. **Git history** — Hist-A (per-package preserve) / Hist-B (squash) / **Hist-C (archive current, fresh starts)**?
5. **Phasing** — **X then Y (recommended)** or X+Y together?
6. **Loose ends to address now**: npm scope availability (4.1), license choice (4.6), and confirming we want to merge `track-H-folio` to master before cleanup (4.3).

**Bold = my recommendation.**  Reply with your picks and I'll either
start Phase X or rewrite §3 to match.
