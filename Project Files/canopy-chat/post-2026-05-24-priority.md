# Post-2026-05-24 priority — bundled plan

After the 2026-05-24 mobile-pivot wave + the 2026-05-25 first-boot
debug session + the 2026-05-26 chat-shell-port + Detox-D-1 wave.
Re-framed as **bundles with goals**, not a flat priority list.
Each bundle says what user-perceptible thing it delivers (cross-
referenced against the JM-* and J-* journeys).

## Status — 2026-05-26 close-of-day

| Bundle | Goal | Status |
|---|---|---|
| **A — Mobile becomes usable** | User can chat on canopy-chat-mobile (JM-1/2/7/8/9/10) | ✅ Most-shipped — #249 done, #253 steps 1-4 + polish shipped, only step 5+ remaining |
| **B — Cross-platform surface parity** | Web ≡ mobile per app | ✅ Mostly done — #250 closed (redundant), #251 shipped, #252 remains, #237 likely redundant |
| **C — Foundation decisions** | Architectural calls land in code | 🚧 #240 done; #248 + #238 still need YOUR architectural calls (A/B/C) |
| **D — Test infrastructure** | JM-* regression-tested | ✅✅ MASSIVE WIN — **#254 D-0 + D-1 green on phone AND emulator** (5/5 tests, ~70s).  #224 Phase A still pending |
| **E — Deferred** | Pre-existing parked | #167 unchanged |

**Today's deliverables (2026-05-26):**
- ✅ #253 steps 2, 3, 4 + polish (inline keyboards, state morphing, needsForm followup, op-specific prompts)
- ✅ #240 manifest-state-shape convergence (2-line fix + defensive vitest)
- ✅ #251 tasks-v0 web edit-skills page
- 🗑️ #250 closed as misframed (stoop already had it)
- ✅ **#254 D-0 setup + D-1 smoke tests green** on c53828f5 + Medium_Phone_API_36 emulator

**Sequencing now:** Bundle A's remaining (#253 step 5+ — thread sidebar, real form rendering, DM spawn, file download) is the natural next slice. After that: #252 (tasks-v0 web chat thread page). Then design calls on #238 + #248.

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
5. 🚧 **Thread sidebar / drawer** — pending.  Hamburger drawer
   leveraging the portable thread-state machine from #231.  No
   fixed-sidebar space on a phone.
6. 🚧 **Multi-field form rendering** — pending.  Today's single-
   missing-param fallback works; multi-field forms need actual
   form renderer port from web's `renderForm`.
7. 🚧 **Special-case button behaviors** — pending.  `[Help with]`
   DM-spawn, `[Start DM]`, `[Download]` file-blob trigger.

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

## Cumulative state of the mobile pivot (2026-05-26)

**Bundle complete + on-device:** the renderMobile projector,
canopy-chat-mobile composition shell, NKN-on-RN transport,
AsyncStorage vault + ItemStore, slash FAB, every web wizard's
portable state core.  Bundle green on Android (#249 partial).

**The honest gap:** the *chat surface itself* (#253) is the only
remaining mobile blocker between "structurally complete" and
"user-usable."  Everything else (Bundles B/C/D) is polish,
parity, or testing.

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
