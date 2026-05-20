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

### Slice A — `tasks-v0` web → `renderWeb`

> **The flagship slice.**  tasks-v0's 14-page web UI is the project's
> richest hand-built surface.  Replacing it via `renderWeb`
> simultaneously: (1) ships the `renderWeb` projector for the
> substrate; (2) proves the manifest model on a non-trivial UI;
> (3) sets the characterization gold-standard the other web slices
> follow.
>
> Owner emphasis recorded verbatim
> (`memory/project-app-manifest-convergence.md`):
> *"De bestaande web-UI is rijk en goed-getest; vervangen vraagt
> zorgvuldige characterization van alle 14 pagina's."*

- **Prereq:** SP-3 V0 (✅ done) + uniform-representation SP-11 demo
  (in-flight) for first real-world signal on the host model.
- **Scope:**
  - Add `renderWeb(manifest) → NavModel` to `@canopy/app-manifest`.
  - Per-page characterization corpus: for each of `index`, `mine`,
    `review`, `dag`, `availability`, `crew`, `crews`, `inbox`,
    `onboard`, `pod-settings`, `privacy`, `welcome` (etc.) — snapshot
    today's rendered HTML + interaction affordances; assert
    byte/structural-identical output from the projector.
  - Migrate `apps/tasks-v0/web/index.js` (and per-page modules) to
    consume the NavModel + per-item buttons from the manifest.
  - Preserve the existing UI-helpers (`taskStatus.js`, `composeArgs.js`,
    `dagFlatten.js`) — they encode V2.7 deps-gate + role-gate
    semantics that the projector must respect, not re-implement.
- **Out of scope:** any visual redesign, mobile-shared helper changes,
  pod-routing changes.
- **Risk:** **High** by construction (rich UI, broad surface).
  Mitigation: characterization corpus per page; merge per-page if
  needed (incremental cutover).
- **Done:** every page renders from the projector + characterization
  is byte-stable; 14 page suites + integration tests all green;
  no divergent hand UI.

### Slice B — `tasks-mobile` → `renderMobile`

> The proof of "web ≡ mobile from one source".  tasks-mobile's
> existing M0–M4 substrate-parity work
> (`memory/project-tasks-mobile-substrate-parity.md`) has already
> retired most divergence; this slice closes the loop by making the
> screen tree itself manifest-driven.

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

### Slice C — household web (new)

> Household has no web UI today.  Adding one through `renderWeb` is the
> **easiest possible greenfield** for the projector — no
> characterization burden, just "does the manifest produce something
> usable?".  Useful both as user-facing functionality and as a
> renderWeb-shape sanity check after Slice A.

- **Prereq:** Slice A merged (renderWeb exists).
- **Scope:** ship `apps/household/web/` consuming `householdManifest`
  via `renderWeb`.  Bare minimum: list/add/markComplete/remove for
  each canonical list type; LLM passthrough (or none in V0).
- **Risk:** Low (no existing UI to characterize against).
- **Done:** household web is browsable; same manifest as the chat
  surface drives both.

### Slice D — `stoop` manifest + chat surface migration

> Stoop is a real production app with TG bot + slash + (LLM?) +
> neighbourhood web pages.  No manifest yet.  This is the manifest's
> **second hardest proving ground** after tasks-v0 — different domain
> vocabulary (offers / requests / claims / contacts), different
> audience model (broader-than-household).

- **Prereq:** Uniform-representation SP-8 prerequisites (the pod-
  routing freeze, now lifted — see
  `memory/project-app-manifest-convergence.md`'s Reconciliation R1).
- **Scope:**
  - Author `apps/stoop/manifest.js` covering current TG bot + slash +
    web ops.
  - Adopt `renderChat` + `renderSlash` for the TG/slash surface (byte-
    or behaviour-equivalence-gated).
  - Decision-point: extend `SLASH_COMMAND_COVERAGE` memo's audit here
    — stoop is the second app likely to declare slash, so this is
    where the host-level collision-policy decision becomes real
    (see `memory/project-slash-command-coverage.md`).
- **Risk:** Medium-high (production app, broader surface than household).
- **Done:** stoop's TG + slash + LLM surface is manifest-driven;
  characterization corpus green.

### Slice E — `stoop` web → `renderWeb`

- **Prereq:** Slice A merged + Slice D's manifest landed.
- **Scope:** stoop's web pages adopt renderWeb from the stoop manifest.
- **Risk:** Medium (smaller than tasks-v0's web; characterization per
  page).
- **Done:** stoop web is projector-driven.

### Slice F — `stoop-mobile` → `renderMobile`

- **Prereq:** Slice B merged + Slice D's manifest landed.
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

```
                        ┌─ Slice C (household web) ───┐
                        │                              │
Slice A (tasks-v0 web ──┼─ Slice B (tasks-mobile) ────┤
  + renderWeb substrate)│                              │
                        │                              │
Slice D (stoop chat ────┼─ Slice E (stoop web) ───────┼─ Slice H
  + manifest)           │                              │  (cross-
                        ├─ Slice F (stoop-mobile) ────┤  cutting)
                        │                              │
                        └─ Slice G (folio) ───────────┘
```

**Critical-path slices:** A (largest), D (most-different domain).
**Lowest-risk early wins:** C (greenfield), B (most prep done).
**Defer until two apps live:** H.

---

## Per-slice risk profile + characterization sizing

Characterization corpus is the gate that prevents regression on rich
existing UIs.  Sizing depends on how rich the existing surface is.

| Slice | Existing-UI richness | Corpus per page/screen | Reasonable timebox per slice |
| ----- | -------------------- | ---------------------- | ---------------------------- |
| A     | Very high (14 pages) | Full snapshot + interaction matrix | 4–8 weeks |
| B     | Medium (M0–M4 done)  | Cross-surface equivalence test     | 2–3 weeks |
| C     | None (greenfield)    | Smoke + golden-output              | 1 week    |
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
- **A:** 14 pages identical to baseline (byte- or DOM-equivalent);
  V2.7 deps-gate + role-gate semantics preserved.
- **B:** NavModel JSON structurally equal between renderWeb +
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

## Open questions (for owner to refine)

1. **Slice A timeboxing** — is 4–8 weeks acceptable, or should we
   pre-split per page (a, b, c…) for incremental merge?
2. **Slice D scope** — does stoop want LLM tool-calling (like
   household) or stay slash-only?  Affects manifest shape + collision
   surface.
3. **Slice G boundary** — folio's restore + version-history domain may
   need `@canopy/protocol` declarations.  When?
4. **Slice H ordering** — does the audience affordance work block
   on SP-5b (item-store schema change) or can it precede it via
   client-only audience labels?
5. **Visual-refresh slice** — separate later, or wove into Slice A's
   characterization (some pages can't be byte-equal if visual changes
   are intended)?
6. **household web (Slice C)** — does household ACTUALLY want a web
   UI, or is the chat surface sufficient forever?
