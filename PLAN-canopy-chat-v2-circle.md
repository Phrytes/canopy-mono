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
- [x] 2.4 **Agent-as-participant** — RESOLVED by reframe (Frits, 2026-05-29), no
      new code. An agent is **just another user**: own WebID, runs externally,
      connects over NKN like any peer — so the existing identity/membership/
      reveal/capability stack already handles it (see [[agent-is-just-a-user]]).
      The only agent-specific knobs already exist: `memberOverride.agentsMayContactMe`
      (1.4/M3), the `circlePolicy.agents` axis (1.2), and "view as… agent" (2.2).
      Future hook (not now): a member-is-an-agent flag so the UI can badge it +
      `agentsMayContactMe` can enforce message filtering. Mirrors the
      circle=group reframe — don't build a separate agent entity.

### Phase 3 — breadth (built in parallel 2026-05-29: 3.1 by orchestrator, 3.2/3.3 by worktree sub-agents)
- [x] 3.1 Hopping UI around Stoop's `hopThrough` (board 7). Shared `circleHop.js`
      (`normalizeHopMode`, `buildHopChain` me→gate→target with `MAX_HOPS=1`,
      `makeHopRelayRequest` anonymized). Device-global stance toggle backed by
      Stoop `getHopMode`/`setHopMode`; web renderer + mobile `CircleHopScreen` +
      hop-match chain card (within-limit gate). Launcher-level (like Availability).
      en+nl ×2. 12 tests.
- [x] 3.2 Skill 4-axis editor + match list (board 8; local-discovery deferred).
      Shared `circleSkills.js` (4 axes openness/posture/status/radius +
      `buildSkillMatches` human/agent/via-hop). Web `circleSkillEditor` +
      `circleSkillMatches` + mobile screens. Editor reached from circle detail
      (draft persists `cc.circleSkill.<id>`); **matches screen built+tested but
      not yet routed** (no match source — like view-as). en+nl ×2. 17 tests.
- [x] 3.3 Folio circle-scoped file browser (board 10B). Shared `circleFolio.js`
      (`normalizeFolioFile` + `buildCircleFiles` scoped via `circleScope`).
      Web `renderCircleFolioBrowser` (All/Favourites/Recent filter strip) +
      mobile `CircleFolioScreen`. Reached from circle detail; **empty until a
      circle pod listFiles is wired**. en+nl ×2. 17 tests. (168 v2 total)
- [x] 3.4 Rules document — 6 governance questions + Agree/Decline consent
      (boards 3B/3C). Shared `circleRules.js` (7-field doc, 6 questions with
      purpose+agreements required, `normalizeRulesDoc`/`buildRulesDoc`/
      `isRulesComplete`/`isRulesEmpty`). Web `circleRulesEditor` (Save gated on
      required) + `circleRulesConsent` (read-only doc + Agree/Decline) + mobile
      `CircleRulesScreen`/`CircleRulesConsentScreen`. Reached from circle detail
      "House rules"; editor "Preview" → consent. Draft persists per circle
      (`cc.circleRules.<id>`). en+nl ×2. 14 tests (182 v2 total). **Additive** —
      threading the consent into the real create/join wizard state machines is a
      follow-on (kept the shared wizards stable).

### Phase 4 — Look & feel (Onderling design system re-skin) ← NEXT (Frits, 2026-05-29)
The original reason for the v2 transition. Current screens use an ad-hoc
gold/cream palette + system fonts + (web) ~no CSS + flat lists — wildly off the
design. Adopt the **Onderling design language: linen + serif + terracotta**
(tokens source: `outreach/Onderling_v2/_chrome.css`; layouts source: the 36-page
**`Canopy interface — interface-ontwerp · print.pdf`** at repo root — read it;
see [[onderling-design-system]]). Tokens: ink `#1f1c14`, ink-soft `#5a5240`,
paper `#f3efe2`, paper-2 `#ebe6d5`, line `#d8d1bc`, **accent terracotta
`#b04a30`**, status green `#4a6230`/`#e0e7d2` + blue `#3f4f76`/`#dde2ee`,
radius 10px, serif "Source Serif 4" headings + sans body.

Recurring components the boards demand (build once, reuse everywhere):
- **framed card** (1px `#d8d1bc`, 10px radius, paper-2 header strip);
- **pill toggle** (terracotta when on, grey track when off);
- **radio-as-box**: selected = terracotta ring + bordered box that expands an
  inline **"GEVOLGEN ALS JE DIT KIEST" consequence callout** (terracotta left-rule);
- **small-caps section label** (ink-soft, letter-spaced);
- **serif headline**; **primary button** solid terracotta / **secondary**
  bordered paper; **avatar circle** (initial on pastel);
- **tag chips** (kind-coloured: VRAAG blue, AANBOD green, LENEN amber; skill
  chips green); **numbered section badges** (terracotta circle "1/2/3").

- [x] 4.1 Shared theme — `src/v2/theme.js` (THEME, re-exported) + `web/v2/theme.css`
      (`:root` vars) + mobile `screens/v2/theme.js` deriving from THEME.
- [x] 4.2 Fonts — web: Source Serif 4 via Google Fonts (mirrors outreach).
      mobile: platform serif (Android Noto Serif / iOS Georgia) — NOT a runtime
      useFonts load (that hung boot at a black screen on device). Embedding
      Source Serif 4 at build time = a 4.8 polish follow-up.
- [x] 4.3 Component primitives — web `circle.css` + mobile theme/CircleTabBar;
      framed cards, pill toggles, radio-as-box + consequence callouts, etc.
- [x] 4.4 Nav restructure (chrome) — bottom tab bar **Kringen / Stroom / Mij**
      done on web (`circleTabBar.js`) + mobile (`CircleTabBar.js`); **Mij** =
      availability/quiet-hours + Hopping. ⏭ **Per-circle feature tabs deferred to
      Phase 5** — the feature surfaces (Agenda/Leden) have no content yet, so
      tabs would be hollow; build them when Phase 5 wires the data.
