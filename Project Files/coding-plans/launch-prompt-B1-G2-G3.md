# Launch prompt — three parallel quick wins (B1 + G2 + G3)

Paste into a fresh Claude Code session at the repo root.

Scope: three independent tasks across Tracks B and G that have
**no open questions** and **no unmet dependencies**.  Run them in
parallel.

---

```
You are the orchestrator for a three-task parallel wave in the
@canopy monorepo at /home/frits/expotest/nkn-test:

- B1 — Bootstrap module
- G2 — README updates surfacing NKN + hop as first-class transports
- G3 — Three-tier reachability classifier

All three are independent, have no open questions, and have all
dependencies met.  No user confirmation needed before agents start.

## Required reading

First read `coding-plans/AGENT-RULES.md` — common rules every
spawned agent must follow.

Then, per task, read the relevant section of the track plan:

- B1: `coding-plans/track-B-identity-sync.md` §B1
- G2: `coding-plans/track-G-reachability.md` §G2
- G3: `coding-plans/track-G-reachability.md` §G3

The schema doc `Design-v3/identity-pod-schema.md` is required
reading for B1 (encryption-protocol section + bootstrap-key
fingerprint).

## Pre-cleared dependencies

None.  All three tasks build on existing substrate.

## Three parallel agents (Wave 1 — all independent)

- **Agent 1: B1 — Bootstrap module.**
  Q-B.1 (HKDF-SHA256 per schema) already locked; no questions.
  Files:
    - create: `packages/core/src/identity/Bootstrap.js`
    - create: `packages/core/test/identity/Bootstrap.test.js`
    - modify: `packages/core/src/identity/index.js` (export)
  Composes existing `Mnemonic.js` + `KeyRotation.js` + `AgentIdentity.js`.
  Seven-step sequence in track-B-identity-sync.md §B1.

- **Agent 2: G2 — README updates.**
  No open questions.  Pure documentation pass.
  Files:
    - modify: `README.md` (main repo)
    - modify or create: `packages/core/README.md`
    - modify: `apps/mesh-demo/README.md`
  Surface NKN + hop-tunnel as first-class transports.  Don't
  oversell ("experimental") things that are actually shipped.
  Four-step sequence in track-G-reachability.md §G2.

- **Agent 3: G3 — Three-tier reachability classifier.**
  No open questions.  Small refactor on existing `RoutingStrategy.js`.
  Files:
    - create: `packages/core/src/routing/ReachabilityTier.js`
    - create: `packages/core/test/routing/ReachabilityTier.test.js`
    - modify: `packages/core/src/routing/RoutingStrategy.js` (add tier classification)
  Three tiers: `direct` / `mesh` / `hop`.  Expose
  `agent.reachabilityFor(peerId)`.
  Four-step sequence in track-G-reachability.md §G3.

Use the Agent tool with `isolation: "worktree"` for each spawned
agent.  Tasks touch disjoint files, so merging back to the main
working copy after each agent completes should be conflict-free.

## Per-agent rules (recap from AGENT-RULES.md)

- Update the relevant track plan as work progresses (Status,
  Last updated, Sequence checkboxes, Notes scratchpad).
- DoD bullets are binding.  Tests green.
- No scope creep.  Things you notice for later → `TODO-GENERAL.md`.
- No new top-level deps without asking.

## Reporting back

After each agent completes (or all three):
- Per task: Status updated in the coding-plans doc; test counts.
- Open questions that surfaced (none expected — flag if any).
- Test failures with reproduction steps.
- TODO-GENERAL.md additions, if any.

If any agent hits a real blocker, stop and report.  Don't paper
over.

## Out of scope

- Any other tasks in Tracks A / B / C / D / E / F / G / H / I.
- Mesh-demo migration (Track B's later concern).
- App-level work.

Now: read AGENT-RULES.md, then spawn the three agents in parallel
via the Agent tool with worktree isolation.  Report when all three
are queued.
```
