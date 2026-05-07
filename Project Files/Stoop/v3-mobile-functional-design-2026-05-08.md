# Stoop V3 — Mobile functional design (2026-05-08)

> What the phone version of Stoop *does* for a user, and how it
> differs from the desktop / web app. Companion to the V1 functional
> design ([`functional-design-2026-05-06.md`](functional-design-2026-05-06.md))
> — V3 mobile inherits everything in §2 of that doc unless this
> document explicitly overrides it.
>
> Phased implementation lives in
> [`v3-mobile-coding-plan-2026-05-08.md`](v3-mobile-coding-plan-2026-05-08.md).
> Privacy / identity model is unchanged from
> [`privacy-and-safety-2026-05-05.md`](privacy-and-safety-2026-05-05.md).
> Pod layout is unchanged from
> [`pod-layout-2026-05-06.md`](pod-layout-2026-05-06.md).

## 1. Pitch

Stoop on a phone is the same buurt-prikbord as the desktop, with
three things the phone unlocks: **carry your buurt with you**
(notifications when something matches your skills), **scan a QR to
join or add a contact** (no typing pod URLs), and **post a photo
straight from the camera** (the bicycle that needs fixing, the
plant cuttings on the windowsill). The phone version is **not** a
slimmed-down companion to a desktop — it's a peer install that
runs the full agent locally, talks to the same buurt-relay, and
shares no server-side state with the desktop other than via the
user's own Solid pod.

## 2. Scope locks

These are decided 2026-05-08 and shape the whole rest of the doc:

1. **Architecture:** native Expo / React Native, parallel to
   `apps/folio-mobile`. **Not** a PWA wrap, **not** a WebView
   shell. (Q1 → c.)
2. **Pod auth:** ships **local-only by default**. Pod sign-in lands
   in Phase 40.3 once the OIDC-RN substrate is extracted from
   folio-mobile. Mobile users who want pod sync wait for the same
   Inrupt-cleanup that affects every other app — V3 doesn't add
   another bespoke OIDC surface. (Q2 → ii via substrate.)
3. **Identity vault:** `@canopy/react-native`'s `KeychainVault`
   (canonical SDK piece) for the agent identity. Auxiliary OIDC
   tokens piggyback on the OIDC-RN substrate's storage when
   sign-in lands. (Q3.)
4. **Local persistence:** mixed — small data (settings,
   MemberMap entries, reveal state) on `AsyncStorageAdapter`;
   large data (item bytes, attachment blobs) on a **new**
   `FileSystemAdapter` extending `@canopy/react-native`. (Q4.)
5. **Bootstrap helper:** lifted from folio-mobile's `serviceFactory`
   pattern into a new `@canopy/sync-engine-rn` (or
   `@canopy/mobile-bootstrap`) substrate. Stoop V3 composes the
   substrate from day one. (Q5.)
6. **Hub:** the Hub is a **separate phone app**, not a desktop
   daemon (superseded direction 2026-05-08). V3 ships
   `standalone`; lite-mode deferred. The agent boundary stays clean
   enough for hub-attachment later.
7. **Background cadence:** lazy-on-background, aggressive-when-
   foreground. Phase 40.8 binds `expo-task-manager` for
   background-fetch; foreground polls at the user's setting.
   Push (when wired) is the primary wakeup path; background-fetch
   is the fallback. (Q7.)
8. **QR scan:** `expo-camera`'s built-in barcode scanning (newer
   single-dep path; not the legacy `expo-barcode-scanner`). (Q8.)
9. **Push:** Expo's push service via `MobilePushBridge` (already
   in `@canopy/react-native`). (Q9.)
10. **Deep links:** `stoop://...` URL scheme for V1 (invite +
    contact-share). Universal HTTPS links deferred. (Q10.)
