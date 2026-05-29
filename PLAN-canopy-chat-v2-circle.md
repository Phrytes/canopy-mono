# PLAN — canopy-chat v2 (circle model) · coding plan & progress tracker

Execution companion to [`DESIGN-canopy-chat-v2-kring.md`](./DESIGN-canopy-chat-v2-kring.md).
This is the living checklist + progress log for building the circle model.
Check boxes as slices land; append to the **Progress log** at the bottom.

## How we work — the additive rule

> **New views only. Never overwrite an existing screen.** The old shell must
> stay runnable side-by-side so we can reference it without digging through
> git history.

- **Web:** a *new* Vite entry `apps/canopy-chat/circle.html` → `web/v2/*`.
  The existing `index.html` + `web/main.js` are left untouched.
- **Mobile:** *new* screens under `canopy-chat-mobile/src/screens/v2/`, reached
  by a new nav entry; the existing `ChatScreen` stays untouched.
- **Portable logic:** new modules under `apps/canopy-chat/src/v2/`, shared by
  both web and mobile renderers (the portable-core split already in place).
- **Web ≡ mobile, in lockstep.** Every slice ships **both** surfaces in the
  same pass (platform-parity rule). The shared `src/v2/` logic is written
  once; web (`web/v2/`) and mobile (`screens/v2/`) are thin renderers over it.
- **Strings:** English is canonical + default; every label via `t()` under a
  `circle.*` locale namespace in `locales/en.json` (default) + `nl.json`.
- Reuse the **same bundled agent / substrates** the old shell uses — we are
  re-presenting existing data, not duplicating it.

## Decisions pinned (defaults — flag to change)

- **Surface:** **web + mobile together**, every slice (platform-parity rule).
  Shared logic in `src/v2/`; thin renderers in `web/v2/` and `screens/v2/`.
- **Circle = the existing group/circle/crew label** (`@canopy/circles`,
  `CIRCLE_ID_IS_CREW_ID_ALIAS`). Not a new entity.
- **Policy record:** `circlePolicy` in the circle's pod `shared.json` (F2),
  hung on the existing `settingsState` machinery.
- **Naming:** code term `circle`; the Dutch UI label is "kring".
- **First end-to-end target:** foundation is circle-type-agnostic; the
  launcher shows whatever circles already exist in the bundled agent (real,
  not mocked). Feature-rich proof targets a household-style circle.

## Phases & checklist

### Phase 0 — foundations + circle-first launcher (additive · web + mobile)
- [x] 0.1 `src/v2/circleModel.js` (shared) — read circles from circlesStore /
      existing groups; normalize `{ id, name, memberCount, lastActivity, features }`
      ✓ `normalizeCircle` / `mergeCircles` (de-dupe crewId≡circleId) /
      `loadCircles` (injectable fetchers, fault-tolerant, sorted); 8 unit tests green
- [x] 0.1b `src/v2/circleSources.js` (shared) — adapter mapping the host's
      `callSkill` onto the fetchers, **reusing existing ops** `getMyCrews` +
      `getCurrentGroup` (+ optional circlesStore); no new ops. 5 unit tests green
- [x] 0.2 `circle.*` locale keys in `en.json` (default) + `nl.json` (both apps)
      ✓ title/new/members/empty/loading × 4 files, JSON valid + key parity
- [x] 0.3 **web** — new Vite entry `circle.html` + `web/v2/circleLauncher.js`
      (pure DOM renderer, 6 happy-dom tests green) + `web/v2/circleApp.js` boot
      (reuses agent + circleSources, graceful-empty) + multi-page vite input.
      ⚠ renderer tested; live boot/data needs a **browser check**.
- [x] 0.4 **mobile** — `screens/v2/CircleLauncherScreen.js` over the shared
      model + an additive toggle pill in `App.js` (ChatScreen untouched, still
      default). ⚠ needs a **device check** (RN not unit-rendered here).
- [x] 0.5 F1 (foundation) — open a circle → scoped detail view. Shared
      `src/v2/circleScope.js` (`itemCircleId`/`isInCircle`/`scopeItems`, crewId≡
      circleId + `circle:`/`crew:` audience) + `src/v2/activeCircle.js`
      (get/set/subscribe). Web: launcher↔`circleDetail` nav (6+4 happy-dom
      tests). Mobile: inline detail in `CircleLauncherScreen`. 31 v2 tests green.
