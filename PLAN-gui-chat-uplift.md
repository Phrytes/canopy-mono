# GUI / chat uplift — parallel track to `PLAN-uniforme-representatie.md`

> **Status:** draft 2026-05-20.  Companion plan to
> `PLAN-uniforme-representatie.md` (the SP-0…SP-11 uniform-representation
> work) — runs **in parallel** rather than blocking on it.  The
> uniform-representation plan establishes the substrate (`@canopy/app-
> manifest`, `@canopy/manifest-host`, `@canopy/circles`, projectors);
> this plan governs the **application of that substrate to every existing
> surface**.
>
> Owner: project lead.  Editable as the surface inventory shifts.

---

## Purpose

The uniform-representation subproject's destination, locked
2026-05-20 (see `memory/project-manifest-driven-surfaces-endgame.md`):

> **Every surface — web GUI, mobile GUI, chat — eventually built on
> top of the manifest.**

Today the project has reached the chat surface for **two of seven**
manifest-eligible apps (household, tasks-v0 declared-only) and **none
of** the web / mobile surfaces.  This plan lays out the route from
"chat partly done" to "all surfaces manifest-driven, web ≡ mobile from
one source" — as concrete slices, ordered by risk-weighted impact.

---

## Per-app surface inventory (2026-05-20 baseline)

Read this as: *which surfaces does each app have today, and does the
manifest drive any of them yet?*

| App           | Web UI                       | Mobile UI                   | Chat surface (TG / LLM / slash)               | Manifest declared?           | Manifest *driving* anything?                                    |
| ------------- | ---------------------------- | --------------------------- | --------------------------------------------- | ---------------------------- | --------------------------------------------------------------- |
| **household** | —                            | —                           | ✅ TG + slash + LLM (`HouseholdAgent`)        | ✅ SP-1                       | ✅ Chat: `renderChat` + `renderSlash` byte-equivalent live      |
| **tasks-v0**  | ✅ 14 pages, rich, well-tested | ✅ shared UI-helpers (M0–M4) | ⏸ LLM-only declared, no consumer wired         | ✅ SP-3 V0                    | ❌ Manifest is declared-only (drift canary)                      |
| **tasks-mobile** | —                          | ✅ RN shell, consumes tasks-v0 substrate | —                                  | n/a (consumes tasks-v0)      | ❌ Hand-built RN screens                                          |
| **stoop**     | ✅ web pages                  | ✅ stoop-mobile RN shell    | ✅ TG bot + slash + (LLM?)                    | ❌ none                       | n/a                                                              |
| **folio**     | ✅ files / notes / versions   | ✅ folio-mobile (restore)   | ⏸ unknown / TBD                               | ❌ none                       | n/a                                                              |
| **circles** (substrate, not an app) | —             | —                           | —                                             | n/a (substrate)              | n/a                                                              |

Drift = **6 of 7 manifest-eligible app/surface combos still hand-
built**.  The plan below addresses each, with characterization gates
sized to the existing UI's richness.

---

## Substrate prerequisites — what `@canopy/app-manifest` still needs

Every per-app uplift in this plan is gated on these substrate
additions.  Build incrementally, app-driven: don't try to "design the
perfect renderWeb" first — let the first app's needs drive the
substrate, then generalise.

| Substrate                       | Status            | First needed by             | Notes                                                                                                       |
| ------------------------------- | ----------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `renderChat`                    | ✅ shipped (SP-0) | household (✅), tasks-v0    | byte-equivalence-proven; F-SP1-a/b/c/d/e contract refinements locked.                                       |
| `renderSlash`                   | ✅ shipped (SP-0) | household (✅)              | drop-in for `regexParse`.                                                                                   |
| `renderWeb` → NavModel          | ❌ not yet         | tasks-v0 web (Slice A)      | Should produce a platform-neutral NavModel that web + mobile share.  Driven by tasks-v0's 14-page reality.   |
| `renderMobile` → NavModel       | ❌ not yet         | tasks-mobile (Slice B)      | Same NavModel as renderWeb; only the adapter differs.  Cross-surface equality test = the killer property.   |
| Per-type interface registry     | ⏸ scaffold exists | renderWeb (Slice A)         | `@canopy/interface-registry` (P6 scaffold) — feeds `renderCompact` / `renderFull` for per-item cells.        |
| Audience / circles affordances  | ⏸ SP-5b           | post-Slice A                | Audience UI affordances (per-section chip, per-item "shared with").                                          |
| `@canopy/protocol` machinery    | ⏸ scaffold exists | multi-step ops (later)      | For ops like onboarding / approval flows that need state-machine runners.                                   |

