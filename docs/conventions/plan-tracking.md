# Convention: tracking standardisation progress

> **Status:** P0 deliverable (per transition doc §V.5). Documents how
> the substrate / standardisation plan gets executed + how progress
> is tracked.
>
> **Locked 2026-05-14.**

## Phase numbering

Standardisation work is decomposed into **Phase 5x.y** units, where:

- `5x` is the **track**: `50` = core/SDK, `51` = React Native, `52`
  = substrates. Tracks beyond 52 are reserved for future planning.
- `y` is the **sub-phase** within the track, in numerical order
  (e.g., `52.1 item-types`, `52.2 pseudo-pod V0`, ..., `52.16
  sharing v2`).

Each phase ships as one or more commits + tests + (often) a doc
update. A phase is **shipped** when its acceptance criteria pass +
no regressions in the upstream test suite.

Sub-phases (`52.15.1`, `52.15.2`, etc.) are introduced when a phase
needs to be split for review or session planning. Sub-phase scope
is documented in the parent phase's coding-plan entry.

## Where work lives

Three doc types govern standardisation:

1. **Coding plans** at `Project Files/Substrates/substrates-v2-coding-plan-YYYY-MM-DD.md`
   are the canonical phase-list. Each phase has a numbered table:
   `# | Task | Files`. Estimates + acceptance criteria appear at
   the end of each phase section.

2. **Functional design** at `Project Files/Substrates/substrates-v2-functional-design-YYYY-MM-DD.md`
   describes the API + behaviour that the coding plan delivers.
   When a phase ships, the functional-design entry MAY be updated
   to reflect implementation realities; the coding plan is then
   marked **Shipped YYYY-MM-DD** with a one-paragraph summary.

3. **Transition doc** at `Project Files/standardisation-transition-YYYY-MM-DD.md`
   is the human-readable companion: per-app impact, breaking-
   changes catalogue, cross-cutting concerns, deferred items.

Open questions live in §"Open questions" of the coding plan +
§V.4 / §V.7 of the transition doc.

## Marking phases as shipped

When a phase ships:

1. The phase's section in the coding plan gains a final line:
   `**Shipped YYYY-MM-DD.**` followed by a one-paragraph summary
   (what landed, test counts, deferred items).
2. The phase's row in §VII "Phasing summary" gets a date / status
   marker.
3. The corresponding section of the functional design (if any)
   is updated to reflect implementation realities (e.g., method
   names that differ from the design's draft).
4. Per-app READMEs in `apps/<name>/README.md` get updated to
   reflect the shipped behaviour (per `conventions/app-readme-scheme.md`).
5. Saved memory at `.../memory/project_*.md` gets updated when
   the shipped phase changes long-running constraints (e.g.,
   "groupMirror retired" memory entry).

The substrates-v2 plan's `## Open questions` section is updated
in lockstep: questions that were "pin during 52.x" get resolved
or struck-through with a pointer to where the answer lives.

## Cross-references in the docs

- Coding plan phase sections cross-link to the functional design
  section that describes the substrate (e.g., "see §4.4 in the
  functional design").
- Functional design sections cross-link forward to the coding plan
  phase that delivers them.
- Both docs cross-link to the transition doc's per-app §IV.x
  section that explains how the change lands in each app.
- Convention docs in `Project Files/conventions/` are referenced
  from the coding plan when they're acceptance gates (e.g.,
  "passes the terminology audit per `conventions/localisation.md`").

## Decision pin-down

Decisions that affect a future phase are **pinned** in the open-
questions section of the coding plan. When the pinning phase ships
+ the decision is locked, the open-question entry is struck-
through with a `**Resolved YYYY-MM-DD**` note pointing at where
the answer lives (typically: the code path + the doc page that
describes it).

Decisions on app-level questions (e.g., Stoop's Q-A/Q-B/Q-D
during 2026-05-14) live in the app's own open-questions doc
(e.g., `Project Files/Stoop/open-questions-YYYY-MM-DD.md`) and
cross-reference back to the coding plan when they trigger
substrate changes.

## Cadence

This is a closed-beta PoC, not a release engineering pipeline.
Phases ship when ready, not on a calendar. The plan describes
**what** + **why**, not **when**. Estimates in the coding plan
are honest (typically 1-5 days per sub-phase) but don't bind
scheduling.

When several phases ship together in one session (as happened
2026-05-14 with 52.9.2 + 52.14 + 52.15 + 52.16), each phase
gets its own "Shipped YYYY-MM-DD" line + entry; the session is
referenced once in the saved memory's narrative.

## Pointers

- `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md`
  — current coding plan
- `Project Files/Substrates/substrates-v2-functional-design-2026-05-11.md`
  — current functional design
- `Project Files/standardisation-transition-2026-05-11.md`
  — current transition guide
- `Project Files/standardisation-plan-restructured-2026-05-10.md`
  — master plan (the §I–§III hierarchy of commitments)
- `Project Files/conventions/app-readme-scheme.md` — what app
  READMEs look like as phases ship
