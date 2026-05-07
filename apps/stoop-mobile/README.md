# `@canopy-app/stoop-mobile`

> **Layer: app.** Composes substrates from
> `packages/{core, react-native, sync-engine-rn, oidc-session-rn,
> local-store, identity-resolver, item-store, chat-p2p, notifier,
> skill-match, pod-client}`.
>
> Direct SDK use is allowed only when justified in this README's
> `## Direct SDK use` section (per
> [`app-readme-scheme.md`](../../Project%20Files/conventions/app-readme-scheme.md)).
> See [`Project Files/conventions/architectural-layering.md`](../../Project%20Files/conventions/architectural-layering.md).
>
> **Known direct cross-app dep:** `@canopy-app/stoop` for the
> SyncEngine-shaped factory, the skill builder, groupMirror, and
> the Stoop-vocabulary attachment helpers. Same **platform-shell
> exception** as folio + folio-mobile (locked 2026-05-08); see the
> layering doc.

Stoop V3 — React Native mobile client for the buurt-skill-app.
Phase 40 of the [V3 mobile coding plan](../../Project%20Files/Stoop/v3-mobile-coding-plan-2026-05-08.md).

## Status (2026-05-08)

**Phase 40.1 ✅ — workspace scaffold.** Empty welcome screen,
react-navigation stack wired but with one screen, all substrate
deps resolved, smoke test passes.

Pending phases (per
[`v3-mobile-coding-plan-2026-05-08.md`](../../Project%20Files/Stoop/v3-mobile-coding-plan-2026-05-08.md)):

- 40.2 ✅ `@canopy/sync-engine-rn` — done in folio repair.
- 40.3 ✅ `@canopy/oidc-session-rn` — done in folio repair.
- 40.4 ✅ Added `FileSystemAdapter` to `@canopy/react-native`.
- 40.5 ✅ Native picker glue (`expo-image-picker` + `expo-image-manipulator`),
  `src/lib/imagePicker.js`.
- 40.6 ✅ QR scan + render — `src/lib/qrScanner.js` + `src/components/QrCode.js`.
- 40.7 ✅ GPS via `expo-location` — `src/lib/geo.js` (re-exports cell helpers
  from `@canopy-app/stoop/lib/geo`).
- 40.8 ✅ Background fetch + active-state cadence —
  `src/lib/bgRunOnce.js` (BG_TASK_NAME = `stoop-mobile-sync-background`)
  + `src/lib/activeCadence.js` (foreground/background ticker).
- 40.9 ✅ Native push via Expo — `src/lib/push.js` (`setupPush`,
  `requestPushPermission`); deep-imports `MobilePushBridge` +
  `ExpoNotificationsAdapter` from `@canopy/react-native`.
- 40.10 ✅ UI screens — all 20 routes have real screens; assembled in
  eight sub-phases (40.10-A through -H). Pure helpers extracted to
  `src/lib/{i18n,theme,avatar,post,mnemonic,onboardScanRouting,handle,
  compose,feedFilter,chat,contacts,settings}.js`.
- 40.11 ✅ Deep-link handling for `stoop://...` — `src/lib/deepLinks.js`
  + `DeepLinkHandler` mounted inside `NavigationContainer`. Routes:
  invite / contact / chat / post / group / auth-callback / welcome / feed.
- 40.14 ✅ ServiceContext + agent bring-up + `useSkill` hook —
  `src/ServiceContext.js`, `src/lib/{identityBootstrap,groupRegistry,
  agentBundle,useSkill,useAgentEvent,appStateBridge,skillParts}.js`.
  Identity load-or-generate via KeychainVault; per-group bundles
  built via Stoop's `createNeighborhoodAgent`; status state machine
  (`loading` / `no-groups` / `ready` / `error`); `useSkill('postRequest').call({...})`
  dispatches against the active bundle.
