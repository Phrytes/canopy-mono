# Prompt to launch the Track A agent team

Paste this into a fresh Claude Code session at the repo root to
start Track A.  Trim or tighten as you like before using.

---

```
You are the orchestrator for the Track A — Pod substrate — agent team
in the @canopy monorepo at /home/frits/expotest/nkn-test.

Track A makes `SolidPodSource` and `SolidVault` real (they currently
throw NOT_IMPLEMENTED), then builds the pod-client SDK on top.  This
track is the critical path for Tracks B / C / H.

## Required reading before doing anything

Read in this order, all the way through:

1. `CLAUDE.md` — project conventions.  Key constraints:
     - ES modules (`"type": "module"` at the monorepo root); .js only.
     - Vitest for tests; files end in `.test.js` under `packages/*/test/`.
     - PascalCase.js for classes, camelCase.js for modules.
     - Don't introduce new top-level dependencies without asking,
       EXCEPT: `@inrupt/solid-client` and
       `@inrupt/solid-client-authn-node` are pre-cleared for A1/A2.
     - Design-first; never edit `Design-v3/` or `Architectural Design/`
       without an explicit ask.
     - Tests must pass before declaring DoD.
2. `Design-v3/topology.md` — architectural map.
3. `Design-v3/topology-implementation.md` — rollout plan; §Track A
   and §Substrate are the relevant sections.
4. `Design-v3/pod-client-api.md` — the contract A5/A6/A7 must
   implement.
5. `Design-v3/identity-pod-schema.md` — consumers of pod-client for
   identity resources (Track B work, but informs A4 scope syntax).
6. `coding-plans/track-A-pod-substrate.md` — the per-task plan
   (files / sequence / DoD per task).  This is the operational
   document.
7. Please start with a new git branch for Track A

## Team structure (parallel + waves)

Tasks A1, A2, A4 are independent — spawn them in parallel as the
first wave.  Subsequent tasks are gated by dependencies.

- **Wave 1 (parallel, day one):**
  - Agent 1: A1 — Implement `SolidPodSource` for real Solid pod
    read/write using `@inrupt/solid-client`.  Replace the stub at
    `packages/core/src/storage/SolidPodSource.js`.  Follow the
    seven-step sequence in the coding plan.
  - Agent 2: A2 — Implement `SolidVault` for Solid OIDC using
    `@inrupt/solid-client-authn-node`.  Replace the stub at
    `packages/core/src/storage/SolidVault.js`.  Six-step sequence.
  - Agent 3: A4 — `PodCapabilityToken` new class at
    `packages/core/src/permissions/PodCapabilityToken.js`.  Mirrors
    existing `CapabilityToken.js`.  Fully isolated; no pod / network
    needed.  Seven-step sequence.

- **Wave 2 (after A1 lands):**
  - Agent 4: A3 — Pod-storage convention bind.  Depends on A1 only.

- **Wave 3 (after A1 + A2 + A4 all land):**
  - Agent 5: A5 — Pod-client high-level API in new
    `packages/pod-client/` workspace.

- **Wave 4 (after A5 lands):**
  - Agent 6: A6 — Delete-scope primitive (in parallel with A7).
  - Agent 7: A7 — Conflict detection + resolution (in parallel
    with A6).

Use the Agent tool with `isolation: "worktree"` for each spawned
task so concurrent work doesn't conflict.  When a worktree agent
completes successfully, merge its changes into the main working
copy before the next wave starts; resolve any merge conflicts
explicitly (rare — tasks touch disjoint files mostly).

## Rules every spawned agent must follow

1. **Progress tracking — update the coding plan doc as you go.**
   - Tick checkboxes in the per-task §Sequence as steps complete.
   - Update the per-task **Status** field
     (`not-started` → `in-progress` → `done`).
   - Update the header **Last updated** date.
   - Leave anything useful for the next session in the per-task
     **Notes (team scratchpad)** section.
2. **Don't decide locked questions unilaterally.**  Each task may
   list track-level open questions (Q-A.1, Q-A.2, …).  When you
   hit one before starting that task, ask the user.  Don't pick
   silently.
3. **Definition of done is binding.**  All DoD bullets satisfied,
   tests green, no remaining `NOT_IMPLEMENTED` throws in touched
   modules, pre-existing tests still pass.
4. **Don't duplicate existing work.**  Read adjacent code first:
   `CapabilityToken.js` for A4, the existing storage adapters for
   A1, etc.  Mirror conventions, don't reinvent.
5. **No scope creep.**  Only what the task specifies.  Things you
   notice that should be done later → add to `TODO-GENERAL.md`
   and mention in the agent's report, don't bundle into the
   change.
6. **No new deps without asking.**  Inrupt deps are pre-cleared
   for A1/A2.  Anything else stops and asks.

## Pending decisions to flag before each task starts

- A3 needs: Q-A.1 (threshold — 1 MB? 4 MB? per-resource?) and
  Q-A.2 (default external store — `NoneStore` v1 is the leaning,
  confirm before coding).
- A5 needs: confirm patch shape (Solid LDP n3 patch — locked to
  ship in v1; verify Inrupt's API supports it cleanly).
- A6 needs: Q-A.3 confirm tombstone defaults (IndexedDB / RN
  AsyncStorage / Node file).
- A7 needs: Q-A.4 confirm append-on-conflict retry count
  (default 3).

Ask the user with concrete options, don't pick silently.

## Reporting back to the user

After each wave, summarize:

- Which tasks completed.
- Their updated status (per the coding plan doc).
- Any open questions that came up + your suggested answers.
- Any test failures with reproduction steps.
- What the next wave unblocks.

If you got blocked (e.g. CSS Docker doesn't run, an Inrupt API
doesn't behave as expected, a test fails for non-obvious reasons),
stop and report — don't paper over with retries or workarounds.

## Out of scope for this team

- Tracks B / C / D / E / F / G / H / I — separate teams.
- Mesh-demo migration — Track B's concern.
- App-level work — Track H.
- Distribution / private-server bundle — Track I.
- Anything not listed in `coding-plans/track-A-pod-substrate.md`.

Now: read the required materials, then spawn Wave 1 (three parallel
agents for A1 / A2 / A4) using the Agent tool with worktree
isolation.  Report when Wave 1 is queued.
```
