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
- [x] 0.5b F1 (content) — populate the detail with the circle's **scoped
      items**. Shared `src/v2/circleContent.js` (`loadCircleItems` over existing
      list ops — bulletin/feed/tasks/notes — normalised + scoped) + a shared
      `makeResolvingCallSkill` (3-arg host callSkill → 2-arg op resolver, reused
      by web + mobile). Detail now lists scoped items (late-fetch guarded so it
      won't clobber the launcher after back). 37 v2 tests green.
- [ ] 0.6 Smoke: launcher lists real circles + opening one scopes the feed,
      verified on **both** web and mobile

### Phase 1 — settings + overrides
- [x] 1.1 F2 `circlePolicy` + `memberOverride` model — `src/v2/circlePolicy.js`
      (defaults, enum validation, normalise, deep-merge for edits); 7 unit tests.
      Pod `shared.json` persistence wires in with the settings screen (1.2).
- [x] 1.2 Circle settings screen (web) — 5 axes (features toggles + LLM/agents/
      reveal/pod radios) over the policy model, persisted via
      `circlePolicyStore` (localStorage now; pod `shared.json` later). Reached
      from the detail "⚙ settings"; en+nl labels. Store + renderer = 9 tests
      (56 v2 total). Mobile screen = M3.
- [x] 1.2b per-option **Consequences** info-panel (board 4A ⓘ) — each enum
      option (llmTool/agents/reveal/pod) carries a ⓘ toggle that expands a
      plain-language consequence panel from `circle.settings.consequence.<opt>`;
      the ⓘ only renders when consequence copy is actually translated (t() miss
      → no ⓘ). en+nl (12 options each). 3 new renderer tests (85 v2 total).
- [x] 1.3 Co-admin consensus (model + web gating) — `src/v2/circleConsensus.js`
      (`makeProposal`/`approveProposal`/`pendingApprovers`: edits apply unless
      `consensusRequired` + ≥2 admins, then a pending proposal needs the other
      admins). Settings screen gains a `consensusRequired` toggle + a
      "Send proposal →" save label + pending note when consensus is active.
      en+nl. 5 model + 2 renderer tests (70 v2 total).
- [ ] 1.3b Cross-admin proposal **delivery** — send/approve proposals
      peer-to-peer (reuse the groupRedeem request/response envelope). Needs the
      multi-admin P2P flow (can't exercise with one local user).
- [x] 1.4 personal-override sheet (web, board 6A) — chat-off / reveal-open /
      agents-may-contact-me + flow-through (tasks/calendar → My things) toggles
      over the `memberOverride` model, persisted via `createMemberOverrideStore`
      (localStorage). Reached from the detail "my settings". en+nl. 7 new tests
      (63 v2 total). Mobile screen → M3.
- [x] 1.5 Holiday mode + quiet hours → cross-circle availability + push
      suppression (board 6C). `memberAvailability` model (holiday `{active,until}`
      + quietHours `{enabled,from,to,weekends}`) with `isPushSuppressed(av, now)`
      (holiday window + overnight-wrapping quiet window + weekend rule), persisted
      via `createAvailabilityStore` (localStorage key `cc.availability`). Reached
      from the launcher "Availability" button → `circleAvailability` renderer.
      en+nl. 12 new tests (82 v2 total). Mobile screen → M3.

### Phase 2 — new surfaces
- [x] 2.1 Cross-circle **Stream** tab — unfiltered, time-ordered projection over
      the shared EventLog, circle-tagged per row (board 5B). Shared
      `buildCircleStream`/`eventCircleId` (`src/v2/circleStream.js`, derives the
      circle from event payload audience fields — circleId≡crewId≡groupId);
      web renderer (`web/v2/circleStream.js`) + mobile `CircleStreamScreen` over
      the same rows. Reached from the launcher "Stream" button; tapping a tagged
      row jumps to that circle. circleApp/App now wire an EventLog the agent's
      publishEvent feeds. en+nl. 12 new tests (97 v2 total) + Playwright green.
      ⚠ mobile screen Detox-only (next rebuild).
- [x] 2.2 **"View as…"** preview — re-run the reveal/openness filter as a chosen
      viewer (board 4C). Shared `viewAsDirectory`/`VIEWER_KINDS`
      (`src/v2/circleViewAs.js`): a real name shows iff the viewer is the member
      themselves, or a member under `open` policy / a pairwise reveal; strangers
      + agents see handles only. Web renderer + mobile `CircleViewAsScreen` (viewer
      picker chips + directory with shown/hidden badges) over the same projection;
      reached from circle detail "View as…". en+nl (web + mobile). 12 new tests
      (109 v2 total) + Playwright green. ⚠ **member directory has no data source
      yet** — needs an identity-resolver MemberMap op; renders empty until then
      (logic fully tested). Mobile screen Detox-only.
- [x] 2.3 **Advisor** — no-LLM rules over the EventLog (board 3D). Shared
      `computeAdvice`/`makeTooBusyEvent`/`COMPLAINT_TYPES` (`src/v2/circleAdvisor.js`):
      surfaces ≤1 advice card / circle / month when ≥3 complaints (incl. a
      member "I'm too busy" signal + disputes) land in 14d AND activity is rising
      (recent-vs-prior count), scoped per circle via `eventCircleId`. Web renderer
      + mobile `CircleAdvisorScreen` (advice card + dismiss + "I'm too busy"
      button that logs a `too-busy` event); monthly cooldown persists per-circle
      (localStorage / AsyncStorage `cc.advisorShown.<id>`). Reached from circle
      detail. en+nl (web + mobile). 13 new tests (122 v2 total) + Playwright green.
      Has live data (eventLog) — the too-busy button populates it. Mobile screen
      Detox-only.
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

## v2 becomes the main app (user-directed 2026-05-29)
- [x] Web: the v2 circle app is the **default** at `/` (`web/index.html`); the
      classic shell moved to `web/classic.html` (linked from the header).
      e2e specs + `bootTabs` repointed to `/classic.html`.
- [x] "+ new circle" creates for real via `quickCreateCircle` → `createGroupV2`
      (web prompt; mobile inline name input), then refreshes the launcher.
- [ ] Mobile default → circle app: **blocked on lifting the agent bundle to
      App level** (ChatScreen boots it internally; the launcher needs it for
      data + create). Reachable via the "Circles" pill until then.

## Testing cadence (user-directed 2026-05-29)
Catch mistakes "not too early, not too late" while keeping manual testing
minimal — automated-first:
- **vitest** unit + happy-dom render — every slice (assistant runs; green
  before commit). 63 v2 tests today.
- **Playwright** web e2e (`test-browser/circle-v2.spec.js`) — real flows unit
  tests can't cover (create→listMyBuurts). **Assistant runs these** (chromium
  installed; `npx playwright test`, ~8s, webServer auto-boots). ✓ circle-v2
  green (2/2). Run when a web slice touches the v2 flow.
- **Detox** mobile — assistant **can't** run (no emulator/device); user-run on
  a real phone / after the M1 bundle lift.
- **Real-user / device testing = the user.** Automated (vitest + Playwright)
  is the assistant's net; the user does real passes at phase boundaries.

## Parity adjustment (user-directed 2026-05-29)
Web confirmed working (launcher + create). Mobile's launcher/screens can't
function until the **agent bundle is lifted to App level** (ChatScreen boots
it internally). So for Phase 1 the per-feature slices ship **shared model +
web renderer** now; the mobile renderers + the bundle-lift are batched into a
**Phase 1 · mobile (M)** block. The shared `src/v2/` logic is written once, so
the mobile screens are thin follow-ons.

### Phase 1 · mobile (M)
- [x] M1 lift the agent bundle to `App.js` (inject into ChatScreen + the
      launcher) so mobile circle screens can load/create. App.js boots the
      bundle once + owns the shared EventLog; both screens receive it as a
      prop. ChatScreen's `bootState` is now DERIVED from the prop (shape
      unchanged) and it attaches its peer-wiring after mount via the new
      `bundle.attachPeerWiring` seam (the inbound router closes over
      ChatScreen's thread state, so it can't be passed at boot). agentBundle
      holds peer-wiring in a mutable slot read at delivery time + on the 1.5s
      catch-up — attach lands before the seconds-long NKN handshake. 2 new
      bootSmoke tests (163 mobile total). ⚠ RN screen layer is Detox-only.