- [x] 4.5 Launcher re-skin — avatar tiles (web) + serif names; "+ new" dashed tile.
      (activity subtitle = Phase 5 member-directory data.)
- [x] 4.6 Web re-skin — `web/v2/circle.css` over all `circle-*` classes; settings
      multi-column on wide. Screenshot-verified launcher/detail/settings/Mij/stream.
- [x] 4.7 Mobile re-skin — gold/cream hex → THEME tokens across all 13 RN screens
      + App.js; serif titles, small-caps labels, terracotta Switch tint.
      ⚠ First device build booted black (font gate, now fixed) — re-verifying.
- [x] 4.8 Per-board pass — settings ⓘ moved inline top-right + consequence
      callout wraps inside the selected box (web, board 4A); mobile radio-as-box
      (selected option ringed terracotta) + left-bordered consequence callout.
      ↳ Optional deferrals (low value / entangled): embed Source Serif 4 on
        mobile at build time (platform serif works now); trim redundant
        back-arrows on the Stroom/Mij tab screens (the mobile e2e taps those
        `circle-*-back` testIDs, so removing them means re-tuning the specs).

### Phase 5 — Wiring & enforcement (close the "UI shipped, data/enforcement deferred" gaps)
Audit 2026-05-29: every in-scope board has UI+model on both surfaces, but a
lot is screen-only. This phase makes it real.
- [x] 5.1 Member-directory op → **View-as** now wired to the real directory
      via `listGroupMembers` (`normalizeCircleMembers`, web + mobile);
      device/web-verified showing real members + reveal badges.
      ↳ Skills matches: deferred — the match-by-skill DISCOVERY op isn't
        designed (board-8 local discovery, 5.7); routing an empty screen = hollow.
      ↳ Tile counts: crews already carry counts (getMyCrews); buurt tiles need a
        small enrichment pass (call listGroupMembers per buurt) — follow-on.
- [x] 5.2 Folio `listFiles` → real **Folio browser** data via
      `circleFilesFromListFiles` (scoped to the circle); web + mobile.
      web-verified showing the 3 seeded files. (Real circle-pod scoping lands
      with 5.4 pod-backing; today it scopes the flat index by circle tag.)
#### Substrate audit (2026-05-29, 3 parallel deep-dives) — reuse, don't rebuild
The remaining slices first looked "blocked on missing substrate", but the audit
of stoop / tasks-v0 / household / secure-agent / packages found the opposite:
**most of it already exists; the work is WIRING/surfacing in canopy-chat, not
authoring.** (Correction: my earlier "inject circleId at dispatch is a no-op"
call was WRONG — the tasks/stoop resolvers already consume an explicit
`_scope`/`crewId`/`groupId` arg, so scoping writes is a thin binding.)

EXISTS — reuse (file refs):
- **Pod IO**: `createPodWriter` + `discoverPodRoot` (`web/podStorage.js:262/73`,
  wired for calendar). Stoop per-group pod state: `attachPodToBundle.js:36` +
  `podPathMap.js:42` (`group/<crewId>/…`; `mem://stoop/settings` cross-app-settings
  = the canonical "shared.json" home). `createCirclePolicyStore({load,save})` is
  already IO-injectable — a `podPolicyIo` adapter drops in with zero caller changes.
- **Active-circle → app scope**: tasks `multiCrewResolver` picks the crew from
  `args.crewId → args._scope → topic` (`bundleResolver.js:54`); stoop resolves
  `groupId` per-call. Injecting `_scope=circleId` scopes writes. Mobile
  `switchActiveGroup` / `setActiveCrew` registry setters exist (ServiceContext).
- **Inbound gate**: secure-agent mute drop (`createSecureAgent.js:505` silent drop,
  vault-backed `MuteSet`) is the chat-off pattern; `PeerResolver.resolveByAddr` =
  addr→member.
- **Rules/consent flows**: join wizard (`joinGroupState.js`) already shows +
  ENFORCES rules consent (gated Next); create wizard (`createGroupState.js`)
  captures rules → `createGroupV2`. v2 `circleRules`/`circleSkills` are parallel
  PREVIEW models to map in (their headers say "threading is a follow-on").
- **Task claim**: `claimTask` (`tasks-v0/skills/index.js:209`). Solo crew: `Crew.js`
  zero-config + `'personal'` pod axis. `flowThrough.tasksToPersonal` flag exists, unconsumed.
- **Mnemonic onboarding**: `@canopy/react-native/mnemonic` + Vault Ed25519 seed +
  restore wizards. **Local "who's here"**: stoop-mobile `MdnsTransport`/BLE.
  **Proof-of-location**: `apps/presence-v0` attestation. **LLM**: `packages/llm-client`
  (provider-agnostic, ollama/mock).
- **Notifier**: `packages/notifier` + `PushPolicy` quiet-hours gate; mobile push
  `setupPush`/`ExpoNotificationsAdapter` (stoop/tasks-mobile, NOT canopy-chat).

GENUINELY NEW substrate (the only authoring left) — and WHY:
1. **Peer→circle membership reverse index** (`groupsFor(webid)`/`membersOf`). WHY:
   chat-off + agents-filter are per-circle, but inbound msgs arrive by peer addr;
   today there's addr→member but no "which circles is this member in" reverse index.
2. **Agent-vs-human marker** (`MemberMap.relation:'agent'` or a signed-claim field).
   WHY: `agentsMayContactMe` must filter AGENT contact specifically; no agent/human
   distinction exists ("an agent is just a user with a WebID", so none was added).
3. **Stored-silent message store**. WHY: board-5C chat-off = "stored, not delivered,
   keep/withdraw" — but mute only DROPS (no retention).
4. **Personal "Mijn dingen" crew instance + claim→personal router**. WHY: the
   `flowThrough.tasksToPersonal` flag is unconsumed + no crew is designated personal.
5. **Notifier suppression hook**. WHY: Notifier delivers unconditionally; needs a
   pre-gate to call `isPushSuppressed` (PushPolicy is a separate wrapper apps compose).