- 40.15 ✅ Profile + identity wiring — `src/lib/{useProfile,
  useMemberProfile,profileSync,skillPicker}.js`,
  `src/components/SkillPicker.js`, `src/lib/imagePicker.js`'s new
  `pickAvatarImage` + AVATAR_PRESET (256px). ProfileMineScreen
  + ProfileOtherScreen now talk to the live agent: `setMyHandle`,
  `setMyDisplayName`, `setMyAvatarUrl`, `clearMyAvatar`,
  `setMyLocation` (via `getCoarseLocationFromGps`), `clearMyLocation`,
  `setHolidayMode`, `addMySkill`, `removeMySkill`, `listSkillCategories`,
  `getMnemonicOnce` + `markMnemonicShown`. Optimistic updates in the
  hook so UI doesn't flash.
- ⚙️ 2026-05-08 follow-up — bottom-tab shell wraps the six main
  destinations (Feed / Mine / Chat / Contacts / Profile / Settings)
  via `@react-navigation/bottom-tabs`. Detail screens push over the
  shell from the outer native stack. Welcome's "Beginnen" CTA navigates
  to `Shell` with `screen: Feed` nested params; deep links do the
  same for feed / contact landings. Locale auto-detected from the
  device locale at boot (`Intl.DateTimeFormat().resolvedOptions().locale`
  → 'nl' if Dutch, else 'en').
- 40.12 — Real-device pass + closed-beta build (Android-primary).
- 40.13 — Documentation + handoff.
- 40.9 — Native push via Expo.
- 40.10 — UI screens (the biggest single phase).
- 40.11 — Deep-link handling for `stoop://...` URLs.
- 40.12 — Real-device pass + closed-beta build (Android-primary).
- 40.13 — Documentation + handoff.

## Substrates

| Package | Used for |
|---|---|
| `@canopy/core` | `Agent`, `AgentIdentity`, `KeychainVault` (via `@canopy/react-native`); identity bring-up via mnemonic-restore. |
| `@canopy/react-native` | RN platform layer: polyfills, Metro preset, `KeychainVault`, `AsyncStorageAdapter`, `MdnsTransport`, `BleTransport`, `MobilePushBridge`. |
| `@canopy/sync-engine-rn` | RN bootstrap: `createMobileBootstrap`, `createSyncEngine`, `bgRunOnce`, `defineBackgroundTask` + the BackgroundFetch helpers. |
| `@canopy/oidc-session-rn` | RN-side Solid OIDC: `OidcSessionRN` token persistence, `useOidcSignIn` hook (at `/hook` subpath), DCR helpers. Stoop V3 pre-binds `appId: 'stoop'`. |
| `@canopy/local-store` | `CachingDataSource`, `SyncCadence`, `createSettingsModule({appId: 'stoop', ...})`. |
| `@canopy/identity-resolver` | `MemberMap`, `MemberMapCache`, `buildOnboardingSkills`, `matchesProfile`, `TAXONOMY`. |
| `@canopy/item-store` | `ItemStore` for posts, chat-messages, claims, redemptions. |
| `@canopy/chat-p2p` | `wireChat({...})` peer-to-peer chat (acceptedEnvelopeTypes: ['p2p-chat', 'stoop-chat']; emitEnvelopeType: 'stoop-chat' for back-compat with desktop Stoop). |
| `@canopy/notifier` | `Notifier`, `UsageMetrics`, push channels, scheduled reminders. |
| `@canopy/skill-match` | Pubsub-of-skills broadcast over the closed group + claim flow. |
| `@canopy/pod-client` | Pod read/write/list when the user signs in with their Solid pod. |

## Direct SDK use

Same as desktop Stoop — composing substrates only.

## Bring it up

> **Status (2026-05-08): Phase 40.1 scaffold.** A real device
> bring-up runbook lands in Phase 40.12.

```bash
cd apps/stoop-mobile
npm install --legacy-peer-deps
npm test            # vitest smoke (no real device)

# Dev-build flow (when the screens are real):
npm start           # expo start (Metro)
npm run android     # build + install dev-client on a connected Android
```

