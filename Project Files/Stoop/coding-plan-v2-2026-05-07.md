# Stoop coding plan — V2 expansion (2026-05-07)

> Continues `coding-plan-v1-2026-05-05.md`. V1 (Phases 0–19) shipped
> the closed-beta-deployable buurt board; V1.5 (Phases 20–22) added
> Solid-pod integration, Web Push, and Layer-2 personal interest
> matching.
>
> **V2** (Phases 23–30, shipped 2026-05-07) turned Stoop from
> "single closed group" into "groups + a contact graph" without
> changing the data-stays-local-first principle.  New capabilities
> are summarised in the bumped functional design
> (`functional-design-2026-05-06.md` §§ 4e–4g + deltas on
> A/B/C/H/I).
>
> **V2.5** (Phases 31–38) is hardening: items deliberately deferred
> during V2 implementation, plus the device-specific-settings split
> that all apps must respect.  Section starts at "Phase 31+".
>
> **V3** (Phases 39+) is the mobile build (Expo, RN 0.76).
> Substrate boundaries are preserved throughout — no app imports
> from another app, and shared concepts get rule-of-two flags
> before extraction.

## Conventions

- **Code + JSDoc + design docs are written in English.**  UI strings
  are localised (`apps/stoop/locales/<lang>.json`); the Dutch domain
  terms `prikbord`, `actief / gepauzeerd / gearchiveerd` (per-skill
  status), and the `nl` keys in `skillsTaxonomy.json` are
  *intentional* domain vocabulary and stay.  Everything else —
  identifiers, comments, skill descriptions, doc bodies — is
  English.
- Settings that vary per device (poll cadence, online window, hop
  policy) live under a per-device blob; settings that follow the
  user (default share-location, broadcastable) live under a shared
  blob.  See Phase 33 for the shape.

## Phase order at a glance

```
V2 (shipped 2026-05-07)
─────────────────────────────
Phase 23  Profile photo + skills/holiday UI + Settings + pod-sync (warm-up)
   │
   ▼
Phase 24  ContactBook + trust + tags + lists + QR contact-share
   │
   ▼
Phase 25  Self-create groups + rotating membership code (two modes)
   │
   ▼
Phase 26  Geo: profile field + geocode skill + maxDistance grid-snap
   │
   ▼
Phase 27  Multi-target posts + sender→receiver filter chain + auto-skillmatch
   │
   ▼
Phase 28  UI: opt-in hop toggle (global + per-contact) + cadence settings
   │
   ▼
Phase 29  Pod-sync coverage for Reveals / settings / interest profile / push subs
   │
   ▼
Phase 30  Device restore (mnemonic → identity → pod → state)
   │
   ▼
V2.5 hardening (Phases 31–38)
─────────────────────────────
Phase 31  Mid-flight identity swap on restore
Phase 32  Deterministic stableId from mnemonic
Phase 33  Device-specific settings split (shared.json + devices/<id>.json)
Phase 34  CachingDataSource bulk-sync on attachInner
Phase 35  Auto-eviction enforcement in groupMirror
Phase 36  Real OIDC integration (CSS fixture)
Phase 37  Hub-side monitoring (Layer 1 substrate)
Phase 38  Capability manifest + per-app pod namespaces
   │
   ▼
later     Hobby-fork template (apps/stoop-hobby/)
   │
   ▼
V3 / 40+  Mobile (Expo, RN 0.76)
```

Total estimate for V2 (Phases 23-30): **~14-19 days** end-to-end (shipped).
V2.5 (Phases 31-39): **~14-19 days** (including Phase 39 picture attachments).
V3 mobile (Phase 40+): see [`v3-mobile-coding-plan-2026-05-08.md`](v3-mobile-coding-plan-2026-05-08.md).

## Phase 23 — Profile photo + skills/holiday UI + Settings + pod-sync

> **Why first:** smallest substrate-impact, biggest user-visible
> uplift, validates that the V2 plumbing (Settings as a first-class
> concept + cache→pod write-through for the new entities) holds
> water before the heavier phases.

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 23.1 | `MemberMap` already has `avatarUrl` slot — wire it end-to-end. New skills `setMyAvatarUrl({url})` / `clearMyAvatar()`. URL is a pod-relative path (`mem://stoop/avatars/<webid>.jpg` locally; `<pod>/stoop/avatars/<webid>.jpg` when synced). | `apps/stoop/src/skills/index.js`, `apps/stoop/test/phase23.test.js` | **App-local.** No core change. |
| 23.2 | UI: `/profile.html` gets an avatar uploader (HTML5 `<input type=file>` → `cache.write()` of the bytes). Renders next to handle on the prikbord (small round). | `apps/stoop/web/profile.html`, `apps/stoop/web/app.js` (new `renderAvatar(member)` helper) | **App-local.** |
| 23.3 | Skills UI on `/profile.html`: list of categories from `TAXONOMY`, per-skill checkbox, status dropdown (`actief` / `gepauzeerd` / `gearchiveerd`). `addMySkill` / `removeMySkill` already exist (Phase 11.5). | `apps/stoop/web/profile.html` | **App-local.** |
| 23.4 | Holiday-mode quick-toggle on `/profile.html` — single button "Vakantie aan / uit" that flips every active skill to `gepauzeerd` and back. Stored as `MemberMap.holidayMode` boolean for cross-device sync. | `apps/stoop/src/skills/index.js` (new `setHolidayMode({on})`), `apps/stoop/web/profile.html` | **Substrate additive (small):** `MemberMap` gains `holidayMode: bool` field. |
| 23.5 | New `/settings.html` page hosting the Phase 4g cadence + hop fields. Skills `getSettings` / `updateSettings({...})`. Settings live in a new `mem://stoop/settings.json` blob, write-through via the same `CachingDataSource`. | `apps/stoop/web/settings.html`, `apps/stoop/src/lib/Settings.js`, `apps/stoop/src/skills/index.js` | **App-local.** Composes existing primitives. |
| 23.6 | Pod-sync wiring for the new settings blob — when `bundle.cache.attachInner(podSource)` is called (Phase 20 path), the settings file flushes alongside everything else. Test: settings written offline → sign-in → blob lands at `<pod>/stoop/settings.json`. | reuse Phase 20 wiring | — |
| 23.7 | Tests: avatar round-trip, skills list mutates on `setMySkill`, `holidayMode` flips all active skills, `getSettings` returns defaults on cold-boot, settings persist across restart, settings flush to pod on attach. | `apps/stoop/test/phase23.test.js` | — |