- [x] M2 mobile default → circle app. App.js lands on the circle launcher;
      the classic chat shell stays ALWAYS mounted underneath (so its
      peer-wiring keeps routing inbound DMs / mesh while the launcher is up)
      and is revealed via "← chat" (testID `circle-to-chat`); the "Circles"
      pill (testID `open-circles`) returns. New `e2e/circleDefault.test.js` +
      a shared `e2e/support/nav.js` `gotoChat()` helper; the 9 chat-focused
      Detox tests now `gotoChat()` after launch. ⚠ Detox suite rebuild + run
      pending (device-only).
- [x] M3 port the Phase 1 web screens to RN — settings (1.2 + 1.2b consequence
      panels), personal override (1.4), and availability (1.5), each over the
      SAME shared model + store factories, persisted via new AsyncStorage-backed
      adapters (`src/core/circleStoresRN.js`, keys match web's localStorage
      convention). Reached from the launcher: Availability button (launcher bar)
      + Settings / My-settings on a circle's detail. Consensus save records a
      pending proposal (1.3b delivery still off). 4 new store-adapter vitest
      tests (167 mobile total) + `e2e/circleScreens.test.js` (availability
      device smoke). ⚠ Detox suite rebuild + run pending (combined M2+M3).
      Date/time fields are plain TextInputs (native picker = polish).

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
- **2026-05-29** — 0.5b shipped: `circleContent.loadCircleItems` (best-effort
  over existing bulletin/feed/tasks/notes ops, normalised + scoped) +
  `makeResolvingCallSkill` shared by both surfaces; web + mobile detail views
  now list the circle's scoped items (late-fetch guarded). 37 v2 tests green.
  **Needs human check:** real per-circle items in the detail on web + mobile
  (data path is best-effort; renderer/scope/content logic is unit-covered).
  Phase 0 done — next chapter is Phase 1 (settings + member overrides).
