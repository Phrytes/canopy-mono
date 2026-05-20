# tasks-v0 web — characterization corpus

> **Purpose.** Capture today's tasks-v0 web UI behaviour as gold-
> standard snapshots so the `PLAN-gui-chat-uplift.md` Slice B
> (tasks-v0 web → `renderWeb`) migration can prove "before == after"
> per page.  Per the owner's discipline:
>
> > *"De bestaande web-UI is rijk en goed-getest; vervangen vraagt
> > zorgvuldige characterization van alle 14 pagina's."*
>
> **Current status (2026-05-20):** scaffold + 5 stable-page starter
> tests landed (review/dag/inbox/availability/privacy); snapshots
> written but awaiting owner-acceptance tick.  Corpus work
> is **strictly value-positive** — even if Slice B never ships, the
> snapshots protect against accidental regression on pages with
> little/no current test coverage.

---

## Methodology

### What we capture

For each page, two-layer snapshot:

1. **Static HTML** — the raw HTML fetched from `mountLocalUi` after
   first paint, with a deterministic actor + crew context.  Catches:
   structural changes, removed/added affordances, role-gated visibility.

2. **Interaction matrix** — for the page's primary affordances (a few
   per page, not exhaustive), call the matching skill via `callSkill`
   + assert the resulting state/HTML changes.  Catches: behaviour
   changes, even when the HTML "looks the same".

### Harness

Reuses the existing `mountLocalUi`-based pattern from
`apps/tasks-v0/test/web.test.js` + `phase8-ui.test.js`.  Per-page
characterization tests live under
`apps/tasks-v0/test/characterization/`.

Shared setup in `test/characterization/setup.js` exposes:

```js
buildCharacterizationFixture({ actor, crewConfig?, extraStaticFiles? })
  → { baseUrl, bundle, crewState, fetchPage(name), teardown }
```

This keeps every characterization test small (3–10 lines of setup +
the assertions that matter for that page).

### Determinism

- Fixed actor webids (`ANNE`, `BOB`, etc. per existing test convention).
- ULIDs in HTML output normalised (`/01[0-9A-Z]{25}/` → `<ULID>`)
  before snapshot comparison.
- Timestamps normalised (`/\d{13}/` for ms-epoch in JSON → `<MS>`).
- DOM order: app.js's render is deterministic given identical input
  (verified by existing tests).

### Snapshot acceptance gate

A snapshot is **owner-confirmed-as-intended** by an explicit "✓ owner
acceptance" tick in the per-page status table below.  Snapshots
written but NOT owner-confirmed are advisory: they detect drift, but
the migration team must consult the owner before relying on one.

---

## Per-page status

Last updated: 2026-05-20.

| Page                | Stability  | Today's coverage             | Corpus status        | Owner ✓ |
| ------------------- | ---------- | ---------------------------- | -------------------- | ------- |
| `index.html`        | Stable     | web.test.js (rich)           | ⏸ TODO: add snapshot | —       |
| `mine.html`         | Stable     | web.test.js (partial)        | ⏸ TODO: add snapshot | —       |
| `review.html`       | Stable     | None                         | ✅ starter landed     | —       |
| `dag.html`          | Stable     | None                         | ✅ landed 2026-05-20  | —       |
| `inbox.html`        | Stable     | None                         | ✅ landed 2026-05-20  | —       |
| `availability.html` | Stable     | None                         | ✅ landed 2026-05-20  | —       |
| `privacy.html`      | Stable     | Static HTML check only       | ✅ landed 2026-05-20  | —       |
| `crews.html`        | IN-FLIGHT  | phase8-ui.test.js (partial)  | ⏸ HOLD until V2 settles  | —       |
| `crew.html`         | IN-FLIGHT  | phase8-ui.test.js (partial)  | ⏸ HOLD until V2 settles  | —       |
| `onboard.html`      | IN-FLIGHT  | Active development (5 commits)| ⏸ HOLD until V2 settles  | —       |
| `pod-settings.html` | IN-FLIGHT  | Active development           | ⏸ HOLD until V2 settles  | —       |
| `welcome.html`      | IN-FLIGHT  | Active development           | ⏸ HOLD until V2 settles  | —       |

**Stable pages (7):** safe corpus targets right now.  Index + mine
have rich existing test coverage; review/dag/inbox/availability have
NONE — these are the **highest-value** corpus additions because
nothing else gates regression on them today.

**In-flight pages (5):** all part of the V2 multi-crew slice; touched
in the last ~10 commits.  Hold off corpus work — snapshotting an
in-flight target locks in a transient state.  Add to the corpus as
each page's V2 work settles.

---

## Recommended next steps (for owner)

Order by value-per-effort (highest first):

1. **review.html starter test** (✅ landed 2026-05-20) — proves the
   harness; review snapshot for owner acceptance.
2. **dag.html** — read-only DAG tree rendering; small surface; zero
   coverage today.  Add a single snapshot + a "click to expand" or
   "click to view detail" interaction test.
3. **inbox.html** — notification feed + clear action.  One snapshot
   covers most of it; one interaction test (`clearNotifications`)
   covers the rest.
4. **availability.html** — week grid with three states (open / tight
   / unavailable).  Snapshot per state; one interaction test
   (toggle a cell).
5. **privacy.html** — small static page.  One snapshot covers it.
6. **mine.html** — refine + extend existing web.test.js snapshots if
   coverage gaps exist.
7. **index.html** — same; existing tests are rich, but a clean
   characterization snapshot is still cheap insurance.

When the V2 multi-crew slice lands and the 5 in-flight pages settle,
add them in the same pattern (status table updated to "Stable", row
moved to the active corpus).

---

## What this corpus does NOT do

- **It does not test the projector.**  Until Slice B exists, there's
  no projector to compare against.  The corpus is the *baseline* that
  Slice B's migration will check against.
- **It does not replace the existing tests.**  `web.test.js`,
  `phase8-ui.test.js`, etc. continue to own the rich interaction-
  level + integration-level testing.  The corpus adds a thin
  characterization layer on top.
- **It does not snapshot LLM-driven flows.**  tasks-v0 web is not
  LLM-mediated; the corpus is pure DOM/skill-dispatch.

---

## References

- Plan: `PLAN-gui-chat-uplift.md` § Slice B (tasks-v0 web → renderWeb).
- Owner discipline:
  `memory/project-app-manifest-convergence.md` (verbatim quote on
  "rich, well-tested, careful characterization").
- Harness pattern: `apps/tasks-v0/test/web.test.js`,
  `apps/tasks-v0/test/phase8-ui.test.js`.
- First starter: `apps/tasks-v0/test/characterization/review.test.js`.