**Acceptance:** add an avatar + 3 skills + flip vakantie + change
the cadence settings. Restart `stoop-ui` (with `persistPath`) →
everything is still there. Sign in to a pod → all four blobs
mirror to `<pod>/stoop/`.

**Estimate:** 2 dagen.

## Phase 24 — ContactBook + trust levels + tags + lists + QR-share

> Introduces the per-user contact graph (functional design § 4e).
> 1:1 contacts are NEW shape — not the same thing as group members.
> Tags + lists give the user free-form addressing on top of the
> two trust levels.

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 24.1 | New `apps/stoop/src/lib/ContactBook.js` — wraps `MemberMap` with a `relation: 'contact' \| 'group-member'` field. Methods: `addContact({webid, pubKey, handle})`, `setTrustLevel(webid, level)`, `setTags(webid, [...])`, `setShareLocation(webid, bool)`, `setAllowHopThrough(webid, bool)`, `removeContact(webid)`. Lists managed via `createList(name)`, `addToList(listId, webid)`, `removeFromList(listId, webid)`, `deleteList(listId)`, `getList(listId)`, `listLists()`. | `apps/stoop/src/lib/ContactBook.js` | **Substrate candidate `@canopy/contacts`** — flagged for rule-of-two extraction when a 2nd app needs trust-graded 1:1 contacts (likely the hobby-fork). Lives app-local for now. |
| 24.2 | `MemberMap` gains `relation` field and the per-contact flags (`trustLevel`, `tags`, `shareLocation`, `allowHopThrough`, `allowAutomatching`). Default for legacy entries: `relation: 'group-member'`, `trustLevel: null`. | `packages/identity-resolver/src/MemberMap.js` | **Substrate additive.** ~10 fields, all optional, fully back-compat. |
| 24.3 | New `mem://stoop/lists/<listId>.json` storage for `ContactList` entries. Listed via `dataSource.list('mem://stoop/lists/')`; written through CachingDataSource → pod. | `apps/stoop/src/lib/ContactBook.js` | **App-local.** Reuses same write-through pattern as MemberMapCache. |
| 24.4 | Skills surface: `addContact`, `removeContact`, `setContactTrust`, `setContactTags`, `setContactFlag` (per-contact share-location / hop / auto-match), `listContacts`, `createList`, `addToList`, `removeFromList`, `listLists`. | `apps/stoop/src/skills/index.js` | **App-local.** |
| 24.5 | QR contact-share: re-uses Phase 17's `getInviteQrPayload` shape but with scheme `stoop-contact://`. Skill `getContactShareQr({trustOffer: 'bekend'\|'vertrouwd'})` returns the payload. Companion `addContactFromQr({payload})` parses + adds. | `apps/stoop/src/skills/index.js`, `apps/stoop/test/phase24.test.js` | **App-local.** |
| 24.6 | Asymmetric-add notification — when Anna calls `addContact(bob, trustLevel: 'vertrouwd')`, an envelope is sent to Bob's agent with subtype `contact-add-request`; Bob's `wireChat`-equivalent surfaces it as a `kind: 'contact-request'` item; Bob has skills `acceptContactRequest` / `declineContactRequest`. | `apps/stoop/src/lib/ContactBook.js`, `apps/stoop/src/chat/wireChat.js` (new subtype) | **App-local.** |
| 24.7 | UI: `/contacts.html` — list with trust-level chips, tag chips, "Toevoegen" form (paste WebID + pubKey), "Toevoegen via QR" button (renders QR; second device scans). Per-contact detail page with the four flags + tags + lists. | `apps/stoop/web/contacts.html` | **App-local.** |
| 24.8 | Promote-from-group flow — group member list gets a "Toevoegen aan contacten" button (default trustLevel: `bekend`). | `apps/stoop/web/` (group member views) | **App-local.** |
| 24.9 | Tests: ContactBook CRUD; tags add/remove; lists create/destroy; pod-sync round-trip; asymmetric-add round-trip via two-bundle test. | `apps/stoop/test/phase24.test.js` | — |

**Acceptance:** Anna adds Bob via QR. Anna marks Bob `vertrouwd` +
tags `'koor'`. Anna creates a list `'Vrienden'` containing Bob.
Bob's agent receives a contact-request envelope; Bob accepts.
Both bundles' `ContactBook` entries reflect the relationship.
Restart → everything still there.

**Estimate:** 3 dagen.

## Phase 25 — Self-create groups + rotating membership code (two modes)

> Functional design § B7–B9. Adds `core.GroupManager` rotation
> primitives + the two distribution modes; UI exposes both.

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 25.1 | `core.GroupManager` gains `rotateGroupKey({groupId, mode, days})` — generates a new shared secret, signs it, records the rotation timestamp on the group config blob. New getter `getCurrentMembershipCode(groupId)`. Old codes remain decryptable for a 24h grace window. | `packages/core/src/identity/GroupManager.js` (additive), `packages/core/test/identity/GroupManager.rotation.test.js` | **SDK additive.** ~80 lines. Composes existing GroupManager primitives. |
| 25.2 | Group config schema gains `keyRotationMode: 'admin-only' \| 'peer-distributable'` and `rotationDays: number` (default 30). Picked at creation; stored on the pod under `<pod>/stoop/groups/<gid>/config.json`. | `apps/stoop/src/onboarding.js` (createGroup args), `Project Files/Stoop/pod-layout-2026-05-06.md` (update) | **App-local.** |
| 25.3 | New skill `createGroupV2({name, rules, keyRotationMode, rotationDays})` — replaces V1's `createGroup`. Existing `createGroup` deprecated; mapping keeps callers working. | `apps/stoop/src/skills/index.js` | **App-local.** |
| 25.4 | Skills: `rotateMyGroupKey({groupId})` (admin-only), `getCurrentMembershipCode({groupId})` (member access depends on mode — `peer-distributable` returns to anyone in the group; `admin-only` returns to admin/coordinator only). | `apps/stoop/src/skills/index.js` | **App-local.** |
| 25.5 | UI: `/create-group.html` gets the two-mode picker with the user-facing wording: *"Alleen admins delen de code uit"* / *"Iedereen mag de code doorgeven"* + the explanation paragraph. Existing wizard untouched. | `apps/stoop/web/create-group.html` | **App-local.** |
| 25.6 | UI: per-group page (new `/group.html?id=<gid>`) shows the current code with a "Tap to copy" button + when it expires + a 3-day-out soft warning. Admin-only sees the rotate button when the period is near. | `apps/stoop/web/group.html` | **App-local.** |
| 25.7 | Auto-eviction logic: agents drop membership artifacts whose code is more than `rotationDays + 1` old. Members who didn't get the new code stop being able to decrypt new posts (their wireChat / mirror filters them out). | `apps/stoop/src/groupMirror.js`, `apps/stoop/src/skills/index.js` | **App-local.** |
| 25.8 | Tests: rotate flow, two modes (only admin succeeds in `admin-only`; any member succeeds in `peer-distributable`), 24h grace window for old codes, eviction after `rotationDays + 1`. | `apps/stoop/test/phase25.test.js`, `packages/core/test/identity/GroupManager.rotation.test.js` | — |

