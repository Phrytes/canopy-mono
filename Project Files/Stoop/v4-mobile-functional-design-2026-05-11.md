# Stoop V4 — Mobile functional design (2026-05-11)

> What the **mobile** version of Stoop does for a user,
> post-standardisation. Describes the state after the Hub-free
> interim path ships (P0–P3 + non-Hub portion of P5 of the
> [standardisation plan](../standardisation-plan-restructured-2026-05-10.md)).
> Web companion: [`v2-web-functional-design-2026-05-11.md`](v2-web-functional-design-2026-05-11.md).
>
> V3 baseline is the 2026-05-08 release of `apps/stoop-mobile`
> (Phases 40.1–40.22 shipped + 40.23 real-device pass pending).
> V3's mobile functional design lives at
> [`v3-mobile-functional-design-2026-05-08.md`](v3-mobile-functional-design-2026-05-08.md);
> V4 inherits that surface unless this doc overrides it.

## 1. Pitch

Stoop on a phone is the same buurt-prikbord as the desktop,
with three things the phone unlocks: **carry your buurt with
you** (push notifications when something matches your skills),
**scan a QR to join or add a contact** (no typing pod URLs),
and **post a photo straight from the camera** (the bicycle
that needs fixing, the plant cuttings on the windowsill). V4
keeps everything V3 did and adapts the storage substrate to
the §II.2 crew-policy choice — including the no-pod default
that mirrors V3's `groupMirror` experience for users who
haven't (yet) set up a Solid pod.

## 2. Scope locks

These are decided 2026-05-11; supplement V3's scope locks
unless explicitly overridden.

1. **Architecture:** native Expo / React Native (V3 scope
   lock 1). Unchanged in V4.
2. **Pod auth via `oidc-session-rn`.** V3 Phase 40.3 +
   Phase 41.15-equivalent already wires this; V4 makes pod
   sign-in the path for users in pod-having crews. New users
   default to no-pod.
3. **Identity vault.** `KeychainVault` from V3 scope lock 3.
   Unchanged.
4. **Local persistence.** `AsyncStorageAdapter` (small) +
   `FileSystemAdapter` (large) from V3 scope lock 4.
   Wrapped by the pseudo-pod V0 substrate (P1).
5. **Bootstrap helper.** Lifted into `@canopy/sync-engine-rn`
   per V3 scope lock 5. V4 extends it to call the
   `pod-routing` substrate on bring-up.
6. **Hub-discovery is a runtime check** (V3 scope lock 6
   updated). When the Hub is installed, Stoop-mobile binds
   via AIDL; otherwise standalone.
7. **Background cadence:** lazy-on-background, aggressive-
   when-foreground (V3 scope lock 7). Unchanged.
8. **QR scan:** `expo-camera` (V3 scope lock 8). Classifier
   list extends to `pod-onboarding://<provider>/<token>`
   payloads (for pod provisioning kicked off on desktop +
   continued on mobile).
9. **Push:** Expo's push service via `MobilePushBridge` (V3
   scope lock 9). Unchanged.
10. **Deep links:** `stoop://...` (V3 scope lock 10).
    Unchanged.
11. **iOS:** out of scope (V3 scope lock 11). Unchanged.
12. **No-pod by default; substrate handles per-crew policy.**
    Crew create wizard explains the choice; default is
    no-pod. Pod-having crews use the substrate's pod-primary
    + envelope path; no-pod crews use pseudo-pod-replicated
    eager fan-out.
13. **Connectivity-loss is first-class (locked 2026-05-11).** Crew
    policies are *preferences* with graceful degradation. Even
    pod-having buurts keep functioning when individual members
    are offline (BLE-only, no internet, train tunnel, pod
    provider down): the substrate falls back to pseudo-pod-
    replicated eager fan-out (over BLE / mDNS / queued relay) for
    that write, and the writer's pending-pod-upload queue drains
    to the buurt's pod on reconnect. Mobile is the canonical
    "offline happens often" case — `MdnsTransport` +
    `BleTransport` carry the fan-out when the relay is
    unreachable, preserving the "campsite buurt" use case across
    pod-having crews too. See plan §II.6 graceful-degradation
    block + substrates §4.4.5a. Upload-on-behalf is **open V2
    work** — particularly relevant for buurts with tech-shy
    members who never provision pods; questions documented in
    plan §II.6 + substrates §4.4.6 for later resolution.

