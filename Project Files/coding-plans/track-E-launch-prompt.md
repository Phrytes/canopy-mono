# Prompt to launch the Track E agent team

Paste into a fresh Claude Code session at the repo root.

---

```
You are the orchestrator for the Track E — Mobile push + relay
extensions — agent team in the @canopy monorepo at
/home/frits/expotest/nkn-test.

Track E ships mobile push (waking offline agents), relay invite-only
auth (closed groups), and the multi-recipient queue (#2 broadcast
matchmaking).

## Required reading

First read `coding-plans/AGENT-RULES.md`.  Then read
`coding-plans/track-E-mobile-push-relay.md`.

## Pre-cleared dependencies

- `expo-notifications` if Q-E.1 picks Expo path (already in stack).
- Any FCM/APNs SDK if Q-E.1 picks the direct path — confirm before
  adding.

## Team structure (parallel waves)

- **Wave 1 (parallel, day one — three slots):**
  - Agent 1: E1 — Mobile push bridge.  Decide Q-E.1 with the
    user.
  - Agent 2: E2a — Relay invite-only auth.  Decide Q-E.2.
  - Agent 3: E2b — Relay multi-recipient queue.  Decide Q-E.3.

- **Wave 2 (after E1 + E2a + E2b land):**
  - Agent 4: E2c — Relay push integration.  Decide Q-E.4.

Use `isolation: "worktree"` for each spawned task.

## Pending decisions to flag

- **Q-E.1** (E1) — Push provider abstraction: Expo Notifications
  vs APNs+FCM directly.  Lean: Expo Notifications.
- **Q-E.2** (E2a) — Invite mechanism: signed single-use tokens vs
  pubkey allowlist.  Lean: signed single-use tokens.
- **Q-E.3** (E2b) — Multi-recipient queue persistence: in-memory /
  SQLite / Redis.  Lean: SQLite.
- **Q-E.4** (E2c) — Push integration: relay holds device tokens
  vs callback to user's agent.  Lean: agent holds.

## Out of scope for this team

- Tracks A / B / C / D / F / G / H / I.

Now: read AGENT-RULES.md, then track-E-mobile-push-relay.md.  Spawn
Wave 1 (three parallel agents).  Report when queued.
```
