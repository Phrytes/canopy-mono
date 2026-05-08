# Tasks Mobile V1 — functional design

> What the phone version of Tasks *does* for a user, and how it
> differs from the desktop / web app. Companion to the V1+V2 web
> functional designs ([`./advice-2026-05-07.md`](./advice-2026-05-07.md),
> [`./functional-design-v2-2026-05-08.md`](./functional-design-v2-2026-05-08.md))
> — the mobile build inherits everything in those docs unless this
> document explicitly overrides it.
>
> **Pattern source:** mirrors
> [`Project Files/Stoop/v3-mobile-functional-design-2026-05-08.md`](../Stoop/v3-mobile-functional-design-2026-05-08.md)
> at the structural level. Stoop V3 is the working RN app to copy
> from; folio-mobile + stoop-mobile are the two consumers that
> already trip the rule-of-two for the mobile substrates this app
> needs.
>
> **Conventions honoured (same as the web app):**
> [`Project Files/conventions/architectural-layering.md`](../conventions/architectural-layering.md),
> [`./app-readme-scheme.md`](../conventions/app-readme-scheme.md),
> [`./localisation.md`](../conventions/localisation.md),
> [`./cross-app-settings.md`](../conventions/cross-app-settings.md),
> [`Project Files/Substrates/policies.md`](../Substrates/policies.md) (rule-of-two).

## 1. Pitch