- [ ] 0.5b F1 (content) — populate the detail with the circle's **scoped
      items** (fetch feed/tasks/notes per circle, run through `scopeItems`).
      Today the detail shows the header + empty state.
- [ ] 0.6 Smoke: launcher lists real circles + opening one scopes the feed,
      verified on **both** web and mobile

### Phase 1 — settings + overrides
- [ ] 1.1 F2 `circlePolicy` record + reader (pod `shared.json`)
- [ ] 1.2 Circle settings screen — 5 axes (features/LLM/agents/reveal/pod) with
      a `Consequences` info-panel component (board 4A)
- [ ] 1.3 Co-admin consensus: pending-change record + "send proposal" (reuse
      `groupRedeem` envelope) (board 4A footer)
- [ ] 1.4 `memberOverride` record + personal-override sheet (board 6A)
- [ ] 1.5 Holiday mode + quiet hours → cross-circle availability + push
      suppression (board 6C)

### Phase 2 — new surfaces
- [ ] 2.1 Cross-circle **Stream** tab — unfiltered projection over EventRouter
      with circle-tags (board 5B)
- [ ] 2.2 **"View as…"** preview — re-run reveal/openness filter as a chosen
      viewer (board 4C)
- [ ] 2.3 **Advisor** — rules over `eventLog` + "too busy?" counter, ≤1/month
      (board 3D)
- [ ] 2.4 **Agent-as-participant** — add/approve an LLM member (board 4B)
      *(needs the design decision in Open Questions first)*

### Phase 3 — breadth
- [ ] 3.1 Hopping UI around Stoop's `hopThrough` (board 7)
- [ ] 3.2 Skill 4-axis editor + match list (human/agent/via-hop) + local
      discovery list (board 8)
- [ ] 3.3 Folio circle-scoped file browser (board 10B)
- [ ] 3.4 Create wizard → 6 rule-based questions + rules-document at join
      (boards 3B/3C)

### Later / excluded
- Store packaging (board 2), co-redaction (board 11), working PoL gate (10C).

## Open questions (carry from design)
1. Agents-in-circle (2.4): spec agent-as-participant now (own WebID + scope)
   or park as a placeholder like PoL?
2. `nl` label for "circle" — "kring" (default) vs ruimte/plek/tafel/hoek.
3. ~~Mobile parity timing~~ — **resolved: web + mobile together, every slice.**

## Progress log
- **2026-05-28** — Plan + design doc written. Confirmed against repo:
  canopy-chat already exposes ~60 slash ops + wizards + handlers covering
  most boards; only Stream / view-as / advisor / agent-participant are
  genuinely new. Additive convention chosen (new `circle.html` entry +
  `web/v2/` + `src/v2/`). Starting Phase 0.
- **2026-05-28** — Surface decision corrected to **web + mobile in lockstep**
  (per user). Slice **0.1 done**: shared `src/v2/circleModel.js` +
  `test/v2/circleModel.test.js` (8 tests green). Next: 0.2 locale keys, then
  the launcher views — web (`circle.html` + `web/v2/`) and mobile
  (`screens/v2/CircleLauncherScreen`) — over the shared model.
- **2026-05-29** — Launcher views shipped (0.2–0.4). Locale keys (4 files);
  web `circle.html` + DOM renderer (6 happy-dom tests, 19 v2 tests total green)
  + defensive boot + multi-page vite; mobile `CircleLauncherScreen` + additive
  App.js toggle pill. Shared model re-exported from `src/index.js` for mobile.
  Full canopy-chat suite: 874 pass / 1 unrelated flake (podStorage timing,
  passes isolated). **Needs human check:** web `circle.html` in a browser +
  the mobile "Circles" pill on device. Next: F1 (scope the shell by the opened
  circle) + real data wiring on both surfaces.
- **2026-05-29** — F1 foundation (0.5) shipped. Shared `circleScope` +
  `activeCircle` (8 tests); web launcher↔detail nav + `circleDetail` renderer
  (4 happy-dom tests); mobile inline detail in `CircleLauncherScreen`. Opening a
  circle now sets the active circle + shows a scoped detail with back. 31 v2
  tests green. **Needs human check:** open a circle on web (`circle.html`) and
  mobile → detail view + back. Next: 0.5b — populate detail with scoped items.