**Discipline:** substrate moves forward-additive only.  No breaking
removals; aliases for any rename.  Each renderer addition lands with
the first app that needs it — never speculative.

---

## The slice plan

Eight slices, A–H.  Each is independently mergeable; dependencies
called out below.

### Slice A — household web (greenfield) → `renderWeb` substrate

> **Reordered 2026-05-20.**  Was originally Slice C.  Promoted to the
> flagship per the "let the smallest first consumer drive the
> substrate" discipline — household has no web UI today, so there is
> zero characterization burden, just "does the projector produce
> something usable?".  This locks the NavModel shape on the easiest
> possible surface; every subsequent web/mobile slice consumes the
> shape Slice A settles.

- **Prereq:** SP-11 V0 demo merged (✅ done — `examples/manifest-host-
  demo/`) so the substrate's chat-side is proven before the web side
  starts.
- **Scope (owner-locked 2026-05-20):**
  - Add `renderWeb(manifest) → NavModel` to `@canopy/app-manifest`.
    NavModel shape is the killer cross-surface contract — designed
    here to be **identical** to what `renderMobile` will later
    consume (only platform adapters differ).
  - Ship `apps/household/web/` consuming `householdManifest` via
    `renderWeb`.  Feature set: list/add/markComplete/remove for each
    canonical list type, **plus LLM passthrough** (chat-style free-
    text input on the web surface — gives the substrate real signal
    for "chat + web from one manifest" parity).
  - Production status: incremental.  Start as substrate-forcing-
    function; if usage emerges, harden into a real surface.  Adapters
    are expected to be ~70%+ reusable across apps so the marginal
    cost of household-web staying alive is small.
- **Out of scope:** any visual polish beyond functional adequacy;
  hooking the new web up to existing TG bot's state (cross-cutting
  decision later).
- **Risk:** **Low** (no existing UI to characterize against).  The
  substrate-design risk lives here — bad NavModel choices ripple to
  every later slice — so spend time on shape, not on visuals.
- **Done:** household web is browsable; same manifest drives both
  chat + web; LLM passthrough works on the web surface; the NavModel
  shape is ready to consume in Slices B+.

### Slice B — `tasks-v0` web → `renderWeb` applied

> **The big one.**  tasks-v0's 13-page web UI (per
> `apps/tasks-v0/docs/characterization-corpus.md`) is the project's
> richest hand-built surface.  This slice **applies** the renderWeb
> projector from Slice A to a real characterized UI.
>
> **Pre-split per owner direction 2026-05-20:** "view pages first,
> make a plan, then ask questions."  Sub-slices below.
>
> Owner emphasis recorded verbatim
> (`memory/project-app-manifest-convergence.md`):
> *"De bestaande web-UI is rijk en goed-getest; vervangen vraagt
> zorgvuldige characterization van alle 14 pagina's."*

#### Slice B sub-plan (draft, awaiting owner sign-off)

- **B.0 — Prep (REQUIRED before any sub-slice implementation):**
  Sweep `apps/tasks-v0/web/`, `apps/tasks-v0/src/ui/`, and per-page
  HTML/JS for **existing comments + readme notes about web ↔ mobile
  parity workarounds**.  Owner flagged this: *"Probably, the code
  already contains many fixes to make it work on both mobile and
  web: maybe check for comments on that too (or readmes)."*  Output:
  a written audit of every parity workaround found, with file:line
  refs.  Drives B.1's NavModel design — workarounds either dissolve
  into the projector or stay as adapter-level concerns.  Commit as
  `apps/tasks-v0/docs/web-mobile-parity-workarounds.md`.

- **B.1 — View-only pages.**  The read-only path through `renderWeb`,
  proven on the smallest characterization surface.  Targets: `dag.html`
  (pure read-only tree).  Optional: a stripped-down `mine.html` read-
  view if owner wants a second proof.
  - Output: NavModel + adapter for the read-only path; characterization
    snapshot stays byte-equal.
  - Locks the NavModel **list-section + per-item-read** shape.
  - Owner sign-off gates moving to B.2.