**Acceptance:** Anna creates a `peer-distributable` group → gets
admin role. Bob redeems Anna's QR → joins. Anna calls
`rotateMyGroupKey` → new code returned. Bob calls
`getCurrentMembershipCode` → gets the new code. Charlie (no
existing membership) tries to join with the old code → rejected
after 24h grace.

**Estimate:** 3 dagen.

## Phase 26 — Geo: profile field + geocode skill + maxDistance grid-snap

> Functional design § A9 + § 4f distance grid. Gives V2 web a
> location story without GPS (the user types a place; Nominatim
> returns coords); V3 mobile binds GPS to the same shape.

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 26.1 | New `apps/stoop/src/lib/geo.js` — pure functions: `cellFor({lat, lng, gridM})`, `distanceKm(cellA, cellB)`, `snapToGrid(km)`. Cell encoding: `<gridM>:<row>:<col>` (geo-hash-shaped string). | `apps/stoop/src/lib/geo.js` | **Substrate candidate `@canopy/geo-grid`** — flagged for rule-of-two extraction when 2nd app needs distance filtering. App-local for now. |
| 26.2 | New skill `geocode({query})` — calls OpenStreetMap Nominatim (`https://nominatim.openstreetmap.org/search?q=…&format=json&limit=1`). Caches results in-process for the session. Returns `{cell, label, source: 'geocode', raw: {lat, lng}}`. Privacy-rate-limit: max 1 call/sec per User-Agent (Nominatim's policy). | `apps/stoop/src/skills/index.js` | **App-local.** Lazy-loaded `node:https`; no new deps. |
| 26.3 | Skills `setMyLocation({cell, label, source})` and `clearMyLocation()` — write to `MemberMap` entry's `location` field; auto-persist via cache. | `apps/stoop/src/skills/index.js` | **App-local.** |
| 26.4 | UI: `/profile.html` gets a "Locatie" section. Web: text input + "Zoek op kaart" button → calls `geocode` → preview *"Oosterpoort, Groningen — afgerond op 500m"* → confirm + save. Privacy notice rendered above the form. | `apps/stoop/web/profile.html` | **App-local.** |
| 26.5 | Mobile-shape preparation (V3 hook): the location-source `'gps'` path is documented in `geo.js` JSDoc; a stub `getCoarseLocationFromGps()` exists but throws *"V3 only"* on web. | `apps/stoop/src/lib/geo.js` | **App-local.** |
| 26.6 | Tests: cell encoding round-trips, `distanceKm` symmetric + commutative, `snapToGrid` returns presets, `geocode` skill stub-tested via `_setHttpFactory` seam (no real Nominatim call in tests). | `apps/stoop/test/phase26.test.js` | — |

**Acceptance:** type "Oosterpoort, Groningen" in `/profile.html` →
preview appears with rounded label → save → `MemberMap` entry has
`location: {cell, label, source: 'geocode'}`. Tests pass without
network access (stub).

**Estimate:** 2 dagen.

## Phase 27 — Multi-target posts + sender→receiver filter chain

> Functional design § 4f. Extends `SkillMatch.broadcast` to fan
> out across (groups ∪ contacts-by-trust ∪ tags ∪ lists), with
> sender-side and receiver-side filters.

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 27.1 | `Post.targets: Target[]` schema lands on `Item.source` for posts. `postRequest` accepts `{targets, maxDistanceKm}`. Back-compat: legacy callers without `targets` get `targets: [{kind: 'group', groupId: <activeGroup>}]` injected. | `apps/stoop/src/skills/index.js` | **App-local.** |
| 27.2 | `apps/stoop/src/lib/targetResolver.js` — pure function: `resolve(targets, {memberMap, contacts}) → Set<webid>`. Handles all four target kinds. Used by sender-side filter + receiver-side check. | `apps/stoop/src/lib/targetResolver.js` | **App-local.** |
| 27.3 | Sender-side filter: in `postRequest`, after item is stored, call `resolve(targets)` + drop recipients beyond `maxDistanceKm` (when their `MemberMap.location` is known) + drop muted. Build a per-recipient `agent.message` fan-out instead of a bare `skillMatch.broadcast` (broadcast still happens for group-target post). | `apps/stoop/src/skills/index.js` | **App-local.** |
| 27.4 | Receiver-side filter: extend `groupMirror.mirror()` (and the new direct-fan-out handler) to drop posts whose `targets` don't include me, posts beyond my `maxDistanceKm` (relative to my own location), and posts on `broadcastable: false`. Auto-skillmatch posts get an extra check via `scorePostRelevance` (Phase 22). | `apps/stoop/src/groupMirror.js` (or new `apps/stoop/src/contactFanout.js`) | **App-local.** |
| 27.5 | UI: `/index.html` post composer gets the multi-select target picker (groups + lists + tags + "Alle bekenden" / "Alle vertrouwden") + distance picker. Persists last choice per kind in `localStorage`. | `apps/stoop/web/index.html`, `apps/stoop/web/app.js` | **App-local.** |
| 27.6 | Post detail UI: shows the target list in plain Dutch (*"Vraag in Oosterpoort skills + Bekende contacten ≤ 5 km"*). | `apps/stoop/web/app.js` (renderItems extension) | **App-local.** |
| 27.7 | Auto-skillmatch on loose contacts (functional design § H4): a post arriving from a non-trusted contact only fires a notification when `scorePostRelevance({text, ...}).matched === true`. Otherwise: silent; post still on prikbord. | `apps/stoop/src/chat/wireChat.js` (or new module) | **App-local.** |
| 27.8 | Tests: targetResolver covers all 4 kinds; sender-side drops out-of-range; receiver-side drops muted; auto-skillmatch silences off-skill posts; back-compat (legacy postRequest still works). | `apps/stoop/test/phase27.test.js` | — |

**Acceptance:** Anna posts a vraag with `targets: [{kind: 'list',
listId: 'vrienden'}, {kind: 'contacts', minTrust: 'vertrouwd'}]`
+ `maxDistanceKm: 5`. Bob (in `vrienden` list, 3km away) sees it +
gets notification. Charlie (vertrouwd, 8km away) doesn't see it.
Dave (bekend, 1km away) doesn't see it.

**Estimate:** 3 dagen.

## Phase 28 — UI: hop toggle + cadence settings

> Functional design § 4g + § 4e hopping switch. The routing
> primitives all ship in `@canopy/core` (`enableSealedForwardFor`,
> `enableRelayForward`, `enableReachabilityOracle`, mesh-demo proves
> they work). Stoop only needs the UI surface.

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 28.1 | Skills `getHopMode` / `setHopMode({global: bool})`. Reads/writes the `Settings` blob from Phase 23.5. When `global: true`, `Agent.js` factory calls `agent.enableRelayForward({policy: 'authenticated'})`; when false, doesn't enable it (or calls `disableRelayForward()` if a recent toggle). | `apps/stoop/src/Agent.js`, `apps/stoop/src/skills/index.js` | **App-local.** Just plumbs core's existing hooks through Settings. |
| 28.2 | `/settings.html` renders the four cadence fields (`pollIntervalMs`, `onlineWindow`, `broadcastable`, `allowHopThrough`) with default values + plain-Dutch hints. Per-contact `allowHopThrough` lives on `/contacts.html` (Phase 24). | `apps/stoop/web/settings.html` | **App-local.** |
| 28.3 | Web honours `pollIntervalMs` in the prikbord refresh loop (replaces the hard-coded `mountLive` 2s). Web honours `broadcastable` in the auto-skillmatch path (Phase 27.7). `onlineWindow` is recorded but no-op on web (always-on). `allowHopThrough` (global) toggles Phase 28.1. | `apps/stoop/web/app.js`, `apps/stoop/src/Agent.js` | **App-local.** |
| 28.4 | Tests: settings round-trip; `setHopMode({global: true})` causes the bundle to enable forward; `setHopMode({global: false})` disables it; cadence value is read by mountLive. | `apps/stoop/test/phase28.test.js` | — |

**Acceptance:** flip global hop on in `/settings.html` → tail
log on the agent shows `enableRelayForward({policy: 'authenticated'})`.
Flip per-contact hop on `/contacts.html` for Bob → fan-out to
Bob via my hop is now allowed.

**Estimate:** 1 dag.

## Phase 29 — Pod-sync coverage for the V2 entities

> Functional design § I7. The CachingDataSource write-through path
> already syncs items + MemberMap + (via Phase 23.6) settings.
> What's still in-memory: Reveals, InterestProfile (Phase 22),
> push subscriptions (Phase 21). This phase wires them onto the
> same path so a pod attach pulls them back on a new device.

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 29.1 | `apps/stoop/src/lib/RevealsCache.js` — listens on `Reveals` events and write-throughs to `mem://stoop/reveals.json`. Mirrors `MemberMapCache`'s shape (rule-of-two trigger noted: extract into `@canopy/identity-resolver` if a 3rd consumer appears). | `apps/stoop/src/lib/RevealsCache.js`, `apps/stoop/src/Agent.js` (wire it) | **App-local.** Composes existing `CachingDataSource`. |
| 29.2 | `apps/stoop/src/lib/InterestProfileCache.js` — debounced (10 sec) write-through of the `InterestProfile` snapshot to `mem://stoop/interest-profile.json`. On bundle boot, load the snapshot back. | `apps/stoop/src/lib/InterestProfileCache.js`, `apps/stoop/src/Agent.js` | **App-local.** |
| 29.3 | `apps/stoop/src/lib/PushRegistryCache.js` — write-through of the `PushRegistry` snapshot to `mem://stoop/push-subscriptions.json` (per-webid, only for the local actor). | `apps/stoop/src/lib/PushRegistryCache.js`, `apps/stoop/src/Agent.js` | **App-local.** |
| 29.4 | Pod-attach test: write something into all three entities offline → call `bundle.cache.attachInner(podSource)` → verify the three blobs land on the pod. | `apps/stoop/test/phase29.test.js` | — |
| 29.5 | Cold-boot test: drop all three blobs into a fixture `mem://stoop/`, build a fresh bundle pointing `persistPath` at it → Reveals + InterestProfile + PushRegistry hydrate from the blobs on construction. | `apps/stoop/test/phase29.test.js` | — |

**Acceptance:** flip a reveal + drive 5 InterestProfile updates +
register a push subscription. Sign in to a pod → wait for queue
flush. On a *fresh* device with the same pod creds: bundle starts
with the same Reveals + InterestProfile snapshot + push sub
already in place.

**Estimate:** 2 dagen.

## Phase 30 — Device restore (mnemonic → identity → pod → state)

> Functional design § I8. Wires the recovery path: a user who
> loses their device can re-onboard on a new one with just their
> recovery phrase + pod credentials, and find everything they had.

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 30.1 | `apps/stoop/web/restore.html` — three-step flow: (1) enter mnemonic → `Bootstrap.fromMnemonic` validates → derive same `stableId`; (2) sign in to pod (reuses Phase 20 flow); (3) confirm restore → cache pulls `mem://stoop/*` paths back. | `apps/stoop/web/restore.html`, `apps/stoop/src/skills/index.js` (new `restoreFromMnemonic({mnemonic})`) | **App-local.** Composes shipped primitives. |
| 30.2 | `restoreFromMnemonic` skill: validates mnemonic → calls `core.Bootstrap.fromMnemonic` → swaps the bundle's identity (`bundle.agent.identity` → new instance). Existing skills continue to work because `from` flows from `LocalUiAuth.localActor` which gets re-bound to the restored WebID. | `apps/stoop/src/skills/index.js` | **App-local.** |
| 30.3 | Onboarding flow split: `/onboard.html` already handles invite redemption; `/restore.html` handles existing-account recovery. Top-level `/welcome.html` (new) lets a first-time visitor pick: "Nieuwe account" → mnemonic generated + shown once (Phase 17 path) / "Bestaande herstellen" → `/restore.html`. | `apps/stoop/web/welcome.html`, `apps/stoop/web/onboard.html` (link to restore) | **App-local.** |
| 30.4 | Cache pull-on-attach: `CachingDataSource.attachInner(pod)` already triggers `pullFromInner('mem://stoop/')` (Phase 4). Verify that with a populated pod + an empty local cache, the pull lands all blobs. | reuse Phase 4 + 20 wiring | — |
| 30.5 | Tests: restore from a pre-populated fixture pod + valid mnemonic → bundle ends up with the same items + members + reveals + interest + push subs as the original. Failure cases: invalid mnemonic, pod with no Stoop data, mismatched WebID. | `apps/stoop/test/phase30.test.js` | — |

**Acceptance:** Anna has been using Stoop for a month, has 12
posts, 4 contacts, 2 lists, a non-trivial InterestProfile, a push
subscription, and a Solid pod. Anna installs Stoop on a fresh
laptop. She enters her recovery phrase + signs into her pod. The
new bundle pulls everything; Anna sees her prikbord exactly as
before within ~10 seconds.

**Estimate:** 2 dagen.

## Later — Hobby-fork template

Out of scope for V2; on the TODO. Sketch:

| # | Task |
|---|---|
| L.1 | Rename / fork doc: how to copy `apps/stoop` → `apps/stoop-hobby`, what to swap (taxonomy.json, locales, mockup copy), what to keep (substrate composition). |
| L.2 | Generic-name the SDK-shaped helpers (e.g. `apps/stoop/src/lib/skillsMatch.js`'s prikbord-vocabulary) so a fork doesn't carry buurt-specific terms in the substrate boundary. |
| L.3 | Substrate extraction triggers fire here — `@canopy/contacts`, `@canopy/geo-grid`, `@canopy/online-cadence` all reach 2 consumers. |

No coding-plan tasks; just a doc deliverable when a hobby-app is requested.

## V3 / 40+ — Mobile (Expo, RN 0.76)

> **Renumbered 2026-05-08** (was Phase 39+; collided with V2.5
> Phase 39 picture attachments).
>
> The full V3 mobile plan moved to a dedicated doc:
> [`v3-mobile-coding-plan-2026-05-08.md`](v3-mobile-coding-plan-2026-05-08.md).
> Functional shape (what mobile does, journeys, locked decisions):
> [`v3-mobile-functional-design-2026-05-08.md`](v3-mobile-functional-design-2026-05-08.md).
>
> High-level outline preserved here for the dependency graph below:
>
> | Phase | Topic | Substrate-touch |
> |---|---|---|
> | 40.1 | `apps/stoop-mobile/` scaffold (mirrors folio-mobile). | **App-local.** |
> | 40.2 | Mobile-bootstrap substrate — lifts folio-mobile's `serviceFactory` pattern out. | **NEW** `@canopy/sync-engine-rn` or `@canopy/mobile-bootstrap`. |
> | 40.3 | OIDC-RN substrate — lifts folio-mobile's `OidcSessionRN` + `expo-auth-session` flow out. | **NEW** `@canopy/oidc-session-rn`. |
> | 40.4 | RN-side `FileSystemAdapter` for `CachingDataSource`. | **EXTEND** `@canopy/react-native`. |
> | 40.5 | Native picker glue for Phase 39 attachments (`expo-image-picker` + `expo-image-manipulator`). | **App-local.** |
> | 40.6 | `expo-camera` (built-in barcode scanning) for QR scan: invite + contacts. | **App-local.** |
> | 40.7 | `expo-location` GPS → `geo.js`'s `getCoarseLocationFromGps()`. | **App-local.** |
> | 40.8 | `expo-task-manager` background-fetch + active/background-aware cadence for `onlineWindow`. | **App-local.** |
> | 40.9 | `MobilePushBridge` wired to `notifier.PushChannel`. | reuses SDK. |
> | 40.10 | RN screens parallel to the web shell. | **App-local.** |
> | 40.11 | Deep-link handling for `stoop://...` URLs. | **App-local.** |
> | 40.12 | Real-device pass (Android primary; iOS noted as out-of-scope per project README). | — |

## Order + dependencies

```
                Phase 23  ───────┬─────────┐
                                 │         │
                Phase 24  ───────┤         │
                                 │         ▼
                Phase 25  ───────┤    (parallelisable)
                                 ▼
                Phase 26  ───────┐
                                 ▼
                Phase 27  ←── needs 24 (contacts) + 26 (geo)
                                 │
                                 ▼
                Phase 28  ←── needs 23 (settings)
                                 │
                                 ▼
                Phase 29  ───────┐
                                 ▼
                Phase 30  ←── needs 29 (full pod-sync)
                                 │
                                 ▼
                V2.5 (31–38)
                                 │
                                 ▼
                V3 / 39+
```

Phase 23-26 can roughly proceed in parallel by an organised
implementer; Phase 27 is the big integration point and needs both
the contact graph (Phase 24) and the geo grid (Phase 26) before it
runs. Phase 28-30 are more linear.

## Substrate candidates flagged in this plan

Three new substrate-extraction triggers, all **rule-of-two** (extract
on the second consumer; live app-local for now):

| Candidate | Trigger | Inventory entry |
|---|---|---|
| `@canopy/contacts` | 2nd app needs trust-graded 1:1 contacts (likely the hobby-fork). | Updated in `Project Files/Substrates/substrate-candidates.md` (Phase 24.1). |
| `@canopy/geo-grid` | 2nd app needs distance-filtering. | Same (Phase 26.1). |
| `@canopy/online-cadence` | 2nd app needs battery-aware time windows. | Same (Phase 28). |

The routing primitives (`enableRelayForward` /
`enableSealedForwardFor` / `enableReachabilityOracle` /
`enableTunnelForward`) **stay in `@canopy/core`** — already
substrate-shaped, mesh-demo demonstrates them at scale, and Stoop's
Phase 28 just toggles them.

## Phase 31+ — V2.5 hardening (deferred items, captured 2026-05-07)

Items deliberately deferred during V2 implementation.  Each is a
follow-up on something we shipped at "good enough for V2" and want
to harden before V3 mobile or a real public deployment.  No fixed
ordering — they're independent.

### Phase 31 — Mid-flight identity swap on restore

> Today's `restoreFromMnemonic` writes the mnemonic-derived seed
> into the vault and tells the user to restart the Stoop process.
> Acceptable for the V2 closed-beta; surprising in a polished UX.

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 31.1 | Add `Agent.swapIdentity(newIdentity)` to `core.Agent`: tear down current `transport.connect` + skill subscriptions, swap `#identity`, re-subscribe.  Equivalent to `Agent.rotateIdentity()` but starts from a supplied seed instead of generating one. | `packages/core/src/Agent.js` | **SDK additive** — composes existing `rotateIdentity` plumbing. |
| 31.2 | Stoop side: `restoreFromMnemonic` calls `agent.swapIdentity(...)` after writing the vault.  No restart needed.  `/restore.html` step 3 becomes a "ready — you're signed in" panel (no manual restart instruction). | `apps/stoop/src/skills/index.js`, `apps/stoop/web/restore.html` | **App-local.** |
| 31.3 | Group-mirror + skill-match peers re-bind to the new pubKey.  Most likely just calling `.start()` again is enough — verify. | `apps/stoop/src/Agent.js`, tests | — |
| 31.4 | Tests: swap-identity round-trip; existing chats / posts authored under the old identity still readable; new posts signed under new identity. | `apps/stoop/test/phase31.test.js` | — |

**Estimate:** 2 days.

### Phase 32 — Deterministic stableId from mnemonic

> Today the V2 restore path issues a *fresh* stableId on the new
> device.  That's wrong for a "restore = same person" UX: every
> mute / report / contact-cache entry keyed on stableId becomes
> stale across devices.

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 32.1 | Change `_loadOrInitStableId` in `core/identity/AgentIdentity.js`: when the vault has no stableId AND a `seed` is available, derive the stableId deterministically from the seed (`HKDF-SHA256(seed, salt='stoop-stableId-v1', info='', len=16)` → base64url).  Existing users with a random stableId in the vault keep theirs (back-compat).  New users + restored-from-mnemonic users get the deterministic id. | `packages/core/src/identity/AgentIdentity.js` | **SDK additive** — back-compat behaviour preserved for existing vaults. |
| 32.2 | Drop the `vault.delete('agent-stable-id')` step in `restoreFromMnemonic` — no longer needed once 32.1 lands. | `apps/stoop/src/skills/index.js` | **App-local.** |
| 32.3 | Tests: same mnemonic → same stableId on a fresh vault, on this run AND a separate process; old vaults with random ids unaffected; the restore flow surfaces the SAME stableId the user had on the original device. | `packages/core/test/identity/AgentIdentity.stableId.test.js`, `apps/stoop/test/phase32.test.js` | — |

**Estimate:** 1 day.  Locked-in design choice (HKDF salt is permanent — never change once shipped).

### Phase 33 — Device-specific settings split (cross-app convention)

> V2 stored everything in one `mem://stoop/settings.json` blob.
> That conflates two unrelated concerns:
> - **Device-specific** preferences (poll cadence, online window,
>   global hop policy, GPS-vs-geocode location source) — different
>   per machine; should NOT travel via the pod to other devices.
> - **User-portable** preferences (default share-location, default
>   broadcastable, holiday-mode signal) — follow the user across
>   every device.
>
> All future agent-SDK apps SHOULD adopt this split.  Documented in
> `pod-layout-2026-05-06.md` so the convention is visible.

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 33.1 | Generate a per-install `deviceId` (random UUID, persisted in vault under `agent-device-id`).  Lazy-init on first read.  Available as `bundle.deviceId`. | `packages/core/src/identity/AgentIdentity.js` (or new helper alongside) | **SDK additive.** |
| 33.2 | Split `apps/stoop/src/lib/Settings.js` into two layouts: `mem://stoop/settings/shared.json` (user-portable) + `mem://stoop/settings/devices/<deviceId>.json` (per-device).  `loadSettings({dataSource, deviceId})` reads both, returns a merged view.  `updateSettings({dataSource, deviceId, patch, scope: 'shared'\|'device'})` writes to the right blob.  Default scope inferred from the field set: device-known fields go to `device`; user-known fields go to `shared`. | `apps/stoop/src/lib/Settings.js` | **App-local.**  Substrate candidate `@canopy/online-cadence` flag updated to note this shape. |
| 33.3 | Migrate existing `mem://stoop/settings.json` blobs on first load: read the legacy blob, partition fields by their nature, write back as the two new blobs, delete the legacy blob.  Idempotent (skip when migration marker present). | `apps/stoop/src/lib/Settings.js` migration helper | — |
| 33.4 | Update `/settings.html`: section heading "Op dit apparaat" wraps device-only fields; "Mijn voorkeuren (synct met al je apparaten)" wraps shared fields.  Visual cue makes the difference obvious to the user. | `apps/stoop/web/settings.html` | — |
| 33.5 | Update the cross-app convention doc.  Pod-layout sketch:<br>`<pod>/<app>/settings/shared.json` — JSON object, user-portable.<br>`<pod>/<app>/settings/devices/<deviceId>.json` — JSON object, per-device.<br>Apps that don't need device-vs-shared keep just `shared.json`. | `Project Files/Stoop/pod-layout-2026-05-06.md` (rename / supersede with a pod-layout-conventions doc if appropriate) | — |
| 33.6 | Tests: shared scope writes go to `shared.json`; device scope writes go to `devices/<id>.json`; legacy migration round-trip; merged-view returns the combined object. | `apps/stoop/test/phase33.test.js` | — |

**Estimate:** 2 days.  This blocks Phase 34 (bulk-sync) only in the
sense that the migration step has to land first if both phases ship
the same week — otherwise independent.

### Phase 34 — `CachingDataSource.attachInner` bulk-sync of pre-attach local writes

> Today's `CachingDataSource.write` only enqueues for the inner
> when one is already attached.  Items written offline (no pod yet)
> stay local-only; signing in to a pod LATER doesn't migrate them.
> Phase 23.6 documented this as a known limitation.

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 34.1 | On `attachInner(pod)`, walk the local Map; for each entry that the inner doesn't have (lazy `pod.read` check, or just unconditional push for V2.5), enqueue a `write` op + flush.  Track sync progress (events: `bulk-sync-started`, `bulk-sync-progress`, `bulk-sync-finished`). | `apps/stoop/src/lib/CachingDataSource.js` | **App-local for now.**  Substrate candidate: when this lands, the `@canopy/local-store` extraction trigger flips on (rule-of-two with `apps/folio`'s sync-engine). |
| 34.2 | UI feedback in `/sign-in.html`: progress bar during attach (so the user knows their data is uploading). | `apps/stoop/web/sign-in.html` | — |
| 34.3 | Bulk-sync MUST respect Phase 33's split — device-only settings on machine A do not get pushed to a pod that other devices share. | `apps/stoop/src/lib/CachingDataSource.js` | — |
| 34.4 | Tests: write 5 items + Reveals + Settings offline; attach stub pod; assert 7+ paths land at the pod within the flush.  Verify device-only blobs do NOT cross-contaminate. | `apps/stoop/test/phase34.test.js` | — |

**Estimate:** 1.5 days.

### Phase 35 — Auto-eviction enforcement in `groupMirror`

> Phase 25.7 stopped at "report status via `getMyMembershipStatus`"
> — actual eviction (filter posts whose author's membership has
> expired) is a relay-side concern in V1+.  V2.5 brings it
> agent-side too so the closed-beta works without a relay.

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 35.1 | Maintain a per-bundle `evictionRoster: Map<webid, expiresAt>` derived from `kind: 'membership-redemption'` items.  Updated reactively when redemptions land. | `apps/stoop/src/groupMirror.js` (or new `apps/stoop/src/lib/EvictionRoster.js`) | **App-local.** |
| 35.2 | `groupMirror.mirror()` filters out posts whose `from` is in the eviction roster + past `expiresAt + GRACE_MS`.  Also filters silently in receiver-side `broadcast-post` handler. | `apps/stoop/src/groupMirror.js`, `apps/stoop/src/chat/wireChat.js` | — |
| 35.3 | UI banner on `/group.html`: "Member X's membership expired — their posts are hidden until they redeem the new code." | `apps/stoop/web/group.html` | — |
| 35.4 | Tests: post from member with expired redemption is dropped on receive. | `apps/stoop/test/phase35.test.js` | — |

**Estimate:** 1.5 days.

### Phase 36 — Real OIDC against a live Solid Pod (CSS fixture) — **DEFERRED 2026-05-07**

> **Status:** deferred indefinitely. Decision 2026-05-07: the
> Docker + CSS integration-test approach is too heavy for the
> value at this scale; existing stub-based tests remain the
> coverage of record. Reconsider if/when a Solid-server-specific
> bug actually bites in production. Phase numbering preserved so
> later phases keep their references.
>
> Phase 20 ships the OIDC flow against a stubbed Inrupt Session.
> V2.5 was originally going to bring up a real Community Solid Server
> (CSS) in CI + an integration test that completes the redirect
> dance.

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 36.1 | Add a CI helper script that boots CSS in a Docker container with a known account.  Document the manual run for local devs. | `apps/stoop/test/fixtures/css-server.js`, `apps/stoop/test/integration-pod.md` | — |
| 36.2 | Integration test: full `startPodSignIn` → user authenticates against CSS → `completePodSignIn` → cache.attachInner produces real reads/writes against CSS storage.  Skipped when CSS isn't running. | `apps/stoop/test/phase36-pod-integration.test.js` (skipped by default) | — |
| 36.3 | Bump the V2 `optionalDependencies` to a tested `@inrupt/solid-client-authn-node` version. | `apps/stoop/package.json` | — |

**Estimate:** 2-3 days.  Fragile (Docker, networking, CSS quirks).

### Phase 37 — Hub-side monitoring (Layer 1 substrate)

> Per the seed doc in
> [`../AgentHub/monitoring-design-2026-05-07.md`](../AgentHub/monitoring-design-2026-05-07.md).
> Layer 1 is the foundational event-stream substrate; Layers 2-4
> consume it.  Build L1 first; Stoop's `/audit.html` becomes its
> first consumer (Phase 18's `/metrics.html` is the precursor).

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 37.1 | Add an `auditEmit({kind, ...})` hook on `core.Agent`.  Every `skills.dispatch`, `transport.sendOneWay`, pod-write through CachingDataSource calls it.  Lazy: zero overhead when no listeners. | `packages/core/src/Agent.js`, `packages/core/src/storage/`, `packages/core/src/a2a/A2ATransport.js` | **SDK additive.** |
| 37.2 | Stoop side: `/audit.html` consumes `agent.on('audit', ...)` (via a polling skill or an SSE bridge through agent-ui).  Renders the event timeline + filters. | `apps/stoop/src/skills/index.js` (new `getAuditEvents` skill or live-stream variant), `apps/stoop/web/audit.html` | **App-local.** |
| 37.3 | Tests: every skill invocation produces an audit event of the right shape; lazy emission verified (no listener → no event objects). | `packages/core/test/Agent.audit.test.js`, `apps/stoop/test/phase37.test.js` | — |

**Estimate:** 3-4 days.  Cornerstone for the Hub + browser projects.

### Phase 39 — Picture attachments in posts and chat (V2.5)

> Decided 2026-05-07. Stoop posts and chat messages can include
> images. Privacy rule
> [`../projects/README.md`](../projects/README.md#personal-pod-urls-stay-out-of-peer-to-peer-messages--applies-to-every-agentic-project-here)
> applies: bytes ship in-message (resized client-side), no
> personal-pod URLs. Storage shape is "separate-blob with inline
> thumbnail" — the prikbord renders thumbnails immediately and
> fetches full bytes on demand.

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 39.1 | New `apps/stoop/src/lib/Attachments.js` — server-side helpers: validate metadata, write/read bytes from `CachingDataSource` at `mem://stoop/items/<itemId>/attachments/<attId>.<ext>`, build the broadcast-payload shape (metadata + thumbnail, no full bytes). | `apps/stoop/src/lib/Attachments.js` (new) | **App-local.** Substrate candidate when the 2nd app needs it. |
| 39.2 | Extend `postRequest` skill: accept `attachments: [{mime, dataB64, width, height, thumbnail, bytes}]`; server stores each blob, embeds metadata (without `dataB64`) in `source.attachments`, broadcast carries `payload.attachments` (thumbnail + metadata, no full bytes). | `apps/stoop/src/skills/index.js` | — |
| 39.3 | Extend `groupMirror.mirror()` + `wireChat.broadcast-post` handler: copy `payload.attachments` into the mirrored item's `source.attachments` (no `ref` field — recipient hasn't fetched bytes yet). | `apps/stoop/src/groupMirror.js`, `apps/stoop/src/chat/wireChat.js` | — |
| 39.4 | New `requestAttachment({itemId, attId})` skill: looks up item.source.fromPubKey, sends `subtype: 'attachment-request'` chat envelope to that pubKey; on `subtype: 'attachment-response'` receipt, writes bytes locally + updates item's attachment with a local `ref`. New chat subtypes wired in `wireChat`. | `apps/stoop/src/skills/index.js`, `apps/stoop/src/chat/wireChat.js` | — |
| 39.5 | Extend `sendChatMessage` skill: accept `attachment: {mime, dataB64, width, height, thumbnail, bytes}` (single inline attachment per message; tighter size cap than prikbord). On receive, recipient writes bytes to local cache + stores `ref` on the chat-message item. | `apps/stoop/src/skills/index.js`, `apps/stoop/src/chat/wireChat.js` | — |
| 39.6 | Browser-side resize helper `apps/stoop/web/lib/imageResize.js`: File → Image → canvas resize to max-edge → JPEG @ q=0.82 → produce {full bytes, thumbnail base64, width, height}. Defaults: prikbord 1280px+120px thumb, chat 800px+120px thumb. | `apps/stoop/web/lib/imageResize.js` (new) | — |
| 39.7 | Post-form picker UI (`<input type="file" accept="image/*" capture="environment" multiple>`, max 4) on `/`. Drives the resize helper, calls `postRequest` with attachment metadata. | `apps/stoop/web/index.html` | — |
| 39.8 | Feed renderer: render thumbnails from `source.attachments[*].thumbnail`. Click → modal that calls `requestAttachment` if no local `ref` yet, then renders the full image. | `apps/stoop/web/app.js` (renderItems), `apps/stoop/web/index.html` | — |
| 39.9 | Chat picker UI on `/chat.html`: single-image cap, lighter resize. Inline rendering on receive (already-fetched bytes; no fetch step needed). | `apps/stoop/web/chat.html`, `apps/stoop/web/app.js` | — |
| 39.10 | Locale keys for picker, modal, "loading…" states, error states. `{text, doc}` shape. | `apps/stoop/locales/{nl,en}.json` | — |
| 39.11 | Tests: postRequest with attachment writes the blob; mirror copies metadata; requestAttachment round-trips; sendChatMessage with attachment round-trips; groupMirror filters evicted-author attachments (Phase 35 interaction). Image-resize helper has its own browser-only test that's skipped in node. | `apps/stoop/test/phase39.test.js` (new) | — |

**Estimate:** 2-3 days. Mobile pickers are explicitly NOT in this
phase — folio-mobile / stoop-mobile is V3 territory. The skills
(39.1-39.5) are platform-agnostic; mobile picks them up unchanged
when V3 mobile lands.

**Non-goals:**

- URL-mode attachments (deferred until a shared / group-pod
  namespace exists; see the privacy rule).
- Server-side image processing / thumbnail regeneration. The
  client is authoritative; the server stores what it gets.
- Animated images / video (cap to still images for V1).

### Phase 38 — Capability-manifest + per-app pod namespaces

> Companion to the agent-SDK browser
> [`../AgentBrowser/design-2026-05-07.md`](../AgentBrowser/design-2026-05-07.md).
> Even before the browser exists, declaring a manifest + enforcing
> per-app pod paths is useful — it lets the user audit "what does
> Stoop want to do?" before granting access.

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 38.1 | New `apps/stoop/agent-app.json` declaring required capabilities: skill names, external hosts (Nominatim), pod path namespace (`mem://stoop/**`), no cookies. | `apps/stoop/agent-app.json` | — |
| 38.2 | `core.AgentApp.loadManifest()` helper + a runtime check at every external-fetch / pod-write that the path matches the declared namespace.  Violations log via the audit substrate (Phase 37). | `packages/core/src/AgentApp.js` (new) | **SDK additive.** |
| 38.3 | Stoop honours the manifest at runtime — `geocode` skill verifies the host is in `external-hosts`. | `apps/stoop/src/lib/geocode.js`, others | **App-local.** |
| 38.4 | Tests. | various | — |

**Estimate:** 2-3 days.

## V2.5 ordering (Phases 31–38)

```
Phase 32 (deterministic stableId)         ←── small SDK additive; foundation for 31
Phase 31 (mid-flight identity swap)       ←── needs 32 for stableId stability
Phase 33 (device-specific settings split) ←── cross-app convention; foundation for 34's care
Phase 34 (bulk-sync on attach)            ←── needs 33 to know which blobs to skip
Phase 35 (auto-eviction in groupMirror)   ←── independent
─── pause for Hub/browser project decisions ───
Phase 36 (real OIDC integration)          ←── DEFERRED 2026-05-07 (stub tests remain the coverage of record)
Phase 37 (audit substrate)                ←── enables Hub Layers 2-4
Phase 38 (capability manifest)            ←── needs Phase 37
```

V2.5 phases 31-35 are Stoop-internal hardening (1-2 days each) and
finish the V2 polish.  Phases 36-38 unblock the broader ecosystem
(Hub + browser projects) and have higher leverage but more setup
cost — sensible to pause for project-direction decisions before
diving in.

**Recommended sprint order:** 32 → 31 → 33 → 34 → 35 (one-at-a-time,
ship each with passing tests).  Estimated total: ~7-8 days.

## Reference

- Functional design (V2 sections 4e/4f/4g + delta's): [`functional-design-2026-05-06.md`](functional-design-2026-05-06.md)
- V1 + V1.5 coding plan: [`coding-plan-v1-2026-05-05.md`](coding-plan-v1-2026-05-05.md)
- Pod layout: [`pod-layout-2026-05-06.md`](pod-layout-2026-05-06.md)
- Substrate candidates: [`Project Files/Substrates/substrate-candidates.md`](../Substrates/substrate-candidates.md)
- Hub-monitoring seed: [`../AgentHub/monitoring-design-2026-05-07.md`](../AgentHub/monitoring-design-2026-05-07.md)
- Agent-SDK browser seed: [`../AgentBrowser/design-2026-05-07.md`](../AgentBrowser/design-2026-05-07.md)
