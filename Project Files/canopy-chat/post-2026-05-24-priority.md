# Post-2026-05-24 priority — bundled plan

After the 2026-05-24 mobile-pivot wave + the 2026-05-25 first-boot
debug session + the 2026-05-26 chat-shell-port + Detox-D-1 wave.
Re-framed as **bundles with goals**, not a flat priority list.
Each bundle says what user-perceptible thing it delivers (cross-
referenced against the JM-* and J-* journeys).

## Status — 2026-05-26 close-of-day

| Bundle | Goal | Status |
|---|---|---|
| **A — Mobile becomes usable** | User can chat on canopy-chat-mobile (JM-1/2/7/8/9/10) | ✅ **COMPLETED 2026-05-26** — #253 all 7 substeps shipped (drawer, multi-field form, button specials) |
| **B — Cross-platform surface parity** | Web ≡ mobile per app | ✅ Mostly done — #250 closed (redundant), #251 shipped, #252 remains, #237 likely redundant |
| **C — Foundation decisions** | Architectural calls land in code | ✅ #240 + #238 done 2026-05-27 (portable `calendarOutboundHook` factory; mobile + web both wired). #248 (stoop-mobile-standalone) rescoped to lower priority — Bundle H handles stoop-via-canopy-chat-mobile |
| **D — Test infrastructure** | JM-* regression-tested | ✅ **COMPLETED 2026-05-26** — #224 Phase A (4 Playwright on Expo web, 13.7s) + Phase B D-2 (8/8 Detox, ~104s) green |
| **E — Deferred** | Pre-existing parked | #167 unchanged |
| **F — Web↔mobile host-op parity** | Mobile host slashes (`/me`, `/help`, `/find`, …) + wizards (dispute, createGroup, …) actually run | ✅ **COMPLETED 2026-05-26** — all 6 slices shipped same day; ~18 host ops live, 7 wizards rendered as RN modals, /logs panel, file picker, /embed-time chrono fallback, Solid OIDC wired via @canopy/oidc-session-rn (real-pod test still parked behind #167) |
| **G — Mobile connectivity gaps** | The host-ops *that needed runners* (`/brief /find /apps`) actually work + NKN actually connects | ✅ **G1+G2+G3 DONE 2026-05-27** — `/brief /find /apps` route to real runners; NKN connects on c53828f5; `/lookup-peer` + `/publish-nkn` wired via portable `podNkn.js` (real-pod end-to-end still parks behind #167 pod creds) |

**Today's deliverables (2026-05-26):**
- ✅ #253 ALL 7 substeps (steps 1-4 + step 5 drawer + step 6 multi-field form + step 7 button specials)
- ✅ #224 Phase A + B D-2 (Playwright Expo-web + Detox extended, drawer/state-morph/multi-thread on emulator)
- ✅ #240 manifest-state-shape convergence (2-line fix + defensive vitest)
- ✅ #251 tasks-v0 web edit-skills page
- 🗑️ #250 closed as misframed (stoop already had it)
- ✅ **#254 D-0 setup + D-1 smoke tests green** on c53828f5 + Medium_Phone_API_36 emulator
- 🆕 **Bundle F filed**: real-device test by user revealed the host-op short-circuit gap (root cause: chat-shell port focused on RN scaffolding, never ported `localBuiltins` from web)

**Bundle F shipped same day, P1→P6:**
- P1 host-op lift (~18 ops live: /me /help /whoami /find ... /reset-thread)
- P2 RN wizards + registry (7 wizards: dispute, createGroup, joinGroup, restoreFromMnemonic, postAudience, encryptedBackup, settings; embed-time added in P5)
- P3 LogsPanel + EventLog wiring (settings already shipped in P2)
- P4 file picker via existing packages/react-native/src/picker substrate + expo-file-system for downloads
- P5 /embed-time wizard + upstream chrono fallback in createTimeEmbed (benefits web too)
- P6 Solid OIDC via existing @canopy/oidc-session-rn substrate (canopychat scheme; SecureStore-backed session)

**Sequencing now:** Bundle F closed.  Open mobile work:
- #237 folio-mobile substrate wiring (shareFolder/saveToMyPod/downloadFile/listFiles/getFileSnapshot)
- ~~#238 calendar substrate path on mobile~~ ✅ shipped 2026-05-27 (portable `calendarOutboundHook` factory; web + mobile wired with single impl)
- ~~#248 stoop-mobile-STANDALONE catch-up scheduleCatchUp impl~~ ✅ shipped 2026-05-27 via Option A — NknTransport composed into stoop-mobile's agentBundle; `agent.nkn` adapter mirrors canopy-chat's `sa.peer`; lifted `requestCatchUpFromKnownPeers` + `handleCatchUpRequest` + `handleBuurtPost` wired through `makePeerRouter`; 7 new tests; soft dep (no nkn-sdk in package.json — devs opt in via `{nknLib}`).
- ~~#252 tasks-v0 web chat thread page~~ ✅ shipped 2026-05-27 (chat.html + portable ui/chatThread.js + 28 tests; tasks-v0 642/642)
- ~~#271 Bundle H Phase 4~~ ✅ shipped 2026-05-27 — BOTH halves: helpWithResponse (portable factory + structured responder-card bubble on mobile, 3 button intercepts) AND group-redeem-response (joiner-side cross-instance redeem via shared pendingMap; portable makeSendGroupRedeemRequest factory; wired through joinGroupWizard's sendPeerRedeem prop). Bundle H is now complete on mobile — all 11 inbound subtypes routed.
- #252 tasks-v0 web chat thread page
- #167 pod creds (parked; unlocks real-pod testing for P6 and 9 it.todo specs)
- ~~Bundle F P4 follow-up: [Download] real-save~~ ✅ #266 shipped 2026-05-27 — renderer surfaces item.embed; ChatScreen wires `save-file` intercept → `saveBase64File` (expo-file-system); locale strings (en/nl) added; +1 buttonSpecials test
- ~~Bundle F P4 follow-up: generic document picker~~ ✅ #267 shipped 2026-05-27 — `pickDocument` + `pickOneDocument` added at `packages/react-native/src/picker/`; expo-document-picker 13.0.3 added to canopy-chat-mobile; `openFilePicker` now routes through generic doc picker; `readFileAsBase64` short-circuits on pre-loaded `dataB64` so Hermes (no FileReader) works; +9 substrate tests
- Bundle F P6 follow-up: real-pod sign-in test once #167 unblocks
- **Bundle H Phase 1 (#268) shipped 2026-05-27** — portable `peerRouter` + portable `chatMessage` handler + DM-thread state on mobile (`ensureDmThread`/`updatePeerDisplay` reducers) + `buildPeerWiring` factory on `bootAgentBundle` + 1.5s post-connect catch-up trigger wire. Mobile now receives chat-message + buurt-peer-intro + catch-up-request envelopes from peers. canopy-chat 724/724, canopy-chat-mobile 134/134.
- **Bundle H Phase 2 (#269) shipped 2026-05-27** — six portable handler factories (calendarInvite / calendarRsvp / fileShare / buurtPost / groupRedeem-request+response / helpWith-accepted) at `apps/canopy-chat/src/core/handlers/`; web replaces inline `onPeerMessage` if/else with `makePeerRouter` delegating to existing inline functions; mobile wires the four substrate-safe handlers (calendar-rsvp / buurt-post / group-redeem-request / help-with-accepted) plus Phase 1's chat-message + buurt-peer-intro + catch-up-request. helpWithResponse stayed inline on web (DOM widget). canopy-chat 758/758 (+34), canopy-chat-mobile 134/134.
- **Bundle H Phase 3 (#270) shipped 2026-05-27** — mobile MessageBubble's new `EmbedCardBubble` renders time-card + file-card embeds with manifest-driven buttons via portable `computeEmbedButtons` helper. Calendar-invite + file-share peer handlers wired on mobile. Locale en/nl. canopy-chat 765/778 (13 todo), canopy-chat-mobile 143/143. STILL DEFERRED: helpWithResponse needs structured 'responder-card' bubble shape; group-redeem-response mobile needs /join-group pendingMap.
- **#237 folio-mobile substrate (closed 2026-05-27)** — investigation confirmed all 5 folio skills work end-to-end on mobile via the in-process `bundle.callSkill` already (substrate is platform-neutral). Added `apps/canopy-chat-mobile/test/folioOps.test.js` (+9 tests). Two cross-platform gaps surfaced as future work: (a) `listFiles` not declared in `mockFolioManifest` (no slash on either platform); (b) `saveToMyPod` is a placeholder on BOTH platforms — real cross-pod copy needs more substrate work.

---

## Bundle A — Mobile becomes usable ⭐

**Goal:** turn canopy-chat-mobile from a curiosity into something
a user can actually have a conversation in.  Today the app boots,
shows the per-app section counts and a "/" FAB, and that's it —
there's no way to type freely, no message list, no thread sidebar.

**Journeys unblocked:** JM-1 (compose across apps), JM-2 (offline
post sync), JM-7 (sub-task spawn), JM-8 (cross-device handoff),
JM-9 (calendar invite from thread), JM-10 (holiday mode UI).  Six
of the ten mobile journeys.

### #249 — First Android boot smoke ✅ COMPLETED 2026-05-26

All checklist items verified on-device:
- ✅ Cold boot → "Agents ready" status
- ✅ All 6 NavModel rows render (canopy-chat / household /
  tasks-v0 / stoop / folio / calendar)
- ✅ Kill + relaunch — identity persists via VaultAsyncStorage,
  stoop cache via AsyncStoragePersist, no re-onboarding
- ✅ NknTransport boot completes (mesh transport status banner
  is its own polish, gated on nknLib being passed)

Now ALSO covered by Detox D-1 automated smoke (#254) — no more
manual reload-and-eyeball required for this checklist.

### #253 — RN chat-shell port (steps 1-4 + polish SHIPPED 2026-05-26)

Scope ordered by user value:

1. ✅ **Bottom TextInput + send button** on ChatScreen.  Full
   pipeline (parseInput → resolveDispatch → runDispatch →
   renderReply) wired.  User + bot bubble pair per dispatch.
2. ✅ **Inline action buttons** on list bubbles.  TouchableOpacity
   per row.button rendering `<opId>:<itemId>` callback format.
3. ✅ **State-morphing** — list bubble re-renders in place after
   a row-tap dispatch (`refreshList.js` helper, mirrors web's
   `refreshListMessageInPlace`).
4. ✅ **Form follow-up for needsForm dispatches** — [Help with]
   on a stoop post now triggers a bot bubble asking "What help
   are you offering?" (op-specific via `pickPromptKey`); next
   user input completes the dispatch with both itemId + body.
5. ✅ **Thread sidebar / drawer** — shipped 2026-05-26 via #253 step 5.  Hamburger drawer leveraging the portable thread-state machine from #231.
6. ✅ **Multi-field form rendering** — shipped 2026-05-26 via #253 step 6 (#255).  `MultiFieldFormBubble` renders web's `renderForm` shape inline.
7. ✅ **Special-case button behaviors** — shipped 2026-05-26 via #253 step 7 (#256).  `[Help with]` DM-spawn + `[Start DM]` thread-spawn + `[Download]` file-blob (real-save wired in #266 2026-05-27).

Out of scope (deferred to #224 Phase B): native-only paths —
push, BLE, camera, voice.

**Acceptance for V2:** typing `/post ladder available` produces
a reply bubble (done step 1).  [Mark complete] tap updates the
list in place (done step 3).  [Help with] reaches body-prompt +
dispatches (done step 4).  Multi-thread + DM spawn still pending
(step 5-7).

---

## Bundle B — Cross-platform surface parity

**Goal:** the platform-parity invariant
([[platform-parity]]) says web ≡ mobile for every app.  Today's
audit ([[web-mobile-parity-gaps]]) lists 4 surfaces where one is
ahead of the other.  Close those.

**Journeys unblocked:** none new — these are completeness fills.
J5 (profile management) becomes possible on tasks-v0 web; JM-1
becomes more useful as folio-mobile gains real ops.

### ~~#250 — tasks-v0 web profile-edit page~~ — RE-FRAMED 2026-05-26

Investigation 2026-05-26 found this was misframed: the profile
skills (`getMyProfile`, `setMyHandle`, `setMyDisplayName`,
`setMyAvatarUrl`, `setHolidayMode`) all live in `apps/stoop` (not
tasks-v0), so the canonical web profile-edit page is
`apps/stoop/web/profile.html` — which **already exists**.

Mobile's `apps/tasks-mobile/src/screens/ProfileMineScreen.jsx`
reaches across apps to call stoop's skills because the mobile
shell composes all apps into one InternalBus.  Tasks-v0's web
server only mounts tasks-v0 skills, so duplicating the page there
would require either copy-pasting the skills (drift bug) OR
cross-app remote calls (substrate doesn't do that today).

**Closed as redundant.**  If a tasks-v0-flavoured profile entry
point is later wanted, the right move is a cross-app link from
tasks-v0's nav to stoop's `/profile.html`, not a new page.

### #251 — tasks-v0 web edit-skills page — SHIPPED 2026-05-26

`apps/tasks-v0/web/skills.html` mirrors
`apps/tasks-mobile/src/screens/EditSkillsScreen.jsx`.  Calls
`getMySkillsFormShape` (load) + `editMySkillsForCrew` (save) —
both genuinely tasks-v0-native (live in
`apps/tasks-v0/src/skills/profile.js`, unlike the misframed #250).

Three form sections (prefilled / suggestions / free-entry) match
the mobile version.  Persist-to-canonical-profile defaults off
(same caution principle as pod-data sharing).  Taxonomy hints
surfaced as informational below the save button.

Nav link added to `apps/tasks-v0/web/index.html`.  Page-skill-drift
canary stays green (614/614 vitest pass).

### #252 — tasks-v0 web chat thread page

Mobile has peer-to-peer task chat.  Web has zero chat surface for
tasks.  Needs message-list + send-input + appeal-button page.
~1 day.

### #237 — folio-mobile substrate wiring (5 skills)

`shareFolder`, `saveToMyPod`, `downloadFile`, `listFiles`,
`getFileSnapshot` are stubbed on mobile.  ~1 day.

**Decision point on #237:** if Bundle A's #253 ends up
composing folio via the shared browser-factory (Option B from
the 2026-05-24 audit), this becomes redundant.  Re-evaluate
once #253 ships.

---

## Bundle C — Foundation decisions

**Goal:** convert open architectural questions into code.  Each
item here has one design call to make first; once decided the
implementation is small.

**Journeys unblocked:** JM-9 (calendar invite from thread) needs
#238; JM-2 (offline post sync) needs #248's reconnect-trigger.

### #240 — Manifest cross-app convergence

**Investigated + resolved 2026-05-26.**  All three of the
priority-doc drifts turned out to be either already fixed or
intentional-by-design:

- ~~`state: 'open'` (household, string) vs `state: ['open']`~~ —
  REAL drift, fixed 2026-05-26 (2 lines in
  `apps/canopy-chat/src/core/agent/mockAgent.js` +
  `apps/household/manifest.js`).  Renderer tolerates both shapes
  per F-SP3-a (locked 2026-05-20); array form is now canonical.
- ~~`appliesTo.kind` is tasks-v0-only~~ — used legitimately by
  tasks-v0's 4 subtask ops to gate `inbox-item` sub-types
  (`subtask-request`, `subtask-proposal`).  No collision today;
  forward-looking concern only.  No action needed.
- ~~`pickerSource` is calendar-only~~ — already adopted by tasks-v0
  via `mockManifests.js` (5+ usages alongside calendar's 5).
  Resolved before the priority doc was written.

**Test added:** `apps/canopy-chat-mobile/test/manifestConvergence.test.js`
walks every op in the merged catalog + asserts shape invariants
(`appliesTo.state` is always an array; `appliesTo.type` is string
or array of strings).  Catches future drift at vitest time.

### #248 — Stoop-mobile catch-up reconnect-trigger

Decision: A (add NknTransport, ~1.5d, best long-term) / B
(translate envelopes, ~half-day) / C (stoop-native via
notify-envelope, ~1d).  Closes the last user-visible
stoop-mobile substrate gap.

**Why it matters now:** JM-2 (offline post sync) is functionally
incomplete without the reconnect-trigger half.

### #238 — Calendar substrate path on mobile

Decision: (a) substrate only (drop native) / (b) native only
(lose cross-peer RSVP) / (c) both (sync native ↔ substrate).
~1.5d after decision.

**Why it matters now:** JM-9 (calendar invite from a stoop
thread) needs this — currently mobile's calendar can only show
local events, not cross-peer ones.

---

## Bundle D — Test infrastructure

**Goal:** the JM-* journeys become regression-tested.  Today
they exist as vitest substrate spines (#229, Layer 1) plus
manual smoke (Layer 3); the middle layers (Playwright / Detox
end-to-end) are missing.

**Test pyramid for canopy-chat-mobile (2026-05-26 close-of-day):**

| Layer | What it covers | Status |
|---|---|---|
| **L1 vitest substrate** | Pure JS logic, manifest pipeline, render contracts, devLog toggles, refreshList state morph, followup state machine, manifest convergence | ✅ 47 tests green |
| **L2 RN component (TBD)** | JSX rendering, click handlers wired correctly, conditional render | ⏸ not started — not yet justified by bug history (see priority doc 2026-05-26 strategy note) |
| **L3a Detox smoke (D-1)** | Cold boot, 6 NavModel rows, slash round-trip with buttons, restart survival | ✅ **5/5 GREEN** on physical phone (c53828f5) AND emulator (Medium_Phone_API_36).  ~70s for the full suite. |
| **L3b Playwright on Expo web (Phase A)** | Browser-equivalent JM-1/JM-2/JM-7 cross-tab flows | 🕓 #224 Phase A — natural next step now D-1 is green |
| **L3c Detox extended (D-2+, Phase B remainder)** | State morph assertion, cross-device JM, native-only JM-3/4/5/6 | 🕓 #224 Phase B — incremental from D-1 |

### #254 — Detox smoke (D-0 + D-1) ✅ SHIPPED 2026-05-26

**Result:** 5/5 tests green in ~70 seconds, both targets:
- `_hello.test.js` — sanity (chat-screen visible)
- `coldBoot.test.js` — Agents ready + 6 NavModel rows
- `slashRoundtrip.test.js` — /mine + Send → list with markComplete buttons
- `restartSurvival.test.js` — relaunch keeps identity

**What unblocked it** (the multi-attempt debugging journey, full pipeline
in `apps/canopy-chat-mobile/docs/detox-investigation-2026-05-26.md`):
1. Switch to release build to bypass `expo-dev-launcher`'s manual-tap picker.
2. Scope `:app:assembleAndroidTest` to avoid library-androidTest cascade pulling JUnit 4/5 duplicates.
3. `packagingOptions.resources.pickFirsts` for META-INF/LICENSE collision.
4. `disableSynchronization()` AFTER `launchApp()` — our app has perpetual background work so default sync-on-idle times out.
5. **`network_security_config.xml` allowing loopback cleartext** — the killer.  Without it, release-mode silently blocked the `ws://localhost:<port>` Detox bridge.
6. SlashFAB moved from `bottom: 24` to `bottom: 80` so it doesn't overlap the chat-send button (real UX bug too).

**Auto-coverage now in place:**

| Source | Item | Now covered? |
|---|---|---|
| #249 | Cold boot without redbox | ✅ coldBoot test |
| #249 | 6 NavModel rows incl. household | ✅ coldBoot test |
| #249 | Restart-survival (vault + stoop cache) | ✅ restartSurvival test |
| #253 step 1 | TextInput + bubble pair appear | ✅ slashRoundtrip test |
| #253 step 2 | List bubble has inline-keyboard buttons | ✅ slashRoundtrip test |
| #249 | "Mesh transport ready" banner | ❌ needs nknLib in test env — D-2 |
| #253 step 3 | State-morphing (row vanishes post-tap) | ❌ D-2 will add this |
| #253 step 4 | `[Help with]` follow-up + DM spawn | ❌ D-2 after the step lands |

**How to run:**
```sh
cd apps/canopy-chat-mobile
npm run detox:build                  # ~2 min
npm run detox:test:attached          # ~70s (phone, default)
npm run detox:test                   # ~70s (emulator)
```

### #224 Phase A — Playwright on Expo web

After #253 surfaces the real chat UI, codify 2-3 highest-value
JM-* scenarios in Playwright.  Reuses
`apps/canopy-chat/test-browser/helpers.js`.  ~1d per scenario;
JM-1 + JM-2 + JM-7 are the recommended first three.

### #224 Phase B — Detox extended (D-2+)

After D-1 lands + the API is informed by real usage.  Covers:
- State-morphing assertions (tap → row vanishes from origin bubble)
- Cross-device JM flows on paired emulators
- Native-only JM-3 (push), JM-4 (BLE), JM-5 (camera), JM-6 (voice)

Detox setup itself is shared with D-1; the extended scope is the
expensive part.

---

## Bundle F — Web↔mobile host-op parity ✅ COMPLETED 2026-05-26

**Background:** The 2026-05-26 chat-shell port (#253) intentionally
short-circuited every `appOrigin === 'canopy-chat'` op with a
"not wired on mobile yet" bubble (`chat.canopy_chat_op_pending`
in `ChatScreen.js > dispatchAndAppend`).  Real-device test by user
revealed `/me /help /threads /embed-time` + `[Dispute]` all hit
this dead-end.  Substrate slashes (`/feed`, `/mine`) still work
because they don't go through that branch.

**Root cause:** Web has `apps/canopy-chat/src/core/localBuiltins.js`
(~1400 lines, ~30 handlers) routed via `web/main.js` `callSkill`
when `appOrigin === 'canopy-chat'`.  Mobile never ported this.
The state-machine half of all 11 wizards IS already portable
(per #235/#236) — only RN renderers are missing.

**Closing summary (2026-05-26 end of day):** all 6 slices shipped
same day.  vitest 123/123 green, Detox 18/18 on emulator
(~165s), APKs installed on Frits's phone (c53828f5).  No new
capability code at the canopy-chat-mobile level — every wiring
delegates to existing substrate packages
(`@canopy/oidc-session-rn`, `packages/react-native/src/picker`,
`@canopy/canopy-chat`'s portable wizard state machines).
Architectural reset midway through P3 (`canopy-chat-unifier-principle`
memory) reshaped P3-P6 from "build X on mobile" to "wire what
exists", correctly cutting P6 from "big" to "small".

**Divergence categories** (resolved):
- A. Host-op handlers (~25 in localBuiltins) — `/me /help /find /brief …` — **P1**
- B. Wizards (state portable already) — dispute, createGroup, embed-time, … — **P2 + P5**
- C. File/picker ops — `/send-file`, `/embed-file`, `[Download]` — **P4** (renderer-side embed exposure = follow-up)
- D. Side panels — `/logs` — **P3** (settings absorbed into P2)
- E. Sign-in / Solid OIDC — `/signin`, `/signout`, `/whoami` signed-in — **P6** (real-pod test parks behind #167)

### P1 — Lift localBuiltins to portable + wire into mobile ✅ SHIPPED 2026-05-26 (#257)

Move pure handlers (no DOM) into the canopy-chat shared core that
mobile can `import` (the module is already exported as
`@canopy-app/canopy-chat/core-localBuiltins`).  Mobile builds its
deps from `threadState` + the booted agent.  Replace ChatScreen's
canopy-chat short-circuit with `localBuiltins[opId](args)`.
Handlers needing DOM/file pickers stay marked "not wired"
explicitly per-op (folds into P3-P5).

**Unlocks:** `/me /help /whoami /find /brief /reset-thread /apps
/security-status /mute /muted /unmute /transports
/rotate-identity /lookup-peer /publish-nkn /audit-tail
/debug-dump` (~15-18 commands).

**Out of scope:** wizard launches, file pickers, side panels,
OIDC.

### P2 — RN wizard renderer + button-tap launches ✅ SHIPPED 2026-05-26 (#258)

One `WizardModal` RN component that consumes the portable wizard
state machines (already split in #235/#236 — see
`apps/canopy-chat/src/core/wizards/`).  Wire `interceptButtonTap`
to launch the right wizard for `[Dispute]`, `[Create group]`,
`[Join group]`, etc.

**Unlocks:** dispute (the user's case), createGroup, joinGroup,
restoreContact, audience, backup, suggestSchedule, conflictDispute,
scheduleAccept (≈ 9 wizards).

### P3 — Compose per-app Settings + Logs surfaces ✅ SHIPPED 2026-05-26 (#259)

**Reframed 2026-05-26** after user reminder that canopy-chat is a
*unifier*, not a place for new screens.  Each app already has its
own settings UI (#212).  Mobile `/settings` should COMPOSE those
per-app screens (e.g. via manifest's `surfaces.settings`), not
invent a new one.  Logs are a host-level concern (eventLog) and
need an RN viewer screen.

**Unlocks:** `/settings` (per-app composition), `/logs`.

### P4 — File pickers — wire existing substrate ✅ SHIPPED 2026-05-26 (#260)

**Reframed 2026-05-26** — `packages/react-native/src/picker`
(`pickAndResize`, `pickFromLibrary`, `captureWithCamera`) ALREADY
EXISTS and is used by stoop-mobile's `imagePicker.js` (with Stoop
presets) and elsewhere.  Mobile canopy-chat just needs to thread
a `pickFromLibrary` instance into `localBuiltins` as
`openFilePicker`, plus `expo-sharing` / `expo-file-system` for the
`[Download]` write path.  Folds into #237 (folio-mobile substrate).

**Unlocks:** `[Download]` (real save), `/send-file`, `/embed-file`.

### P5 — `/embed-time` — wire calendar's picker if portable ✅ SHIPPED 2026-05-26 (#261)

**Reframed 2026-05-26** — check `apps/calendar/` first for a
portable date-picker hook before adding RN
`@react-native-community/datetimepicker` standalone.  Goal: the
calendar app owns the picker; canopy-chat composes.

**Unlocks:** `/embed-time`.

### P6 — Solid OIDC on mobile — wire existing substrate ✅ SHIPPED 2026-05-26 (#262, real-pod test parks behind #167)

**Reframed 2026-05-26** (NOT "big" as originally framed): the OIDC
substrate `packages/oidc-session-rn` ALREADY EXISTS and is
production-wired in tasks-mobile (`PodSettingsScreen.jsx` +
`expo-auth-session`) and stoop-mobile (`SignInScreen.js` +
`useStoopAuth` hook + `IssuerPicker`).  Mobile canopy-chat just
needs to thread one of those auth hooks (or the substrate
directly) into `localBuiltins` as `podAuth`.  Still parks behind
#167 for FULL real-pod parity testing (which needs creds), but
wiring itself is small.

**Unlocks:** `/signin`, `/signout`, `/whoami` (real session).

---

## Bundle G — Mobile connectivity gaps ⭐ FILED 2026-05-27

**Background:** 2026-05-27 real-device test by user found three slash
commands not behaving as planned:
- `/brief` returns `brief.no_runner`
- `/peer-connect` doesn't work (no `connectPeer` dep)
- `/me` bubble appears but says "NKN: not connected"

**Root cause:** Bundle F P1 wired only the simple-dep handlers
(those needing just `agent` + `t` + `threadStore`).  Seven handler
deps were left undefined in `hostOps.js` — handlers gracefully
return their `*.no_*` errors but the user perceives them as
broken.  Plus a foundational gap: no mobile app in this repo
actually loads `nkn-sdk`, so `agent.peer.address` stays null at
boot.

**Full audit (2026-05-27, all mobile host slashes):**

| Command | Status | Reason |
|---|---|---|
| `/help`, `/me`, `/whoami`, `/reset-thread`, `/threads`, `/newthread`, `/security-status`, `/transports`, `/transport-mode`, `/set-relay`, `/rotate-identity`, `/mute(d)/unmute`, `/audit-tail`, `/debug-dump` | ✅ work | `agent` + `t` + `threadStore` deps suffice |
| `/test-peer`, `/peer-connect` | 🟡 work but no-op | NKN never connected; `/peer-connect` also has no `connectPeer` dep wired |
| `/me` shows "NKN: not connected" | 🟡 correct given the foundational gap | `agent.peer.address` is null |
| `/brief` | ❌→✅ (G1) | `briefRunner` was undefined; G1 wired `runBrief` from canopy-chat/src/brief.js |
| `/find` | ❌→✅ (G1) | `findRunner` was undefined; G1 wired `runFind` from canopy-chat/src/find.js |
| `/apps` | ❌→✅ (G1) | `appRegistry` was undefined; G1 wires `new AppRegistry()` + `syncWithCatalog` |
| `/lookup-peer` | ❌ blocked by #167 | needs `lookupPeerNknByWebid` — reads peer's pod profile |
| `/publish-nkn` | ❌ blocked by #167 | needs `publishNknAddrToPod` — writes own pod |
| `/sendto` | 🟡 partial | `simPeers` undefined (web-only demo hardcode; not applicable on prod mobile) |
| `/send-file` (P4) | 🟡 picker works, send fails without NKN | needs NKN connect + `lookupPeerNknByWebid` for webid→nkn resolution |
| `/logs` | ✅ works (Bundle F P3) | eventLog + openLogsPanel wired |
| `/signin`, `/signout`, `/whoami` signed-in path | 🟡 wired but #167 | podAuth wired (F P6); real OAuth needs creds |
| 8 wizards (`/dispute`, `/create-group`, …, `/embed-time`) | ✅ open + collect form (Bundle F P2+P5) | submit calls substrate skills which work |

**Reference dig (2026-05-27)**: user pointed at
`/home/frits/expotest/nkn-test (Copy)/apps/mesh-demo/README.md` —
which documents the exact NKN opt-in snippet:

```js
import { NknTransport } from '@decwebag/core';
const nkn = new NknTransport({ identity });
await nkn.connect();
agent.addTransport('nkn', nkn);
```

The substrate NknTransport there + the canopy-chat-mobile one at
`packages/react-native/src/transport/NknTransport.js` both have a
dynamic-import path:
```js
const mod = await import('nkn-sdk');   // resolves nkn-sdk at runtime
```
And: "**Node.js: npm install nkn-sdk; it will be auto-imported if
not passed.**"  Mesh-demo README explicitly says "doesn't enable
NKN by default" — the pattern is scaffolded but no in-repo app
*currently* runs it; the substrate IS proven for the connect-
plumbing path though.

**Concrete G2 plan (revised after the reference dig):**
1. `npm install nkn-sdk` in canopy-chat-mobile (release peer-dep)
2. In `agentBundle.js`, drop the `opts.nknLib` gate — call
   `agent.connectPeerTransport({})` whenever the agent supports
   it.  The substrate's `#resolveNknLib` will dynamically import
   nkn-sdk on its own (path #3 in its fallback chain).
3. Wire `connectPeer` dep in hostOps so `/peer-connect` re-runs
   the transport's connect.
4. Verify on Android — known risk: WebRTC datachannel absence on
   Hermes; nkn-sdk gracefully falls back to relay-node send per
   the substrate doc.

### G1 — Wire briefRunner + findRunner + appRegistry ✅ SHIPPED 2026-05-27 (#263)

Pure-lift from existing canopy-chat sources — same unifier
pattern as Bundle F.  `runBrief` (with `createBriefCache`),
`runFind`, `AppRegistry` all already portable.  Built once per
hostOps construction; cache survives across `/brief` invocations
within a session.  Unlocks `/brief`, `/find`, `/apps`.

### G2 — Make NKN actually connect on mobile ✅ DONE 2026-05-27 (#264, verified on c53828f5)

**What unblocked it (the two non-obvious traps):**
1. `realAgent.connectPeerTransport` *requires* `nknLib` explicit
   (throws if undefined).  Mobile must `await import('nkn-sdk')` +
   pass it — the substrate's dynamic-import fallback never fires
   because realAgent's gate trips first.
2. Android's `network_security_config.xml` was loopback-only (from
   #254 Detox fix).  NKN bootstrap RPC uses cleartext HTTP IPs
   (e.g. 172.245.30.19) — every seed-node lookup got
   `CLEARTEXT communication not permitted` until cleartextTrafficPermitted
   was widened to base-config.  nkn-test workspace used the same
   pattern via `usesCleartextTraffic="true"` in src/debug/AndroidManifest.

**Two warnings remain but are non-fatal**:
- `Property 'WebAssembly' doesn't exist` — Hermes is JS-only;
  nkn-sdk falls back to JS crypto.
- `RTCPeerConnection` absent — nkn-sdk falls back to relay-node
  send per substrate doc; slightly higher latency, no hole-punching.

**Investigation 2026-05-27**:
- `packages/react-native/src/transport/NknTransport.js` substrate
  is READY + lists `nkn-sdk`/`nkn-multiclient` as **optional**
  peer deps + has a runtime dynamic-import fallback chain
  (opts.nknLib → globalThis.nkn → `import('nkn-sdk')`).
- **No production mobile app in this repo currently installs
  nkn-sdk.**  Confirmed across `apps/{stoop,tasks,folio}-mobile`,
  `apps/mesh-demo`, `apps/mesh-demo (17 april)`, `apps/presence-v0`,
  and `expotest/step1-expo52`.
- **`expotest/step1-expo52`** (prior known-working mesh-on-RN
  app) uses **BLE + mDNS + RelayTransport**, NOT NKN.  Its agent
  imports `RelayTransport, MdnsTransport, BleTransport` from
  `@decwebag/core`.
- **`expotest/nkn-test (Copy)/apps/mesh-demo`** documents the
  NKN opt-in pattern in README §"NKN — rendezvous-less reachability"
  + ships the working substrate `NknTransport` with dynamic-import.
  The README says explicitly: "doesn't enable NKN by default — to
  try it, add an `NknTransport` to your agent".  Pattern is
  scaffolded but no in-repo app currently runs it.
- **canopy-chat web** uses NKN MultiClient via `globalThis.nkn`
  (CDN load).  Mobile parity is the goal.

**Concrete plan** (lowered from "needs design decision" to
"ready-to-implement" after the reference dig):
1. `npm install nkn-sdk` in canopy-chat-mobile.
2. Loosen the `opts.nknLib && ...` gate in
   `src/core/agentBundle.js` — when the agent exposes
   `connectPeerTransport`, just call it with `{}`.  The substrate
   `#resolveNknLib` handles dynamic import on its own.
3. Wire `connectPeer` dep in `hostOps.js` so `/peer-connect` calls
   `agent.connectPeerTransport({})` for the reconnect path.
4. Verify on Android via Detox + manual `/me` check on phone.

**Known risks**:
- nkn-sdk on Hermes untested in this repo's history.  Substrate
  doc claims it should work with `crypto.getRandomValues` +
  `Buffer` polyfills (mobile index.js imports
  `@canopy/react-native/platform/polyfills` which loads them).
- WebRTC datachannels absent on RN 0.76 (`react-native-webrtc`
  124.0.7 fails native module registration per
  `apps/mesh-demo/src/agent.js:42`).  Substrate doc says nkn-sdk
  falls back to relay-node send — acceptable.
- Bundle size +~70KB.

**Fallback plan if nkn-sdk fails on Hermes**: switch to
RelayTransport (step1-expo52's proven pattern).  Web already has
`/set-relay`; pointing both surfaces at the same relay creates
a cross-platform bridge without needing NKN client on mobile.

### G3 — Wire lookupPeerNknByWebid + publishNknAddrToPod (parks behind #167) (#265)

Both deps need an authenticated pod fetch.  Once #167 lands +
G2's chosen transport is live, mirror web's main.js wiring
(reads peer's pod profile / writes own).  Unlocks `/lookup-peer`
+ `/publish-nkn` + `/send-file` webid-resolution.

---

## Bundle E — Deferred (parking lot)

### #167 — Provision 3 pod creds + flip 9 it.todo to real

Pre-existing deferred from v0.7.P3 work.  Needs real Solid pod
accounts; not mobile-pivot territory.  Whenever creds become
available.

---

## What's NOT in this plan (deliberately)

- **iOS** — out of scope per [[stoop-mobile]] convention; would
  be a separate quarter's work.
- **Browser smoke per app** — manual-only, never automated.
  See [[canopy-chat-smoke-pending]] memory for the checklist.
- **Real-device verification of NknTransport (#223)** — manual,
  needs two physical phones; rolls into Bundle D.

---

## Cumulative state of the mobile pivot (2026-05-26 end of day)

**On-device, behind APK install on c53828f5:**
- Chat shell #253 (TextInput + message list + thread drawer + multi-field
  form bubble + button-special intercepts + DM-spawn intercepts)
- Bundle D — Detox 18/18 green on emulator (~165s); Playwright 4/4
  on Expo Web (#224 Phase A + B D-2)
- Bundle F — full host-op parity with web: ~18 host slashes routed
  through localBuiltins, 7 RN wizard modals (dispute, createGroup,
  joinGroup, restoreFromMnemonic, postAudience, encryptedBackup,
  settings) + 8th (embed-time), `/logs` panel with live EventLog,
  file picker via existing substrate, Solid OIDC via existing
  oidc-session-rn substrate.

**Architectural principle reinforced (memory: canopy-chat-unifier-principle):**
canopy-chat-mobile is now demonstrably a thin shell — every Bundle
F slice ended up wiring an EXISTING substrate package
(`@canopy/oidc-session-rn`, `packages/react-native/src/picker`,
`apps/canopy-chat/src/eventLog`, the portable wizard state machines)
rather than writing new code at the chat-shell level.  Where new
code WAS needed (handler upstream patches in `localBuiltins.js`
for FileReader/dataB64 + chrono fallback), both surfaces
benefit.

**Open mobile work** (filed, not blocking):
- #167 pod creds (parks Bundle F P6 real-pod test + 9 it.todo specs)
- #237 folio-mobile substrate wiring (shareFolder / downloadFile / …)
- #238 calendar substrate path on mobile — needs YOUR architectural call
- #248 stoop-mobile catch-up reconnect-trigger — needs YOUR architectural call
- #252 tasks-v0 web chat thread page (parity follow-up)
- ~~Bundle F P4 follow-ups~~ ✅ both shipped 2026-05-27 (#266 [Download] real-save, #267 generic doc picker)
- Bundle F P6 follow-up: cycle real-pod test once #167 unblocks

## Snapshot — what shipped 2026-05-24 + -25

| Date | Task | What |
|---|---|---|
| 2026-05-24 | #246 | Slash-coverage audit + folio LLM-only call + first-mount-wins policy |
| 2026-05-24 | #243 | Stoop web rotateMyAddress + unmutePeer |
| 2026-05-24 | #244 | Stoop web kind sub-picker |
| 2026-05-24 | #245 | Stoop web group switch/join/create |
| 2026-05-24 | #239 | Stoop-mobile catch-up verify (→ #247 filed) |
| 2026-05-24 | #241 | Canopy-chat-mobile slash FAB + filter |
| 2026-05-24 | #247 | Stoop-mobile lastSeenFrom + wireCatchUp scaffold (→ #248 filed) |
| 2026-05-25 | #249 (bundle) | metro.config.js + 10 dep additions + stray-store cleanup → Android bundle green |
| 2026-05-26 | #253 | chat-shell port: TextInput + msg list + 7 substeps (state-morph, followUp, drawer, multi-field form, button specials) |
| 2026-05-26 | #224 | cross-device parity tests: Playwright on Expo Web (Phase A 4/4) + Detox D-2 extended (Phase B 8/8) |
| 2026-05-26 | Bundle F | 6-slice host-op parity (filed + closed same day after user real-device test): localBuiltins lift, 7 RN wizards + embed-time, /logs panel, file picker, chrono date fallback, Solid OIDC wiring — vitest 123/123, Detox 18/18 |
| 2026-05-27 | Bundle G | G1 brief/find/appRegistry wiring + G2 NKN connect on mobile (nkn-sdk 1.3.6 added, fire-and-forget IIFE, cleartext network_security_config widened) — user confirmed NKN address shows in /me on c53828f5 |
| 2026-05-27 | #266 | Bundle F P4-followup-1: [Download] real-save — renderer.js surfaces item.embed on list rows; buttonSpecials emits `save-file` intercept; ChatScreen wires `saveBase64File`; locale en/nl |
| 2026-05-27 | #267 | Bundle F P4-followup-2: generic doc picker — `pickDocument`/`pickOneDocument` at substrate; expo-document-picker 13.0.3; `openFilePicker` routes through it; `readFileAsBase64` short-circuits on pre-loaded `dataB64` so Hermes works |
| 2026-05-27 | Bundle H Phase 1 (#268) | Portable peer-router + chat-message handler + DM-thread state on mobile; `buildPeerWiring` factory pattern on bootAgentBundle; chat-message + buurt-peer-intro + catch-up-request now flow inbound on canopy-chat-mobile; web still uses its inline router (lift in Phase 2). 11 new vitest cases (peerRouter 6 + chatMessage 5) + 7 mobile threadState tests. Lifts the "can I chat with peers on phone?" answer from "no" to "yes for chat-message; richer subtypes follow in Phase 2" |
| 2026-05-27 | Bundle H Phase 2 (#269) | Six portable handler factories (calendarInvite / calendarRsvp / fileShare / buurtPost / groupRedeem-request+response / helpWith-accepted). Web replaces inline onPeerMessage block with makePeerRouter delegating to existing inline funcs. Mobile wires the four substrate-safe handlers. 34 new vitest cases across the new factories. canopy-chat 758/758, mobile 134/134. helpWithResponse stays inline (DOM widget), calendar-invite/file-share/group-redeem-response on mobile filed as Phase 3 (#270) |
| 2026-05-27 | Bundle H Phase 3 (#270) | Portable `computeEmbedButtons` helper at `src/core/embedButtons.js`; mobile `EmbedCardBubble` renders time-card + file-card with manifest-driven action buttons; calendar-invite + file-share peer handlers now wired on mobile. 7 new embedButtons tests + 9 folioOps tests (latter from #237 agent). canopy-chat 765/778 (13 todo), mobile 143/143 |
| 2026-05-27 | #237 closed | Folio-mobile substrate investigation — all 5 ops already work on mobile via in-process `bundle.callSkill`. No code changes in `src/`. Two cross-platform gaps logged (listFiles no slash, saveToMyPod placeholder) |
| 2026-05-27 | #238 calendar outbound | Portable `calendarOutbound.js` factory replaces web's 100+-line inline fan-out (web/main.js:1497) AND wires mobile `dispatchAndAppend` for the first time. addEvent w/ attendees-nkn fans out calendar-invite over NKN; rsvp* sends calendar-rsvp back to organiser; cancelEvent stub. 17 vitest cases. Architectural choice: lifted-to-portable factory + per-platform wire (Bundle H pattern) |
| 2026-05-27 | #265 Bundle G3 | Mobile `podNkn.js` wraps the (portable) podStorage helpers via OidcSessionRN's authenticated fetch. /lookup-peer + /publish-nkn now wired on mobile. 7 podNkn + 2 hostOps tests. Real-pod test parks behind #167 |
| 2026-05-27 | #252 tasks-v0 web chat | New `chat.html` + portable `src/ui/chatThread.js` + 28 vitest cases mirror tasks-mobile's ChatThreadScreen. Inbox appeal-button now navigates to the new page. tasks-v0 642/642 |
| 2026-05-27 | #271 Bundle H Phase 4 | Portable `makeHandleHelpWithResponse` factory + structured `responder-card` bubble on mobile with Accept/Decline/Counter buttons via TouchableOpacity + 3 new buttonSpecials intercepts (5 helpWith + 4 buttonSpecials tests). PLUS portable `makeSendGroupRedeemRequest` factory + shared `pendingPeerRedeemsRef` Map wires the joiner-side cross-instance redeem flow on mobile: joinGroupWizard's `sendPeerRedeem` prop now populated; group-redeem-response peer-router handler resolves the same Map (+5 groupRedeem tests). Bundle H now complete on mobile — all 11 inbound subtypes routed |
| 2026-05-27 | #272 Post-V0 locale loader | Pure-browser runtime locale loader for tasks-v0 web (no i18next dep, ~150 LoC). `i18nBootstrap.js` + `i18nAutoBoot.js` overlay; tasks-ui serves en/nl JSON. 10 HTML pages wired (incl. task.html). `?lng=nl` URL param activates Dutch; sticks via localStorage. 16 vitest cases |
| 2026-05-27 | #273 Folio listFiles slash | `/files` declared in mockFolioManifest (substrate skill always worked via callSkill; only the slash entry was missing). `saveToMyPod` real cross-pod copy parks behind #167 |
| 2026-05-27 | #274 task.html (per-task page) | Mirrors TaskDetailScreen — header pill + action stack (Claim/Submit/Approve/Reject/Edit/Appeal/etc) + history timeline. Portable helpers `src/ui/taskDetail.js`. mine/inbox/review/index rows link via wrapped `text` cell. 42 new tests (37 unit + 5 characterization). tasks-v0 700/700 |
| 2026-05-27 | DESIGN audit | DESIGN-canopy-chat.md + DESIGN-canopy-chat-journeys.md vs current code: 90%+ implemented. Real gaps: Q30 briefSummary adopters (household/stoop/tasks-v0), `_sync` adopters (stoop/tasks-v0), resolveContact real impls, J6 reactive OIDC callback completion, v0.8 LLM (deferred). 🟡 partials: `notification`/`file` reply shapes, chat-nav consumer adoption, J5 record-panel reactive re-render, "Open in full" mini-page → side panel, per-recipient appliesTo viewer-context, podSync.js stub |
| 2026-05-27 | Slash test audit | 65 slashes / 31 vitest / 3 Detox / 8 indirect → **24 uncovered (~37%)**. Worst: stoop long-tail (8: /lend-assign /lend-return /skills /leave-group /tree /sign-out /report /bulletin); canopy-chat shell (10: /dm /send-to /apps on-off /peer-connect /test-peer /transports /transport-mode /set-relay /debug-dump /reset-thread); calendar (4: /decline /tentative /pod-status /icalfeed); household (2: /task /tasks) |
| 2026-05-27 | Slash audit follow-up — me | +6 inline tests in `journeys-cross-app.test.js`: CC-CL.6-9 (decline/tentative/pod-status/icalfeed) + CC-HH.X-Y (/task /tasks). All cheap mirror-tests of existing CC-CL.* and CC-HH.* patterns |
| 2026-05-27 | Slash audit follow-up — agent | +36 tests in `localBuiltins.shell-slashes.test.js` covering all 10 chat-shell-residue slashes (/dm /send-to /apps on-off /peer-connect /test-peer /transports /transport-mode /set-relay /debug-dump /reset-thread). canopy-chat 834 passing (+36 from agent + 6 from me = +42 over the 792 baseline) |
| 2026-05-27 | Slash audit follow-up — stoop | +19 tests in `journeys-stoop-slashes.test.js` (agent) covering all 8 stoop long-tail slashes (/lend-assign /lend-return /skills /leave-group /tree /sign-out /report /bulletin). canopy-chat 853/866 (+19). 7 substrate gaps logged for future work (mockStoopManifest sparse, /lend-assign shell-only-by-design, /leave-group confirm-flag plumbing, markReturned alias, /skills JSON handoff, /test-peer arg name, /reset-thread error distinguishing) |
| 2026-05-27 | DESIGN gap #1 — Q30 adopters | `<app>_briefSummary` skills + manifest brief: declarations on **household** + **stoop** (both via agent — partial agent crash recovered, household had a navmodel test assertion + snapshot to update post-#240) + **tasks-v0** (me — new `apps/tasks-v0/src/skills/briefSummary.js` + manifest.js:listOpen brief decl + wireSkills.js registration). tasks-v0 700/700, stoop 632/632, canopy-chat 853/866 |
| 2026-05-27 | DESIGN gap #2 — `_sync` adopters | Agent B (session-limited) landed ~20 stoop `_sync` emit sites + helper; I fixed 8 strict-`toEqual` test assertions to `toMatchObject` (additive `_sync` field) and finished tasks-v0 list-ops (`apps/tasks-v0/src/skills/_syncEnvelope.js` + emit on listOpen / listMine / listClaimable / listMyInbox / listAwaitingApproval / listMyMasteredTasks). Mutating-op _sync deferred. canopy-chat 854/867, stoop 632/632, tasks-v0 700/700 |
| 2026-05-27 | Substrate cleanups (7 items, slash audit) | Agent A (session-limited): mockStoopManifest gains 7 missing long-tail slashes; `/leave-group` declares `body:'flags'`; `/skills` substrate JSON-parses string→array; `/reset-thread` gains `no_store` locale key; `/lend-assign` shape comment + arg-form documented. canopy-chat 854/867 |
| 2026-05-27 | #248 Option A | NknTransport composed into stoop-mobile's agentBundle + `agent.nkn` adapter + real `scheduleCatchUp` via lifted factories + makePeerRouter for inbound. 7 new tests; stoop-mobile 939 passing. Soft dep on nkn-sdk; real-device test parks alongside #224B Detox |
