# Prompt to launch the Track D agent team

Paste into a fresh Claude Code session at the repo root.

---

```
You are the orchestrator for the Track D — Multi-member infrastructure
— agent team in the @canopy monorepo at /home/frits/expotest/nkn-test.

Track D ships SDK primitives that multi-member apps (#2 / #4 / #6 / #7)
need: per-skill posture metadata, a broadcast-of-skills primitive,
role-aware groups, merge contracts, and the federated reader.  This
track has no dependency on Track A — it builds on already-existing
substrate (skills framework, pubSub, GroupManager) and on pure-function
modules.

## Required reading

First read `coding-plans/AGENT-RULES.md` — common rules for every
spawned agent.  Then read the track-specific operational document:
`coding-plans/track-D-multi-member.md`.

## Pre-cleared dependencies

None.  Track D builds entirely on existing substrate.  If a task
seems to need a new dep, stop and ask.

## Team structure (parallel + waves)

- **Wave 1 (parallel, day one — three slots):**
  - Agent 1: D1 — Skill posture flag.  Extends `defineSkill.js`,
    `SkillRegistry.js`, `capabilities.js`.  Decide Q-D.2 with the
    user before starting.
  - Agent 2: D3 — Role-aware groups.  Extends `GroupManager.js`,
    `PolicyEngine.js`.  Decide Q-D.1 + Q-D.5 with the user before
    starting.
  - Agent 3: D4 — Merge contracts library.  Pure functions in
    `packages/core/src/storage/MergeContracts/`.  No open
    questions — go.

- **Wave 2 (after D1 lands):**
  - Agent 4: D2 — Skills pubsub.  Decide Q-D.4 with the user
    before starting.

- **Wave 3 (after D4 lands):**
  - Agent 5: D5 — Federated reader.  Decide Q-D.3 with the user
    before starting.  Implementation goes against a mock
    PodClient interface; integration tests are gated until
    Track A5 ships.

Use the Agent tool with `isolation: "worktree"` for each spawned
task.  Merge worktree branches back into the Track D working
branch as each agent completes.

## Pending decisions to flag (with concrete options)

- **Q-D.1** (D3) — Role taxonomy: standard set only, or
  app-defined extensions?  Lean: 5 standard roles
  (admin / coordinator / member / observer / external) + app-
  defined-extension API.
- **Q-D.2** (D1) — Skill posture orthogonality: single enum
  (`posture: 'always'|'negotiable'|'humanInTheLoop'`) vs
  orthogonal flags (`posture` + `humanInTheLoop`).  Lean:
  orthogonal.
- **Q-D.3** (D5) — Federated-reader failure mode default:
  `fail-on-any` / `partial-success-with-flag` / `best-effort`.
  Lean: `partial-success-with-flag`.
- **Q-D.4** (D2) — Skills-pubsub topic naming: flat vs
  hierarchical with wildcards.  Lean: hierarchical
  (`skills:<group-id>:<posture>:<skill-id>`).
- **Q-D.5** (D3) — Group revocation vs role demotion as
  separate primitives or merged?  Lean: keep `revokeProof` as
  full revocation; add `setRole(...)` as the demote/promote
  primitive.

Ask the user with options like the above; don't decide
unilaterally.

## Out of scope for this team

- Tracks A / B / C / E / F / G / H / I — separate teams.
- Any pod-side work (Track A's domain).
- App-level work (Track H).

Now: read AGENT-RULES.md, then track-D-multi-member.md, then spawn
Wave 1 (three parallel agents) using the Agent tool with worktree
isolation.  Report when Wave 1 is queued.
```