- **B.2 — Light-interaction pages.**  Read + simple state-transition
  per item.  Targets: `mine.html` (read + light claim), `review.html`
  (read + approve/reject), `inbox.html` (read + clear), `availability.html`
  (read + toggle), `privacy.html` (read + toggle).
  - Output: NavModel adds the `itemActions[]` shape from
    `DESIGN-navmodel-sketch.md`; per-item state-gated buttons
    proven against the 5 corpus snapshots already landed.
  - Owner sign-off gates moving to B.3.

- **B.3 — Heavy-write pages.**  Forms + multi-field interactions.
  Targets: `index.html` (workspace — Add task + filter + status
  changes — the richest single page), `crew.html` (read + settings
  edit).
  - Output: NavModel adds the `affordances[]` shape; form-rendering
    proven.
  - Slice B's substantive functional payoff lands here.

- **B.4 — Multi-crew + V2 pages.**  HOLD until V2 multi-crew work
  settles.  Targets: `crews.html`, `onboard.html`, `pod-settings.html`,
  `welcome.html`.
  - These pages have active development.  Adding their
    characterization snapshots before that work settles locks in a
    transient state.  Schedule B.4 after V2 multi-crew slice merges.

**Per sub-slice acceptance gate:**
1. characterization corpus for the targeted page(s) byte-stable
   before/after;
2. NavModel JSON for that page snapshot-locked + owner-confirmed;
3. existing test suites (web.test.js, phase8-ui.test.js) green;
4. owner walkthrough of the resulting page (functional fidelity
   confirmed verbally).

- **Prereq:** Slice A merged (renderWeb exists + NavModel shape
  locked) + characterization corpus largely populated (see
  `apps/tasks-v0/docs/characterization-corpus.md` — corpus work can
  start in parallel with Slice A's substrate design, NOT with
  Slice B's implementation).
- **Scope:**
  - Per-page migration: for each stable page (`index`, `mine`,
    `review`, `dag`, `availability`, `inbox`, `privacy`, …) and the
    in-flight V2 pages (`crews`, `crew`, `onboard`, `pod-settings`,
    `welcome`) — snapshot today's rendered HTML + interaction
    affordances; assert byte/structural-identical output from the
    projector.
  - Migrate `apps/tasks-v0/web/index.js` (and per-page modules) to
    consume the NavModel + per-item buttons from the manifest.
  - Preserve the existing UI-helpers (`taskStatus.js`, `composeArgs.js`,
    `dagFlatten.js`) — they encode V2.7 deps-gate + role-gate
    semantics that the projector must respect, not re-implement.
  - Sub-divide into commits per-page-group (e.g., view/list pages
    first, then editing, then admin) — DON'T merge as one giant
    diff.
- **Out of scope:** any visual redesign, mobile-shared helper changes,
  pod-routing changes.
- **Risk:** **High** by construction (rich UI, broad surface).
  Mitigation: characterization corpus per page; merge per-page-group
  (incremental cutover); 5 in-flight V2 pages held until their V2
  work lands.
- **Done:** every page renders from the projector + characterization
  is byte/structurally-stable; 13 page suites + integration tests
  all green; no divergent hand UI.

### Slice C — `tasks-mobile` → `renderMobile`

> The proof of "web ≡ mobile from one source".  tasks-mobile's
> existing M0–M4 substrate-parity work
> (`memory/project-tasks-mobile-substrate-parity.md`) has already
> retired most divergence; this slice closes the loop by making the
> screen tree itself manifest-driven.  Can run **in parallel** with
> Slice B once Slice A's NavModel locks (both consume the same
> NavModel; different surfaces).

