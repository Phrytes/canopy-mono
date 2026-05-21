# Prompt to launch the Track B agent team

Paste into a fresh Claude Code session at the repo root.

---

```
You are the orchestrator for the Track B — Identity-as-pod-content sync
— agent team in the @canopy monorepo at /home/frits/expotest/nkn-test.

Track B ships the vault-pod sync model from `identity-pod-schema.md`.
Vault stays primary on-device; pod holds canonical identity state
across devices.  B1 (Bootstrap) starts immediately; B2–B5 wait for
Track A1 to complete.

## Required reading

First read `coding-plans/AGENT-RULES.md`.  Then read
`coding-plans/track-B-identity-sync.md` — the operational document.
Note that `Design-v3/identity-pod-schema.md` is the schema B2
implements byte-for-byte.

## Pre-cleared dependencies

None.  All needed crypto + identity primitives already exist
(`tweetnacl`, `Mnemonic.js`, `KeyRotation.js`).

## Team structure (waved, A-gated)

- **Wave 1 (immediate, independent of A):**
  - Agent 1: B1 — Bootstrap module.  Q-B.1 already locked
    (HKDF-SHA256 per schema).  Go.

- **Wave 2 (after Track A1 + B1 land):**
  - Agent 2: B2 — IdentityPodStore.  Implements the schema.

- **Wave 3 (after B2 lands):**
  - Agent 3: B3 — IdentitySync.  Decide Q-B.3 + Q-B.4 with the
    user before starting.
  - Agent 4: B4 — RN identity wiring.  Decide Q-B.2
    (mesh-demo migration shape) with the user before touching
    the demo.

- **Wave 4 (after B2 + B3 land):**
  - Agent 5: B5 — Vault → pod migration utility.

Use `isolation: "worktree"` for each spawned task.

## Pending decisions to flag (with concrete options)

- **Q-B.2** (B4) — Mesh-demo migration: side-by-side (new `pod`
  opt on createMeshAgent; existing flow unchanged) vs hard cut.
  Lean: side-by-side.
- **Q-B.3** (B3) — Manifest concurrent-write resolution:
  last-modified-LWW with retry vs per-device manifest fragments.
  Lean: LWW with retry.
- **Q-B.4** (B3) — Sync schedule: continuous polling / interval
  polling / push-only (LDN).  Lean: interval polling v1.

## Out of scope for this team

- Tracks A / C / D / E / F / G / H / I.
- Recovery / cloud-backup (Track C).
- Cross-track: B5 may need to coordinate with C if running
  side-by-side in time.

Now: read AGENT-RULES.md, then track-B-identity-sync.md, then spawn
B1 immediately.  Wait for Track A1 before spawning Wave 2.  Report
when each wave is queued.
```
