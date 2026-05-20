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
| SP-5b V0a (`item.audience` field)   | ✅ Done — locks audience model as real data                |
| SP-5b V0b (`ListFilter.audience`)    | ✅ Done — equality match; webid-set resolution → V0c        |
| SP-5b V0c (view.defaultAudience + cross-pod) | ⏸ When real consumer pressure surfaces             |
| SP-4b + SP-11 V0 demo               | ✅ Done (`examples/manifest-host-demo/`)                    |
| Slice A.1–A.4 (household web + LLM) | ✅ Done — **Slice A COMPLETE**                              |
| Slice B.0 parity audit              | ✅ Done                                                    |
| Slice B.1 (dag.html via renderWeb)  | ✅ Done — first tasks-v0 page projector-driven              |
| Slice B.2+ (tasks-v0 web migration) | ⏸ B.2/B.3/B.4 ahead                                       |
| Slice C.0 recon (tasks-mobile)      | ✅ Done                                                    |
| Slice C.1+ (renderMobile migration) | ⏸ Awaiting Slice A sign-off + manifest extension          |
| Slice D.1 (stoop manifest draft)    | ✅ Done — **9 DECIDE markers** awaiting owner              |
| Slice D.2 (stoop LLM)               | ⏸ After D.1 settles                                       |
| Slice E–G                           | ⏸ Future                                                  |
| Slice H (cross-cutting)             | ⏸ After ≥2 apps live                                      |

---

## Commit log (this session, newest first)

Branch `feat/app-manifest` — substantive commits this session:

- (next) — feat(item-store): SP-5b V0b — `ListFilter.audience` equality match
- `ef961dc` — feat(item-store): SP-5b V0a — `item.audience` field + `audienceFromItem` bridge
- `41b140d` — feat(tasks-v0): Slice B.1 — dag.html via renderWeb (view-only)
- `9dfff80` — feat(household): Slice A.4 — LLM passthrough on web
- `f0d5ebb` — docs+progress: Slice C.0 recon (tasks-mobile screens) + PROGRESS.md tracker
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
| `@canopy/item-store`           | **118**      | +14 V0a + 8 V0b audience filter             |
| `apps/household`               | **574**      | +4 LLM-passthrough smoke (A.4)              |
| `apps/tasks-v0`                | **569**      | +4 sliceB1-navmodel test (B.1)              |
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

## SP-track follow-up options (analysis 2026-05-20)

Asked: which `PLAN-uniforme-representatie.md` SP makes sense as
next-up?  Remaining open SPs (everything except SP-0…SP-4 V0, SP-5
V0, SP-11 V0 already done):

| SP    | What it is                                        | Status  | Risk | Leverage |
| ----- | ------------------------------------------------- | ------- | ---- | -------- |
| SP-3b | tasks-v0 web migration                            | In flight (B.1 ✅, B.2+ ahead) | Med | High (active surface) |
| SP-5b | item.audience + ListFilter + host wiring          | Deferred (waiting consumer) | Med (central schema) | High (unblocks Slice H + cross-app audience) |
| SP-6  | renderMobile + tasks-mobile (= Slice C)           | Recon ✅; impl ahead | Med | High (38+ ops needed) |
| SP-7  | folio boundary check (= Slice G)                  | Recon ✅; ahead | Low–med | Bounded (or documented "doesn't fit") |
| SP-8  | stoop adoption (= Slice D)                        | D.1 ✅; D.2 ahead | Med | High (live surface) |
| SP-9  | SDK decomposition (base / extensions / `requires`)| Ahead   | Med–high (shared SDK refactor) | Foundational |
| SP-10 | Scaffolder (manifest → testable app skeleton)     | Blocked on SP-9 in PLAN; **could land V0 without** | Med | High per-new-app |
| SP-11b| Cross-surface demo + embeds + saved cross-circle view | Blocked on SP-5b + interface-registry maturity | Low | Demo polish |

Independent of the GUI/chat track (which owns SP-3b / SP-6 / SP-7 /
SP-8 as Slices B / C / G / D), the **pure SP** options narrow to:
**SP-5b**, **SP-9**, **SP-10 V0**, **SP-11b**.

### My recommendation: **SP-5b** (item.audience field)

**Why SP-5b wins over the alternatives:**

- **Foundational** — gets the audience model into real data, not
  theoretical.  Every downstream slice that touches audience
  (Slice H, cross-app, stoop groups, folio sharing) needs this.
- **Forward-additive** — `item.visibility` shorthands keep working;
  `item.audience` is a new optional field that defaults to the
  existing visibility's structured equivalent.  Existing items
  validate unchanged.
- **Multiple apps flagging it** — `AUDIT-stoop-folio-surfaces.md` §
  "Shared concerns": both apps flagged audience semantics + cross-
  pod member metadata as out-of-scope-but-needed substrate work.
  SP-5b satisfies both.
- **Locks the design before rewrite cost grows** — every new app
  that ships hand-rolled visibility logic is more work to migrate
  later.  Better to lock the shape now while the manifest model is
  hot.
- **Test surface is bounded** — `@canopy/item-store`'s schema test
  + every consumer's listOpen/filter tests.  ~1100 tests across the
  chain; forward-additive means most stay green by construction.

**Why SP-5b over SP-9 / SP-10 / SP-11b:**

- **SP-9** (SDK decomposition) is medium-high risk — touches shared
  SDK across all apps.  Worth doing, but only when there's a concrete
  reason a base/extension split unblocks something.  No acute pull
  today.
- **SP-10** scaffolder is high-leverage IF a new app is being
  authored.  No new app on the horizon (stoop / folio / household /
  tasks-v0 all exist).  SP-10 V0 (without SP-9) is possible but the
  payoff is theoretical.
- **SP-11b** demo extension is nice-to-have — adds polish to an
  existing proof, doesn't unblock new work.

**SP-5b proposed V0 scope** (matches the locked plan in CODING
SP-5b):

- `item.audience: Audience` field added to `@canopy/item-store`
  Item schema.
- Existing `visibility: 'household' | 'private' | 'role:*'` values
  map 1:1 to audience short-hands (forward-additive).
- `ListFilter.audience` accepted; resolver walks circles + cross-
  pod via the already-merged Phase-3.3c resolver.
- `view.defaultAudience` host wiring (items created through a view
  inherit it).
- Renderer audience affordances (F-SP5-a) explicitly DEFERRED to a
  separate slice once renderWeb has at least one real audience
  consumer — keeps SP-5b focused.

### Alternative: split SP-5b into V0a / V0b

If SP-5b feels too central in one slice, split:
- **SP-5b-V0a** — just the `item.audience` field on item-store with
  visibility-shorthand fallback.  Tests across all apps.  No
  ListFilter changes; no host wiring.  Atomic, low risk.
- **SP-5b-V0b** — ListFilter.audience + cross-circle resolver.
  Needs V0a + a real audience consumer.

Then `SP-5b-V0a` first; pause; user-test; `V0b` when consumer
demand makes the shape obvious.

---

## Open question to owner (2026-05-21)

Pick the next SP:
1. **SP-5b** (V0a — `item.audience` field only) — my recommendation
2. **SP-10 V0** (scaffolder without SP-9 dependency)
3. **Slice C.1** (tasks-mobile renderMobile — biggest GUI slice next)
4. Something else