- **Prereq:** Slice A merged (renderWeb's NavModel shape locks first).
- **Scope:**
  - Add `renderMobile(manifest) → NavModel`.  **Same NavModel as
    `renderWeb`**; only the platform adapter differs.
  - RN adapter in `apps/tasks-mobile/src/manifest-adapter.js` —
    NavModel → React Navigation tabs/stack tree; per-item buttons →
    JSX components.
  - Cross-surface equivalence test: same manifest → same NavModel
    structurally (byte-equality of the NavModel JSON minus platform-
    specific metadata).
  - Real-device acceptance (orthogonal pass, not merge-blocking).
- **Risk:** Medium.  Most divergence already retired (M0–M4); the new
  surface is RN-shaped only.
- **Done:** tasks-mobile screens projector-generated from the same
  manifest as web; cross-surface NavModel equality holds.

### Slice D — `stoop` manifest + chat surface migration

> Stoop is a real production app with TG bot + slash + (LLM?) +
> neighbourhood web pages.  No manifest yet.  This is the manifest's
> **second hardest proving ground** after tasks-v0 — different domain
> vocabulary (offers / requests / claims / contacts), different
> audience model (broader-than-household).
>
> **Owner direction 2026-05-20:** stoop adopts **slash-only first**;
> LLM tool-calling layered as a follow-on after slash works.  This
> minimises Slice D's scope + makes the slash-collision-policy
> decision concrete on day one of the migration.
>
> See `AUDIT-stoop-folio-surfaces.md` for stoop's surface inventory
> (16 web pages, 110 skills, no manifest today, no slash today
> either — chat is SDK-skill-dispatch via `@canopy/chat-p2p`).

- **Prereq:** Uniform-representation SP-8 prerequisites (the pod-
  routing freeze, now lifted — see
  `memory/project-app-manifest-convergence.md`'s Reconciliation R1).
- **Scope (D.1 — slash + manifest):**
  - Author `apps/stoop/manifest.js` covering ~12–15 core ops
    (postRequest, listOpen, listMyRequests, assignLend, markReturned,
    setMySkills, createGroupV2, leaveGroup, reportPost, getItemTree,
    mutePeer, setPeerReveal — per
    `AUDIT-stoop-folio-surfaces.md`).
  - Add `surfaces.slash` declarations to the manifest's ops; pick a
    grammar that aligns with household's where it matches (e.g.
    `/add` for postRequest may collide with household — forces the
    host-level collision-policy decision per
    `AUDIT-slash-coverage.md`).
  - Adopt `renderChat` + `renderSlash` for stoop's existing chat
    surface; behaviour-equivalence-gated against the current SDK
    skill-dispatch path.
- **Scope (D.2 — LLM tool-calling layered, follow-on):**
  - After D.1 ships, add LLM passthrough on top.  Same pattern as
    household.  Separate commit; sub-slice timeboxed independently.
- **Risk:** Medium-high (production app, broader surface than
  household).  Mitigation: per-op characterization for slash; LLM
  layered in D.2 after slash works.
- **Done (D.1):** stoop's TG + slash surface is manifest-driven;
  collision-policy applied per `AUDIT-slash-coverage.md`;
  characterization corpus green.
- **Done (D.2):** LLM tool-calling on the existing chat surface.

### Slice E — `stoop` web → `renderWeb`

- **Prereq:** Slice A merged + Slice D's manifest landed.
- **Scope:** stoop's web pages adopt renderWeb from the stoop manifest.
- **Risk:** Medium (smaller than tasks-v0's web; characterization per
  page).
- **Done:** stoop web is projector-driven.

### Slice F — `stoop-mobile` → `renderMobile`

- **Prereq:** Slice C merged + Slice D's manifest landed.
- **Scope:** RN adapter from Slice B, applied to stoop.  Cross-surface
  equivalence holds for stoop too.
- **Risk:** Low-medium.
- **Done:** stoop-mobile screens projector-generated.

### Slice G — `folio` manifest + multi-surface migration

> Folio is the project's **boundary check** — files / versions /
> restore is a different domain shape (no verb list, no DoD lifecycle,
> different operations).  The manifest model either fits or it doesn't;
> either way the boundary documents itself.  See
> `PLAN-uniforme-representatie.md` § SP-7.

- **Prereq:** Slices A, B, C merged (substrate is mature).
- **Scope:**
  - Author `apps/folio/manifest.js` if the model fits; otherwise
    document the boundary + record what's missing.
  - If it fits: web + mobile + (chat?) migrations via the existing
    projectors.
- **Risk:** Low–medium for the manifest-author; high if the model
  doesn't fit and we need substrate extensions.
- **Done:** either folio is projector-driven or the model's boundary
  is documented for posterity.

### Slice H — Cross-cutting (slash, audience, multi-app host)

> The cross-cutting concerns that surface only once ≥2 real apps live
> on the manifest.  Done as one audit slice once the per-app
> migrations create real signal.

- **Prereq:** at least Slices A + D merged (two apps with slash live).
- **Scope:**
  - **Slash coverage audit** per
    `memory/project-slash-command-coverage.md` — pick a host-level
    collision-policy + codify it.
  - **Audience affordances (F-SP5-a)** — `renderWeb` / `renderMobile`
    NavModel additions for per-section `defaultAudience` chip +
    per-item "shared with" control.  Needs `@canopy/circles` (SP-5
    V0 ✅) + item-store `audience` field (SP-5b).
  - **Multi-app host wiring** for production deployments where ≥2
    apps share one chat process (the SP-11 demo's pattern, productised).
- **Risk:** Medium (cross-cutting; touches every shipped surface).
- **Done:** project-wide collision-policy chosen + applied; audience
  UI affordances live; ≥2 multi-app hosts in production.

---

## Order & dependencies

**Reordered 2026-05-20** per the "smallest first consumer drives the
substrate" discipline.  Was: A=tasks-v0-web, B=tasks-mobile,
C=household-web.  Now: A=household-web (greenfield), B=tasks-v0-web
(rich), C=tasks-mobile.

```
Slice A (household web                      ┌─ Slice B (tasks-v0 web)
  + renderWeb substrate ──── NavModel ──────┼─ Slice C (tasks-mobile
  — greenfield)                              │   + renderMobile)
                                             │
Slice D (stoop chat ─────────────────────────┼─ Slice E (stoop web) ────┐
  + manifest)                                │                           │
                                             ├─ Slice F (stoop-mobile) ──┼─ Slice H
                                             │                           │  (cross-
                                             └─ Slice G (folio) ─────────┘  cutting)
```

**Critical-path slice:** A (locks NavModel shape).
**Largest slice:** B (tasks-v0's 13 pages).
**Cleanest greenfield:** A (no characterization burden) and C-secondary.
**Defer until two apps live:** H.
**Parallelisable after A:** B + C consume the same locked NavModel
from different surfaces, so they can run in parallel once Slice A
merges (owner's bandwidth permitting).

---

## Per-slice risk profile + characterization sizing

Characterization corpus is the gate that prevents regression on rich
existing UIs.  Sizing depends on how rich the existing surface is.

| Slice | Existing-UI richness | Corpus per page/screen | Reasonable timebox per slice |
| ----- | -------------------- | ---------------------- | ---------------------------- |
| A     | None (greenfield)    | Smoke + golden-output              | 1–2 weeks (substrate design dominates) |
| B     | Very high (13 pages) | Full snapshot + interaction matrix | 4–8 weeks |
| C     | Medium (M0–M4 done)  | Cross-surface equivalence test     | 2–3 weeks |
| D     | Medium (TG bot)      | Byte-equivalence on bot replies + slash routing | 2–3 weeks |
| E     | Medium               | Per-page snapshot                  | 2–3 weeks |
| F     | Medium               | Cross-surface equivalence + smoke  | 1–2 weeks |
| G     | Unknown until manifest authored | Smoke; boundary-test driven | 2–4 weeks |
| H     | Cross-cutting        | Project-wide regression sweep      | 1–2 weeks |

These are *estimates from outside* — owner's per-app knowledge will
refine them.

---

## Acceptance gates per slice

Universal:
- Test counts: existing app tests must remain green to the same count
  (no test deletion without explicit rationale recorded).
- Manifest drift canary stays green (the manifest's op set matches
  the skill set; no orphan ops).
- Cross-surface equivalence test (for slices touching both web +
  mobile) holds.
- Substrate stays forward-additive (no breaking removals; aliases for
  renames).
- Owner-written acceptance walkthrough captured per app surface (e.g.
  "open the inbox, claim task X, mark complete, see it move").

Slice-specific:
- **A:** household web browsable; chat + web from one manifest;
  NavModel shape design-doc'd before any Slice B/C work starts.
- **B:** 13 pages identical to baseline (byte- or DOM-equivalent);
  V2.7 deps-gate + role-gate semantics preserved; per-page-group
  merge cadence.
- **C:** NavModel JSON structurally equal between renderWeb +
  renderMobile.
- **D:** TG bot replies + slash routing byte-equivalent to baseline.
- **G:** Either projector-driven OR documented boundary.

---

## What this plan does NOT cover

- **The uniform-representation substrate work itself** —
  `PLAN-uniforme-representatie.md` owns SP-0…SP-11 (substrate +
  recombination demo + per-app manifest authoring).  This plan
  *consumes* that substrate; doesn't replace it.
- **Backend / pod-routing / sync-engine work** — handled by the P3
  pod-storage roadmap [[project-p3-pod-storage-roadmap]] +
  [[project-p3-sync-engine-absorption]].
- **App-internal feature work** — new functionality per app stays in
  each app's own changelog.  This plan governs *surface* migration,
  not feature growth.
- **Visual redesign** — the projector preserves whatever look-and-feel
  the existing UI has.  A separate "visual refresh" slice could be
  scheduled later if wanted; out of scope here.
- **Maatschappij variant + outreach site** — separate plans; see
  [[project-usage-data-maatschappij-variant]] +
  [[project-outreach-site-structure]].

---

## How to run this in parallel with the uniform-representation work

The two plans are **complementary, not sequential**:

- `PLAN-uniforme-representatie.md` ships the substrate (renderChat,
  renderSlash, renderWeb, renderMobile, manifest-host, circles).
- This plan applies the substrate to every existing surface.

Day-to-day:

- **When a substrate piece lands** (e.g. renderWeb lands as part of
  Slice A's substrate work), the *next* slice that needs it (Slice C
  household-web, Slice E stoop-web) becomes unblocked.
- **When a per-app manifest lands** (e.g. stoop manifest in Slice D),
  the per-surface slices for that app (E, F) become unblocked.
- **The owner can drive both tracks in parallel** by deciding, per
  turn, whether to build substrate (uniform-representation plan) or
  apply substrate to surface (this plan).  No hard ordering between
  the two — only within-track ordering.

---

## Owner decisions (2026-05-20)

Each item: the question, the owner's answer, and what's now locked
in the slice descriptions above.

1. **Slice A scope:** household web with **LLM passthrough**
   included.  *Locked in Slice A § Scope.*  Rationale: richer
   substrate signal for "chat + web from one manifest" parity.

2. **Slice B timeboxing:** **view pages first; make a plan, then ask
   questions**.  Pre-split into B.0 (parity-workarounds audit) → B.1
   (view-only) → B.2 (light interaction) → B.3 (heavy write) → B.4
   (multi-crew V2 pages — held).  Also: *"the code already contains
   many fixes to make it work on both mobile and web: maybe check
   for comments on that too (or readmes)"* — captured as B.0's
   explicit pre-implementation prep step.

3. **Slice D scope:** **slash-only first**; LLM tool-calling layered
   in D.2 after slash works.  *Locked in Slice D § Scope; the slice
   is now split into D.1 + D.2.*

4. **Slice G boundary (`@canopy/protocol` for folio):** *"Whenever
   you think it fits."*  Recorded as my call; default is "fold in if
   folio's manifest authoring surfaces a clean state-machine shape;
   otherwise defer to a later slice."

5. **Slice H ordering (audience affordances vs SP-5b):** *"do
   whatever leads to the best functional, clean, readable code —
   this is more important than rewriting or efficiency"*.  Recorded
   as my call; default is "wait for SP-5b to land so audience
   affordances use real item-store data, not client-only labels".

6. **Visual-refresh slice:** same direction — my call, prioritise
   clean code over byte-equality.  Default: visual changes that
   can't be byte-equal get a separate "visual refresh" sub-slice
   per page; characterization corpus remains the gold standard for
   structural fidelity.

7. **household web (Slice A) production status:** *"I think it is
   relatively low effort after creating all the adapters and
   manifests, right? Especially because adapters overlap quite a bit
   between apps. What do you say?"* — **honest answer recorded in
   Slice A § Scope above:** YES, the household-web SLICE is mostly
   adapter glue (~100–200 lines) once renderWeb + the web adapter
   exist.  The LLM-passthrough integration adds modest work (embed
   a `ChatAgent` + a free-text input on the page).  Adapters are
   expected to be ~70%+ reusable across apps — the marginal cost of
   keeping household-web alive after substrate ships is small.
   Recommendation: keep it.  Two surfaces (phone-chat + browser) is
   strictly better than one if the per-surface cost is bounded.

All 7 questions answered; slice descriptions updated to lock the
decisions in.  No more open questions blocking implementation.