#### Re-sequenced coding plan (reuse-first)
- [x] 5.3 **Active-circle → app-scope sync** (WIRING; supersedes old 5.5). DONE
      2026-05-29. `scopeReadyDispatch(ready, activeCircleId)` (router.js) injects
      `circleId`/`crewId`/`groupId`/`_scope = activeCircle` into **create** dispatches
      only (verb ∈ {add,post}; NOT `create`/claim/complete/remove), and only when no
      explicit scope was given. Applied at the web + mobile `runDispatch` boundaries
      (peer-handler `callSkill` bypasses it → inbound posts aren't mis-scoped). Web is
      two pages, so main.js hydrates the active circle from `sessionStorage['cc.activeCircle']`
      (the bridge circleApp.js writes); mobile is one module instance, no bridge needed.
      Did NOT use `switchActiveGroup`/`setActiveCrew` — per-dispatch injection is cleaner
      (no persistent global crew-state mutation).
- [x] 5.3b **cc tasks → multi-crew (circle = crew = label/filter)**. DONE 2026-05-29.
      User: "tasks should have been multi-crew in the first place." cc tasks ran single-crew
      (`cc-default`), so the injected scope was delivered but storage wasn't split per circle.
      Now: `createBrowserMultiCrewTasksAgent` (tasks-v0/browser.js) composes a mesh agent on
      cc's shared bus with a `crewsMap` + `multiCrewResolver`; `ensureCrew(crewId)` lazily
      spawns a crew per circle (own `mem://tasks/crews/<id>/` store). cc resolver falls back
      to the primary crew for unscoped calls (preserves all legacy single-crew behaviour).
      realAgent `ensureCrew(realArgs.crewId)` before each tasks invoke. Circle view's task
      source wired: `getMyTasks` alias → `listOpen` (the entire `loadCircleItems` DEFAULT_SOURCES
      was aspirational — getBulletin/getFeed/getMyTasks/listNotes are in 0 manifests; getMyTasks
      is unique so `makeResolvingCallSkill` probes past stoop→tasks-v0). Tests: 5 factory-isolation
      (tasks-v0) + 5 CC-TK.F1 incl. REAL separation (task in circle A absent from B; unscoped stays
      in primary). Full suites green: tasks-v0 705, canopy-chat 1063, mobile 167.
- [x] 5.3c **Mobile multi-crew tasks parity** — DONE 2026-05-30.  Discovery: the
      mobile bundle (`agentBundle.js`) dynamically imports the same portable
      `createRealHouseholdAgent` that 5.3b already swapped to
      `createBrowserMultiCrewTasksAgent` + `ensureCrew(args.crewId)`.  Multi-crew is
      inherited transparently through that shared factory — no mobile-source swap was
      needed.  Added `apps/canopy-chat-mobile/test/multiCrewSeparation.test.js` mirroring
      CC-TK.F1: a task added with `crewId:'circle-a'` is visible in A and absent from B,
      and primary-crew seeds don't leak into a fresh circle.  Mobile suite 167 → **169
      passed (20 files)**.
- [x] 5.3d **Posts wired (stoop), notes is a substrate gap** — DONE 2026-05-30.
      Aliased `getBulletin → listOpen` in `STOOP_OP_ALIAS` (realAgent.js); per-circle write
      path pre-builds `targets: [{kind:'group', groupId}]` when `postRequest` carries a
      `groupId` (injected by `scopeReadyDispatch`); read path's `adaptStoopReply` surfaces
      `groupId` from `item.source.targets[]` to the row top level so `itemCircleId` filters
      correctly.  `getFeed` left unaliased (would dupe stoop posts).  `listNotes` reported
      as a true substrate gap — no `listNotes` skill exists in any app; wiring would need
      a notes substrate (write + list + per-circle scoping), out of scope for a wiring
      slice.  New `CC-ST.F1` block in journeys-cross-app.test.js mirrors CC-TK.F1 (post in
      circle-a absent from circle-b, seeded posts don't leak).  Suites: canopy-chat 1119
      (was 1117), tasks-v0 705, stoop 632.
- [x] 5.4a **Pod-backed circle config — substrate** (adapter + composite + host wiring).
      DONE 2026-05-29. `podPolicyIo({getWriter, app})` (JSON IO over `createPodWriter.read/write`,
      no-op when getWriter returns null) + `tieredPolicyIo(local, pod, {shouldMirror})`
      composite (local canonical; pod mirror gated by `value.pod !== 'none'` — the axis
      is actually enforced on writes). Host stores switched on both surfaces: web
      `circleApp.js` uses `tieredPolicyIo(localStorage, pod)` against a `podWriterRef.current`
      thunk; mobile `makeCirclePolicyStoreRN(storage, {getPodWriter})` takes an optional
      thunk (defaults null). Thunks are null today → behaviour unchanged until 5.4b flips
      the wire. 17 new unit/integration tests (mock podWriter proves load-falls-back-to-pod,
      saves mirror per axis, joiner picks up policy from pod). Rules/skills don't have stores
      yet (out of scope); member override stays local (it's personal — fits personal pod, a
      later slice). Full suites green: canopy-chat 1080, mobile 167.
- [x] 5.4b **Web pod session restore on v2 launcher** (activation). DONE 2026-05-29.
      Mirrors main.js's flow on circleApp.js (index.html): fire-and-forget
      `podAuth.handleRedirect({restorePreviousSession:true})` → `discoverPodRoot` →
      `createPodWriter` → assign to `podWriterRef.current`.  Trimmed vs main.js (no
      calendar/NKN hooks — those live on classic.html); the 5.4a tiered IO picks it up on
      the next save/load.  A policy with `pod === 'shared'` now actually mirrors to the
      group pod the moment the session resolves.
- [x] 5.4c **Mobile pod session restore on v2 launcher** — DONE 2026-05-30.
      `buildCirclePodWriter(session, deps?)` in `circleStoresRN.js` mirrors web's
      `discoverPodRoot → createPodWriter` flow over an `OidcSessionRN` (null on
      missing/unauthed/no-webid; `discoverPodRoot` + `createPodWriter` injectable for
      tests).  App.js lifts the session ref out of `ChatScreen`, adds `circlePodWriterRef`
      + `refreshCirclePodWriter()` + a sync `getCirclePodWriter` thunk, and threads
      `sessionRef` + `getPodWriter` to both `ChatScreen` and `CircleLauncherScreen`.
      ChatScreen accepts `sessionRef`/`onSessionChanged` (with back-compat fallback when
      not provided) and fires `onSessionChanged` on sign-in / sign-out so the launcher
      refreshes its writer.  Launcher threads `getPodWriter` into `makeCirclePolicyStoreRN`.
      Store identity stays stable; the thunk reads `.current` live so the moment the
      session restores the next save auto-mirrors.  8 new tests cover null/unauthed/no-webid
      and the local-only-vs-mirror paths.  Mobile suite 169 → **177 passed**.
- [x] 5.5a **Structured rules doc in create wizard** (WIRING). DONE 2026-05-29.
      `createGroupState` Step 3 now carries `state.rulesDoc` (a `DEFAULT_RULES_DOC`-shaped
      object) instead of a single `rulesText`; `buildRulesObjectFromState` spreads the v2
      doc via `buildRulesDoc({ ...rulesDoc, purpose: state.purpose })` so Step 1's purpose
      lands on the rules doc too.  Web + RN renderers iterate `RULES_QUESTIONS` (5 in the
      step — purpose is captured at Step 1) with locale-driven labels
      (`circle.rules.q.<key>.text`).  Machine-readable enum axes
      (`accessPolicy`/`leavePolicy`/`conflictPolicy`) coexist with the doc's free-text
      fields.  Tests updated (wizardsState2.test.js); full suites green (canopy-chat 1080,
      mobile 167).
- [x] 5.5b **Structured rules consent in join wizard**.  DONE 2026-05-29.
      `joinGroupState` now exposes `state.rulesDoc` (populated by `extractRulesDoc`
      when the invite carries v2 structured fields).  Web + RN consent screens render
      the per-field sections under their `circle.rules.q.<key>.text` labels; older
      `rulesText`-only invites fall back to the legacy single-blob view.  4 new
      state-machine tests.
- [x] 5.5c **Skills step in create wizard**.  DONE 2026-05-29.  Inserted a Skills
      step between Rules and Tech (`STEP_NAMES` now 6 entries).  Each row carries
      the four `SKILL_AXES` axes; unnamed rows are dropped at submit; `normalizeSkill`
      coerces enum values.  `buildRulesObjectFromState` embeds the named list as
      `rules.skills` (createGroupV2 spreads the blob verbatim; a dedicated substrate
      slot is a follow-up).  Web + RN renderers + 3 new tests.
- [x] 5.5d **Retire standalone v2 rules/skills previews into the wizards**.  DONE 2026-05-29.
      `circleRulesConsent.js` (the standalone joiner-preview renderer) deleted now that
      the join wizard inlines the same rendering from the same doc.  `circleRulesEditor`'s
      `onPreview` route dropped, and the `circleApp.js` host's `showRulesConsent` retired.
      `circleRulesEditor` itself stays — it's the post-create rules editor, a separate
      surface from the create/join wizards.  Skill editors stay too (post-create edit).
      Both suites green (canopy-chat 1084, mobile 167).
- [x] 5.6 **NEW substrate — peer→circle index + agent marker**.  DONE 2026-05-30.
      Two pieces, both fully tested:
      (a) `MemberMap.relation` extended to accept `'agent'` alongside the existing
          `'contact'`/`'group-member'` (default).  Backward-compatible; an unknown value
          falls back to `'group-member'`.  1 new test in
          `packages/identity-resolver/test/MemberMap.test.js` (76 total green).
      (b) `GroupsIndex` (`apps/canopy-chat/src/v2/groupsIndex.js`) — pure sync data
          structure with bidirectional `Map<webid, Set<circleId>>` +
          `Map<circleId, Set<webid>>`, methods `add`/`remove`/`removeCircle`/`groupsFor`/
          `membersOf`/`has`/`clear`.  `bindMemberMap(index, circleId, memberMap)` does an
          initial `.list()` sync then subscribes to `member-added`/`-updated`/`-removed`;
          returns an unbind that drops the circle.  Tolerates a MemberMap-shaped object
          without `on/off` and an array shorthand.  Exported from `src/index.js`.
          12 new tests (`test/v2/groupsIndex.test.js`).  Full canopy-chat 1096 / 1109
          green.  Unblocks 5.7 (chat-off + agents-filter inbound gates can now route by
          `groupsFor(peerWebid)` and check `member.relation === 'agent'`).
- [x] 5.7a **Override enforcement — pure substrate**.  DONE 2026-05-30.
      `apps/canopy-chat/src/v2/circleEnforcement.js` exports three host-injection-shaped
      pure predicates: `isInboundChatOff({peerWebid, groupsIndex, getOverride})`,
      `isInboundAgentBlocked({peerWebid, circleId, memberMap, getCirclePolicy,
      getOverride})`, `shouldRouteClaimToPersonal({circleId, getOverride})`.  Each fails
      closed on invalid input + swallows accessor errors as "no decision" so a broken
      override store never silently denies inbound.  13 tests cover the truth table +
      back-compat shapes.  Exported from `src/index.js`.
- [x] 5.7b **Quiet-hours Notifier hook**.  DONE 2026-05-30.
      `packages/notifier/src/Notifier.js` gained an optional `isSuppressed: (recipient,
      channelId, payload, now) => boolean | Promise<boolean>` constructor opt +
      `setSuppressionPredicate()` setter for late-binding.  `#fireOnce` / `#fireRecurring`
      consult it before each delivery; suppressed deliveries emit `'suppressed'` instead
      of `'fired'`, and a throwing predicate is treated as "do not suppress" so a broken
      hook can't silently swallow notifications.  5 new tests (78 / 78 notifier green).
      Predicate is host-supplied — typically the existing
      `isPushSuppressed(availability, now)` from `src/v2/memberAvailability.js`.  Stored-
      silent (board-5C "keep but don't notify") is intentionally NOT in this slice — it's
      an additional storage primitive layered on top of these gates, scoped separately
      if/when needed.
- [x] 5.7c **Wire enforcement into hosts** — DONE 2026-05-30 (2 of 3 wired; tasks
      claim-router deferred).
      **secure-agent** (`packages/secure-agent/src/createSecureAgent.js`): new factory opt
      `{groupsIndex, getOverride, getCirclePolicy, memberMap, getCircleIdForEnv?}`.  The
      receive handler now drops envelopes after the existing mute fast-path when either
      `isInboundChatOff` (shared-circle override.chatOff) or `isInboundAgentBlocked`
      (peer `relation === 'agent'` + `policy.agents === 'no'` OR `override.agentsMayContactMe
      === false`) matches.  Fails OPEN on accessor/predicate throw; logs via audit.
      Predicate logic mirrors `apps/canopy-chat/src/v2/circleEnforcement.js` (inlined to
      avoid a substrate→app layering violation).  Exposed as `sa.circleEnforcement.{wired,
      isInboundBlocked}` for diagnostics; `securityStatus().circleEnforcementWired` reports
      state.  12 new tests (secure-agent 120 → 132 green).
      **household** (`apps/household/src/scheduler/Scheduler.js`): household doesn't
      construct a `Notifier` (the migration is deferred per its README), so wired the
      5.7b contract directly into the digest/nudge dispatch.  New
      `isSuppressed: (recipient, kind, now) => bool|Promise<bool>` ctor opt +
      `setSuppressionPredicate(fn)` setter + `fireDigestNow({force:true})` bypass.
      Predicate consulted just before `postToChat`; a throwing predicate fails open.
      7 new tests including `isPushSuppressed`-shape integration (household 588 / 588).
      **DEFERRED: tasks claim-router.**  Would need (a) a personal-crew bundle resolver
      alongside the existing `bundleResolver`, (b) plumbing the canopy-chat per-circle
      `getOverride` accessor into the tasks adapter context, (c) re-targeting the
      substrate mirror's publish path.  Three concrete touches across tasks + adapter +
      canopy-chat host — past a focused edit.  The `shouldRouteClaimToPersonal` predicate
      is already unit-tested, so a future focused slice can pick it up.
      Suite results: secure-agent 131/132 (1 pre-existing skip), notifier 78/78,
      household 588/588, canopy-chat 1119/1132.
- [x] 5.8 **Pluggable LLM** (WIRING).  DONE 2026-05-30.
      `apps/canopy-chat/src/v2/llmPicker.js` exports a pure `selectLlmClient(policy,
      providers)` that maps the per-circle `llmTool` axis (`off`/`local`/`cloud`) onto
      a host-supplied `{local?, cloud?}` providers map (each is an
      `@canopy/llm-client.LlmClient` instance), failing closed to `null` for `'off'` /
      malformed inputs / a missing provider.  `createRealHouseholdAgent` accepts
      `opts.llmProviders` and surfaces it as `agent.llmProviders` (defaults `{}`), so
      downstream consumers pair it with the policy: `selectLlmClient(policy, agent.
      llmProviders)`.  6 unit + 2 integration tests (canopy-chat 1117 / 1130 green).
      No invocation in this slice — consumers (free-text resolution, find, content
      recs) land when the UX calls for them; the seam is in place.
      Supersedes [[llm-pluggability-deferred]].
- [x] 5.9a **`view` axis editable + read-hook in detail**.  DONE 2026-05-30.
      Added `'view'` to `ENUM_AXES` on web (`web/v2/circleSettings.js`) and mobile
      (`screens/v2/CircleSettingsScreen.js`) — admin can now pick `chat` / `screen` /
      `cross-stream` and the choice round-trips through the existing policy IO
      (incl. 5.4a's pod mirror).  `circleApp.showDetail` reads `policy.view` so the
      consumption seam exists; the actual route-swap to a chat / cross-stream variant
      is a UX follow-up (today's renderer still shows the detail screen, by design —
      both chat and cross-stream surfaces ride classic.html until v2 absorbs them).
      Settings DOM tests updated for the 5-axis layout (3 view + 3 llmTool + 3 agents
      + 2 revealPolicy + 4 pod = 15 enum options).  Suites: canopy-chat 1117 / mobile 167.
- [x] 5.9b **First-run onboarding + mnemonic** (mobile UX flow).  DONE 2026-05-30
      *(v1 — welcome + gate only; boot-time BIP39 restore deferred to 5.9b-followup
      / task #320)*.  Added `src/core/firstRun.js` (pure AsyncStorage probe of
      `cc-chat-id:agent-privkey` + `cc.welcomed` marker) and
      `src/screens/FirstRunWelcomeScreen.js` (Welcome with Start + "I have a
      recovery phrase" CTAs).  `App.js` now holds a `firstRun: 'checking'|'show'
      |'dismissed'` state, gates the bundle-boot useEffect on `=== 'dismissed'`
      (so we don't synthesise an identity the user is about to overwrite), and
      renders the welcome until `Start` is tapped.  "I have a recovery phrase"
      surfaces a deferred-feature notice pointing at the existing
      `/restore-from-mnemonic` wizard — true boot-time restore needs a
      `getMnemonicOnce` skill on the canopy-chat agent (not registered) plus
      vault re-keying support, both tracked as **#320 (5.9b-followup)**.
      Suites: canopy-chat 1127 / mobile 185 (+8 new `firstRun.test.js`).
- [x] **5.9b-followup** — boot-time BIP39 restore on mobile (task #320). DONE 2026-05-30.
      Added `src/core/restoreFromMnemonic.js` (pure helper: normalises input, validates
      BIP39 via `@canopy/core.validateMnemonic`, seeds `cc-chat-id:agent-privkey` via
      `AgentIdentity.fromMnemonic` + a `VaultAsyncStorage` with the matching prefix).
      Added `src/screens/MnemonicEntryScreen.js` (multi-line input + live word-count
      + localised error mapping). `App.js` grew a `firstRun: 'restore'` state between
      `'show'` and `'dismissed'`: tapping "I have a recovery phrase" routes to the
      entry screen, valid submit seeds the vault BEFORE flipping to `'dismissed'`,
      so the boot useEffect finds the seeded keypair instead of generating fresh.
      `AgentIdentity.getMnemonic()` already exists for the future read-side
      ("show me my words again") — no new skill registration needed for V0.
      8 new pure tests cover every error branch (empty / wrong-length / invalid /
      storage). en+nl locales. Suites: mobile 200 / 24 files (192 + 8 new).
- [x] 5.9c **Local "who's here" via `MdnsTransport`** (task #316). DONE 2026-05-30.
      Added `get connectionCount()` on `MdnsTransport`, dynamic-imported it in
      `canopy-chat-mobile/agentBundle.js` (best-effort + time-boxed `connect()`,
      silent when the native module isn't compiled in), exposed as `bundle.mdns`.
      `CircleLauncherScreen` renders a passive "Nearby N device(s)" row at the top
      of the kringen list, subscribes to `peer-discovered` + `peer-disconnected`
      so the count updates as peers come and go.  Hides when `bundle.mdns` is null
      (vitest / iOS / Expo Go / Wi-Fi off).  7 new tests (`nearbyRow.test.js`) cover
      formatter + synthetic mdns contract.  en+nl locales (`circle.nearby.label` /
      `circle.nearby.count`).  Worktree-discipline note: the dispatched sub-agent
      claimed integration but only shipped the formatter + tests — the launcher
      render had to be re-wired by hand against the race-corrupted file.
- [x] 5.9d **PoL placeholder row** (task #317). DONE 2026-05-30.
      Added `apps/canopy-chat/src/v2/circlePol.js` (`getCirclePolStatus`,
      `formatPolStatus`, `formatAttestedAt`) + 14 unit tests.  Re-exported from
      `apps/canopy-chat/src/index.js`.  Web `circleDetail.js` accepts a `pol`
      prop and renders `.circle-detail__pol` between the meta row and items;
      `circleApp.showDetail` probes `getCirclePolStatus` in parallel with
      `loadCircleItems`.  Mobile `CircleLauncherScreen.CircleDetail` accepts
      `callSkill` + probes on mount + renders a `polRow`.  en+nl on both
      surfaces (`circle.pol.title` / `notConfigured` / `attestedAt`).  Real
      attestation gate (board 10C) stays in "Later / excluded".  Worktree note:
      sub-agent breached into main tree + reverse-engineered overwritten work
      from failing tests; merged manually from the worktree files.
- [x] 5.9e **`view='chat'` routes to circle-bound chat** (task #339). DONE 2026-05-30.
      Tapping a circle whose `policy.view === 'chat'` now bypasses the action-grid
      detail and routes to the chat surface (5.3's active-circle dispatch already
      scopes posts to the circle's buurt-thread, so dismissing to chat is enough).
      Mobile: launcher's `openCircle` peeks the policy and calls the new
      `onChatRoute(circleId)` prop; App.js wires it to `setScreen('chat')`.
      Web: `circleApp.showDetail` does the same check and navigates to
      `/classic.html?circle=<id>`.  Both fall through to default detail when
      `view` isn't 'chat'.  Follow-up: per-circle thread auto-selection inside
      ChatScreen on URL/prop arrival (low-risk, the active-circle dispatch
      already does the heavy lifting today).

**Phase 5 closed 2026-05-30.** Suites: canopy-chat 1141 / 1154 (+13 todo, +14
new circlePol), canopy-chat-mobile 200 / 24 files (+15 across 5.9b firstRun,
5.9c nearbyRow, and 5.9b-followup restoreFromMnemonic).

### Later / excluded
- Store packaging (board 2), co-redaction (board 11), working PoL gate (10C).

### Phase 6 — design-vs-code gap audit (2026-05-30 PDF re-read)
A re-read of `Canopy interface — interface-ontwerp · print.pdf` against current code surfaced 10 major + 8 minor gaps the plan either missed or under-tracked. All logged as P6.* tasks. **English-first locale per [[english-default-multilingual]]** — the PDF mockups are in Dutch but the app default is English; Dutch UI strings translate to nl locale entries.

**Major (P6.1–P6.10):**
- P6.1 (#321) — Functies axis (per-kring feature toggles: chat/board/tasks/lists/calendar/notes/rules/memberCard). Today's ENUM_AXES is missing this entirely.
- P6.2 (#322) — Multi-admin consensus voorstel flow (board 4A): `Show diff` + `Send proposal →` + "N changes waiting on X" — 1.3b's deferred delivery side.
- P6.3 (#323) — Kring tile activity-preview subtitle + unread badge (board 5A). 4.5 promised this but it never landed.
- P6.4 (#324) — Wederkerigheid notice when peer has chat-off (board 5C): "X doesn't receive chat in Y · Save / Withdraw".
- P6.5 (#325) — Taken doorstroom claim-router buurt → "My things" (board 6B). Finishes 5.7c's deferred 3 substrate touches.
- P6.6 (#326) — Auto-hop-prompt when in-circle skill-match returns nothing (board 7A).
- P6.7 (#327) — Skill-match source-side wiring (board 8B): inline match list under a posted question. 3.2's "no match source" gap.
- P6.8 (#328) — "Nearby" dedicated screen with people + public skills + BLE/mDNS source (board 8C). 5.9c only adds a count; the screen is a separate gap.
- P6.9 (#329) — First-run mnemonic display on CREATE side (board 3A): 12-word phrase + [Written down/Photo/Later] CTAs. Distinct from #320 (restore-side).
- P6.10 (#330) — Agent-toevoeg admin approval flow (board 4B): admin-OK-per-agent join request card.

**Minor (P6.M1–P6.M8):**
- P6.M1 (#331) pod-migration warning · P6.M2 (#332) view-as "sees / doesn't see" split · P6.M3 (#333) Stream pinned compose + inline actions · P6.M4 (#334) split @-mention vs all-message push · P6.M5 (#335) holiday extension shortcuts + outgoing auto-reply · P6.M6 (#336) per-contact hop overrides UI · P6.M7 (#337) "My things" as Folio notes-list · P6.M8 (#338) Folio "Shared by me / with me" filters.

**Phase 6 closed 2026-05-30.** All P6.* (10 major + 8 minor) shipped with peer-fan-out / cross-device approve / mDNS skill broadcast wiring as follow-ups.

### Phase 7 — Schermen reframe (α wave, 2026-05-31 / 2026-06-01)
A re-read of the v2 PDF (`Canopy interface · v2 — kring als bouwsteen · print.pdf`) surfaced a separate 10-item audit (distinct from Phase 6's gap audit) that proposed a *recipe-block scherm + user-owned screens* model. Shipped in 5 stages:

- [x] **α.1 — Recipe-block editor for scherm-mode** (closes audit #1 + #9). Per-kring `RecipeBook = {recipes:[{id,name,blocks:[{id,type,config,order}]}], activeId}` persisted via the same tiered pattern as `circlePolicyStore`. 7 block types: `announcement`, `noticeboard`, `agenda`, `tasks` (added α.4), `rules`, `photo`, `text`. Per-block status `'ok'|'empty'|'error'` with per-block fallback render. Tasks #365–#375. **Files:** `src/v2/kringRecipe.js`, `src/v2/kringRecipeBlocks.js`, `web/v2/circleScreen.js` + `circleRecipeEditor.js`, `mobile screens/v2/CircleScreenView.js` + `CircleRecipeEditorScreen.js`.
- [x] **α.2 — Per-user multi-kring screens** (closes audit "screens reframe"). `ScreenBook = {screens:[{id,name,kringFilter:[cid|null],blocks}], activeId}` per user. Multi-kring materializer iterates active kringen, drops muted (Q5), caps by limit. Tasks #376–#377. **Files:** `src/v2/userScreens.js`, `src/v2/userScreenBlocks.js`.
- [x] **α.3 — Schermen as the primary landing tab.** New top-level tab `Schermen` replaces `Kringen` as the boot landing surface. First-run seeds a "Stream" screen with one noticeboard block. Tasks #378–#381. **Files:** `web/v2/circleScreensPicker.js`, `mobile CircleScreensPickerScreen.js`, `circleApp.js:showScreens`.
- [x] **α.4 — Migrate "Mijn dingen" + personal calendar to default screen recipes** (closes audit #7 + #8). New `tasks` block type (per-kring + multi-kring materializers, Q5 mute drop, scope `assigned-to-me`|`all`). First-run seed grows from one screen ("Stream") to three: "Stream" + "My things" (tasks block) + "My calendar" (agenda block). Commit `bfb3d3c`. Tasks #382–#385.
- [x] **α.5 — Polish trio** (closes audit #3 + #6 + #10). Three parallel worktree sub-agents:
  - α.5a (#386, commit `e8eb47b`) — `quickReplies:[{label,slash}]` field on reply payloads + inline-keuze pill row in bot/LLM bubbles; tapping submits the slash through the existing input path. New `src/core/quickReplies.js` portable normaliser; web `domAdapter.js` + mobile `MessageBubble`.
  - α.5b (#387, commit `c538378`) — extends per-kring personal-override `push` from `{onMention, onEveryMessage}` to four kinds adding `onNewItem` + `onProposal`; new "Notifications" section in CircleOverride on both surfaces.
  - α.5c (#388, commit `7f75778`) — optional `compact:boolean` on the four list-shaped block configs (announcement / noticeboard / agenda / tasks) + `.circle-screen__block--compact` CSS variant + RN `*Compact` style variants + per-block "Compact" checkbox in the recipe editor (web + mobile).

**Phase 7 closed 2026-06-01.** Suites: canopy-chat 1628 / 1641 (+26 over α.4 baseline), canopy-chat-mobile 222 / 222 (+6). Worktree-base bug fixed (`worktree.baseRef: "head"` in `settings.local.json`). v2 PDF audit closed except #5 (co-redactie) and #2 + #4 (never enumerated — likely the same Schermen + Mijn-dingen items now covered).

### Phase 8 — Launcher rethink (β-residual, NEXT)
**Why now.** With Schermen as the primary landing tab (α.3) the launcher's role shrank: it's the secondary "switch to a specific kring" surface, not the home screen. But `circleLauncher.js` still carries 5 action buttons from the pre-Schermen era (Stream / Availability / Hop / Nearby / MyThings) that duplicate what's on Schermen + Mij. The kring tile list itself is in arbitrary order, has no grouping, and "+ new circle" doesn't carry kind-aware defaults despite the create wizard knowing about kinds.

The α wave touched the chrome around the launcher but never re-thought the launcher itself.

- [x] **β.1+β.2+β.3 — Launcher overhaul** (combined, commit `949c873` 2026-06-01). Stripped 5 duplicate top-row buttons; sort tiles by `previews[c.id]?.ts` desc with name tiebreak; group tiles by `kind` (`KIND_ORDER = ['household','buurt','vriendenkring']` + 'other'), headers shown only when ≥2 kinds present. Web + mobile, 17 launcher dom tests + 4 parity tests.
- [x] **β.4 — Kind-aware "+ new circle" defaults** (commit `e3b4f12` 2026-06-01). New `apps/canopy-chat/src/v2/kringTemplates.js` exports a `KRING_TEMPLATES` map + `defaultsForKind` + `applyTemplate`. Wired into `createGroupState.setKind` — picking a kind pre-fills `features` / `revealPolicy` / `pod` / `llmTool` / `agents` / `consensusRequired`. User-overridden values always win; switching kinds is non-destructive. 17 template tests + 9 wizard tests + 2 parity.
- [x] **β.5 — Per-tile context menu** (commit `7ca1173` 2026-06-01). Right-click (web) / long-press (mobile) opens a 4-action menu — [Pin to top] / [Mute] / [Settings] / [Leave kring]. Pin state via new `src/v2/circlePinStore.js` (portable + AsyncStorage adapter); pin partition applied AFTER β.2 sort but BEFORE β.3 grouping so pins stay inside their kind section. Mute toggles existing `DEFAULT_MEMBER_OVERRIDE.chatOff`; Leave dispatches `stoop.leaveGroup` after a destructive-confirm. RN menu uses Modal-with-backdrop. 12 pin-store + 28 launcher + 5 parity tests.

**Phase 8 closed 2026-06-01.** Suites: canopy-chat 1696 / 1709 (+68 over α.5 baseline), canopy-chat-mobile 222 / 222 (no regression). The launcher is now: title → kringen grouped by kind, pinned-first inside each section, sorted by recent activity → "+ new circle".

### Phase 9 — Co-redactie via folio sync-engine (γ wave, NEXT)
**Reframe (Frits, 2026-06-01).** Original Phase 9 was a full CRDT — L, deferred. But a re-read of `packages/sync-engine/` + `apps/folio/` showed ~80% of the substrate already exists: three-way diff (`packages/sync-engine/src/diff.js` produces `{toUpload, toDownload, toDelete, conflicts}`), content-addressed version capture with retention (`packages/sync-engine/src/versions.js`), SyncEngine orchestrator with an `applyConflict` hook (defaults to noop emit-only), and a concrete file-oriented `applyConflict.js` in folio that writes git-style markers as a reference pattern. Live CRDT editing + presence is **deferred** indefinitely; this wave does *post-sync merge conflict resolution* for kring JSON blobs (recipes, rules, policy).

The gap: kring stores (`circlePolicyStore`, `kringRecipeStore`, `circleRulesStore`) blindly overwrite on save — no diff, no versions, no conflict surface. They're JSON blobs, not files, so folio's byte-level diff isn't a direct fit but the diff+versions+applyConflict *shape* is.

- [ ] **γ.1 — `objectDiff` substrate** (S). New `packages/sync-engine/src/objectDiff.js` mirroring `diff.js`'s shape but per-key over a JSON object: takes `(localObj, podObj, knownObjState)`, returns `{toMerge, conflicts}` where each conflict is `{path:string[], yours, theirs, base}`. Pure + tested (~10 cases: both-changed, one-side-only, base-missing, deep nesting, array-of-blocks treated as keyed by `id`). Lives in sync-engine so other JSON-blob stores can reuse it.
- [ ] **γ.2 — Version capture wired into kring stores** (S/M). Hook `captureVersion()` (from `packages/sync-engine/src/versions.js`) into the tiered-store save path used by `circlePolicyStore` / `kringRecipeStore` / `circleRulesStore`. Each save snapshots the prior content into a versioned slot keyed by `(circleId, storeName)` so γ.3 has the "last common state" needed for 3-way merge. Reuse existing retention machinery (50 versions / 100MB budget per file → 50 versions per `(circleId,storeName)` pair). Add a `listVersions(circleId, storeName)` helper. Tests: capture on every save; retention prunes; round-trip restore.
- [ ] **γ.3 — Per-block conflict UI in the recipe editor** (M). When loading a recipe and finding a pod-side change that conflicts with local (via γ.1's `objectDiff` over γ.2's versioned ancestry), surface a modal: "Two of you edited this. [Keep yours] / [Take theirs] / [Merge]". Per-block granularity — recipes are made of independent blocks, so a conflict touches only the affected blocks, not the whole recipe. Web + mobile.
- [ ] **γ.4 — Same flow for rules doc + circlePolicy** (S). Trivial extension once γ.1–γ.3 land — same diff + versions + modal, different store.

**Total**: ~4 small commits. γ.1 and γ.2 are independent (different files); γ.3 depends on both; γ.4 is a flow follow-on.

### Later / deferred
- **Live CRDT editing + presence** — the original Phase 9 ambition. Needs Y.js or similar + presence substrate + NKN sync of edit ops. Out of scope until post-sync merge proves insufficient.
- **Co-redactie for text/photo block content** — there are no inline editors for those today; once one exists, γ's diff applies.

### Cleanup (cross-cutting)
- [ ] **Vite build leak — multiple Node-only imports reach the browser bundle.**
      Pre-existing (predates 5.4). vitest/dev/Playwright fine, only `vite build` fails.
      **Partial progress 2026-05-30:** `fsNode` lazy-loaded in
      `packages/sync-engine/src/versions.js` + `apps/folio/src/autoShare.js` (the original
      blocker chain). Next blocker is `apps/stoop/src/lib/FilePersist.js`; ~10 source
      files across `packages/{sync-engine,pod-client,pseudo-pod,core}`, stoop, folio
      eagerly import `node:fs`/`path`/`crypto`. **Proper fix is a Vite `resolve.alias`
      for `node:*` to a stub-with-named-exports**, not per-file lazy-loading — that's a
      one-config-line change in the canopy-chat Vite config, vs ~10 file edits.

## v2 becomes the main app (user-directed 2026-05-29)
- [x] Web: the v2 circle app is the **default** at `/` (`web/index.html`); the
      classic shell moved to `web/classic.html` (linked from the header).
      e2e specs + `bootTabs` repointed to `/classic.html`.
- [x] "+ new circle" creates for real via `quickCreateCircle` → `createGroupV2`
      (web prompt; mobile inline name input), then refreshes the launcher.
- [x] Mobile default → circle app — **SHIPPED in M2** (2026-05-29).  App.js
      lands on the circle launcher; classic chat shell stays mounted
      invisibly so its peer-wiring keeps routing while the launcher is up.
      The "Circles" pill remains as the explicit toggle.  This entry was
      left as `[ ]` by mistake when the original "blocked on bundle lift"
      stalled — the unblock + ship landed in M1 + M2 below.

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
1. ~~Agents-in-circle (2.4)~~ — **RESOLVED 2026-05-29:** an agent is just
   another user (own WebID, external, over NKN). No in-app agent entity;
   reuse the peer/identity/membership stack. See [[agent-is-just-a-user]].
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
