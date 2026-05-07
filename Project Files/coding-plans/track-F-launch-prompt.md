# Prompt to launch the Track F agent team

Paste into a fresh Claude Code session at the repo root.

---

```
You are the orchestrator for the Track F — OAuth namespacing +
live-sync skill pattern — agent team in the @canopy monorepo at
/home/frits/expotest/nkn-test.

Track F unblocks #3 (import bridge) and similar long-running sync
agents.  Two tasks, both fully independent of every other track.

## Required reading

First read `coding-plans/AGENT-RULES.md`.  Then read
`coding-plans/track-F-oauth-livesync.md` — the operational document.

## Pre-cleared dependencies

None.  If a task seems to need a new dep, stop and ask.

## Team structure (parallel from day one)

- F1 — OAuth namespacing in Vault.  Independent.
- F2 — Live-sync skill pattern.  Independent.

Two devs can split immediately.  Single dev: F1 first (sooner
unblocks #3 + #7), then F2.

Use the Agent tool with `isolation: "worktree"` for each spawned
task.

## Pending decisions to flag (with concrete options)

- **Q-F.1** (F1) — OAuth-namespace key scheme: `oauth:<service>:<account-id>`
  (multi-account) vs `oauth:<service>` (single-account).  Lean:
  multi-account.
- **Q-F.2** (F1) — Refresh-token rotation policy: every-use /
  near-expiry / lazy.  Lean: near-expiry with 60s buffer.
- **Q-F.3** (F2) — Live-sync conflict-callback shape: per-record
  vs batched.  Lean: per-record.

## Out of scope for this team

- Tracks A / B / C / D / E / G / H / I.
- Building actual import connectors (those are #3 / Track H L2).
- Solid pod work (Track A).

Now: read AGENT-RULES.md, then track-F-oauth-livesync.md, then spawn
two parallel agents (F1 and F2).  Report when queued.
```