## 2a. Composition (what we import from the web workspace)

Mobile is a **thin RN shell over the same app-level code as
the web app** — Stoop's skills, group state, MemberMap,
skill-match wiring, role policy, chat / reveal / claim
machinery, and locales are imported unchanged from
`@canopy-app/stoop`. This is the **platform-shell exception**
locked in
[`conventions/architectural-layering.md`](../conventions/architectural-layering.md#shared-ui-glue-helpers-between-platform-shells-locked-2026-05-10),
shared with Tasks + Folio's mobile shells.

What mobile imports from `@canopy-app/stoop` (the web app
workspace, not a substrate):

- **Agent + crew construction.** The `createStoopAgent`
  factory + per-crew bring-up; whatever V2 names them post-
  P1 (the substrate-first lifts may move some of this into
  `packages/`).
- **Skills.** `src/skills/` — `postRequest`, `respondToItem`,
  `sendChatMessage`, `requestReveal`, `redeemInviteWithGate`,
  `createGroupWithRules`, `rotateMyGroupCode`,
  `subscribeWebPush`, `scorePostRelevance`, …. Mobile dispatches
  these via the `useSkill` hook in `@canopy/sync-engine-rn`.
- **Role policy + group ops.** `listGroupMembers`,
  `postAnnouncement`, `editGroupRules`, `removeMember`,
  `listReports`, plus the per-role visibility gates.
- **Shared UI helpers (`src/lib/` → `src/ui/` post-P5).**
  `targetResolver`, `geo`, etc.; mobile re-exports via
  `export *` shims in `apps/stoop-mobile/src/lib/`. The
  V1-lifts work in
  [`migration-tasks-v1-lifts-2026-05-08.md`](migration-tasks-v1-lifts-2026-05-08.md)
  is mostly already complete; remaining helpers lift during
  P5 of the standardisation plan.
- **Locales.** `apps/stoop/locales/{nl,en}.json` — the
  canonical buurt-tone Dutch + English voice; mobile-only
  strings layer on top via `apps/stoop-mobile/locales/{nl,
  en}.json`.

What mobile adds on top (the RN-specific layer):

- **Screens** — every RN screen in `apps/stoop-mobile/src/
  screens/`. The screens compose web's skills + helpers
  into React Native components; the V3 work
  ([Phases 40.1–40.22](v3-mobile-coding-plan-2026-05-08.md))
  wired this end-to-end.
- **Service bring-up** — `ServiceContext` +
  `createMobileBootstrap` from `@canopy/sync-engine-rn`.
- **Native modules** — `KeychainVault`, `FileSystemAdapter`,
  `AsyncStorageAdapter`, `MdnsTransport`, `BleTransport`,
  `MobilePushBridge` (all from `@canopy/react-native`).
- **Mobile substrates** — `oidc-session-rn`, `react-native/
  picker`, `react-native/qr`, `react-native/mnemonic`,
  `react-native/push`, `react-native/i18n`.

The cross-app dep on `@canopy-app/stoop` is **the only
mobile-specific cross-app import**; everything else is via
shared substrates in `packages/`. Mobile doesn't fork any
web-version code.

## 3. What's the same as desktop

Every capability from
[`v2-web-functional-design-2026-05-11.md`](v2-web-functional-design-2026-05-11.md) §3
ships on mobile too, with the same skills and the same
substrate plumbing (via the composition in §2a):

- Identity + profile (handle, avatar, skills, holiday-mode,
  location).
- Group membership (codes rotate 30 days; redemption gates;
  Phase 35 auto-evict).
- Browse + post (prikbord with kind chips, broadcast via
  `skill-match`, substrate-mirror).
- Respond + coordinate (1:1 chat threads, claim flow,
  bilateral reveal handshake).
- Lend lifecycle.
- Contacts + lists (trust levels; per-contact flags; tags;
  list management).
- Auto-eviction filter (Phase 35).
- Picture attachments in posts and chat.
- Settings (per-device + shared).
- Pod sign-in (`oidc-session-rn`) — for pod-having crews.
- Layer-2 personal-interest scoring (Phase 22 `scorePost-
  Relevance`).
- Skill-match auto-suggest (Phase 22 broadcast scope: groups
  + hop-discovered peers + contacts).

## 4. What's different on mobile

Inherited from V3's §4 unchanged except where §4i below
notes:

### 4a. Onboarding via QR (V3 §4a)

Three payload shapes recognised: invite, contact-share,
recovery (BIP-39). V4 adds `pod-onboarding://...` for the
case where the user starts pod provisioning on desktop and
continues on mobile.

### 4b. Push as primary wakeup (V3 §4b)

Wakeup triggers unchanged. Pod URLs absent from push payloads
(project privacy rule preserved).

### 4c. Background-fetch as fallback (V3 §4c)

`expo-task-manager` cadence + active-state-aware split
carries forward unchanged.

### 4d. Camera-first picture posting (V3 §4d)

`expo-image-picker` opens to camera by default; resize via
`@canopy/react-native/picker.pickAndResize`. Unchanged.

### 4e. Location via GPS (V3 §4e)

Tap "Use my location" → `expo-location` → snap to 500m grid.
Place-name search also offered. Unchanged.

### 4f. Local-magic discovery (V3 §4f)

`MdnsTransport` + `BleTransport` discover peers on the same
Wi-Fi / nearby. Unchanged; in V4 these transports also serve
peer pseudo-pod fetches for no-pod crews.

### 4g. Settings split on mobile (V3 §4g)

Per-device `pollIntervalMs` (5000 ms), `onlineWindow`,
`allowHopThrough`. Shared `broadcastable`,
`defaultShareLocation`. Unchanged.

### 4h. Recovery phrase + cross-device identity (V3 §4h)

Mnemonic-restore flow unchanged. V4: after restore, the agent
registers itself in the user's agent-registry resource (or
the pseudo-pod replication ring for no-pod users); per-device
`deviceId` stays fresh per V3 Phase 33.1.

