# Session progress tracker — `feat/app-manifest` branch

> Living document.  Updated each turn so the owner can scan state +
> the next agent / next session can pick up cleanly.  Companion to:
>
> - `PLAN-uniforme-representatie.md` — substrate roadmap (SP-0…SP-11)
> - `PLAN-gui-chat-uplift.md` — surface migration (Slices A–H)
> - `DESIGN-navmodel-sketch.md` — NavModel shape + owner decisions
>
> Branch `feat/app-manifest` — NOT yet merged to master.

---

## Headline (2026-05-20, end-of-day)

**Substrate complete chat-side + first web-adapter shipped.**  Track
status:

| Track | Status                                                            |
| ----- | ----------------------------------------------------------------- |
| SP-0 `@canopy/app-manifest`         | ✅ Done (renderChat, renderSlash, renderWeb, renderMobile) |
| SP-1 household chat cutover         | ✅ Done (byte-equivalence proven)                          |
| SP-2 household tasks + contacts     | ✅ Done                                                    |
| SP-3 V0 tasks-v0 manifest           | ✅ Done (LLM-only; web UI untouched)                       |
| SP-4 V0 `@canopy/manifest-host`     | ✅ Done                                                    |
| SP-5 V0 `@canopy/circles`           | ✅ Done                                                    |
| SP-4b + SP-11 V0 demo               | ✅ Done (`examples/manifest-host-demo/`)                    |
| Slice A.1–A.3 (household web)       | ✅ Done                                                    |
| Slice A.4 (LLM passthrough on web)  | ⏸ NEXT                                                    |
| Slice B.0 parity audit              | ✅ Done                                                    |
| Slice B.1+ (tasks-v0 web migration) | ⏸ Awaiting Slice A.4 + owner sign-off                     |
| Slice C.0 recon (tasks-mobile)      | ✅ Done                                                    |
| Slice C.1+ (renderMobile migration) | ⏸ Awaiting Slice A sign-off + manifest extension          |
| Slice D.1 (stoop manifest draft)    | ✅ Done — **9 DECIDE markers** awaiting owner              |
| Slice D.2 (stoop LLM)               | ⏸ After D.1 settles                                       |
| Slice E–G                           | ⏸ Future                                                  |
| Slice H (cross-cutting)             | ⏸ After ≥2 apps live                                      |

---

## Commit log (this session, newest first)

Branch `feat/app-manifest` — substantive commits this session:

- `00eb102` — feat(app-manifest): renderMobile alias + cross-surface equivalence test
- `c57221b` — feat(household): Slice A.3 — web adapter consuming NavModel
- `4711dd4` — feat(app-manifest, household): Slice A.2 — household manifest → NavModel
- `77c7904` — feat(stoop): Slice D.1 — DRAFT manifest (slash-only)
- `020f1b8` — feat(app-manifest): Slice A.1 — renderWeb skeleton + NavModel typedefs
- `c61552f` — docs(tasks-v0): Slice B.0 parity audit — web↔mobile workarounds
- `f298992` — docs+plan: stoop+folio surface audit + lock-in of owner decisions
- `bd14da1` — docs: AUDIT-slash-coverage.md — cross-cutting policy options for slash
- `66597a4` — corpus(tasks-v0): expand characterization to dag/inbox/availability/privacy
- `80ef762` — docs: DESIGN-navmodel-sketch.md — proposed renderWeb/renderMobile shape
- `196c729` — docs+corpus(tasks-v0): reorder GUI/chat plan + scaffold characterization corpus
- `722382b` — docs: PLAN-gui-chat-uplift.md — parallel-track plan for surface migration
- `b92d36c` — feat(examples): SP-11 V0 + SP-4b — manifest-host recombination demo
- `ce88398` — refactor(household): extract skillRegistry + add mountable shape
- `d2680b4` — feat(tasks-v0): SP-4b — multi-crew through manifest-host (proof)
- `9311568` — feat(circles, item-types): SP-5 V0 — audience + circles substrate
- `217348a` — docs(manifest-host, app-manifest): flag three V0 cross-app conflicts
- `16cc118` — feat(manifest-host): SP-4 V0 — runtime composition of N manifests
- `4c0b22f` — feat(tasks-v0): manifest + LLM-bridge (SP-3 V0; web UI untouched)
- `b94f410` — feat(household): manifest cutover + tasks/contacts (SP-1 + SP-2)
- `11d9658` — feat(app-manifest): new @canopy/app-manifest substrate + projectors (SP-0…SP-3 V0)