Tasks on a phone is the same crew-task ledger as the desktop, with three things the phone unlocks: **carry your crew with you** (push when you get assigned, when your task is approved/rejected, when you're past a deadline), **photo-as-deliverable** (snap a picture of the finished work to attach to your "submitted" state), and **scan a QR to join a crew** (no typing pod URLs or pasting invite links).

The phone version is **not** a slimmed-down companion to the desktop — it's a peer install that runs the full agent locally, talks to the same crew bus, and shares no server-side state with the desktop other than via the user's own Solid pod. Every V1 + V1.5 + V2 capability that exists on the web exists here, expressed as native screens.

## 2. Scope locks

Decided 2026-05-08, shape the rest of the doc:

1. **Architecture:** native Expo / React Native, parallel to `apps/folio-mobile` and `apps/stoop-mobile`. **Not** a PWA wrap, **not** a WebView shell.
2. **Pod auth:** ships **local-only by default**. Pod sign-in lands once the OIDC-RN substrate is wired (already shipped in `@canopy/oidc-session-rn`; folio-mobile + stoop-mobile both consume it). No bespoke OIDC surface.
3. **Identity vault:** `@canopy/react-native`'s `KeychainVault` for the agent identity. Tasks-mobile's per-crew identity vault (V2.0 persistence) round-trips via the same keychain primitive.
4. **Local persistence:** mixed — `AsyncStorageAdapter` for small data (settings, MemberMap, hint blobs, invoice rollups); `FileSystemAdapter` for large data (deliverable photos, calendar `.ics` blobs the V2.1 emitter writes, attachment thumbnails).
5. **Bootstrap helper:** reuses `@canopy/sync-engine-rn` (already shipped — Stoop V3's first consumer; Tasks-mobile is the second, satisfying rule-of-two without any further substrate work).
6. **Hub:** the Hub is a **separate phone app**, not a desktop daemon. Tasks-mobile ships `standalone`; lite-mode deferred. Agent boundary stays clean enough for hub-attachment later (Agent Hub work is tracked elsewhere). -- dont count on this for now
7. **Background cadence:** lazy-on-background, aggressive-when-foreground. `expo-task-manager` for background-fetch; foreground polls at the user's setting. Push (when wired) is the primary wakeup; background-fetch is the fallback.
8. **QR scan:** `expo-camera`'s built-in barcode scanning (single-dep path, same choice Stoop V3 made).
9. **Push:** Expo's push service via `MobilePushBridge` (already in `@canopy/react-native`). The V1.5 web app's `--push` flag becomes the default mode here — no flag, just on (with per-event toggle in settings).
10. **Deep links:** `tasks://...` URL scheme for V1 (invite + cap-token-bound bot binding; appeal-thread deep links). Universal HTTPS links deferred.
11. **iOS:** out of scope per the project-wide lock. Android-primary; the app may run on iOS via Expo, but no iOS-specific code paths, tests, or release process.
12. **Bot dispatch on mobile:** the chat-bot (V1.5) is a server-side concept. Mobile users **configure** chatBindings + cap-tokens via the existing skills (`setBotChatBinding`, `issueBotToken`), but the bot itself runs in the desktop / hosted CLI process. Mobile doesn't try to host a Telegraf instance.
13. **Single-agent topology** (added 2026-05-08 — Stoop refactor handoff): Tasks-mobile follows the V2.8 single-agent convention from the desktop. ONE `core.Agent` per `<ServiceContext>`, transports as routes; per-crew state in `Map<crewId, CrewState>` (no per-crew Agent). Skills register once with a `bundleResolver` that picks the crew at dispatch time. Mobile **inherits the V2.8 shape from the desktop** — `apps/tasks-mobile` imports `buildMeshAgent` + `buildCrewState` from `apps/tasks-v0` rather than re-implementing. Per [`Project Files/conventions/single-agent.md`](../conventions/single-agent.md).

## 3. What's the same as desktop

Every capability listed in `advice-2026-05-07.md` § "Functional summary" + every V2 capability ships on mobile too, with the same skills and the same pod shape:

- **Crew envelope + role policy** (admin / coordinator / member / observer / external + custom roles).
- **DAG of tasks** with cycle-free `dependencies`, `requiredSkills`, `dueAt`.
- **DoD lifecycle**: claim → submit → approve / reject / revoke → appeal.
- **Sub-tasks** with admin-approval depth threshold.
- **In-app inbox** (V1.5 cap-token-bound; mobile reads the same `<crew-pod>/tasks/inbox/<webid>/` blobs).
- **Cap-token-bound bot agent** (V1.5): mobile users see + manage their own chatBinding from the Crew screen; the bot runs server-side.
- **Calendar emission** (V2.1): mobile reads + writes the same `.ics` blob; *additionally* offers native phone-calendar integration via `expo-calendar` (see § 4d).
- **Compensated-role + invoicing** (V2.2): mobile renders the per-month rollup; admin can flip the toggle from the phone.
- **Availability hints** (V2.3): mobile is the *primary* surface — tapping a half-day cell on the go is more natural than on a desktop.
- **Auto-scheduling planner** (V2.4): mobile shows suggestion cards; accept commits.
- **Cross-crew dashboard** (V2.5): mobile is the *primary* surface for "do I need to do anything tonight" — most usage will be on a phone.

The same skill registry, the same locale files, the same role policy. Mobile is a parallel implementation, not a port.

## 4. What's different on mobile

### 4a. Onboarding via QR

Desktop: paste an invite link or load a `crew.json` config file via `--crew`.

Mobile: **tap "Scan QR" → scan the admin's QR**. The same invite payload (`{groupId, secret, ...}`) encoded as a QR. Redemption flow is otherwise identical — privacy gate, member roster join, MemberMap auto-persist.

The same scanner handles two more payload shapes:
- **Cap-token bot binding** — admin generates a QR that encodes `{chatId, webid, tokenBlob}`; the bot agent (server-side) scans it via the chat-bot's QR-relay protocol (lifted from the V1.5 cap-token flow). Equivalent to typing the chatId + webid into the Crew page's bindings table.
- **Recovery phrase** — 12 / 24 BIP-39 words encoded as a QR (mirrors Stoop V3).

The scanner UI shows a one-line hint about which of the three it recognized before applying.

### 4b. Push is the primary wakeup

Desktop: page is open or it isn't.

Mobile: app may be backgrounded or not running. Web Push doesn't reach a backgrounded RN app. **Native push via Expo's push service** is the V1 path.

Wakeup triggers (locked in skills already; mobile just consumes the existing notifier events):

- **Inbound assignment** — someone reassigns a task to me.
- **Submission to approve** — a task I'm the approver of just got submitted.
- **Approval / rejection on my submission** — the task I submitted got a verdict.
- **Revocation** — my assignment was revoked (with reason).
- **Sub-task admin-approval queue entry** — admin/coord see new requests pile up.
- **Past-deadline** — task with `dueAt` in the past, no completion yet.
- **Daily digest** (opt-in) — once a day at the user's local time, count of open + overdue + mine across all crews.

The cap-token + push wiring already exists (V1.5 PushChannel + PushPolicy). Mobile token registration plugs into the same registry. Push payload carries enough metadata to render a useful notification body without opening the app — but no task body content beyond the title + author handle (per the project-wide privacy rule).

### 4c. Background-fetch as fallback

When push is undelivered (Doze / battery saver), `expo-task-manager` schedules a background-fetch every X minutes (X comes from `pollIntervalMs.background` device setting; default `null` → push only).

Active-state-aware:

- **Foreground:** the agent connects to the relay and polls per the user's `pollIntervalMs.foreground` (default 5 s — mobile-friendly, vs desktop's 2 s).
- **Background:** disconnect, drain, sleep. Background-fetch tick brings it back for a single short-lived sync (target 30 s online window).

Same split Stoop V3 uses; lifted code-wise (no new substrate).

### 4d. Native calendar integration (`expo-calendar`)

Desktop: subscribe to the V2.1 `.ics` URL.

Mobile: **two choices** offered side-by-side on the Settings screen:

1. **Subscribe URL** (same as desktop) — copy the URL into your calendar app's "Add by URL" option. Works on iOS + macOS Calendar, Apple Watch, etc. without any native API.
2. **Native calendar write** — `expo-calendar` writes events directly to a Tasks-owned local calendar on the phone (per-crew). Better UX (no manual subscribe step, instant appearance) but requires `expo-calendar` permission and is per-device (doesn't follow the user across phones).

Both paths share the same V2.1 ICS-builder code (pure function); the native path just calls `Calendar.createEventAsync` for each VEVENT instead of writing to a `.ics` file.

The user picks one or both at first run; per-event sync semantics (UID-based update) work the same way.

nr 2 sounds best!

### 4e. Camera-first photo deliverables

Desktop: deliverable is a free-text or pod-resource link.

Mobile: when a task has `definitionOfDone.kind === 'photo'` (a new optional field — purely additive on the existing `definitionOfDone`), the submit-action button is "📷 Take photo" rather than "Submit." The captured photo lands at:

- `<crew-pod>/tasks/deliverables/<taskId>/<photoId>.jpg` (when pod-attached)
- Local-store fallback path (when local-only mode)

Resize via `expo-image-manipulator` to `max-edge 1280px, JPEG q=0.82`. The photo's pod URL becomes `task.deliverable.ref` automatically, and the V1 `submitTask` skill fires with the populated `deliverable`.

Approver UI on mobile (Review screen) renders the inline photo thumbnail + tap-to-zoom. Same pattern Stoop V3's Phase 39 photo attachments use; lifted code-wise.

### 4f. Local-magic discovery (mDNS + BLE)

Desktop: web app has no peer-discovery; relies on the relay.

Mobile: `MdnsTransport` + `BleTransport` (already shipped in `@canopy/react-native`) discover crew members on the same Wi-Fi / nearby. `createMeshAgent` wires them as preferred transports behind relay. Mostly relevant for in-person crew work (a household, a maintenance crew on-site).

Permission UX: the app explains *why* it asks for BLE / location (needed for BLE on Android) up-front, with an opt-out that keeps the user on relay-only.

### 4g. Settings split on mobile

Per the cross-app-settings convention, mobile has its own `deviceId` and writes its own `devices/<deviceId>.json`. Mobile-relevant fields:

| Field | Scope | Mobile default |
|---|---|---|
| `pollIntervalMs.foreground` | device | 5000 (vs desktop 2000) |
| `pollIntervalMs.background` | device | `null` (push-only) |
| `onlineWindow` | device | `{everyMinutes: null, durationSec: null}` |
| `allowHopThrough` | device | `false` |
| `pushPreferences` | shared | `{}` (per-event opt-out, follows user across devices) |
| `cadenceOverrides` | shared | `{}` (carries from web) |
| `calendarSyncMethod` | device | `'ics'` (mobile-only field; values: `'ics'` / `'native'` / `'both'`) |

The web's Settings page becomes a Settings screen with the same two-section layout ("On this device" / "My preferences").

### 4h. Recovery phrase + cross-device identity

The mnemonic-restore flow (lifted from Stoop V3 / Phase 31) is what makes mobile + desktop feel like one person. On a fresh mobile install:

- "I'm new" → onboarding via QR + crew join (creates a fresh identity).
- "I have a recovery phrase" → enter the 12 / 24 words → the identity swaps mid-flight, crews + roles + member maps follow the user (same `stableId` via Phase 32's HKDF derivation).

Mobile install gets a **fresh `deviceId`** even when the mnemonic matches — Phase 33.1 explicit. Per-device settings start from defaults; shared settings seed from the pod's `shared.json` after sign-in.

### 4i. Bot binding via QR (admin convenience)

The web bot bindings panel needs an admin to know the chatId in advance. On mobile, an admin can:

1. Tap "Issue bot token" on the Bot bindings screen.
2. Enter the bound member's webid + TTL.
3. Show a QR encoding the token blob.
4. The bound member's bot client (running on a desktop CLI) scans the QR to load the token into its own vault.

Same cap-token blob the V1.5 `issueBotToken` skill returns; just a different transport into the holding agent. Reuses the QR scanner from journey 4a.

## 5. User journeys (the seven flows from V1+V2, re-cast on a phone)

### Journey 1 — First run, joining a crew

1. Install Tasks (Android primarily).
2. Welcome screen: "New" / "Restore" / "I have a QR code."
3. **"I have a QR code"** → scanner opens directly.
4. Scan invite QR → privacy + crew-rules gates → handle picker → join.
5. Sees the Workspace (open tasks). Empty (just joined). Push permission asked, with explanation.
6. Optional: "Save your recovery phrase" prompt.

~15 seconds from cold install to first crew view.

### Journey 2 — Claim a task on the way to work

1. Push: "New task in OSS Tools NL — write the README." Tap.
2. Workspace opens to that task's detail.
3. Tap "Claim." Brief loading. Now `claimed`, assigned to me.
4. Phone calendar (if native sync enabled) shows the deadline at the right time.

~5 seconds end-to-end.

### Journey 3 — Submit with a photo

1. Open My Work → tap an in-progress task.
2. Tap "📷 Take photo" (visible because `definitionOfDone.kind === 'photo'`).
3. Camera opens → snap → preview → confirm.
4. "Submit" → the underlying `submitTask` fires with the photo's pod URL as `deliverable.ref`.
5. Approver gets a push within seconds.

### Journey 4 — Approver triages on the bus

1. Push: "Anne submitted 'Paint the fence' for review."
2. Tap → Review screen with the inline photo + Anne's submit-note.
3. Tap "Approve" or "Reject + reason."
4. Done. Anne gets the verdict push.

### Journey 5 — Set my availability

1. Open Availability tab → 7×2 grid for this week.
2. Tap "Tue PM" → cycles through `unknown → open → tight → unavailable → unknown`.
3. Pod write happens in the background; coordinators see the chip on their next assign-picker view.

### Journey 6 — Suggest a plan + accept

1. Open My Work → "Suggest a plan."
2. Three suggestion cards appear with reason chips.
3. Tap "Accept" on the top one → `scheduledAt` set → the calendar (native or ICS) refreshes within seconds.

### Journey 7 — One screen for all my crews

1. Open Crews tab.
2. Three rows: each crew, with open / overdue / awaiting-approval / mine counters. Overdue counts in red.
3. Tap any row → switches the rest of the app to that crew's context.

(This last one is the mobile flagship — desktop users juggle browser tabs; mobile users glance at one screen.)

### Journey 8 — Bot binding via QR (admin)

1. Admin opens Crew → Bot bindings → "Issue token" → enters the new member's webid + TTL.
2. App displays a full-screen QR with the token blob.
3. The new member's desktop bot client scans it (or pastes the URL).
4. Token loaded; cap-token mode active immediately.

(Same outcome as the V1.5 web flow, faster.)

## 6. Screens

V1 ships these screens (parallel to web pages):

| Screen | Web equivalent | Notes |
|---|---|---|
| Welcome | (none — desktop has CLI flag) | New / Restore / Scan QR |
| Onboard (Scan) | (none) | Camera-first; falls back to paste |
| Onboard (Restore) | (none) | Mnemonic input; mid-flight swap |
| Workspace (Open tasks) | `/index.html` | Pull-to-refresh + filter chips + FAB-create. V2.7: disabled close button + tooltip; admin force-complete; propose-mode for sub-task on submitted parent. |
| Task detail | (modal in /) | Full-screen photo modal for deliverables |
| My work | `/mine.html` | Assigned + mastered + claimable + planner cards. V2.7: open-deps chip on cards waiting on sub-tasks. |
| Review | `/review.html` | Approver inbox with inline photos. V2.7: disabled Approve + tooltip when parent is dependency-blocked. |
| DAG | `/dag.html` | Sub-task tree (collapsible) |
| Inbox | `/inbox.html` | Notifications list with badge. V2.7: render `subtask-proposal` cards with Approve/Decline buttons + auto-rollback warning. |
| Crews dashboard | `/crews.html` | One row per crew + jump-in |
| Crew settings | `/crew.html` | Members + settings + stats + admin panels |
| Bot bindings (admin) | (panel on /crew.html) | Includes "Issue token" → QR flow |
| Compensation | (panel on /crew.html) | Per-pro month rollup |
| Calendar sync | (panel on /crew.html) | Native vs ICS picker |
| Availability | `/availability.html` | 7×2 grid; primary mobile surface |
| Custom roles (admin) | (panel on /crew.html) | Add/remove roles |
| Profile (mine) | (none) | Avatar + handle + skills + recovery phrase |
| Profile (other) | (none) | Read-only |
| Sign-in (Pod) | (none) | Lands when OIDC-RN wires |
| Push | (none) | Subscribe + test + per-event toggle |
| Settings | (none) | Two-section layout (per-device / shared) |
| Privacy | `/privacy.html` | Same notice + mobile-only sections |

(20 screens. Subset of Stoop V3's 22 — Tasks doesn't have the contacts / location-pin surfaces.)

## 6a. Implementation status (none yet — pre-build)

Nothing built yet. The 2026-05-08 audit Stoop V3 went through after Phases 40.1-40.13 is the cautionary tale: don't ship UI shells without agent wiring. Tasks-mobile's coding plan (deferred to a separate doc) bakes wiring into each phase from the start.

## 7. Locale + i18n

Tasks-mobile reuses `apps/tasks-v0/locales/{nl,en}.json`. The locale resolver becomes a small RN-friendly module — no DOM walker (no `data-i18n` attributes), just `t(key, fallback)`. Existing `{text, doc}` shape works through the same `_lookupKey` unwrap.

Locale files are **shared** between web and mobile — same keys, same translator-context notes. Mobile-only strings (camera permission rationale, push permission rationale, "Scan QR", "Take photo" CTA) get added under a new `mobile.*` section following the same `{text, doc}` rule. New keys this design needs:

- `mobile.welcome.*` (3 keys: title, new, restore)
- `mobile.scan.*` (4 keys: prompt, hint, error_invalid, error_camera)
- `mobile.push.*` (5 keys: rationale, opt_in_label, test_button, status_subscribed, status_blocked)
- `mobile.calendar.*` (4 keys: native_label, ics_label, both_label, permission_rationale)
- `mobile.deliverable_photo.*` (3 keys: cta, retake, confirm)
- `mobile.tabs.*` (6 keys: workspace, mine, review, dag, crews, more)

## 8. Open questions (deferred to coding-plan time)

These are decisions where I don't yet have enough info to lock — they'll be pinned in the coding plan, not here:

- **QR rendering library on mobile.** `react-native-qrcode-svg` (Stoop V3's pick) vs hand-roll. Picked at the QR phase.
- **Photo viewer UX.** Single image: just modal. Multi-image (sub-task tree with multiple deliverables): swipeable carousel? Standard Expo gallery component?
- **Native calendar UX.** Per-crew calendar object vs single Tasks calendar with crew tags? `expo-calendar` supports both.
- **Onboarding photo + camera permission rationale copy.** Need the Dutch + English translator-friendly tone.
- **Background-fetch quota / OS limits.** Android Doze + iOS BackgroundTasks quota — same investigation Stoop V3 did; revisit with mobile-build numbers.
- **Bot-binding QR shape.** Encode the entire token blob (kilobytes — too big for a QR) vs encode a one-time exchange token + the bot fetches the real token over the bus (smaller, but adds an exchange step). Picked at the bot-binding phase.
- **Daily digest payload.** "3 open in OSS Tools NL, 1 overdue" — should it carry per-crew counts or just total? Privacy-vs-usefulness tradeoff.
- **Where the Hub-on-phone direction lands.** Stoop V3 punted; Tasks-mobile does the same — designed to be hub-attachable later, ships standalone V1.

## 9. Non-goals

- **iOS-specific code paths** (locked in main README).
- **Lite mode / hub-attached** (deferred until Hub-on-phone ships).
- **Voice deliverables / video deliverables** (V2 mobile territory).
- **Offline-first migration of the WHOLE web shell** to RN — mobile is a parallel implementation, not a port.
- **Capacitor / Tauri / other RN alternatives** — Expo is the picked path.
- **Hosting the Telegram bot on mobile** — the bot is server-side. Mobile only configures bindings + holds the issuer-side cap-token + revocation list (which are already on the tasks agent).

## 10. Phasing (high-level, sized — full table in the coding plan)

| Phase | Theme | Estimate |
|---|---|---|
| 41.1 | Scaffold `apps/tasks-mobile/` (mirror stoop-mobile shape; reuse `sync-engine-rn`) | 1 d |
| 41.2 | ServiceContext + agent bring-up + `useSkill` hook | 2 d |
| 41.3 | Onboarding screens (Welcome / Scan / Restore / Issue) | 2 d |
| 41.4 | Workspace + task detail + filter chips + FAB-create. **V2.7:** disabled "Mark complete" button + open-deps tooltip; admin-only "Force complete" button + reason sheet on dependency-blocked parents; "Add sub-task" flips to "Propose sub-task" mode when parent is `submitted` and caller isn't the assignee (calls `proposeSubtask`). | 1.75 d |
| 41.5 | My work + planner cards + photo deliverable submit flow. **V2.7:** assigned-task cards reflect the disabled close button when `item.status === 'waiting'` (use the V2.7 `status` field now returned by `listMine`); display the open-deps count as a chip on the task card so it's visible without opening detail. | 2.5 d |
| 41.6 | Review (with inline photos) + DAG + Inbox + crew-context switch. **V2.7:** Review screen disables "Approve" symmetrically + tooltip; Inbox screen renders `subtask-proposal` cards with `[Approve]` / `[Decline]` buttons (Approve shows a confirm-sheet warning about the auto-rollback to claimed; Decline opens an optional note text field); new `subtask-proposal` event-label localization. | 2 d |
| 41.7 | Crews dashboard + per-crew jump-in | 0.5 d |
| 41.8 | Crew settings panels (members, custom roles, bot bindings, compensation, calendar sync, availability admin toggle) | 2 d |
| 41.9 | Availability grid + opt-in flow | 1 d |
| 41.10 | Profile (avatar, handle, skills, recovery) | 1 d |
| 41.11 | Settings (per-device + shared) + push opt-in + per-event toggle | 1.5 d |
| 41.12 | Native calendar integration (`expo-calendar`) + ICS-URL fallback | 1 d |
| 41.13 | Bot binding QR (admin issue + scanner classifier) | 0.5 d |
| 41.14 | AppState bridge + background-fetch task registration | 0.5 d |
| 41.15 | Sign-in (Pod) — wire OIDC-RN; pod-side bulk sync | 1.5 d |
| 41.16 | Real-device pass + closed-beta APK build | 1-2 d |
| 41.17 | Documentation + handoff (README + privacy update) | 0.5 d |

Total **~22-23 dev-days** for V1 (was ~21-22 before V2.7's mobile bullets bumped 41.4 + 41.6 by ~½ d each). Wall-clock with parallelism: phases 41.4-41.7 + 41.9 + 41.10 + 41.11 + 41.12 + 41.13 are largely disjoint surfaces and could ship in 4-5 parallel streams, bringing wall-clock down to ~10-12 dev-days.

## 11. Substrate composition + rule-of-two analysis

| Capability | Substrate(s) used | Rule-of-two |
|---|---|---|
| Scaffold + agent bring-up | `@canopy/sync-engine-rn` + `@canopy/react-native` (KeychainVault, AsyncStorageAdapter, FileSystemAdapter) | Already shipped; Tasks-mobile is the second consumer (after Stoop V3). No further substrate work. |
| QR scan | `expo-camera` directly | First mobile consumer of QR scanning is Stoop V3; Tasks-mobile is the second. Can lift Stoop V3's `lib/QrClassifier` if rule-of-two trips, otherwise inline. |
| Push | `@canopy/notifier.PushChannel` + `@canopy/notifier.PushPolicy` + `@canopy/relay.ExpoPushSender` | Already shipped (V1.5 + Stoop). Mobile just consumes. |
| Native calendar | `expo-calendar` directly | First consumer in this repo. **Stays app-local.** When a second app needs native calendar write, lift to `@canopy/calendar-native` (or fold into the `@canopy/calendar` substrate that V2.1 flagged as a future lift). |
| Photo deliverables | `expo-image-picker` + `expo-image-manipulator` directly | Stoop V3 Phase 39 already does this for prikbord posts; same primitives. Lift the shared resize+thumbnail helper if Tasks-mobile + Stoop V3 paths reveal duplication. |
| Background fetch | `expo-task-manager` directly | Same as Stoop V3 — both apps wire it the same way. **Substrate candidate** (`@canopy/bg-cadence`?) but defer until friction shows. |
| OIDC sign-in | `@canopy/oidc-session-rn` | Already shipped (folio + stoop). Tasks-mobile is the third consumer. |
| mDNS / BLE peer discovery | `@canopy/react-native` (`MdnsTransport`, `BleTransport`, `createMeshAgent`, `requestMeshPermissions`) | Already shipped. |
| All Tasks skills | `@canopy/item-store`, `@canopy/identity-resolver`, `@canopy/skill-match`, `@canopy/local-store`, `@canopy/notifier`, `@canopy/chat-p2p`, `@canopy/chat-agent` (only the bridge interface — bot itself is server-side) | Already shipped, full reuse. |

**No new substrates promoted by Tasks-mobile V1.** Every capability either reuses an already-shipped substrate or stays app-local pending a second consumer (per `Project Files/Substrates/policies.md`).

## 12. Privacy + data-sharing (mobile additions)

Inherits everything from V1's pod-data-sharing caution principles. Mobile-only additions to call out in the privacy notice:

- **Camera access** — used only for QR scan + photo deliverables. Photos uploaded to *your own pod path* (per-task, per-crew); no third-party processing.
- **Push tokens** — sent to the user's own relay or the Expo push service. Tokens are device-scoped; rotating a token (re-installing the app) invalidates the old one.
- **`expo-calendar` permission** — only when the user picks "Native calendar write." Reads the system calendar list to decide where to create the Tasks calendar; never reads existing events.
- **Location** — only when the user enables BLE peer discovery (Android requires location permission for BLE). Not used for any geographic feature; coords are never persisted.

The privacy notice (`apps/tasks-v0/src/lib/privacyNotice.js` shared across web + mobile) gets four mobile-only items, both languages, same `{text, doc}` shape.

## 13. Risk register (mobile additions)

In priority order:

1. **Push delivery on Doze / battery saver** — Android may delay or drop notifications. Mitigation: background-fetch fallback with explicit "this is a fallback" UI hint; daily-digest opt-in as a third tier.
2. **Camera permission denials** — user denies camera; Scan / Take-photo flows broken. Mitigation: gentle "you can paste an invite link instead" affordance on the Scan screen; "you can mark complete without a photo" affordance on the submit screen (deliverable becomes free-text).
3. **Photo deliverable size** — 1280px JPEG is ~300 KB; pod write may fail on slow networks. Mitigation: queue retry via `local-store.SyncCadence`; user sees an "uploading" badge until acked.
4. **Native calendar drift** — `expo-calendar` writes events that the user could delete from the system calendar app, leaving no link back. Mitigation: store the calendar event ID in `task.scheduledAt.calendarEventId` so re-emission can re-create; if the event is missing on next sync, re-create it.
5. **OIDC-RN sign-in surface gap** — pod sign-in lands when the substrate ships. Until then, mobile is local-only. Mitigation: explicit "local-only mode" indicator in Settings + a "what does this mean?" help link.

## 14. References

- Web V1 functional design: [`./advice-2026-05-07.md`](./advice-2026-05-07.md)
- Web V2 functional design: [`./functional-design-v2-2026-05-08.md`](./functional-design-v2-2026-05-08.md)
- Web V1+V2 coding plans: [`./coding-plan-2026-05-07.md`](./coding-plan-2026-05-07.md), [`./coding-plan-v2-2026-05-08.md`](./coding-plan-v2-2026-05-08.md)
- App CHANGELOG: [`apps/tasks-v0/CHANGELOG.md`](../../apps/tasks-v0/CHANGELOG.md)
- Stoop V3 mobile (the working RN pattern to mirror): [`Project Files/Stoop/v3-mobile-functional-design-2026-05-08.md`](../Stoop/v3-mobile-functional-design-2026-05-08.md), [`Project Files/Stoop/v3-mobile-coding-plan-2026-05-08.md`](../Stoop/v3-mobile-coding-plan-2026-05-08.md), [`apps/stoop-mobile/`](../../apps/stoop-mobile/)
- folio-mobile (sister RN pattern): [`apps/folio-mobile/`](../../apps/folio-mobile/)
- RN platform layer: [`packages/react-native/`](../../packages/react-native/), [`Project Files/Substrates/L0-react-native.md`](../Substrates/L0-react-native.md)
- Mobile bootstrap substrate: [`packages/sync-engine-rn/`](../../packages/sync-engine-rn/)
- Pod sign-in substrate: [`packages/oidc-session-rn/`](../../packages/oidc-session-rn/)
- Conventions: [`Project Files/conventions/`](../conventions/) (architectural-layering, app-readme-scheme, localisation, cross-app-settings)
- Substrate policies: [`Project Files/Substrates/policies.md`](../Substrates/policies.md)
- Mobile-substrates rule: [`Project Files/conventions/architectural-layering.md`](../conventions/architectural-layering.md#mobile-substrates-live-in-their-own-packages-locked-2026-05-08)
- iOS-out-of-scope: [main `README.md`](../../README.md#platform-support--ios-deliberately-out-of-scope-locked-2026-05-08)
