# Post-2026-05-24 priority — bundled plan

After the 2026-05-24 mobile-pivot wave + the 2026-05-25 first-boot
debug session (#249 bundle now green on Android).  This doc
re-frames the remaining work as **bundles with goals**, not a flat
priority list.  Each bundle says what user-perceptible thing it
delivers (cross-referenced against the JM-* and J-* journeys) so
the "why" is visible at a glance.

## TL;DR

| Bundle | Goal | Tasks | Blocking? |
|---|---|---|---|
| **A — Mobile becomes usable** | A user can actually chat on canopy-chat-mobile (JM-1, JM-2, JM-7, JM-8, JM-9, JM-10 reachable) | #249, #253 | Blocks everything user-perceptible |
| **B — Cross-platform surface parity** | Every reachable app has the same surface on web + mobile | #237, #250, #251, #252 | Independent of A |
| **C — Foundation decisions** | Architectural calls land in code, drift gets reconciled | #238, #240, #248 | Independent; each needs one decision |
| **D — Test infrastructure** | JM-* journeys become regression-tested instead of one-shot smoke | #224 Phase A, then Phase B | Phase A needs #253; Phase B much later |
| **E — Deferred (parking lot)** | Pre-existing parked work | #167 | Not mobile-pivot |

**Sequencing recommendation:** Bundle A first (one focused push).
B and C interleavable in any order after A.  D Phase A after A.
D Phase B much later (probably end-of-quarter).  E whenever pod
credentials become available.

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

### #249 — Finish first Android boot smoke (PARTIAL)

Bundle landed green on 2026-05-25.  Manual checklist still owes:

- [ ] Cold boot shows "Booting agents…" → "Agents ready" (or
      surface a redbox if not).
- [ ] All 6 NavModel rows render (canopy-chat, household,
      tasks-v0, stoop, folio, calendar).
- [ ] Kill + relaunch restores identity (VaultAsyncStorage) +
      stoop's cached state (AsyncStoragePersist).  Should NOT
      re-onboard.
- [ ] NknTransport "Mesh transport ready" announces.

Expected: 30 mins on device.  Any failure here gates #253 —
runtime polyfill or vault bug needs fixing first.

### #253 — RN chat-shell port (NEW — was lost from the task list)

Scope ordered by user value:

1. **Bottom TextInput + send button** on ChatScreen.  Without
   this nothing about #253 is user-visible.
2. **Scrolling message list** above the input — render dispatched
   skill outputs as bubbles.
3. **Wire `onSubmit` through `bundle.callSkill` / LLM-router** —
   mirror what the web chat-shell does in
   `apps/canopy-chat/src/web/chat-shell/index.js`.
4. **Inline action buttons** in reply bubbles ([Help with] /
   [Accept] / [Decline] / [Counter] / [Schedule]) — portable
   handlers already exist from #231.
5. **Thread sidebar** as a hamburger drawer (no fixed-sidebar
   space on a phone).  Uses the portable state machine from
   #231.

Out of scope: native-only paths (push, BLE, camera, voice) —
those are #224 Phase B.

Estimated: 2-3 days.

**Acceptance:** typing `/post ladder available` and hitting send
produces a reply bubble.  Then JM-7's [Help with] inline button
spawns a DM thread.

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

**Test pyramid for canopy-chat-mobile (2026-05-26 state):**

| Layer | What it covers | Status |
|---|---|---|
| **L1 vitest substrate** | Pure JS logic, manifest pipeline, render contracts, devLog toggles, refreshList state morph | ✅ 34 tests green |
| **L2 RN component (TBD)** | JSX rendering, click handlers wired correctly, conditional render | ⏸ not started — not yet justified by bug history (see priority doc 2026-05-26 strategy note) |
| **L3a Detox smoke (D-1)** | Cold boot, slash round-trip, restart survival on real Android emulator/device | 🚧 **#254 — going next** |
| **L3b Playwright on Expo web (Phase A)** | Browser-equivalent JM-1/JM-2/JM-7 cross-tab flows | 🕓 #224 Phase A — after #253 stabilises |
| **L3c Detox extended (D-2+, Phase B remainder)** | State morph, cross-device JM, native-only JM-3/4/5/6 | 🕓 #224 Phase B — defer until D-1 informs the API |

### #254 — Detox smoke (D-0 + D-1) ⬅ NEXT

**Goal:** replace Frits's manual reload-and-check loop with three
automated tests that run on the Android emulator.  Setup is ~half-
day, plus ~half-day for the 3 tests.

**The three D-1 tests:**

1. **Cold boot smoke** — launches app, asserts "Agents ready"
   visible, expanding the debug section shows 6 app rows
   including `household`.
2. **Slash command round-trip** — types `/mine`, asserts a list
   bubble appears with at least one `[Mark complete]` button.
3. **Restart survival** — relaunches the app, asserts no
   welcome / onboarding screen + the existing identity persists.

**What gets auto-covered after D-1 ships:**

| Source bundle | Manual item | D-1 auto? | Notes |
|---|---|---|---|
| #249 | Cold boot without redbox | ✅ | covered by test 1 |
| #249 | 6 NavModel rows incl. household | ✅ | covered by test 1 |
| #249 | Restart-survival (vault + stoop cache) | ✅ | covered by test 3 |
| #249 | "Mesh transport ready" banner | ❌ | needs nknLib in test env — D-2 |
| #249 | Slash FAB visible + functional | ✅ partial | test 2 exercises the SlashFAB path |
| #253 step 1 | TextInput + bubble pair appear | ✅ | covered by test 2 |
| #253 step 2 | List bubble has inline-keyboard buttons | ✅ | covered by test 2 |
| #253 step 3 | State-morphing (row vanishes post-tap) | ❌ | D-2 will add this |
| #253 step 4 | `[Help with]` DM spawn etc. | ❌ | D-2 after step 4 ships |

**Constraints / setup-day specifics:**
- Uses Android emulator (AVD).  No CI yet — local-only.
- Jest as the Detox runner (not vitest — Detox can't use vitest).
- Will sprinkle `testID="…"` on key components (ChatScreen
  wrapper, input, send button, debug toggle, list row, button).
- Gradle Detox flavor added (release-with-debugger).
- New scripts in `apps/canopy-chat-mobile/package.json`:
  `detox:build`, `detox:test`.

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