Plus the C.0 recon doc + this PROGRESS.md in the next commit.

---

## Test counts (latest, end-of-day)

| Package / app                  | Tests        | Notes                                       |
| ------------------------------ | ------------ | ------------------------------------------- |
| `@canopy/app-manifest`         | **107**      | +7 cross-surface equivalence                |
| `@canopy/circles`              | **50**       | (unchanged)                                 |
| `@canopy/manifest-host`        | **20**       | (unchanged)                                 |
| `@canopy/item-types`           | **97**       | +6 view/circle sweep                        |
| `apps/household`               | **570**      | +18 NavModel test + 8 web smoke             |
| `apps/tasks-v0`                | **551**      | +5 SP-4b proof + 4 corpus starter + 10 dag/inbox/availability/privacy |
| `apps/stoop`                   | **572**      | +6 D.1 manifest-validation                  |
| `examples/manifest-host-demo`  | **9**        | (unchanged)                                 |

**All green.**  Zero regressions across the session.

---

## Open follow-ups (owner-decision needed)

### 1. Stoop manifest DECIDE markers (D.1)

`apps/stoop/manifest.js` carries **9 owner-facing DECIDE markers**.
Stylistic naming choices the agent left for owner input:

- `/respond` vs `/reply` vs `/reageer` for `respondToItem`
- `/skills` vs `/profile` for `setMySkills`
- `/buurt` vs `/posts` vs `/prikbord` for `listOpen`
- `/withdraw` vs `/cancel` vs `/intrekken` for `cancelRequest`
- `/lend-return` vs `/returned` vs `/teruggebracht` for `markReturned`
- Whether `reportPost` should use canonical `add` verb instead of
  non-canonical `report`
- Whether `setMySkills` should split into `addMySkill` +
  `removeMySkill` using canonical verbs
- (2 more — see manifest header for the full list)

Action: owner reviews the manifest, picks options, deletes
`DECIDE:` markers.

### 2. NavModel snapshot acceptance

`apps/household/test/__snapshots__/navmodel.test.js.snap` —
auto-written on first run; owner should review + tick the "Owner ✓"
column in `apps/tasks-v0/docs/characterization-corpus.md` (status
table) once confirmed intended.

### 3. Slice C signal — NavModel extensions surfaced in A.3

The A.3 agent (household web adapter) flagged 5 items the NavModel
likely needs:

a. **Read-only sections marker** — `members` section is empty by
   substrate-default (`listOpen` rejects `type:'contact'`).  Want
   a `view.readOnly: true` or "no add affordance" signal so the
   adapter doesn't surface an Add form.

b. **`registerName` no `surfaces.ui`** — household's members can't
   be added from web today.  Either declare `surfaces.ui` on the op
   (manifest-side) OR add a `verb === 'register'` auto-surface rule
   in renderWeb (substrate-side).

c. **Multi-field forms** — `addTask`'s optional `assignee` + `dueAt`
   aren't reachable from web; the form only sends `{text}`.  Slice B
   will need richer affordance projection driven off `paramsSchema`.

d. **`listOpen` returns text-only** — bootstrap re-reads the store
   to surface `items[]`.  V1 cleanup: manifest's list ops should
   return structured `data` alongside `replies`.

