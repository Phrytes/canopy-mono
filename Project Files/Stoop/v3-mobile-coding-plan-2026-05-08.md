# Stoop V3 mobile — coding plan (2026-05-08)

> Phase-by-phase build of `apps/stoop-mobile`. Companion to the
> functional design ([`v3-mobile-functional-design-2026-05-08.md`](v3-mobile-functional-design-2026-05-08.md)).
> Numbered Phase 40+ to avoid the V2.5 collision (Phase 39 is
> picture attachments, already shipped).
>
> This plan extracts two new RN-specific substrates as part of the
> work — both because Stoop V3 is the rule-of-two consumer of
> patterns that already exist app-locally in folio-mobile.

## Scope locks (carried from the functional design)

1. Native Expo / RN, Android-primary. iOS out of scope per main
   `README.md`.
2. Local-only by default; pod sign-in lands at Phase 40.3 once
   the OIDC-RN substrate exists.
3. `KeychainVault` for the agent identity; `AsyncStorageAdapter`
   + new `FileSystemAdapter` for cache.
4. Mobile substrates separated from cross-platform substrates per
   [`../conventions/architectural-layering.md`](../conventions/architectural-layering.md#mobile-substrates-live-in-their-own-packages-locked-2026-05-08).
5. `standalone` attachment model; Hub-attached mode deferred.
6. Lazy-on-background, aggressive-when-foreground cadence.
7. `expo-camera` (built-in barcode), Expo push, `stoop://` URLs.

## Phase numbering

V3 mobile = **Phases 40.1 through 40.13**. The previous coding plan
([`coding-plan-v2-2026-05-07.md`](coding-plan-v2-2026-05-07.md))
pointed at "39+" for V3 mobile; that label was renumbered 2026-05-08
to dissolve the collision with V2.5 Phase 39 (picture attachments).
A 2-line summary of the same outline lives in coding-plan-v2 for
the dependency graph; the authoritative plan is this doc.

## Substrate touches (overview)

Three substrate-level changes, all as **separate RN packages** per
the architectural-layering rule:

| Substrate | Action | Phase |
|---|---|---|
| `@canopy/sync-engine-rn` | NEW — lift folio-mobile's `serviceFactory` + `bgRunOnce` patterns out. Stoop V3 + folio-mobile both consume. | 40.2 |
| `@canopy/oidc-session-rn` | NEW — lift folio-mobile's `OidcSessionRN` + `folioAuth` + `dcr` out. Stoop V3 + folio-mobile both consume. | 40.3 |
| `@canopy/react-native` | EXTEND — add `FileSystemAdapter` (alongside `AsyncStorageAdapter`). Stoop V3 + folio-mobile both consume. | 40.4 |

Plus the new app workspace `apps/stoop-mobile/` (40.1) and the
phase-40.5+ in-app screens, picker glue, etc.

## Phase 40.1 — Scaffold `apps/stoop-mobile/`

| # | Task | Files |
|---|---|---|
| 40.1.1 | Workspace skeleton mirroring `apps/folio-mobile`'s Expo 52 + RN 0.76.9 setup. `package.json` deps: `@canopy/{core, react-native, item-store, identity-resolver, skill-match, notifier, chat-agent}` + Stoop's app skills via local symlink, plus Expo + RN peers. | `apps/stoop-mobile/{package.json,app.json,babel.config.js,metro.config.js,index.js,App.js}` |
| 40.1.2 | App-readme per the convention. Sections: Substrates, Direct SDK use (none — composes substrates only), Status, Bring it up, Authentication (placeholder until 40.3), Settings layout (per Phase 33), Personal-pod URLs do not travel peer-to-peer (per the project rule), Localisation (shares `apps/stoop/locales/`). Hub-attachment: `standalone`. | `apps/stoop-mobile/README.md` |
| 40.1.3 | `vitest.config.js` with mocked Expo + RN modules (mirror folio-mobile's `test/setup.js`). | `apps/stoop-mobile/{vitest.config.js,test/setup.js}` |
| 40.1.4 | One smoke test: app boots without errors, renders a placeholder screen. | `apps/stoop-mobile/test/smoke.test.js` |
| 40.1.5 | Update root `package.json` workspace list + `nodemodules` install. | `package.json` |

**Estimate:** half a day.
**Acceptance:** `cd apps/stoop-mobile && npm test` passes one smoke
test; `npm start` boots Expo in dev mode without bundle errors.

## Phase 40.2 — Substrate `@canopy/sync-engine-rn` extraction

> **Purpose:** lift folio-mobile's RN-side bootstrap into a substrate
> Stoop V3 can consume from day one. Resolves the open MEDIUM TODO
> on cross-app imports
> ([`Project Files/TODO-GENERAL.md`](../TODO-GENERAL.md) §
> "Extract folio-mobile → folio shared code into a substrate").

| # | Task | Files |
|---|---|---|
| 40.2.1 | Create `packages/sync-engine-rn/` package with the standard layout (`src/`, `index.js`, `package.json`, `vitest.config.js`). Peer deps: `@canopy/sync-engine`, `@canopy/react-native`, `@canopy/pod-client`, `expo-file-system`, `expo-secure-store`, `expo-task-manager`. | `packages/sync-engine-rn/**` |
| 40.2.2 | Move + adapt `apps/folio-mobile/src/lib/serviceBuilder.js` and `bgRunOnce.js` into `packages/sync-engine-rn/src/`. Keep the API surface stable for folio-mobile (one-line consumer change). | `packages/sync-engine-rn/src/serviceBuilder.js`, `bgRunOnce.js` |
| 40.2.3 | Extract folio-mobile's RN-engine subclass shape into a generic `createMobileBootstrap({core deps, app id, paths})` factory. App-specific adaptation (e.g. Stoop's groupMirror, folio's SyncEngine subclass) plugs in via callback. | `packages/sync-engine-rn/src/createMobileBootstrap.js` |
| 40.2.4 | Update `apps/folio-mobile/src/ServiceContext.js` to import from `@canopy/sync-engine-rn`. | `apps/folio-mobile/src/ServiceContext.js`, `apps/folio-mobile/package.json` |
| 40.2.5 | Tests: substrate-level unit tests + folio-mobile's existing tests still pass. | `packages/sync-engine-rn/test/*.test.js` |
| 40.2.6 | Substrate README. Notes the RN-substrate-separation rule + cross-link to the cross-platform `@canopy/sync-engine`. | `packages/sync-engine-rn/README.md` |

**Estimate:** 2 days.
**Acceptance:** folio-mobile boots + tests pass against the
substrate; substrate exposes `createMobileBootstrap` ready for
Stoop V3 to consume.

## Phase 40.3 — Substrate `@canopy/oidc-session-rn` extraction

> **Purpose:** the second consumer (rule-of-two) of folio-mobile's
> RN-OIDC pattern is Stoop V3. Lifting now keeps Stoop V3 from
> shipping its own bespoke surface that the Inrupt-cleanup TODO
> would have to migrate later.

| # | Task | Files |
|---|---|---|
| 40.3.1 | Create `packages/oidc-session-rn/` package. Peer deps: `expo-auth-session`, `expo-secure-store`, `expo-web-browser`, `expo-crypto`. | `packages/oidc-session-rn/**` |
| 40.3.2 | Move `apps/folio-mobile/src/auth/OidcSessionRN.js`, `folioAuth.js`, `dcr.js` into the substrate. Generalise: `OidcSessionRN` accepts an app-id (storage-key prefix) so folio's `folio-oidc-*` keys and Stoop's `stoop-oidc-*` keys don't collide. The `folioAuth` becomes `runOidcSignIn(opts)` taking issuer + redirect URI + client metadata. | `packages/oidc-session-rn/src/{OidcSessionRN,oidcSignIn,dcr}.js` |
| 40.3.3 | Update `apps/folio-mobile/src/auth/folioAuth.js` to a thin wrapper that calls `runOidcSignIn({appId: 'folio', ...})`. Preserve the `folio://auth/callback` scheme. | `apps/folio-mobile/src/auth/{folioAuth,OidcSessionRN}.js` |
| 40.3.4 | Tests: substrate-level unit tests for token storage + refresh + the discovery / dynamic-client-registration helpers. Folio-mobile's existing auth tests still pass. | `packages/oidc-session-rn/test/*.test.js` |
| 40.3.5 | Substrate README + cross-links. Note: the Inrupt-cleanup may consolidate this with the desktop OIDC; this substrate is the V3 entry point for that future migration. | `packages/oidc-session-rn/README.md` |
| 40.3.6 | Stoop V3 SignIn screen (placeholder UI; full integration in 40.10). When the user taps "Sign in to pod", call `runOidcSignIn({appId: 'stoop', issuer, redirectUri: 'stoop://auth/callback'})` → on success seed an `OidcSessionRN`. | `apps/stoop-mobile/src/auth/{stoopAuth,signIn}.js` |
| 40.3.7 | Register `stoop://auth/callback` in `apps/stoop-mobile/app.json`. | `apps/stoop-mobile/app.json` |

**Estimate:** 2 days.
**Acceptance:** Folio-mobile sign-in still works against
`storage.inrupt.com`; Stoop V3 sign-in placeholder works against
the same.

## Phase 40.4 — Extend `@canopy/react-native` with `FileSystemAdapter`

| # | Task | Files |
|---|---|---|
| 40.4.1 | Implement `FileSystemAdapter` mirroring the `AsyncStorageAdapter` shape (`get/set/delete/list/has`) but backed by `expo-file-system`'s document directory. Used for paths the cache needs (image bytes, large items). | `packages/react-native/src/storage/FileSystemAdapter.js` |
| 40.4.2 | Tests with mocked `expo-file-system`. | `packages/react-native/test/storage/FileSystemAdapter.test.js` |
| 40.4.3 | Re-export from `packages/react-native/index.js`; document in CHANGELOG. | `packages/react-native/{index.js,CHANGELOG.md}` |
| 40.4.4 | Stoop V3's `CachingDataSource` construction in the bootstrap selects `FileSystemAdapter` for image / blob paths and `AsyncStorageAdapter` for everything else (or sticks to one for V1 if perf allows). | `apps/stoop-mobile/src/Agent.js` |

**Estimate:** half a day.
**Acceptance:** Stoop V3 saves a 500 KB attachment locally; round-
trip read works after app restart.

## Phase 40.5 — Native picker glue for picture attachments

| # | Task | Files |
|---|---|---|
| 40.5.1 | `apps/stoop-mobile/src/lib/imagePicker.js` — wraps `expo-image-picker` (camera + library) and `expo-image-manipulator` (resize). Exports `pickPrikbordImages({max: 4})` and `pickChatImage()` mirroring the web `imageResize.js` API shape. | `apps/stoop-mobile/src/lib/imagePicker.js` |
| 40.5.2 | Both helpers return the same `{mime, dataB64, width, height, thumbnail, bytes}` shape the Phase 39 skills accept. | — |
| 40.5.3 | Permission rationale string lookups in the locale (`mobile.camera_rationale`, `mobile.gallery_rationale`); add to `apps/stoop/locales/{nl,en}.json` under a new `mobile` namespace. | `apps/stoop/locales/{nl,en}.json` |
| 40.5.4 | Tests with mocked `expo-image-picker` + `expo-image-manipulator`. | `apps/stoop-mobile/test/imagePicker.test.js` |

**Estimate:** half a day.
**Acceptance:** `pickPrikbordImages` returns 1-4 resized images
with thumbnails; `postRequest` ships them via the existing skill.

## Phase 40.6 — QR scan + render

| # | Task | Files |
|---|---|---|
| 40.6.1 | `apps/stoop-mobile/src/lib/qrScanner.js` — wraps `expo-camera`'s built-in barcode scanning. Recognises three payload shapes: invite (`?invite=<json>` URL), contact-share (`stoop-contact://...`), recovery code (12 / 24 BIP-39 words). Returns `{kind, payload}`. | `apps/stoop-mobile/src/lib/qrScanner.js` |
| 40.6.2 | Scanner UI screen: full-screen camera preview + one-line hint ("This is an invite link") + cancel button. | `apps/stoop-mobile/src/screens/ScanScreen.js` |
| 40.6.3 | QR rendering for "Show my invite" / "Show my contact-share" — pick `react-native-qrcode-svg` (Expo-friendly, MIT, well-maintained). | `apps/stoop-mobile/src/components/QrCode.js`, `package.json` |
| 40.6.4 | Locale keys for scanner UI + permission rationale. | `apps/stoop/locales/{nl,en}.json` |
| 40.6.5 | Tests. Mocked camera; verifies the payload-classifier correctly tags each shape. | `apps/stoop-mobile/test/qrScanner.test.js` |

**Estimate:** 1 day.
**Acceptance:** scanning a known-good invite QR opens the redeem
flow; scanning a contact-share QR opens the contact-add flow.

## Phase 40.7 — GPS location

| # | Task | Files |
|---|---|---|
| 40.7.1 | Implement `getCoarseLocationFromGps()` in `apps/stoop/src/lib/geo.js` for RN: uses `expo-location` to fetch coordinates, snaps to 500m grid, returns the same `{cell, label, source: 'gps'}` shape the web `geocode` skill returns. | `apps/stoop/src/lib/geo.js` (the existing stub) |
| 40.7.2 | Permission rationale + flow: tap "Use my location" → permission prompt → coordinates → snap → preview → confirm (same UX as web's geocode-confirm flow). | `apps/stoop-mobile/src/screens/ProfileScreen.js` |
| 40.7.3 | Locale keys for the rationale + the new "Use my location" CTA. | `apps/stoop/locales/{nl,en}.json` |
| 40.7.4 | Tests. | `apps/stoop-mobile/test/geo.test.js` |

**Estimate:** half a day.
**Acceptance:** profile screen sets a location via GPS; profile
screen also still supports place-name geocoding (typed query).

## Phase 40.8 — Background fetch + active-state cadence

| # | Task | Files |
|---|---|---|
| 40.8.1 | App-state listener: `AppState.change` event drives `bundle.cache.setOnline(...)` + adjusts the polling cadence. Foreground = `pollIntervalMs` from settings; background = disconnect from relay, drain, sleep. | `apps/stoop-mobile/src/state/appStateBridge.js` |
| 40.8.2 | `expo-task-manager` registration: when `onlineWindow.everyMinutes` is set, schedule a background fetch. The handler boots the agent for `onlineWindow.durationSec`, runs one sync, tears down. | `apps/stoop-mobile/src/state/backgroundFetch.js` |
| 40.8.3 | Settings screen exposes `pollIntervalMs` + `onlineWindow` per Phase 33 (already in the per-device settings blob). Mobile defaults: `pollIntervalMs: 5000`, `onlineWindow: { everyMinutes: null }` (push only). | `apps/stoop-mobile/src/screens/SettingsScreen.js`, `apps/stoop/src/lib/Settings.js` (default-tweak) |
| 40.8.4 | Tests + a "battery profile" doc note: empirical readings on a real device with each cadence preset, captured in `apps/stoop-mobile/docs/battery.md`. | `apps/stoop-mobile/{test,docs}` |

**Estimate:** 1 day.
**Acceptance:** app on real device foregrounds = relay-connected;
backgrounds = disconnected + scheduled fetch fires per setting.

## Phase 40.9 — Native push via Expo

| # | Task | Files |
|---|---|---|
| 40.9.1 | Wire `MobilePushBridge` (`packages/react-native`) to Stoop's `notifier.PushChannel`. Token-registration mirrors `apps/stoop/web/push.html`'s subscribe/unsubscribe but uses Expo push tokens. | `apps/stoop-mobile/src/state/pushBridge.js` |
| 40.9.2 | Push permission flow: ask on first run after first group join (not at install — premature). Rationale strings in locales. | `apps/stoop-mobile/src/screens/PushSetupScreen.js` |
| 40.9.3 | Notification tap → app opens to relevant screen. Routing via `Linking` + the `stoop://` scheme: `stoop://chat?thread=<id>`, `stoop://post?id=<id>`, `stoop://group?id=<gid>`. | `apps/stoop-mobile/src/state/deepLinks.js` (also serves Phase 40.11) |
| 40.9.4 | Server-side: relay's `PushSender` already supports Expo push (`relay.ExpoPushSender`); confirm it's wired in the Stoop relay's `PushChannel` config. (May already be — Phase 21 web infrastructure parallels this.) | `apps/stoop/src/Agent.js` (push channel config) |
| 40.9.5 | Tests with mocked `expo-notifications`. | `apps/stoop-mobile/test/push.test.js` |

**Estimate:** 1 day.
**Acceptance:** sending a chat message from a desktop user triggers
a native notification on the recipient's mobile install; tapping
it opens the chat thread.

## Phase 40.10 — UI screens

> The biggest single phase. Mirrors the web shell but native.

| # | Task | Files |
|---|---|---|
| 40.10.1 | `react-navigation` stack setup; route table per § 6 of the functional design. | `apps/stoop-mobile/App.js`, `src/navigation.js` |
| 40.10.2 | WelcomeScreen, OnboardScreen (scan + restore), ProfileScreen, FeedScreen, PostComposeScreen, ItemDetailScreen. | `apps/stoop-mobile/src/screens/*.js` |
| 40.10.3 | ChatThreadsScreen, ChatThreadScreen, ContactsScreen, ContactScreen (other-user view), GroupScreen, SettingsScreen, PrivacyScreen, PushSetupScreen. | `apps/stoop-mobile/src/screens/*.js` |
| 40.10.4 | Shared components: PostCard (renders item + thumbs), AvatarCircle, ChipRow, ConfirmModal, AttachmentModal (full-image viewer with swipe). | `apps/stoop-mobile/src/components/*.js` |
| 40.10.5 | Stoop V3 mobile reuses `apps/stoop/locales/`; add `mobile.*` namespace for mobile-only strings. | `apps/stoop/locales/{nl,en}.json` |
| 40.10.6 | Per-screen tests with mocked navigation + skills. | `apps/stoop-mobile/test/screens/*.test.js` |
| 40.10.7 | Settings layout in README ("Settings layout" + "Personal-pod URLs do not travel peer-to-peer" sections — mirror what's in `apps/stoop/README.md`). | `apps/stoop-mobile/README.md` |

**Estimate:** 5-6 days.
**Acceptance:** complete navigation through all journeys §5 of the
functional design; every visible string is i18n-resolvable.

## Phase 40.11 — Deep links

| # | Task | Files |
|---|---|---|
| 40.11.1 | Register `stoop://` scheme in `app.json` (already partially done in 40.3 / 40.9). Define the route table: `stoop://invite?...`, `stoop://contact?...`, `stoop://chat?thread=<id>`, `stoop://post?id=<id>`, `stoop://group?id=<gid>`, `stoop://auth/callback`. | `apps/stoop-mobile/app.json` |
| 40.11.2 | `Linking.addEventListener` handler in App.js routes to the right screen. Falls back to Welcome when the app is fresh-launched from a deep link before sign-in. | `apps/stoop-mobile/App.js`, `src/state/deepLinks.js` |
| 40.11.3 | Tests with `Linking.openURL` mock. | `apps/stoop-mobile/test/deepLinks.test.js` |

**Estimate:** half a day.
**Acceptance:** clicking a `stoop://invite?...` link from another
app opens the redeem flow.

## 2026-05-08 mid-build audit — what 40.1-40.13 actually delivered

> Phases 40.1-40.13 shipped on schedule but on a narrower scope than
> the original goal "ship all web capabilities to phone." The audit
> below is honest: lots of pretty UI, none of it wired to a live
> agent. The new Phases 40.14-40.24 fix that.

**What 40.1-40.13 actually shipped:**
- Phase 40.1 ✅ — workspace scaffold + smoke test.
- Phase 40.2 ✅ — `@canopy/sync-engine-rn` substrate; folio-mobile
  consumes it.
- Phase 40.3 ✅ — `@canopy/oidc-session-rn` substrate; folio-mobile
  consumes it. Stoop V3 has the `useSignInHook` slot but doesn't yet
  call it.
- Phase 40.4 ✅ — `FileSystemAdapter` in `@canopy/react-native`.
  Not yet consumed by Stoop V3 (no `CachingDataSource` wired).
- Phase 40.5 ✅ — `imagePicker.js` with `pickPrikbordImages` +
  `pickChatImage` matching the Phase 39 byte shape. Not yet wired
  to PostComposeScreen / ChatThreadScreen (passed in via callback).
- Phase 40.6 ✅ — `qrScanner.js` payload classifier + `QrCode`
  component + OnboardScanScreen with `expo-camera`'s `CameraView`.
  Real camera, real classifier — but the routing to the redeem
  flow is still callback-driven (no live agent to redeem against).
- Phase 40.7 ✅ — `geo.js` mobile-side `getCoarseLocationFromGps`
  via `expo-location`. ProfileMineScreen has a "use my location"
  prop; the prop is unwired.
- Phase 40.8 ✅ — `bgRunOnce.js` + `activeCadence.js` modules.
  AppState listener exists; **not yet attached** to a live
  `bundle.cache.setOnline(...)`. Background-fetch task **not yet
  registered** with `expo-task-manager`.
- Phase 40.9 ✅ — `push.js` with `setupPush` + `requestPushPermission`.
  PushScreen has the opt-in CTA; **not yet ships the token to
  the relay**, no test-push button.
- Phase 40.10 🟡 — all 20 screens implemented as UI shells with
  `prop`-based data + callback inputs. **No `ServiceContext` boots
  an agent**; every prop is unwired. Tab-shell + locale auto-detect
  was a 2026-05-08 follow-up after a real-device test.
- Phase 40.11 ✅ — deep-link parser (`deepLinks.js`) + DeepLinkHandler
  inside the NavigationContainer. Routes registered in `app.json`.
- Phase 40.12 ⏸ — deferred (real-device pass; nothing works
  end-to-end yet).
- Phase 40.13 ⏸ — deferred (no shipped behaviour to document).

**What was missed entirely** (not in any phase but should be):
- ServiceContext + agent bring-up (folio-mobile pattern not
  duplicated for Stoop).
- `useSkill` hook for screens to invoke skills.
- Trust-level + per-contact-flag UI on ContactScreen.
- Distance / group-multi-select / audience picker on PostCompose.
- Hop-through toggle + onlineWindow inputs on SettingsScreen.
- Avatar picker wiring on ProfileMineScreen.
- Skills add/remove (chip multi-select with categories) on
  ProfileMineScreen.
- Recovery-phrase reveal on ProfileMineScreen.
- Member-list + role chips + assign-role on GroupScreen.
- CreateGroupScreen (the 6-question wizard equivalent of
  `/create-group.html`) — entire screen.
- AuthCallbackScreen (bulk-sync progress after pod sign-in) —
  entire screen.
- Skill-match inbox / suggestions surface — entire screen.
- ContactRequests list (incoming-add approval) — sub-flow.
- ContactList management (create / rename / delete + drag-into-list).
- Brainstorm features past V1 web: rotating group keys,
  rotating addresses, auto-skill-match privacy gate.

The new Phases 40.14-40.24 close these gaps.

## Phase 40.14 — ServiceContext + agent bring-up + `useSkill` hook

> **Critical path** — every other new phase needs this first. Mirrors
> `apps/folio-mobile/src/ServiceContext.js`'s pattern. Once this
> ships, the existing UI shells flip to "live" with one prop binding
> per screen.

| # | Task | Files |
|---|---|---|
| 40.14.1 | `apps/stoop-mobile/src/ServiceContext.js` — boots an `Agent` via `createMobileBootstrap` from `@canopy/sync-engine-rn`, attaches Stoop's `buildSkills` + `buildOnboardingSkills` + `wireGroupBroadcastMirror` from `@canopy-app/stoop`, wires `KeychainVault`, `AsyncStorageAdapter`, `FileSystemAdapter`, `MdnsTransport`, `BleTransport`, `MobilePushBridge`. Exposes via `<ServiceProvider>` React context. | `apps/stoop-mobile/src/ServiceContext.js` |
| 40.14.2 | `apps/stoop-mobile/src/lib/useSkill.js` — `useSkill(skillId)` returns `{call, loading, error}`. Wraps `agent.invoke(localPeer, skillId, parts)` with React state for loading + error. Auto-cancels on unmount. | `apps/stoop-mobile/src/lib/useSkill.js` |
| 40.14.3 | `apps/stoop-mobile/src/lib/useAgentEvent.js` — subscribes to a named `agent.on(eventName, ...)` and re-renders the consumer when new events arrive. Used by Feed (item arrive), ChatThread (message arrive), Push (push handler). | `apps/stoop-mobile/src/lib/useAgentEvent.js` |
| 40.14.4 | `App.js` wraps the navigator in `<ServiceProvider>`. The provider blocks rendering until the agent is identity-bootstrapped (returns a small splash for the first ~200 ms). | `apps/stoop-mobile/App.js` |
| 40.14.5 | `apps/stoop-mobile/src/lib/AppState.js` — wires `AppState.change` to `bundle.cache.setOnline(...)`. Foreground = poll at `pollIntervalMs`; background = disconnect, drain, sleep. (The pure helpers are already in `lib/activeCadence.js`; this glues them to live state.) | `apps/stoop-mobile/src/lib/AppState.js` |
| 40.14.6 | Tests: ServiceContext renders, agent boots, `useSkill` invokes a stub skill end-to-end. | `apps/stoop-mobile/test/ServiceContext.test.js`, `useSkill.test.js` |

**Estimate:** 2 days.
**Acceptance:** ServiceContext mounts; FeedScreen receives a non-
empty `items` array on a test-fixture agent; tapping a button on a
test screen invokes a stub skill and re-renders.

## Phase 40.15 — Profile + identity wiring

| # | Task | Files |
|---|---|---|
| 40.15.1 | ProfileMineScreen wires `setMyHandle`, `setMyProfile`, `setMyAvatarUrl`, `clearMyAvatar`, `getCoarseLocationFromGps`, `setLocation`, `clearLocation`, `setHolidayMode`, `addMySkill`, `removeMySkill`, `listMySkills`. Avatar picker via `imagePicker.pickChatImage` (single image, AVATAR_PRESET 256px). | `apps/stoop-mobile/src/screens/ProfileMineScreen.js` |
| 40.15.2 | Skills sub-flow: add a categorised skill picker (mirror Phase 23 categories from `apps/stoop/src/lib/skillsMatch.js`'s `TAXONOMY`). New component `<SkillPicker categories={...} selected={...} onChange={...}>` reused on Profile + PostCompose. | `apps/stoop-mobile/src/components/SkillPicker.js` |
| 40.15.3 | Recovery phrase reveal: wires `getMnemonicOnce` + `markMnemonicShown`. Renders the 12 / 24 words in a copy-to-clipboard layout inside a confirm modal; warns about screenshot risk in the body. | `apps/stoop-mobile/src/screens/ProfileMineScreen.js` |
| 40.15.4 | ProfileOtherScreen wires `getMemberProfile(memberId)` + `requestReveal`. | `apps/stoop-mobile/src/screens/ProfileOtherScreen.js` |
| 40.15.5 | Tests: skill calls, error handling, sad paths. | `apps/stoop-mobile/test/screens/ProfileMineScreen.test.js` |

**Estimate:** 1.5 days.
**Acceptance:** Real-device test — set handle, set name, take a
photo for avatar, set location via GPS, add 3 skills, toggle
holiday on/off, see recovery phrase. All values survive app
restart.

## Phase 40.16 — Posts + items wiring + new compose controls

| # | Task | Files |
|---|---|---|
| 40.16.1 | FeedScreen wires `listOpen` + subscribes to `agent.on('item-arrive', ...)`. Pull-to-refresh calls `refresh`. Filter chips drive a server-side filter on the listOpen call (kind / skill / distance). | `apps/stoop-mobile/src/screens/FeedScreen.js` |
| 40.16.2 | PostComposeScreen wires `postRequest` with attachments via `imagePicker.pickPrikbordImages`. New compose-controls: **distance slider** (max-km, snaps to {1, 2, 5, 10, 25} per `lib/geo.js`'s `DISTANCE_PRESETS`), **group multi-select** (lists user's joined groups), **audience picker** (open / contacts-only / trusted-only / all-broadcastable). | `apps/stoop-mobile/src/screens/PostComposeScreen.js`, `apps/stoop-mobile/src/components/AudiencePicker.js` |
| 40.16.3 | ItemDetailScreen wires `getItem(id)`, `respondToItem`, `claimItem`, `cancelClaim`. Claim list inline; accept/reject buttons call `acceptResponder` / `rejectResponder`. | `apps/stoop-mobile/src/screens/ItemDetailScreen.js` |
| 40.16.4 | MineScreen wires `listMine` + the cancel/accept/reject claim actions. | `apps/stoop-mobile/src/screens/MineScreen.js` |
| 40.16.5 | Tests. | `apps/stoop-mobile/test/screens/{FeedScreen,PostComposeScreen,ItemDetailScreen,MineScreen}.test.js` |

**Estimate:** 2 days.
**Acceptance:** Real-device — post a vraag with photo + distance +
group + audience, see it on Feed, tap to detail, accept a claim
on MineScreen.

## Phase 40.17 — Chat + reveal handshake wiring

| # | Task | Files |
|---|---|---|
| 40.17.1 | ChatThreadsScreen wires `listChatThreads` + `agent.on('chat-message-arrive', ...)` (refreshes the list on activity). | `apps/stoop-mobile/src/screens/ChatThreadsScreen.js` |
| 40.17.2 | ChatThreadScreen wires `getChatThread(id)`, `sendChatMessage`, `requestReveal`, `acceptReveal`, `declineReveal`. Photo attachments via `imagePicker.pickChatImage` (single, CHAT_PRESET 800px). | `apps/stoop-mobile/src/screens/ChatThreadScreen.js` |
| 40.17.3 | Reveal-handshake UI: header CTA changes state machine: `not_revealed` → `request_pending` → `revealed` (with both displayName and handle visible) OR `request_declined`. | `apps/stoop-mobile/src/screens/ChatThreadScreen.js` |
| 40.17.4 | Tests. | `apps/stoop-mobile/test/screens/Chat*.test.js` |

**Estimate:** 1.5 days.
**Acceptance:** Two test devices: A sends a message + photo; B
receives + replies; A taps "Connect" → B sees a prompt → both see
each other's real names afterward.

## Phase 40.18 — Contacts + groups + new screens

| # | Task | Files |
|---|---|---|
| 40.18.1 | ContactsScreen wires `listContacts`, `addContact`, `removeContact`, `addContactFromQr`. Plus a header section for **incoming requests** (`listIncomingContactRequests`, `acceptContactRequest`, `declineContactRequest`). | `apps/stoop-mobile/src/screens/ContactsScreen.js` |
| 40.18.2 | ContactScreen wires `setContactTrust` (bekend / vertrouwd), `setContactFlag` (shareLocation / hopThrough / autoMatch), `setContactTags`. New TrustPicker + FlagToggleRow components. | `apps/stoop-mobile/src/screens/ContactScreen.js`, `apps/stoop-mobile/src/components/{TrustPicker,FlagToggleRow}.js` |
| 40.18.3 | New ContactListsSection on ContactsScreen — lists user's contact-lists (`listContactLists`, `createContactList`, `renameContactList`, `deleteContactList`, `addContactToList`, `removeContactFromList`). | `apps/stoop-mobile/src/screens/ContactsScreen.js` |
| 40.18.4 | GroupScreen wires `getGroup`, `getMembers`, `rotateMyGroupCode`, `getCurrentMembershipCode`, `leaveGroup`, `listEvictedMembers`, `removeMember`. New MemberRow with role chip; assign-role sub-flow (`setMemberRole(memberId, 'admin' | 'coordinator' | 'member')`). | `apps/stoop-mobile/src/screens/GroupScreen.js`, `apps/stoop-mobile/src/components/MemberRow.js` |
| 40.18.5 | **New CreateGroupScreen** — multi-step wizard mirroring `/create-group.html`'s 6 questions: name + purpose, admins, house rules, conflict resolution, location anchor, distance defaults. Wires `createGroupWithRules`. On success, navigates to OnboardIssueScreen with the freshly-issued admin invite token. | `apps/stoop-mobile/src/screens/CreateGroupScreen.js` (NEW) + `src/navigation.js` (route entry) |
| 40.18.6 | Tests. | `apps/stoop-mobile/test/screens/{ContactsScreen,ContactScreen,GroupScreen,CreateGroupScreen}.test.js` |

**Estimate:** 2.5 days.
**Acceptance:** Real-device — create a group, share QR via
OnboardIssueScreen, second device scans + redeems, both see each
other in the member list, set per-contact trust + flags.

## Phase 40.19 — Settings + push + sign-in wiring

| # | Task | Files |
|---|---|---|
| 40.19.1 | SettingsScreen wires `getSettings` / `updateSettings` for both shared (`broadcastable`, `defaultShareLocation`) and per-device (`pollIntervalMs`, `onlineWindow.everyMinutes`, `onlineWindow.durationSec`, `allowHopThrough`). Two inputs for online-window; a toggle for hop-through; a slider for poll-interval. | `apps/stoop-mobile/src/screens/SettingsScreen.js` |
| 40.19.2 | PushScreen wires `subscribePushChannel(token, platform)` → ships the Expo token to the relay. Adds a "Test push" button (`triggerSelfPush`). Subscription-status pill pulls from `getPushSubscriptionStatus`. | `apps/stoop-mobile/src/screens/PushScreen.js` |
| 40.19.3 | SignInScreen wires `useOidcSignIn` from `@canopy/oidc-session-rn/hook` with `appId: 'stoop'`. On success, the agent re-keys to the pod identity (Phase 33 mid-flight swap). | `apps/stoop-mobile/src/screens/SignInScreen.js` |
| 40.19.4 | **New AuthCallbackScreen** — bulk-sync progress polling after pod sign-in. Polls `getBulkSyncStatus` every 500 ms; renders a progress bar + "uploading {done}/{total}" + a finish state. Mirrors `/auth-callback.html`. | `apps/stoop-mobile/src/screens/AuthCallbackScreen.js` (NEW) + `src/navigation.js` |
| 40.19.5 | Tests. | `apps/stoop-mobile/test/screens/{SettingsScreen,PushScreen,SignInScreen,AuthCallbackScreen}.test.js` |

**Estimate:** 1.5 days.
**Acceptance:** Sign-in to a test pod, watch bulk-sync progress,
see settings synchronise across devices.

## Phase 40.20 — Skill-match suggestion inbox + privacy-aware notify

> Implements the brainstorm's auto-match flow. **Design-blocked** on
> `§8a.3` of the functional design — needs a few questions answered
> first. The phase is here so the work isn't lost; pull it forward
> when the design lands.

| # | Task | Files |
|---|---|---|
| 40.20.1 | Resolve the open privacy questions in `§8a.3` (rate limits, opt-in scope, notify-on-no-match policy). | (design doc) |
| 40.20.2 | New SkillMatchInboxScreen — list of incoming skill-match suggestions. Each row shows the requester's handle (or anonymised if not yet revealed), the skill / category, and a "Help" / "Ignore" CTA. | `apps/stoop-mobile/src/screens/SkillMatchInboxScreen.js` (NEW) |
| 40.20.3 | Wire `subscribeSkillMatchOffers` (or whatever the substrate names it) — receives broadcasts from the user's wider connection list (groups + hop-discovered + contacts), runs the local skills filter, surfaces matches as inbox entries + push notifications. | `apps/stoop-mobile/src/screens/SkillMatchInboxScreen.js`, `apps/stoop-mobile/src/lib/skillMatchListener.js` (NEW) |
| 40.20.4 | Add a per-contact `flag_auto_match` toggle (already in `apps/stoop/locales/{nl,en}.json`'s `contacts.flag_auto_match`; the per-contact UI lives on ContactScreen from Phase 40.18). | `apps/stoop-mobile/src/screens/ContactScreen.js` |
| 40.20.5 | Tests. | `apps/stoop-mobile/test/screens/SkillMatchInboxScreen.test.js` |

**Estimate:** 1.5 days (after design unblocks).
**Acceptance:** Two devices: A posts a request, B's agent
auto-evaluates against B's skills, B sees the suggestion in the
inbox + a push.

## Phase 40.21 — AppState bridge + background-fetch task

| # | Task | Files |
|---|---|---|
| 40.21.1 | `apps/stoop-mobile/src/state/backgroundFetch.js` — registers `expo-task-manager` task on app boot when `onlineWindow.everyMinutes` is set; handler boots the agent via `bgRunOnce` for `onlineWindow.durationSec`, runs one sync, tears down. (`bgRunOnce` already exists in `@canopy/sync-engine-rn` as of Phase 40.2.) | `apps/stoop-mobile/src/state/backgroundFetch.js` |
| 40.21.2 | Settings UI exposes a "test background fetch" button that simulates the OS firing the task; on real devices that's the only way to verify pre-OS-eligibility. | `apps/stoop-mobile/src/screens/SettingsScreen.js` |
| 40.21.3 | Battery profile doc with empirical numbers per cadence preset. | `apps/stoop-mobile/docs/battery.md` |
| 40.21.4 | Tests with mocked `expo-task-manager`. | `apps/stoop-mobile/test/state/backgroundFetch.test.js` |

**Estimate:** 0.5 day.
**Acceptance:** Phone in background fires the task at the
configured cadence; cadence is clamped to OS minimum (15 min on
Android Doze) with a hint surfaced in Settings.

## Phase 40.22 — Privacy / safety polish

> Design-blocked on `§8a.1`, `§8a.2` of the functional design.
> Captures rotating group keys, rotating addresses, and metadata-
> public warnings.

| # | Task | Files |
|---|---|---|
| 40.22.1 | Resolve open questions in `§8a.1` + `§8a.2`. Draft a separate sketch for the rotating-key flow (cadence config, external-channel UX, missed-rotation behaviour). | (design doc) |
| 40.22.2 | Rotating group keys — wire `rotateGroupSecret` (admin) + `redeemGroupSecret` (member). New "Rotate code" CTA on GroupScreen with a 30-day cadence default. Member-side: a banner appears 3 days before rotation reminding the user to get the new code through the external channel. | `apps/stoop-mobile/src/screens/GroupScreen.js`, `packages/skill-match` or wherever the cadence-config lives |
| 40.22.3 | Rotating addresses — implement per-day pubKey rotation (or whatever cadence the design picks), with rendezvous via the user's pod. UI: a "Rotate identity address" toggle in Settings (privacy section). | `apps/stoop-mobile/src/screens/SettingsScreen.js`, plus SDK-level work in `@canopy/core` |
| 40.22.4 | Metadata-public warning — first-launch onboarding adds a slide explaining that **traffic metadata** (when you talk to whom, even if content is encrypted) is visible to relay operators. Accept-or-decline with a "use local-only" path. | `apps/stoop-mobile/src/screens/WelcomeScreen.js` (or a new MetadataWarningScreen) |
| 40.22.5 | Trust enforcement — verify per-contact flags (`shareLocation`, `hopThrough`) actually gate the relevant data flows in the SDK. Add SDK-level tests. | `packages/identity-resolver` or `@canopy-app/stoop` |

**Estimate:** unknown until the §8a.1 + §8a.2 designs land. Expect
2-4 days plus design time.
**Acceptance:** Brainstorm requirements (rotating keys, rotating
addresses, metadata warning) demonstrably wired end-to-end.

## Phase 40.23 — Real-device pass + closed-beta build (was 40.12)

| # | Task |
|---|---|
| 40.12.1 | Android dev build via EAS or local `gradlew assembleDebug`. Smoke test on a physical Android device: install, sign in, post, chat, scan QR, push, background fetch. |
| 40.12.2 | Battery profile doc (from 40.8.4) updated with real-device numbers. |
| 40.12.3 | Closed-beta APK built and stored under `apps/stoop-mobile/release/`. |
| 40.12.4 | iOS: not built. Document in `apps/stoop-mobile/README.md` under Status that iOS is out-of-scope per main project README. |

**Estimate:** 1-2 days (Android friction is hard to estimate).
**Acceptance:** APK installable on a real device; documented
known issues + battery numbers.

## Phase 40.24 — Documentation + handoff (was 40.13)

| # | Task |
|---|---|
| 40.24.1 | Update `apps/stoop-mobile/README.md` with: Status (Phase 40.23 complete), Bring it up (dev build), Substrates, Direct SDK use, Authentication, Settings layout (per Phase 33), Hub-attachment plan (`standalone`), Known limitations. |
| 40.24.2 | Cross-link from `apps/stoop/README.md` to the mobile README. |
| 40.24.3 | Update `Project Files/conventions/architectural-layering.md` with the new `*-rn` substrates added (sync-engine-rn, oidc-session-rn). |
| 40.24.4 | Add a memory entry summarising what V3 mobile shipped. |

**Estimate:** half a day.

## Total estimate

**Original Phases 40.1-40.13 (UI + scaffolding):** ~12-14 days,
already shipped.

**New Phases 40.14-40.24 (wiring + missing screens + brainstorm
features):** ~15 days plus the design time needed to unblock 40.20
and 40.22.

| Phase | Theme | Estimate |
|---|---|---|
| 40.14 | ServiceContext + agent bring-up + `useSkill` hook | 2 d |
| 40.15 | Profile + identity wiring | 1.5 d |
| 40.16 | Posts + items wiring + new compose controls | 2 d |
| 40.17 | Chat + reveal handshake wiring | 1.5 d |
| 40.18 | Contacts + groups wiring + new screens (CreateGroup, etc.) | 2.5 d |
| 40.19 | Settings + push + sign-in wiring (incl. AuthCallback) | 1.5 d |
| 40.20 | Skill-match suggestion inbox (design-blocked) | 1.5 d |
| 40.21 | AppState bridge + background-fetch task | 0.5 d |
| 40.22 | Privacy / safety polish (rotating keys + addresses) (design-blocked) | 2-4 d + design |
| 40.23 | Real-device pass + closed-beta build | 1-2 d |
| 40.24 | Documentation + handoff | 0.5 d |

Phase 40.20 + 40.22 are design-blocked on §8a.1/2/3 of the
functional design. The other phases can start as soon as 40.14
ships.

## Order + dependencies

```
[Original phases — done]
40.1 (scaffold) ─────────────────────────────────────┐
                                                     │
40.2 (sync-engine-rn) ←─ extracts folio-mobile       │
40.3 (oidc-session-rn) ←─ extracts folio-mobile      │
40.4 (FileSystemAdapter) ─ depends on 40.1           │
                                                     │
40.5 (image picker) ──┐                              │
40.6 (qr scanner) ─────┤                             │
40.7 (gps location) ───┤                             │
40.8 (background) ─────┤                             │
40.9 (push) ───────────┤                             │
                       │                             │
40.10 (screens shells)─┘                             │
40.11 (deep links) ──────────────────────────────────┤
                                                     │
[New phases — wiring + gaps]                         │
40.14 (ServiceContext + useSkill) ←──── BLOCKER for the rest
        │                                            │
        ├─ 40.15 (profile)                          │
        ├─ 40.16 (posts + items + compose-controls) │
        ├─ 40.17 (chat + reveal)                    │
        ├─ 40.18 (contacts + groups + CreateGroup)  │
        ├─ 40.19 (settings + push + signin + bulk-sync UI)
        ├─ 40.21 (AppState + background)            │
        │                                            │
        ├─ 40.20 (skill-match inbox) ←── design-blocked
        ├─ 40.22 (privacy polish)     ←── design-blocked
                                                     │
40.23 (real-device pass) ─ after 40.14-40.21         │
40.24 (docs / handoff)   ─ last                      │
```

## Open questions (resolved at phase-time, not now)

1. **Cache adapter selection.** Phase 40.4 picks
   `FileSystemAdapter` for blob-shaped paths (image bytes), keeps
   `AsyncStorageAdapter` for everything else. Decision: split or
   single — measure perf at 40.10 against a 100-post dataset.
2. **QR rendering library.** `react-native-qrcode-svg` vs.
   alternative. Decision: 40.6 picks; if licensing or maintenance
   concerns surface, fall back to `react-native-svg` + hand-roll.
3. **Battery floor.** `expo-task-manager` minimum cadence on
   Android is 15 min (Doze). 40.8 documents this; users requesting
   shorter cadences on settings see a clamped value with a hint.
4. **Image-viewer carousel.** 40.10.4 picks between a stock Expo
   gallery component and a custom swipeable. Decision deferred.
5. **APK signing for closed-beta.** EAS managed signing vs.
   self-managed keystore. Decision: 40.12 picks based on whether
   we have a stable Expo account.

## References

- Functional design: [`v3-mobile-functional-design-2026-05-08.md`](v3-mobile-functional-design-2026-05-08.md).
- V2.5 plan (high-level outline preserved there): [`coding-plan-v2-2026-05-07.md`](coding-plan-v2-2026-05-07.md).
- folio-mobile pattern source: [`apps/folio-mobile/`](../../apps/folio-mobile/).
- RN platform layer: [`packages/react-native/`](../../packages/react-native/).
- Mobile-substrates rule: [`../conventions/architectural-layering.md`](../conventions/architectural-layering.md#mobile-substrates-live-in-their-own-packages-locked-2026-05-08).
- iOS scope: [main `README.md`](../../README.md#platform-support--ios-deliberately-out-of-scope-locked-2026-05-08).
- Inrupt-cleanup TODO + Phase-40.3 link: [`../TODO-GENERAL.md`](../TODO-GENERAL.md).
