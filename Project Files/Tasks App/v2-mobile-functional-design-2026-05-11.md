# Tasks V2 — Mobile functional design (2026-05-11)

> What the **mobile** version of Tasks does for a user,
> post-standardisation. Describes the state after the Hub-free
> interim path ships (P0–P3 + non-Hub portion of P5 of the
> [standardisation plan](../standardisation-plan-restructured-2026-05-10.md)).
> Web companion: [`v2-web-functional-design-2026-05-11.md`](v2-web-functional-design-2026-05-11.md).
>
> V1 baseline is the Phase 41.x release of `@canopy-app/tasks-mobile`
> (19 screens, 106 tests, real-device pass pending — see
> [Phase 41 coding plan](mobile-coding-plan-2026-05-08.md)).

## 1. Pitch

Tasks on a phone is the same crew task ledger as the desktop,
with the three things the phone unlocks: **push notifications**
when a task in your skills profile becomes available, **scan a
QR** to join a crew or restore identity (no typing pod URLs),
and **photo deliverables** straight from the camera (the
"fixed bench" snapshot as DoD evidence). The phone version is
**not** a slimmed-down companion to a desktop — it's a peer
install that runs the full agent locally, talks to the same
relay, and shares no server-side state with the desktop other
than via the user's own pods (or, in no-pod crews, the
pseudo-pod replication ring).

## 2. Scope locks

These are decided 2026-05-11 and shape the rest of the doc:

1. **Architecture:** native Expo / React Native, parallel to
   `apps/folio-mobile` and `apps/stoop-mobile`. Not a PWA wrap,
   not a WebView shell.
2. **Pod attach is optional.** New installs default to local-
   only (no pod). Pod sign-in lands when the user picks a
   pod-having crew policy or upgrades from no-pod. Mobile uses
   `@canopy/oidc-session-rn`.
3. **Identity vault:** `@canopy/react-native`'s
   `KeychainVault` for the agent keypair. Auxiliary OIDC
   tokens piggyback on `oidc-session-rn` storage.
4. **Local persistence:** `AsyncStorageAdapter` for small
   (settings, MemberMap entries, inbox state);
   `FileSystemAdapter` for large (deliverable photos,
   attachments). Both wrapped by the pseudo-pod V0 substrate.
5. **Single-agent topology** (V2.8): one `core.Agent` per
   process, per-crew `CrewState`. Unchanged from V1.
6. **Hub-discovery is a runtime check.** When the Hub is
   installed, Tasks-mobile registers as a bundle and defers
   transport ownership. When the Hub isn't installed,
   standalone mode runs the full stack locally. Same APK in
   both cases.
7. **Background cadence:** lazy-on-background, aggressive-when-
   foreground. `expo-task-manager` for background-fetch; push
   is the primary wakeup path; background-fetch is the
   fallback.
8. **QR scan:** `expo-camera` built-in barcode scanning; the
   classifier in `@canopy/react-native/qr` recognises
   `tasks://invite`, `tasks://bot-token`, BIP-39, and
   contact-share payloads.
9. **Push:** Expo's push service via `MobilePushBridge`.
10. **Deep links:** `tasks://...` URL scheme.
11. **iOS out of scope.** Android-primary; the app may run on
    iOS via Expo, but no iOS code paths, tests, or release
    process.

## 2a. Composition (what we import from the web workspace)