e. **`itemActions` state-gating needs richer state derivation** —
   client's `deriveItemState(item)` only derives `open|complete|
   removed`; doesn't handle `claimed|submitted|approved` (V2.7 DoD
   lifecycle).  Tasks-v0 web (Slice B) will hit this.

Action: owner judges priority; some are pure substrate (a, b, c)
and some are adapter-level (d, e).

---

## Open follow-ups (mine to drive)

### Active TaskCreate items (see `TaskList`)

Tracked as proper tasks for visibility.

### Slice A.4 — LLM passthrough on household web

Bare minimum:
- Embed a `<input type="text">` chat box on the household web page.
- POST → `ChatAgent.onMessage` → `renderChat(householdManifest, ...)`'s
  composed handlers.
- Reuse the existing `HouseholdAgent`'s LLM wiring (don't reinvent).

Risk: low.  Pre-requisites: A.3 ✅, an LLM provider configured
(can be `mockProvider` for V0).

### Slice B.1 — dag.html → renderWeb

The first tasks-v0 page migration.  Pre-requisites:
- Slice A complete (✅ A.1, A.2, A.3 done; A.4 nice-to-have but not blocking)
- Owner sign-off on the NavModel shape locked in A.1
- `apps/tasks-v0/docs/characterization-corpus.md` review of
  dag.html's snapshot

### Slice C.1 — renderMobile adapter for tasks-mobile

Substantial.  Pre-requisites:
- Slice A complete
- The 38+ missing manifest ops surfaced in
  `apps/tasks-mobile/docs/screen-inventory.md`'s Phase 1 list
- Owner direction on which screens land first (the recon doc
  proposes Phases 1–3 first)

### Slice D.2 — stoop LLM tool-calling

After D.1 DECIDE markers settle.  Add LLM to stoop's chat surface
using the SAME pattern as household.  Most of the wiring is
boilerplate.

---

## Decisions locked this session

| When        | Decision                                                              |
| ----------- | --------------------------------------------------------------------- |
| 2026-05-20  | Slice A LLM passthrough INCLUDED on household web                      |
| 2026-05-20  | Slice B pre-split B.0 → B.1 → B.2 → B.3 → B.4 (held)                  |
| 2026-05-20  | Slice D split D.1 (slash-only) → D.2 (LLM after)                      |
| 2026-05-20  | Slice G (folio @canopy/protocol): my call ("whenever it fits")        |
| 2026-05-20  | Slice H audience affordances: my call (default = wait for SP-5b)      |
| 2026-05-20  | Visual refresh: my call (default = separate slices for big changes)   |
| 2026-05-20  | Household web stays alive as production surface (low marginal cost)   |
| 2026-05-20  | NavModel Q1 detail-view: deferred to V1                                |
| 2026-05-20  | NavModel Q2 section ordering: manifest declaration order               |
| 2026-05-20  | NavModel Q3 globals: inferred from `surfaces.ui.placement === 'global'`|
| 2026-05-20  | NavModel Q4 equivalence: strict JSON equality default                  |
| 2026-05-20  | NavModel Q5 sort: `view.sort = {by, direction}` passed through         |
| 2026-05-20  | NavModel Q6 type-enum fallback (multi-type ops) — locked in renderWeb  |

---

## How this file evolves

- After every turn that lands a commit, append to "Commit log" + update
  "Test counts" + update "Track status" in the headline table.
- When the owner answers an open follow-up, MOVE it from "owner-
  decision needed" to "Decisions locked this session" with the date.
- When a slice / SP transitions to ⏸ → in-progress → ✅, update the
  headline table.
- TaskCreate items for the *immediate next 1–2 work items* (don't
  flood the task list with future-far items; PROGRESS.md is the
  long-horizon view).

---

## Open question to owner (2026-05-20)

What's next?

1. **A.4** — LLM passthrough on household web (1 commit, low risk, small)
2. **D.1 DECIDE resolution** — owner picks 9 stylistic choices in stoop manifest
3. **Slice C.1 start** — tasks-mobile renderMobile (substantial; ~38 ops to add)
4. **Slice B.1** — dag.html migration (smallest tasks-v0 web page; the read-only path proof)

My recommendation: **A.4 + B.1 in parallel**.  A.4 closes Slice A; B.1
proves Slice B's first sub-slice.  Both small / bounded.  D.1 DECIDE
markers wait on owner.  C.1 is the next BIG slice — schedule after A.4
+ B.1 ship.