### 4i. Storage-policy choice during crew create or join (new in V4)

The crew-create wizard gains a storage-policy step (default:
no-pod). When joining an existing crew, the user's mobile
just adopts whatever policy the crew picked; if it's a pod-
having policy and the user doesn't have a pod yet, the join
flow optionally prompts to provision one (skippable for the
decentralised / hybrid cases when the user doesn't need a pod
of their own).

A new section in the per-crew settings screen shows the
crew's policy + a one-click "request upgrade" affordance for
non-admins (which sends a poll to the crew's admin) and a
direct upgrade flow for admins.

`/profile.html`-equivalent on mobile gains a "My Solid pods"
section with the two-pod upgrade preset (mirroring web).

### 4j. Hub-discovery + AIDL binding (P4+, new in V4)

When the Hub is installed, Stoop-mobile registers as a bundle
on launch. Stoop-mobile's transport stack defers to the Hub's;
one foreground-service notification on the device instead of
Stoop's own; unified inbox in the Hub includes Stoop's items.
No user-facing UI change in standalone mode.

## 5. User journeys (the seven V1/V3 flows, plus two new)

### Journey 1 — First run, joining a buurt via QR

1. Install Stoop-mobile (Android primarily).
2. Welcome screen: "New" / "Restore" / "Scan QR."
3. Scan invite QR → privacy + house-rules gates → handle
   picker → join.
4. Sees the prikbord. The buurt's existing posts appear
   (eager fan-out from peers' pseudo-pods + the new user's
   ring entry warms).
5. Push permission asked (with explanation).
6. Optional: save recovery phrase prompt.

No pod needed in this flow.

### Journey 2 — Posting a vraag (with photo) — V3 unchanged

### Journey 3 — Responding to someone else (with chat photo) — V3 unchanged

### Journey 4 — Bilateral reveal of real names — V3 unchanged

### Journey 5 — Lend lifecycle — V3 unchanged

### Journey 6 — Group create + admin work — V3 unchanged, plus

Mobile **does** support group-create. The 6-question wizard
now includes the storage-policy step. Defaults to no-pod;
admin can pick another policy if they have a pod available.

### Journey 7 — Mute / report / leave — V3 unchanged

### Journey 8 — Buurt upgrades to a pod (admin) — NEW

1. Admin in `/group.html` mobile → storage section →
   "Upgrade this group's storage."
2. Wizard: provision new buurt pod / use my personal pod /
   point at an existing shared pod.
3. Picks "use my personal pod" → grants the crew access via
   ACPs.
4. Substrate lazily migrates content; refs rewrite.
5. Members' mobile apps catch up on next read.

### Journey 9 — Embedding a Tasks ref in a supply offer — NEW

1. User in Stoop mobile, posting "ladder lenen."
2. Tap "+ embed item" → search UI over their pods.
3. Pick "Move the ladder (task)" from their Tasks crew.
4. Submit → post carries the embed ref.
5. Recipients' prikbord cards show the task chip; tap →
   opens Tasks (locally; Hub-mediated cross-app routing is
   P6).

## 6. Screens

V4 screens (inherits V3's set; new in **bold**, modified in
**italics**):

| Screen | V3 equivalent | Notes |
|---|---|---|
| Welcome | V3 Welcome | New / Restore / Scan QR |
| Onboard (Scan) | V3 | Camera-first; recognises new `pod-onboarding://` payloads |
| Onboard (Restore) | V3 | Mnemonic; mid-flight identity swap |
| Onboard (Issue) | V3 | Admin generates QR |
| Prikbord (Feed) | V3 | Pull-to-refresh + filter chips + FAB-post + **embed-ref chips** |
| Post compose | V3 | Camera-first; multi-photo + **embed-ref slot** |
| Item detail | V3 | Full-screen photo modal |
| Chat threads | V3 | List view |
| Chat thread | V3 | Inline photo, reveal CTA |
| My posts | V3 | Own posts + claim management |
| Contacts | V3 | List + add via QR / manual + trust + flags |
| Contact detail | V3 | Trust + flags + tags |
| Profile (mine) | V3 | Avatar + handle + skills + holiday + location + recovery + **"My Solid pods" section** |
| Profile (other) | V3 | Read-only view |
| Group | V3 | *Adds storage-policy section + upgrade affordance* |
| Create group | V3 | *Wizard now includes storage-policy step* |
| Settings | V3 | Per-device + shared |
| Sign-in (Pod) | V3 (Phase 40.3 + 41.15 equiv.) | Now the path for pod-having crews |
| Push | V3 | Opt-in + per-event toggles |
| Privacy | V3 | Privacy notice |
| Skill-match inbox | V3 (Phase 40.20) | Auto-match suggestion stream |
| Auth callback | V3 (Phase 40.19) | Bulk-sync progress |
| Metrics | V3 (admin / debug) | Closed-beta dashboard |

The V3 set carries forward intact; new affordances appear on
existing screens. No screens are removed.

## 6a. Implementation status (post-standardisation)

V3 (Phases 40.1–40.22) shipped 2026-05-08; Phase 40.23 real-
device pass + closed-beta APK was pending. V4 work is the
standardisation transition layered on top.

| Phase from plan | Stoop-mobile work | Status (2026-05-11) |
|---|---|---|
| V3 40.23 | real-device pass + closed-beta APK | hardware pending (carries forward into V4 baseline) |
| P0 | n/a | pending |
| P1 | route writes through `notify-envelope` per crew policy; storage-policy step in crew create wizard; "My Solid pods" section on profile; embed-ref slot on compose | pending |
| P2 | adopt `item-types` for Stoop's types | pending |
| P3 | **`groupMirror` substrate cut-over** — mobile is one of the test platforms for parity | pending |
| P5 | adopt `agent-registry`; canonical app skeleton alignment (Stoop V3 already lifted `src/lib/` into shared substrates per the 2026-05-08 migration doc) | pending |
| P4 (Hub) | `hub-discovery` + `hub-binding`; runtime-detect Hub | pending |
| P6 (Hub) | register Stoop's renderers (compact + full) for `supply-offer`, `demand-offer`, `chat-message`, `neighbourhood-job`; neighbourhood-job as protocol | pending |
| P7 (Hub) | bundle refactor (Stoop second; after Tasks) | pending |

The cliff is P3 (groupMirror cut-over); see V2 web doc + the
transition doc §IV.2 for the load-bearing test strategy.

## 7. Locales

V4 reuses `apps/stoop/locales/{nl,en}.json` (shared with web)
plus `apps/stoop-mobile/locales/{nl,en}.json` for mobile-only
strings. V3 already established the locale-resolver substrate
(`@canopy/react-native/i18n`). V4 adds keys for:

- Storage-policy picker copy in the create-group wizard.
- "My Solid pods" section on profile.
- Embed-ref chip labels on prikbord cards + compose.
- Hub-discovery banner copy (when Hub is detected, a one-time
  "Stoop is now using the Hub" toast).

The `{text, doc}` leaf shape + the doc-field-mandatory rule
applies unchanged.

## 8. Open questions

- **Storage-policy step UX in crew create wizard.** Show all
  four policies with descriptions, or progressive disclosure
  (default no-pod, "advanced" reveals the others)? Pin
  during P1; recommendation favours progressive disclosure
  with a "what's this?" link.
- **Per-crew upgrade affordance for non-admins.** Show a
  one-click "request upgrade" that polls the admin? Or hide
  upgrade entirely from non-admins? Default proposed: show
  with a "request upgrade" CTA that drops a notification to
  admin. Pin during P1.
- **Mobile UI for the storage-mapping editor.** Full editor
  on mobile, or just the upgrade-to-two-pod preset + sign-out?
  Default proposed: just preset + sign-out on mobile; full
  custom editor in the Hub-web-console (P5 Hub portion). Pin
  during P1.
- **Migration warning copy.** When a crew upgrades from no-pod
  to pod-having, the substrate's lazy migration kicks in.
  How prominently to warn users about data migration? Pin
  during P3.
- **Background-fetch quotas under V4's pseudo-pod
  replication-ring traffic.** No-pod crews fan-out more
  bandwidth than pod-having crews. Measure on real devices
  during P3.

## 9. Non-goals

- **iOS-specific code paths** (V3 lock; unchanged).
- **Lite mode / hub-attached** (deferred until P4 Hub work).
- **Voice posts / video** (V5 territory).
- **Offline-first migration of the WHOLE web shell to RN** —
  mobile is a parallel implementation, not a port (V3 lock;
  unchanged).
- **Capacitor / Tauri / other RN alternatives** — Expo is the
  picked path (V3 lock; unchanged).
- **Bundle refactor pre-P7.** Stoop-mobile ships as a normal
  app through P3 + P5 (non-Hub portion).

## 10. Phases

Phasing is the standardisation plan's §III.A; Stoop-mobile
work mirrors §IV.2 of the transition doc. V3's pending Phase
40.23 (real-device + closed-beta APK) folds into the V4
baseline.

## 11. References

- Standardisation plan:
  [`../standardisation-plan-restructured-2026-05-10.md`](../standardisation-plan-restructured-2026-05-10.md).
- Transition doc:
  [`../standardisation-transition-2026-05-11.md`](../standardisation-transition-2026-05-11.md).
- Core functional design:
  [`../SDK/core-v2-functional-design-2026-05-11.md`](../SDK/core-v2-functional-design-2026-05-11.md)
  — what `packages/core` provides; Stoop-mobile composes via
  `@canopy-app/stoop`.
- Substrates functional design:
  [`../Substrates/substrates-v2-functional-design-2026-05-11.md`](../Substrates/substrates-v2-functional-design-2026-05-11.md)
  — per-substrate behaviour. Mobile-specific consumption
  points: §5.7 oidc-session-rn (Stoop-mobile already in V3);
  §4.1 pseudo-pod (replication-ring mode is the no-pod-crew
  durability story that replaces `groupMirror`); §4.4
  notify-envelope (per-write mode); §4.6 agent-registry.
- V3 mobile functional design:
  [`v3-mobile-functional-design-2026-05-08.md`](v3-mobile-functional-design-2026-05-08.md).
- V3 mobile coding plan:
  [`v3-mobile-coding-plan-2026-05-08.md`](v3-mobile-coding-plan-2026-05-08.md).
- V1 functional design:
  [`functional-design-2026-05-06.md`](functional-design-2026-05-06.md).
- Pod layout: [`pod-layout-2026-05-06.md`](pod-layout-2026-05-06.md).
- Privacy + identity model:
  [`privacy-and-safety-2026-05-05.md`](privacy-and-safety-2026-05-05.md).
- Web companion:
  [`v2-web-functional-design-2026-05-11.md`](v2-web-functional-design-2026-05-11.md).
- V3 current implementation:
  [`apps/stoop-mobile/`](../../apps/stoop-mobile/).
- folio-mobile (the working RN pattern to mirror):
  [`apps/folio-mobile/`](../../apps/folio-mobile/).
- Tasks-mobile (sibling RN):
  [`apps/tasks-mobile/`](../../apps/tasks-mobile/).
- RN platform layer:
  [`packages/react-native/`](../../packages/react-native/).
- iOS-out-of-scope:
  [main `README.md`](../../README.md#platform-support--ios-deliberately-out-of-scope-locked-2026-05-08).
- Layering convention:
  [`../conventions/architectural-layering.md`](../conventions/architectural-layering.md).
- Hub direction:
  [`../projects/README.md`](../projects/README.md).
