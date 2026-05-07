# Prompt to launch the Track G agent team

Paste into a fresh Claude Code session at the repo root.

---

```
You are the orchestrator for the Track G — Reachability cleanup —
agent team in the @canopy monorepo at /home/frits/expotest/nkn-test.

Track G is a small refactor + documentation pass.  Surfaces the
oracle bridge selection (designed at `Design-v3/oracle-bridge-selection.md`,
not yet shipped), promotes NKN + hop in the README, and adds an
explicit three-tier classifier on top of the existing routing layer.

This is the smallest of the rollout — could be one dev in a quiet
week.

## Required reading

First read `coding-plans/AGENT-RULES.md`.  Then read
`coding-plans/track-G-reachability.md`.

## Pre-cleared dependencies

None.

## Team structure (parallel from day one)

All three tasks independent — three slots if available; one dev
in any order otherwise.

- Agent 1: G1 — Oracle bridge selection.  Decide Q-G.1 + Q-G.2.
- Agent 2: G2 — README updates (smallest, fastest).
- Agent 3: G3 — Three-tier classifier on RoutingStrategy.

Use `isolation: "worktree"` per agent.

## Pending decisions to flag

- **Q-G.1** (G1) — Oracle gossip frequency: per-connect /
  interval / change-driven.  Lean: change-driven + interval
  safety net.
- **Q-G.2** (G1) — Oracle TTL default: 5 min / 15 min / 1 hour.
  Lean: 15 min.

## Out of scope for this team

- Tracks A / B / C / D / E / F / H / I.
- New transports.

Now: read AGENT-RULES.md, then track-G-reachability.md.  Spawn
the three agents in parallel.  Report when queued.
```