11. **iOS:** **out of scope** for the project (locked in main
    [`README.md`](../../README.md#platform-support--ios-deliberately-out-of-scope-locked-2026-05-08)).
    Android-primary; the app may run on iOS via Expo, but no iOS
    code paths, tests, or release process.

## 3. What's the same as desktop

Every capability listed in
[`functional-design-2026-05-06.md`](functional-design-2026-05-06.md) §2
ships on mobile too, with the same skills and the same pod
shape:

- Identity + profile (handle, displayName, avatar, skills,
  holiday-mode, location).
- Group membership (codes rotate the same way, redemption is the
  same skill).
- Browse + post (prikbord with kind chips, broadcast via
  `skill-match`, mirror via `groupMirror`).
- Respond + coordinate (1:1 chat threads, claim flow, reveal
  handshake).
- Lend lifecycle.
- Contacts + lists (Phase 24 surface — mobile renders the same
  data, scans QR for invites + contact-add).
- Auto-eviction filter (Phase 35).
- Picture attachments in posts and chat (Phase 39 — bytes-in-message,
  separate-blob with thumbnail).
- All settings: shared (broadcastable, defaultShareLocation) and
  per-device (`onlineWindow`, `pollIntervalMs`, `allowHopThrough`)
  — the per-device settings start fresh on the mobile install per
  Phase 33's deviceId rule.

## 4. What's different on mobile

### 4a. Onboarding via QR

Desktop: paste an invite link into `/onboard.html?invite=...`.

Mobile: **tap "Scan QR" → scan the admin's QR**. The same
`?invite=...` payload encoded as a QR code. The redemption flow is
otherwise identical: privacy + house-rules gates, handle picker,
join.

The same scanner handles **contact-add QR** from the contacts
flow.

UX implication: the scanner needs to recognise three payload
shapes: invite (`{groupId, secret, ...}`), contact-share
(`stoop-contact://...`), and recovery code (12 / 24 BIP-39 words
encoded as text). The scanner UI shows a one-line hint about which
of the three it recognised before applying.

### 4b. Push notifications are the primary wakeup

Desktop: the page is open or it isn't.

Mobile: app may be in the background or not running at all. Web
Push (Phase 21) doesn't reach a backgrounded RN app. **Native
push via Expo's push service** is the V3 path.

Wakeup triggers (locked in skills already; mobile just consumes
them):

- New broadcast post in a joined group → push if the post matches
  my skills profile (Phase 22 / 27.7's `notifyWorthy` predicate).
- Inbound chat message on an existing thread.
- Inbound contact-add request.
- Membership-code-expiry warning (3 days before code rotation).
- Lend-due reminder (Phase 16 — wired via `notifier.scheduleBefore`).

Push payload carries enough metadata to render a useful
notification body without opening the app — but the body never
includes user-content beyond the post-author's handle + a one-line
preview. Pod URLs absent (per the project privacy rule).

### 4c. Background-fetch as fallback

When push is disabled or undelivered, `expo-task-manager` schedules
a background-fetch every X minutes (X comes from the user's
`onlineWindow.everyMinutes` device setting; default `null` → no
background fetch, push only).

The cadence is **active-state-aware**:

- **Foreground / active:** the agent connects to the relay and
  polls per the user's `pollIntervalMs` (default 2 seconds — same
  as desktop).
- **Background / inactive:** the agent disconnects, drains queues,
  and goes to sleep. `expo-task-manager` brings it back at the
  configured cadence, runs a single short-lived sync (target: 30 s
  online window), then sleeps again.

This split keeps the foreground experience real-time while the
background stays battery-friendly. Phase 40.8 implements it.

### 4d. Camera-first picture posting

Desktop: file picker → canvas resize.

Mobile: `expo-image-picker` opens directly to the camera by
default ("Take a photo" before "Choose from gallery"). The post
form's primary CTA on the post-form screen is "📷 Photo" rather
than "Browse files."

Resize via `expo-image-manipulator` matches the web side's
PRIKBORD_PRESET (max-edge 1280px, JPEG q=0.82, paired ~120px
thumbnail). Uses the existing Phase 39 skills unchanged
(`postRequest({attachments: [...]})`,
`requestAttachment({itemId, attId})`,
`getAttachmentDataUrl({itemId, attId})`).

Chat picker: same flow, `CHAT_PRESET` (max-edge 800px), single
image per message.

### 4e. Location via GPS, not place-name geocoding

Desktop: type "Oosterpoort, Groningen" → Nominatim returns coords
→ snap to 500m grid.

Mobile: tap "Use my location" → `expo-location` returns coords →
snap to 500m grid. The `getCoarseLocationFromGps()` shape is
already stubbed in `apps/stoop/src/lib/geo.js` — Phase 40.7 fills
it in.

Place-name search is **also** offered on mobile (typed query →
Nominatim) for the user who wants to set a different reference
location than where they currently are.

### 4f. Local-magic discovery (mDNS + BLE)

Desktop: web app has no peer-discovery; relies on the relay.

Mobile: `MdnsTransport` + `BleTransport` (already shipped in
`@canopy/react-native`) discover peers on the same Wi-Fi /
nearby. `createMeshAgent` wires them as preferred transports
behind relay. This is the "5 mensen in de buurt" capability from
the original brainstorm — works on mobile, doesn't on web.

Permission UX: the app explains *why* it asks for BLE / location
(needed for BLE on Android) up-front, with an opt-out that keeps
the user on relay-only. `requestMeshPermissions` from the SDK
handles the OS prompts.

### 4g. Settings split on mobile

Per Phase 33, mobile has its own deviceId and writes its own
`devices/<deviceId>.json` to the user's pod (when signed in).
Mobile-relevant fields:

- `pollIntervalMs` — foreground refresh cadence. Mobile default:
  **5000 ms** (vs desktop's 2000 ms; battery-aware).
- `onlineWindow` — `{everyMinutes, durationSec}` for background-
  fetch. Default: `{ everyMinutes: null, durationSec: null }` (no
  background fetch; push only).
- `allowHopThrough` — same semantics as desktop. Default off.

Shared (synced to all of the user's installs via the pod):

- `broadcastable`, `defaultShareLocation` — same semantics, mobile
  reads them on first run after sign-in.

The `/settings.html` web equivalent on mobile is a Settings screen
with the same two-sectioned layout from Phase 33.4 ("Op dit
apparaat" / "Mijn voorkeuren").

### 4h. Recovery phrase + cross-device identity

The mnemonic-restore flow (Phase 31's mid-flight identity swap)
is what makes mobile + desktop feel like one person. On a fresh
mobile install:

- "I'm new" → onboarding via QR + handle picker (creates a fresh
  identity).
- "I have a recovery phrase" → enter the 12 / 24 words → the
  identity swaps mid-flight, contacts and mute lists follow you
  (same `stableId` via Phase 32's HKDF derivation).

The mobile install gets a **fresh `deviceId`** even when the
mnemonic matches — Phase 33.1 explicit. Per-device settings start
from defaults; shared settings (after pod sign-in lands) seed
from the pod's `shared.json`.

## 5. User journeys (the seven flows from V1, re-cast on a phone)

### Journey 1 — First run, joining a group

1. Install Stoop (Android primarily; iOS untested).
2. Welcome screen: "New" / "Restore" / "I have a QR code."
3. **"I have a QR code"** → opens scanner directly.
4. Scan invite QR → privacy + house-rules gates → handle picker
   → join.
5. Sees the prikbord. Empty (just joined). Push permission asked
   (with explanation).
6. Optional: "Save your recovery phrase" prompt (one tap to
   navigate to Profile → Recovery).

Compared to desktop: no manual paste-link step; no "open in browser"
hop. ~15 seconds from cold install to first prikbord view.

### Journey 2 — Posting a vraag (with photo)

1. Tap floating "+" button on prikbord → post form.
2. Pick kind (ask / offer / lend) — radio chips.
3. Type the question.
4. Tap "📷 Photo" → camera opens → take photo → preview.
5. (Optional) Add up to 3 more photos.
6. Tap "Post" → resize runs (~1 s for 4 photos at 1280px) →
   `postRequest` ships → broadcast goes out.
7. Returns to prikbord with the new post pinned at top.

Compared to desktop: camera-first flow; resize is the user-visible
delay; everything else identical.

### Journey 3 — Responding to someone else (with a chat photo)

1. Push notification: "@oosterpoort-vogel-12 zoekt iemand met
   gereedschap voor fietsen."
2. Tap notification → app opens directly to that post.
3. Tap "Ik help" → chat thread opens.
4. Type a reply, tap 📷, take a photo of "the wrench I have" → send.
5. Counterparty receives push → opens chat → sees photo + text.

The full bytes ship inline in the chat envelope (Phase 39 chat
shape). Both sides store a local copy on receive.

### Journey 4 — Bilateral reveal of real names

1. In a chat thread, tap "Connect" button → confirmation prompt
   ("This shares your real name with @vogel-12; they'll see a
   prompt to do the same.").
2. `requestReveal` ships.
3. Counterparty's app: notification → tap → sees the prompt → can
   accept (mutual reveal) or decline.

Identical skill flow as desktop; mobile just has a button instead
of a menu item.

### Journey 5 — Lend lifecycle

1. Anne posts "Te leen — ladder t/m vrijdag" with a photo.
2. Bob taps "Ik wil dit lenen" → claim recorded.
3. Friday morning, both get a push: "Ladder weer terug bij Anne
   vandaag."
4. Bob taps "Teruggebracht" → item marked complete.

The Phase 16 `notifier.scheduleBefore` already drives the reminder.
Mobile renders it as a push instead of a web banner.

### Journey 6 — Group create + admin work

Mobile **does** support group-create (the `/create-group.html`
equivalent). The 6-question wizard renders as a multi-step form.
Membership-code rotation works the same — admins generate, share
out-of-band, members redeem.

The QR shown for an invite is rendered with a barcode library on
mobile (TBD — `react-native-qrcode-svg` is the Expo-friendly choice
unless we lift to a substrate too).

### Journey 7 — Mute / report / leave

Same skills as desktop (`muteContact`, `reportItem`,
`leaveGroup`); mobile renders them in a long-press contextual menu
on a post or in a contact card.

## 6. Screens

V3 ships these screens (parallel to web pages; per
[`v3-mobile-coding-plan-2026-05-08.md`](v3-mobile-coding-plan-2026-05-08.md) Phase 40.10):

| Screen | Web equivalent | Notes |
|---|---|---|
| Welcome | `/welcome.html` | New / Restore / Scan QR |
| Onboard (Scan) | `/onboard.html` | Camera-first; falls back to paste |
| Onboard (Restore) | `/restore.html` | Mnemonic input; mid-flight swap |
| Prikbord (Feed) | `/index.html` | Pull-to-refresh + filter chips + FAB-post |
| Post compose | (post-form section of /) | Camera-first; multi-photo |
| Item detail | (modal in /) | Full-screen photo modal |
| Chat threads | `/chat.html` (list) | List view |
| Chat thread | `/chat.html?thread=…` | Inline photo, reveal CTA |
| My posts | `/mine.html` | Own posts + claim management |
| Contacts | `/contacts.html` | List + add via QR / manual |
| Profile (mine) | `/profile.html` | Avatar + handle + skills + holiday + location + recovery |
| Profile (other) | (modal in /) | Read-only view of another member |
| Group | `/group.html` | Code visibility (admin only) + redeem + eviction banner |
| Settings | `/settings.html` | Two-sectioned (per-device / shared) |
| Sign-in (Pod) | `/sign-in.html` | Lands Phase 40.3; placeholder until then |
| Push | `/push.html` | Push opt-in + test |
| Privacy | `/privacy.html` | Same notice |
| Metrics | `/metrics.html` | Optional (admin / debug only on mobile) |
| Onboard (Issue) | `/onboard.html` (issue mode) | Admin generates QR, shows it for someone to scan |

## 6a. Implementation status (2026-05-08 audit)

> The original Phases 40.1–40.13 (in
> [`v3-mobile-coding-plan-2026-05-08.md`](v3-mobile-coding-plan-2026-05-08.md))
> shipped the screen *shells* but deferred the agent bring-up that
> connects them to the SDK. Every screen takes data + callbacks via
> props; nothing supplies those props yet. The user-visible effect is
> that the app navigates fine but no button does anything.
>
> The plan was always to wire the agent in afterwards (folio-mobile
> uses the same pattern via its `ServiceContext`), but it didn't get
> a phase number. This audit fixes that — Phases 40.14-40.24 in the
> coding plan pick up the bring-up + the gaps documented below.

### Per-screen coverage

UI shell quality is high; agent wiring is uniformly missing. Specific
sub-flows that need additional UI are in **bold**.

| Screen | UI shell | Agent wiring | Notable sub-flows still missing |
|---|---|---|---|
| Welcome              | ✅ | n/a — pre-agent  | — |
| Onboard (Scan)       | ✅ | ❌ — `redeemInviteWithGate` not wired; QR classifier OK | Privacy + house-rules gates after redeem |
| Onboard (Restore)    | ✅ | ❌ — `restoreFromMnemonic` + `validateMnemonicPhrase` not wired | Post-restore identity-confirmation step |
| Onboard (Issue)      | ✅ | ❌ — `getInviteQrPayload` not wired | Token expiry refresh |
| Prikbord (Feed)      | 🟡 | ❌ — `listOpen` doesn't populate items | **Distance filter + group filter chips**; pull-to-refresh hooked but no-op |
| Post compose         | 🟡 | ❌ — `postRequest` not wired | **Distance max-km slider; group multi-select; audience picker (which contacts beyond groups); hide-name option; expiry picker** |
| Item detail          | 🟡 | ❌ — `respondToItem`, `cancelRequest` not wired | **Claim list + accept/reject inline**; reveal-status indicator |
| Chat threads         | 🟡 | ❌ — `listChatThreads` not wired | — |
| Chat thread          | 🟡 | ❌ — `sendChatMessage`, `requestReveal` not wired | **Reveal handshake** (CTA exists but unwired); typing-indicator |
| My posts             | 🟡 | ❌ — `cancelRequest`, `acceptResponder` not wired | Claim-state machine UI |
| Contacts             | 🟡 | ❌ — `listContacts`, `addContact`, `removeContact` not wired | **Incoming-contact-request approval list**; **trust-level picker (bekend / vertrouwd) per contact**; **per-contact flag toggles (shareLocation, hopThrough, autoMatch)**; **contact-list management (create / rename / delete + drag-into-list)** |
| Contact detail       | 🟡 | ❌ — `setContactTrust`, `setContactFlag`, `setContactTags` not wired | **Trust-level + flags UI**; tags input |
| Profile (mine)       | 🟡 | ❌ — `setMyHandle`, `setMyProfile`, `setMyAvatarUrl`, `addMySkill`, `removeMySkill`, `setHolidayMode` not wired | **Avatar picker + clear**; **location via GPS button** + place-name search + clear; **skills add/remove (multi-select with categories)**; **recovery phrase show / regenerate** |
| Profile (other)      | 🟡 | ❌ — read of remote profile not wired | — |
| Group                | 🟡 | ❌ — `getGroup`, `rotateMyGroupCode`, `getCurrentMembershipCode`, `leaveGroup` not wired | **Member list + per-member role chips (admin / coordinator / member)**; **rotate code + display next-rotation hint**; **list evicted members + reinvite**; edit-rules sub-screen |
| **Create group**     | ❌ | ❌ — `createGroupWithRules` not wired | **Entire screen missing** — 6-question wizard equivalent of `/create-group.html` |
| Settings             | 🟡 | ❌ — `updateSettings` not wired | **`onlineWindow.everyMinutes` + `durationSec`**; **`allowHopThrough`**; **`broadcastable`** (shared); **`defaultShareLocation`** (shared); **export-my-data** action |
| Sign-in (Pod)        | 🟡 | ❌ — `useSignInHook` not bound; OIDC flow not driven | **Bulk-sync progress** (auth-callback.html equivalent — separate screen needed) |
| Push                 | 🟡 | ❌ — `subscribeWebPush` / token-ship not wired | **Test-push button**; subscription status pull-from-relay |
| Privacy              | ✅ | static — no agent needed | mobile-only sections (camera/location/BLE rationale recap) |
| Metrics              | 🟡 | ❌ — `getMetrics` not wired | — |
| **Auth callback**    | ❌ | ❌ | **Entire screen missing** — bulk-sync progress polling after pod sign-in |
| **Skill-match inbox**| ❌ | ❌ — `skill-match` substrate exists | **Entire screen missing** — auto-match suggestion stream + privacy-aware notify |

### Cross-cutting gaps

1. **No `ServiceContext`** — there's no agent bring-up at all. Screens
   render but receive no data and have no skill dispatcher.
   `apps/folio-mobile/src/ServiceContext.js` is the canonical pattern;
   Stoop V3 needs its own.
2. **No `useSkill` hook** — even if the agent existed, the screens have
   no documented way to invoke skills with loading / error states.
3. **No `bundle.cache` writes** — `FileSystemAdapter` lands in 40.4 but
   nothing persists to it yet. Photos taken in compose are lost on
   close.
4. **AppState bridge unwired** — `lib/activeCadence.js` is built but
   never gets attached to a live `bundle.cache.setOnline(...)`.
5. **Background-fetch task not registered** — `lib/bgRunOnce.js` is a
   stub; the OS-level `expo-task-manager` registration is missing.
6. **Push not subscribed** — `lib/push.js` defines `setupPush` and
   `requestPushPermission` but the screen doesn't drive them and the
   token never reaches the relay.
7. **Locale parity on freshly-mobile keys** — `mobile.*` is in the
   bundles, plus `welcome.*`, `onboard_*`, `tabs.*`, `feed.kind_*`,
   `compose.kind_*` — but there are still hard-coded strings in
   sub-components flagged by the audit (PlaceholderScreen, some
   button labels).

## 6b. Brainstorm features past V1 web

The user's "next-phase" brainstorm (
[`projects/02-neighborhood-app/README.md`](../projects/02-neighborhood-app/README.md)
or wherever it lands) added requirements that aren't on the desktop
either — they're net-new design work that needs a home in the plan:

| Brainstorm requirement | Status | Notes |
|---|---|---|
| **Trust level (bekend / vertrouwd) per contact** | SDK has it (Phase 24); no mobile UI | Picker on ContactScreen + per-flag toggles |
| **Distance sharing only with trusted contacts** | SDK has `flag_share_location`; not in mobile UI | Per-contact toggle on ContactScreen |
| **Post: max distance + group multi-select + audience picker** | Partially in SDK (`postRequest` accepts targets); compose UI omits | New compose-screen sub-controls (distance slider, group multi-select, audience selector by openness level) |
| **Anyone can create a group + share via QR + auto-admin** | SDK has `createGroupWithRules`; no mobile screen | New CreateGroupScreen — multi-step like `/create-group.html` |
| **Mede-admin / coordinator roles** | Partial in SDK; UI missing | New role chip + assign-role sub-flow on GroupScreen |
| **Rotating group key (30 d, external channel)** | Phase 35 evict-on-expiry exists; rotation cadence + external-channel UX is **new design work** | Needs a separate sketch + skill — see §11 below |
| **Avatar upload from camera/library** | SDK has `setMyAvatarUrl`; mobile UI exists, unwired | Wires up in Phase 40.15 |
| **Skills + holiday-mode in profile** | SDK has it; mobile UI exists, unwired | Wires up in Phase 40.15 |
| **Profile sync with Solid pod (and test it)** | Substrate ready (`oidc-session-rn`); not wired in app | Wires up in Phase 40.19 |
| **Hop-relay through-me toggle (battery-aware)** | SDK has `allowHopThrough`; mobile UI omits | New row on SettingsScreen — Phase 40.19 |
| **Time-window relay polling (`onlineWindow.{everyMinutes,durationSec}`)** | SDK has it; mobile UI omits | Two number inputs on SettingsScreen — Phase 40.19 |
| **Posts outside groups, audience by trust level** | Partial in SDK (per-contact flags); audience picker UI missing | New audience picker on PostCompose — Phase 40.16 |
| **Auto-skillmatch broadcasts to non-contacts (privacy-aware)** | `skill-match` substrate exists; client-side privacy gate + notify UX is **new design** | New SkillMatchInbox screen + per-receive privacy gate — Phase 40.20 |
| **Rotating addresses + metadata-public warning** | Privacy concern; partial in SDK (`AddressRotation` ?) | **New design** — see §11 below |
| **Activities / hobbies variant of the app** | Future product fork | Out of scope for V3; tracked separately |



Stoop V3 mobile reuses `apps/stoop/locales/{nl,en}.json`. The
locale resolver becomes a small RN-friendly module — no DOM
walker needed (no `data-i18n` attributes to resolve), just `t(key,
fallback)`. Existing `{text, doc}` shape keeps working through the
same `_lookupKey` unwrap.

Locale files are **shared** between web and mobile — same keys,
same translator-context notes. Mobile-only strings (camera
permission rationale, push permission rationale, "Tap to scan",
"Take a photo" CTA) get added under a new `mobile.*` section
following the same `{text, doc}` rule.

## 8. Open questions (deferred to coding-plan time)

These are decisions where I don't yet have enough info to lock —
they're tracked in the coding plan, not here:

- **QR rendering library on mobile.** `react-native-qrcode-svg` vs.
  `react-native-svg` + a hand-roll. Picked at Phase 40.6.
- **Photo viewer UX.** Single image: just modal. Multi-image:
  swipeable carousel? Standard Expo gallery component? Picked at
  Phase 40.10.
- **Onboarding photo + camera permission rationale copy.** Need the
  buurt-tone Dutch + English; written when Phase 40.6 lands.
- **Background-fetch quota / OS limits.** Android Doze + iOS
  background-fetch limits constrain how often we can wake. Phase
  40.8 measures + tunes; doc updates with findings.
- **Mobile-specific privacy notice changes.** Phase 4i of V1
  privacy may need a "this app sees your location, camera, mic
  (no), contacts (no)" addendum specifically for the app-store
  listing. Track separately when listing prep happens.

## 8a. Open design questions surfaced by the 2026-05-08 audit

These are net-new design questions, separate from the Phase-time
decisions in §8. They block the Phase 40.20 + 40.22 work.

1. **Rotating group keys (30-day cadence, external channel).**
   The brainstorm asks: admins generate a fresh key every N days,
   distribute it through an out-of-band channel (WhatsApp group,
   physical handover). Members who don't get the new key auto-evict.
   Open: (a) what's the SDK skill set — `rotateGroupSecret`,
   `redeemGroupSecret`? (b) does the user pick the cadence per group,
   or is it a project-wide constant? (c) what's the UX when the
   user misses a rotation — silent eviction, or a warning push N
   days in advance? Phase 35 already auto-evicts on expiry; the
   missing piece is the periodic-rotation cadence + the external-
   channel flow.

2. **Rotating identity addresses.** The brainstorm asks for "rotating
   addresses" as a metadata-privacy measure on the relay. The agent
   currently uses a long-lived `pubKey` as its address. Open:
   (a) does the address rotate per-session, per-day, per-message?
   (b) how do contacts re-discover the user after a rotation —
   pubsub-of-rendezvous-keys? a directory in the user's pod?
   (c) what's the metadata trade-off — full anonymity-set rotation
   is heavy. Needs a separate design sketch before implementation.

3. **Auto-skill-match privacy gate.** The brainstorm asks: a user's
   request gets broadcast to the wider connection list (groups +
   hop-discovered + contacts), the receiving agent first checks
   internally if it matches the user's skills, and only notifies
   the user on a match. Open: (a) what's the privacy guarantee for
   the requester — does the receiver's agent reveal the request to
   the user even on a no-match? (b) what's the rate-limit per
   sender per receiver (don't spam)? (c) does the notification
   require the receiver to opt-in per-sender or globally? The
   Phase 22 `notifyWorthy` predicate is a starting point — needs
   extension for the broader audience.

4. **Audience picker UX.** What's the right control on a phone for
   "post to: my groups [G1, G2] + my trusted contacts"? A multi-
   select chip row scales poorly past ~5 audiences. Considered:
   audience-templates (e.g. "all my groups", "trusted only",
   "everyone in 5 km"). Pick the simplest approach that covers the
   user's brainstorm; iterate from real use.

5. **Pod attach / detach UX.** Sign-in lands in Phase 40.19; the
   bulk-sync progress (`/auth-callback.html` equivalent) needs a
   mobile design — modal? full-screen? cancellable?

## 9. Non-goals

- **iOS-specific code paths** (locked in main README).
- **Lite mode / hub-attached** (deferred until Hub-on-phone ships).
- **Voice posts / video** (V4 territory).
- **Offline-first migration of the WHOLE web shell** to RN —
  mobile is a parallel implementation, not a port.
- **Capacitor / Tauri / other RN alternatives** — Expo is the
  picked path, single-runtime is a feature.

## 10. Coverage-pass phases (40.14 — 40.24)

Phases 40.1–40.13 shipped UI + scaffolding. The 2026-05-08 audit
(§ 6a, § 6b above) re-scoped what's left into ten new phases driven
by feature-completeness:

| Phase | Theme | Estimate |
|---|---|---|
| 40.14 | ServiceContext + agent bring-up + `useSkill` hook | 2 d |
| 40.15 | Profile + identity wiring (avatar / skills / holiday / location / recovery) | 1.5 d |
| 40.16 | Posts + items wiring (Feed / Compose / Detail / Mine) + new compose-controls (distance / groups / audience) | 2 d |
| 40.17 | Chat + reveal handshake wiring (threads list, photos, request-reveal flow) | 1.5 d |
| 40.18 | Contacts + groups wiring + new screens (CreateGroup, ContactRequests, role mgmt) | 2.5 d |
| 40.19 | Settings + push + sign-in wiring (full Settings + AuthCallback bulk-sync) | 1.5 d |
| 40.20 | Skill-match suggestion inbox + privacy-aware notify | 1.5 d |
| 40.21 | AppState bridge + background-fetch task registration | 0.5 d |
| 40.22 | Privacy/safety polish (rotating addresses + metadata warning + trust enforcement) | needs design first |
| 40.23 | Real-device pass + closed-beta build (was 40.12) | 1-2 d |
| 40.24 | Documentation + handoff (was 40.13) | 0.5 d |

Total ~15 days of focused work past the existing scaffolding. Phase
40.22 is design-blocked on the open questions in § 8a. The
authoritative phase plan with task tables lives in
[`v3-mobile-coding-plan-2026-05-08.md`](v3-mobile-coding-plan-2026-05-08.md).

## 11. References

- V1 functional design: [`functional-design-2026-05-06.md`](functional-design-2026-05-06.md).
- V2.5 phases (the substrate work mobile inherits): [`coding-plan-v2-2026-05-07.md`](coding-plan-v2-2026-05-07.md).
- Pod layout: [`pod-layout-2026-05-06.md`](pod-layout-2026-05-06.md).
- Privacy + identity model: [`privacy-and-safety-2026-05-05.md`](privacy-and-safety-2026-05-05.md).
- folio-mobile (the working RN pattern to mirror): [`apps/folio-mobile/`](../../apps/folio-mobile/).
- RN platform layer: [`packages/react-native/`](../../packages/react-native/).
- Mobile-substrates rule: [`../conventions/architectural-layering.md`](../conventions/architectural-layering.md#mobile-substrates-live-in-their-own-packages-locked-2026-05-08).
- iOS-out-of-scope: [main `README.md`](../../README.md#platform-support--ios-deliberately-out-of-scope-locked-2026-05-08).
- Hub-on-phone direction: [`../projects/README.md`](../projects/README.md#agent-hub-compatibility--applies-to-every-agentic-project-here) (2026-05-08 update).
