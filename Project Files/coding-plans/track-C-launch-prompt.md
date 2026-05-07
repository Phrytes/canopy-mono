# Prompt to launch the Track C agent team

Paste into a fresh Claude Code session at the repo root.

---

```
You are the orchestrator for the Track C — Recovery + backup tooling
— agent team in the @canopy monorepo at /home/frits/expotest/nkn-test.

Track C ships the user-controlled recovery surface: BIP-39 seed +
encrypted cloud backup + portable-pod-bundle export + UI flows.

## Required reading

First read `coding-plans/AGENT-RULES.md`.  Then read
`coding-plans/track-C-recovery-backup.md` — the operational document.

## Pre-cleared dependencies

- `dropbox` SDK (npm) for `DropboxAdapter` (C2 first adapter).
  Other cloud SDKs ship later — ask before adding.

## Team structure (waved + cross-track gates)

- **Wave 1 (after Track B1 lands):**
  - Agent 1: C1 — CloudBackup module.  Decide Q-C.1 + Q-C.2 +
    Q-C.5 with the user before starting.

- **Wave 2 (parallel with C1, after B1):**
  - Agent 2: C2 — Cloud adapter platform shims (iOS / Android).
    First adapter per Q-C.5; others follow.

- **Wave 3 (after Track A5 lands):**
  - Agent 3: C3 — PodExporter / PodImporter.

- **Wave 4 (after C1 + C3 land):**
  - Agent 4: C4 — Recovery flow UI.  Decide whether to extend
    mesh-demo or build a new admin app.
  - Agent 5: C5 — Backup nudges.  Decide Q-C.4 with the user.

Use `isolation: "worktree"` for each spawned task.

## Pending decisions to flag (with concrete options)

- **Q-C.1** (C1) — What goes in the cloud backup:
  bootstrap-only / bootstrap + recovery hints / full pod state.
  Lean: bootstrap + recovery hints.
- **Q-C.2** (C1) — Cloud-backup encryption-key derivation:
  bootstrap directly / KDF-derived from bootstrap / separate
  user passphrase.  Lean: KDF-derived.
- **Q-C.4** (C5) — Backup-cadence default: daily / weekly /
  monthly nudge.  Lean: monthly.
- **Q-C.5** (C1+C2) — Cloud adapters v1: which platforms first.
  Lean: Dropbox first (cross-platform), iCloud + Drive followup.

## Out of scope for this team

- Tracks A / B / D / E / F / G / H / I.
- The actual Bootstrap module (Track B1).
- Real Pod client implementation (Track A).

Now: read AGENT-RULES.md, then track-C-recovery-backup.md.  Wait for
B1 before spawning C1; wait for A5 before spawning C3.  Report each
wave queued.
```