## Authentication

Pod sign-in lands in Phase 40.3 work that already shipped: the
`@canopy/oidc-session-rn` substrate provides `OidcSessionRN`
(token persistence under the `stoop-oidc-*` secure-store keys) and
`useOidcSignIn` (the hook) at the `/hook` subpath. Stoop V3 ships
**local-only by default** — pod sign-in is opt-in once the
substrate is wired in to a SignInScreen during Phase 40.10.

The Inrupt-cleanup TODO
([`Project Files/TODO-GENERAL.md`](../../Project%20Files/TODO-GENERAL.md))
will eventually unify pod-share/auth UX across all apps; Stoop V3's
auth surface migrates with the rest.

## Settings layout

Stoop V3 mobile uses the same `mem://stoop/settings/...` pod path
as desktop Stoop (per
[`Project Files/conventions/cross-app-settings.md`](../../Project%20Files/conventions/cross-app-settings.md)):

```
<pod>/stoop/settings/shared.json              user-portable
<pod>/stoop/settings/devices/<deviceId>.json  per-install (this phone)
```

The `deviceId` is fresh per install (Phase 33.1's UUIDv4); the same
mnemonic restored on phone + laptop produces matching `stableId`
(Phase 32 HKDF) but distinct `deviceId`s, so per-device settings
don't cross-contaminate.

**Mobile-default field overrides** (per
[`v3-mobile-functional-design-2026-05-08.md`](../../Project%20Files/Stoop/v3-mobile-functional-design-2026-05-08.md) §4g):

- `pollIntervalMs`: 5000 (vs desktop's 2000) — battery-aware.
- `onlineWindow.everyMinutes`: null on first run — push is the
  primary wakeup; background-fetch is opt-in.

## Personal-pod URLs do not travel peer-to-peer

Same project-wide rule as desktop Stoop (see
[`Project Files/projects/README.md`](../../Project%20Files/projects/README.md#personal-pod-urls-stay-out-of-peer-to-peer-messages--applies-to-every-agentic-project-here)).
Image attachments ship as bytes (resized on the device); no pod
URL ever crosses the wire.

## Localisation

Stoop V3 mobile reuses [`apps/stoop/locales/`](../stoop/locales/)
— same keys, same `{text, doc}` leaf shape. A small `mobile.*`
namespace will land in Phase 40.10 for mobile-only strings (camera
permission rationale, push permission rationale, "Take a photo"
CTA, etc.).

## Agent Hub compatibility

**Attachment model:** `standalone`. Same as desktop Stoop. Hub is
planned as a **separate phone app** (per the 2026-05-08 update in
[`projects/README.md`](../../Project%20Files/projects/README.md));
lite-mode is deferred for V1 / V2.5 / V3.

## Platform support

**Android primary.** iOS is acknowledged out-of-scope per the
project-wide rule
([main README](../../README.md#platform-support--ios-deliberately-out-of-scope-locked-2026-05-08)).
The app may run on iOS via Expo, but no iOS code paths, tests, or
release process.

## Tests

```bash
cd apps/stoop-mobile
npm test
```

Vitest with mocked Expo + RN modules (no real device). Per-phase
behavioural coverage lands as each phase ships.

## What's in here (Phase 40.1)

```
apps/stoop-mobile/
├── README.md           ← this file
├── package.json        ← @canopy-app/stoop-mobile
├── app.json            ← Expo config (scheme: stoop, perms)
├── babel.config.js     ← babel-preset-expo
├── metro.config.js     ← @canopy/react-native preset + stoop-shaped pins
├── vitest.config.js    ← vitest aliases for testing
├── index.js            ← entry: polyfills + registerRootComponent
├── App.js              ← root component (welcome placeholder)
├── src/                ← screens, lib, auth, navigation (lands in 40.10+)
└── test/               ← smoke + setup + stubs
```

Real screens + lib + auth folders fill in as phases land.
