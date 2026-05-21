# Agent rules — shared across all track launch prompts

These rules apply to every agent spawned to work on a track in
the @canopy monorepo at `/home/frits/expotest/nkn-test`.
Track-specific launch prompts under `coding-plans/track-*.md`
reference this file by name.

---

## Required reading before any work

Read in this order, all the way through:

1. `CLAUDE.md` — project conventions.  Constraints that bite:
   - ES modules; `.js` only.  Vitest for tests.
   - PascalCase.js for classes, camelCase.js for modules/helpers.
   - Tests live under `packages/*/test/`, end in `.test.js`.
   - **No new top-level deps without asking** (per-track
     pre-clearances are listed in that track's launch prompt).
   - Design-first.  Never edit `Design-v3/` or
     `Architectural Design/` without an explicit ask.
   - Tests must pass before declaring DoD.
2. `Design-v3/topology.md` — architectural map.
3. `Design-v3/topology-implementation.md` — rollout plan; read
   the §Substrate audit + the relevant §Track section.
4. `Design-v3/identity-pod-schema.md` — ratified schema.
   Some tracks consume this; even those that don't, should
   know what's pinned.
5. `Design-v3/pod-client-api.md` — pod-client surface
   contract.  Track A implements; other tracks may consume.
6. The track's own coding plan: `coding-plans/track-<X>-*.md`
   — the operational document.  Sequence + DoD per task.

---

## Progress tracking

The coding plan doc IS the progress tracker.  Every agent must:

- Tick checkboxes in §Sequence as steps complete.
- Update the per-task **Status** field
  (`not-started` → `in-progress` → `done`) at the **start**
  and **end** of work, not just the end.
- Update the header **Last updated** date.
- Update the per-task **Notes (team scratchpad)** with any
  context useful for resuming work in a later session — pinned
  versions, gotchas, deviations from the spec, things you
  noticed that future you (or another agent) will want to
  know.

If you stop work mid-task (interrupted, blocked, end of
session), leave the status as `in-progress` and write what
you'd do next in the scratchpad.  Don't leave the doc in a
state where the next session has to guess.

---

## Decision-making rules

- **Open questions are not yours to lock.**  Each track has a
  §Track-level open questions table.  When you reach a task
  that lists open questions, **stop and ask the user** with
  concrete options before proceeding.  Don't pick silently.
- **DoD is binding.**  All bullets satisfied.  Tests green,
  no skipped suites without a noted reason, no remaining
  `NOT_IMPLEMENTED` throws in modules you touched.
- **No scope creep.**  Only what the task specifies.
  Things you notice that should happen later → add to
  `TODO-GENERAL.md` with a brief context, mention in the
  agent's report, but **don't bundle into the same change**.
- **Don't duplicate existing work.**  Read adjacent code
  before writing new code.  If a class / pattern already
  exists, mirror it; don't reinvent.  Use the substrate audit
  in `topology-implementation.md` as your guide.
- **No new deps without asking.**  Track launch prompts list
  pre-cleared deps.  Anything else: stop and ask.

---

## Reporting back to the user

After each wave, summarize:

- Which tasks completed; their updated Status per the coding
  plan doc.
- Open questions that came up + your suggested answers.
- Test failures with reproduction steps.
- What the next wave unblocks.
- Any TODO-GENERAL.md entries you added.

If you got blocked (Docker doesn't run, an API doesn't behave
as expected, a test fails for non-obvious reasons), **stop and
report**.  Don't paper over with retries or workarounds.

---

## Worktree isolation

When spawning sub-agents in parallel via the Agent tool, use
`isolation: "worktree"`.  When a worktree agent finishes
successfully, merge its branch back into the track's working
branch before the next wave starts.  Resolve conflicts
explicitly.

---

## Out of scope (always)

- Editing files in `Design-v3/` (design docs are
  ratified — surface change requests instead).
- Editing files in `Architectural Design/` (reference only).
- Touching `apps/mesh-demo/` unless the track explicitly
  scopes it in.
- Other tracks' files.  Each track's plan lists what's in
  scope; respect it.