Mobile is a **thin RN shell over the same app-level code as
web** — the V2.8 single-agent factories, skills, role policy,
DAG logic, shared UI helpers, and locales are all imported
unchanged from `@canopy-app/tasks-v0`. This is the
**platform-shell exception** locked in
[`conventions/architectural-layering.md`](../conventions/architectural-layering.md#shared-ui-glue-helpers-between-platform-shells-locked-2026-05-10),
shared with Folio + Stoop's mobile shells.

What mobile imports from `@canopy-app/tasks-v0` (the web app
workspace, not a substrate):

- **Agent construction.** `buildMeshAgent`, `wireSkills`,
  `bundleResolver`, `createCrewAgent` — the V2.8 single-agent
  factories that wire the meshAgent + per-crew `CrewState`.
- **Role policy.** `buildStandardRolePolicy` + the standard
  five roles + DoD gates + Phase 7 narrow exception.
- **Shared UI helpers (`src/ui/`).** taskStatus, composeArgs,
  inboxClassify, effectiveActor, i18nMerge, dagFlatten — all
  pure-of-platform, re-exported via `export *` shims in
  `apps/tasks-mobile/src/lib/`.
- **Skills + DAG.** `src/skills/`, `src/dag.js`, `src/dag-
  tree.js`. After P1, the V2.7 hard-deps logic in `dag.js`
  lifts into `item-store` and consumers (web + mobile) follow.
- **Locales.** `apps/tasks-v0/locales/{en,nl}.json` —
  authoritative; mobile-only strings layer on top via
  `apps/tasks-mobile/locales/{en,nl}.json`.

What mobile adds on top (the RN-specific layer):

- **Screens** — every RN screen in `apps/tasks-mobile/src/
  screens/`. The screens compose web's skills + UI helpers
  into React Native components.
- **Service bring-up** — `ServiceContext` +
  `createMobileBootstrap` from `@canopy/sync-engine-rn`.
- **Native modules** — `KeychainVault`, `FileSystemAdapter`,
  `AsyncStorageAdapter`, `MdnsTransport`, `BleTransport`,
  `MobilePushBridge` (all from `@canopy/react-native`).
- **Mobile substrates** — `oidc-session-rn`, `react-native/
  picker`, `react-native/qr`, `react-native/mnemonic`,
  `react-native/push`, `react-native/i18n`.

The cross-app dep on `@canopy-app/tasks-v0` is **the only
mobile-specific cross-app import**; everything else is via
shared substrates in `packages/`. Mobile doesn't fork any
web-version code; if a helper needs a mobile-specific
variant, it lifts to a substrate first (substrate-first rule,
§II.11 of the plan).

## 3. What's the same as desktop

Every capability listed in
[`v2-web-functional-design-2026-05-11.md`](v2-web-functional-design-2026-05-11.md)
§3 ships on mobile too, with the same skills and the same
substrate plumbing (via the composition in §2a):

- Crew lifecycle (`createCrewAgent` per crew with
  `crew.kind ∈ household | project | team | friends |
  maintenance`); `pauseCrew` / `archiveCrew`.
- Standard five roles + per-role policy gates.
- Task DAG (add / claim / submit / approve / reject / revoke /
  appeal); hard-deps gate; sub-tasks (direct or via
  `proposeSubtask`).
- Skill-match dispatch.
- Inbox + action-button routing.
- Closed-beta privacy notice.
- Metrics surface (`getMetrics`).

## 4. What's different on mobile

### 4a. Onboarding via QR

Desktop: paste an invite link into `/onboard.html`.

Mobile: tap "Scan QR" → scan the admin's `tasks://invite`
payload. The same payload encoded as a QR. Three QR shapes
recognised:

- `tasks://invite/<crewId>/<token>` — crew invitation.
- `tasks://bot-token/<scope>/<token>` — bot binding for a
  Telegraf-style bot.
- 12 / 24 BIP-39 words — recovery restore.

A one-line hint shows which of the three the scanner
recognised before applying.

### 4b. Push as primary wakeup

Web Push doesn't reach a backgrounded RN app; native push via
Expo's push service is the path. Wakeup triggers (skills
already define them; mobile consumes):

- Task in my skills profile becomes available (`skill-match`
  + the crew's `notifyWorthy` predicate).
- Inbox event needs my action (approve / decline / appeal).
- Task I claimed has a parent that just completed (V2.7 gate
  unlocks).
- Sub-task request needs my decision.

Push payload carries enough metadata to render a useful
notification body without opening the app — author handle +
one-line preview. Pod URLs absent (project privacy rule).

### 4c. Background-fetch as fallback

When push is disabled or undelivered, `expo-task-manager`
schedules a background-fetch every X minutes (X from the
user's `onlineWindow.everyMinutes` device setting; default
`null` → no background fetch, push only).

Active-state-aware cadence:

- **Foreground / active:** agent connects to the relay and
  polls per `pollIntervalMs` (default 2 seconds).
- **Background / inactive:** agent disconnects, drains queues,
  sleeps. `expo-task-manager` brings it back, runs a single
  short-lived sync (target: 30 s online window), then sleeps.

### 4d. Photo deliverables straight from the camera

Tasks's DoD-with-approver lifecycle includes optional photo
deliverables. Mobile: `expo-image-picker` opens directly to
the camera by default. Picker uses
`@canopy/react-native/picker`'s `pickAndResize({mode,
preset})` — same preset shapes as Stoop's `PRIKBORD_PRESET`
and `CHAT_PRESET`.

### 4e. Local-magic discovery (mDNS + BLE)

Desktop web has no peer-discovery; relies on the relay.

Mobile: `MdnsTransport` + `BleTransport` discover peers on the
same Wi-Fi / nearby. `createMeshAgent` wires them as preferred
transports behind relay. This is the "small crew on the same
network" capability — works on mobile, doesn't on web.

Permission UX: the app explains *why* it asks for BLE +
location up-front, with an opt-out that keeps the user on
relay-only. `requestMeshPermissions` handles the OS prompts.

### 4f. Per-device settings on mobile

Mobile has its own deviceId and writes its own
`devices/<deviceId>.json` to the user's pod (when signed in).
For no-pod users, the device settings live in the pseudo-pod.
Mobile-relevant fields:

- `pollIntervalMs` — foreground refresh cadence. Mobile
  default: 5000 ms (vs web's 2000 ms; battery-aware).
- `onlineWindow` — `{everyMinutes, durationSec}` for
  background-fetch. Default: `{ everyMinutes: null,
  durationSec: null }` (push only).
- `allowHopThrough` — same semantics as web. Default off.

Shared (synced to all the user's installs via the pod or the
pseudo-pod replication ring):

- `pushPreferences`, `cadenceOverrides`,
  `defaultCalendarShared`.

### 4g. Recovery phrase + cross-device identity

The mnemonic-restore flow makes mobile + desktop feel like one
person. On a fresh mobile install:

- "I'm new" → onboarding via QR + handle picker (creates a
  fresh identity).
- "I have a recovery phrase" → enter the 12 / 24 words → the
  identity swaps mid-flight, agent registers in the user's
  agent-registry (or pseudo-pod ring for no-pod users).
- "I'm rejoining via QR" → standard invite flow.

The mobile install gets a fresh `deviceId` even when the
mnemonic matches. Per-device settings start from defaults;
shared settings seed from the pod (or pseudo-pod replica).

### 4h. Hub-discovery + AIDL binding (P4+)

When the Hub is installed, Tasks-mobile binds via AIDL on
launch and defers transport / FG-service / inbox aggregation
to the Hub. Standalone mode (today's behaviour) is the
Hub-absent fallback. No UI change visible to the user — the
mobile shell looks the same; only battery + memory footprint
change.

## 5. User journeys

### Journey 1 — First run, joining a no-pod crew via QR

1. Install Tasks-mobile (Android primarily; iOS untested).
2. Welcome screen: "New" / "Restore" / "I have a QR code."
3. "I have a QR code" → opens scanner directly.
4. Scan invite QR → privacy + house-rules gates → handle
   picker → join.
5. Workspace loads. Crew is in no-pod mode. Push permission
   asked (with explanation).
6. Optional: "Save your recovery phrase" prompt.

Compared to web: no paste-link step. ~15 seconds cold-install
to first workspace view.

### Journey 2 — Claiming a skill-matched task

1. Push notification: "Anne: 'fix the broken bench' — your
   carpentry skill matches."
2. Tap notification → opens the task detail directly.
3. Tap "Claim" → ledger writes via the substrate (no-pod crew:
   eager full-payload fan-out; pod-having crew: pod-primary +
   envelope).
4. Returns to "Mine" screen with the new task pinned.

### Journey 3 — Photo deliverable submit

1. Anne claimed "fix the broken bench" yesterday.
2. Today she fixes it; opens the task detail; taps "Submit
   deliverable."
3. Camera opens directly (`pickAndResize`); takes a photo;
   resize runs (~1 s) → attached.
4. Taps "Submit" → `submitTask` ships with the photo as a
   deliverable item.
5. The approver gets a push notification with the photo
   thumbnail.

### Journey 4 — Sub-task proposal

1. Bob's claimed "paint the garden wall" but the wall needs a
   primer first.
2. Tap "Propose sub-task" → form with text + DoD.
3. Submit → `proposeSubtask` writes to Bob's pseudo-pod (or
   his sharing-container for pod-having crews); envelope
   notifies the master.
4. Master gets a push → reviews → approves or declines.

### Journey 5 — Crew upgrades to pod-having

1. Anne's household crew has been no-pod for two weeks.
2. From the crew settings screen → "Upgrade this crew" → wizard.
3. Picks "centralised" + provisions a household pod (OIDC
   flow runs via `oidc-session-rn` if Anne doesn't already
   have a pod).
4. Substrate lazily migrates content. Anne's mobile keeps
   working uninterrupted; for the other members, their next
   read fetches from Anne's pod.

### Journey 6 — Hub install, mid-life transition

1. Tasks-mobile has been running standalone for a month.
2. Anne installs the Hub from Play Store.
3. On Tasks-mobile's next launch, `hub-discovery` returns
   `{hubInstalled: true}`; the app re-registers as a bundle.
4. The transport stack now goes through AIDL; one
   foreground-service notification on the device instead of
   Tasks's own; unified inbox in the Hub includes Tasks's
   items.

## 6. Screens

V2 ships these screens (mostly the V1 set; new in **bold**):

| Screen | Web equivalent | Notes |
|---|---|---|
| Welcome | `/welcome.html` | New / Restore / Scan QR |
| Onboard (Scan) | `/onboard.html` | Camera-first; falls back to paste |
| Onboard (Restore) | (mnemonic input on web) | Mid-flight identity swap |
| Onboard (Issue) | (admin generates invite on web) | Admin generates QR |
| Workspace | `/index.html` | DoD composer + embed-ref slot + skill-match indicator |
| Task detail | (modal in `/`) | Photo deliverable + claim / submit / approve UI |
| Mine | `/mine.html` | Assigned / I'm master of / Ready to claim |
| Planner | (custom mobile screen) | Local calendar overlay (V1 surface) |
| Review | `/review.html` | Approver inbox |
| DAG | `/dag.html` | Sub-task tree; cross-pod refs render with a bold border |
| Inbox | `/inbox.html` | Notifications + action routing |
| Crews dashboard | `/crew.html` (per-crew on web) | Multi-crew switcher |
| Crew settings | (subsections in `/crew.html`) | 6 sections: identity / members / cadence / push / **storage policy** / privacy |
| Availability grid | (Phase 4 calendar) | Per-user weekly availability |
| Profile (mine) | (profile on web) | Avatar / handle / skills / recovery |
| Settings | (per-device + shared) | `pollIntervalMs` / `onlineWindow` / push prefs |
| Native calendar | (Phase 41.12) | Reads system iCal sources |
| Bot-binding QR | (admin generates) | Generate bot-binding QR for Telegraf etc. |
| **Pod settings** | `/pod-settings.html` | Pod-attach / sign-out / two-pod upgrade preset |
| Push | (Phase 41.11) | Opt-in + per-event toggles |
| Sign-in (pod) | (Phase 41.15) | OIDC flow when user provisions / attaches a pod |
| Privacy | `/privacy.html` | Same notice |

Total: ~21 screens. The new explicit **Pod settings** screen
materialises what V1 had as a deferred Phase 41.15 surface.

## 6a. Implementation status (post-standardisation)

V1's 19 screens shipped through Phase 41.17. V2 work is the
standardisation transition + the new Pod settings screen.

| Phase from plan | Mobile-specific work | Status |
|---|---|---|
| P0 | n/a | pending |
| P1 | route writes via substrate; Pod settings screen; sign-in flow polished; pseudo-pod V0 client wiring | pending |
| P2 | adopt `item-types` for `task` | pending |
| P3 | pseudo-pod V1 + write-through queue | pending |
| P5 | adopt `agent-registry`; drop `actorAliases`; canonical skeleton alignment | pending |
| P4 (Hub) | `hub-discovery` + `hub-binding` wiring; standalone vs registered-bundle mode | pending |
| P6 (Hub) | register `task` renderer (compact + full); propose-subtask protocol consumer | pending |
| P7 (Hub) | bundle refactor (Tasks is the canonical first) | pending |

V1 still has one open phase: **41.16 — real-device pass +
closed-beta APK** (hardware pending). That can ship before P1
starts; V2's storage transition rebases on whatever 41.16
landed.

## 7. Locales

V2 reuses `apps/tasks-v0/locales/{en,nl}.json` plus mobile-
specific keys in `apps/tasks-mobile/locales/{en,nl}.json`:

- Existing `mobile.*` keys carry forward.
- New mobile-only keys for the Pod settings screen
  (`pod_settings.scan_provider`, `pod_settings.upgrade_two`,
  `pod_settings.sign_out_warn`), plus storage-policy picker
  strings in the crew settings screen.

The `{text, doc}` leaf shape + the doc-field-mandatory rule
applies unchanged.

## 8. Open questions

- **Pod settings screen on a no-pod install.** Show the
  current pseudo-pod state, give a clear "you can attach a pod
  whenever" CTA, or hide the screen entirely? Default
  proposed: show with a friendly "no pod attached yet" header
  + "Set up a pod" + "Stay local" choices. Pin during P1.
- **Background-fetch quotas on Android Doze.** Measure +
  tune during P1; the per-event cadence settings might need
  per-app-state overrides.
- **Sign-out + re-sign-in mid-crew.** What state does the
  pseudo-pod retain? Default: keep everything cached, write
  queue drains on re-sign-in. Pin during P1.
- **Multiple crew context switching speed.** Today's V1
  switches per-crew via `bundle.cache.activeCrewId`. Under V2,
  switching shouldn't trigger a full pseudo-pod re-init.
  Verify in P1.

## 9. Non-goals

- **iOS-specific code paths.**
- **Lite mode / hub-attached** (deferred until P4).
- **Voice / video deliverable submit** (post-V2).
- **Capacitor / Tauri / other RN alternatives** — Expo is the
  picked path.

## 10. Phases

Phasing is the standardisation plan's §III.A; Tasks-mobile
work mirrors §IV.1 of the transition doc. No new phase
numbers in this doc.

The V1 41.16 real-device-pass phase ships ahead of P1 in any
order — it's an existing V1 deliverable that the V2 work
rebases on.

## 11. References

- Standardisation plan:
  [`../standardisation-plan-restructured-2026-05-10.md`](../standardisation-plan-restructured-2026-05-10.md).
- Transition doc:
  [`../standardisation-transition-2026-05-11.md`](../standardisation-transition-2026-05-11.md).
- Core functional design:
  [`../SDK/core-v2-functional-design-2026-05-11.md`](../SDK/core-v2-functional-design-2026-05-11.md)
  — what `packages/core` provides; Tasks-mobile composes via
  `@canopy-app/tasks-v0`'s V2.8 factories.
- Substrates functional design:
  [`../Substrates/substrates-v2-functional-design-2026-05-11.md`](../Substrates/substrates-v2-functional-design-2026-05-11.md)
  — per-substrate behaviour. Mobile-specific consumption
  points: §5.7 oidc-session-rn (already in V1 for Folio,
  Tasks-mobile adopts in P1); §4.1 pseudo-pod (RN backing
  via `FileSystemAdapter` + `AsyncStorageAdapter`); §4.4
  notify-envelope (per-write mode); §4.6 agent-registry
  (mobile registers on first run).
- Web companion:
  [`v2-web-functional-design-2026-05-11.md`](v2-web-functional-design-2026-05-11.md).
- V1 mobile (current) behaviour:
  [`apps/tasks-mobile/README.md`](../../apps/tasks-mobile/README.md).
- V1 mobile coding plan (Phase 41):
  [`mobile-coding-plan-2026-05-08.md`](mobile-coding-plan-2026-05-08.md).
- Folio-mobile (RN pattern parallel):
  [`apps/folio-mobile/`](../../apps/folio-mobile/).
- Stoop-mobile (RN sibling):
  [`apps/stoop-mobile/`](../../apps/stoop-mobile/).
- RN platform layer:
  [`packages/react-native/`](../../packages/react-native/).
- Layering convention:
  [`../conventions/architectural-layering.md`](../conventions/architectural-layering.md).
- iOS-out-of-scope:
  [main `README.md`](../../README.md#platform-support--ios-deliberately-out-of-scope-locked-2026-05-08).
- Hub-on-phone direction:
  [`../projects/README.md`](../projects/README.md).
