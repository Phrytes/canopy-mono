# @canopy-app/folio-mobile

> **Layer: app.** Composes substrates from `packages/{item-store, agent-ui, ...}`. Direct SDK use is allowed only when justified in this README's `## Direct SDK use` section (per [`app-readme-scheme.md`](../../Project%20Files/conventions/app-readme-scheme.md)). See [`Project Files/conventions/architectural-layering.md`](../../Project%20Files/conventions/architectural-layering.md). **Known direct SDK use:** `pod-client.PodClient` + `core.Bootstrap` — the canonical "no substrate fits yet" example called out in the layering doc.

Folio.C2 — React Native mobile client for [Folio](../folio/), the
Solid-pod-backed markdown notes app built on the @canopy SDK.

This is a separate workspace from `apps/mesh-demo` (per Q-C1.3); the two
apps share `packages/*` but maintain independent Expo configurations.

## Substrates

This app composes the following substrate packages
(see [`Project Files/conventions/architectural-layering.md`](../../Project%20Files/conventions/architectural-layering.md)):

| Package | Used for | Why a substrate, not direct SDK |
|---|---|---|
| `@canopy/sync-engine` (L1a) | Bidirectional pod ↔ local-folder sync (RN side: `expo-file-system` + RN watcher adapter). Pulled in via the `@canopy-app/folio` app library. | Folio shipped this substrate; mobile reuses the engine + RN adapters via Folio's app-side service factory. |

The `@canopy-app/folio` workspace is **not** a substrate — it's a sibling app that exports its `SyncEngine` subclass + RN service factory for Folio Mobile to consume. This is the Folio C1 pluggable-engine pattern.

## Direct SDK use

| SDK package | Primitive | Used for | Justification |
|---|---|---|---|
| `@canopy/pod-client` | `PodClient`, `SolidOidcAuth` | Solid pod read/write/list + OIDC auth flow (mobile-side, `expo-auth-session`). | Folio is one of the canonical PodClient consumers; no substrate currently wraps "construct an authenticated PodClient from an OIDC flow on RN." Layering doc lists this as the canonical "no substrate fits yet" example. |
| `@canopy/core` | `PodCapabilityToken` | Share screen — accept incoming capability tokens from another agent. | Capability-token primitive is SDK-foundational; substrates compose it, they don't wrap it. |
| `@canopy/react-native` | `platform/polyfills` (entry-point side-effect import) | RN bring-up: `react-native-get-random-values` + `nacl-util` polyfills before any crypto runs. | Platform layer — RN-specific bring-up lives in `@canopy/react-native` by design; no substrate wraps it. |

## Status

**v0** — Phase C deliverable.  Screens + auth + plain-TextInput editor.
Built on top of Folio.C1's pluggable RN engine adapters.

Out of scope for this slice:

- Push notifications
- App Store / Play Store packaging
- Tablet / iPad layouts
- Offline-only mode
- Markdown preview / syntax highlighting
- Background sync wiring (the C1 `backgroundTasks.js` foundation is
  present but not yet auto-registered — manual sync only)
- Multi-account support

## Bring it up

### Install

```bash
# From the repo root.
npm install --prefix apps/folio-mobile
```

The workspace pulls Folio + the SDK packages via `file:` deps so
local edits to `apps/folio/` and `packages/*` are picked up by Metro
without re-publishing.

### Run on emulator

```bash
cd apps/folio-mobile
npx expo start

# Then press 'a' for Android emulator (Android Studio AVD running).
```

The first build will take a couple of minutes — Metro re-bundles all
of `packages/core` + `packages/pod-client` + `packages/react-native` +
`apps/folio` into the dev bundle.  Subsequent fast-refreshes are
sub-second.

### Run on real device (dev build)

The mesh-demo's existing dev build is installed on the user's phone.
Folio-mobile uses a **different** application ID
(`ag.canopy.foliomobile`), so it needs its own dev build.  Per
CLAUDE.md, you should NOT run `npx expo run:android` for this app
without explicit user approval — that prebuilds and installs a fresh
APK.

When the user IS ready for a real-device build:

```bash
# user-attended only
cd apps/folio-mobile
npx expo run:android
```

After install, `npx expo start` in the same terminal serves the JS
bundle to the dev build over LAN.

## Authentication

Auth uses [`expo-auth-session`](https://docs.expo.dev/versions/latest/sdk/auth-session/)
with PKCE against the Solid OIDC issuer.  Default issuer is
`https://login.inrupt.com`; override via `<SignInScreen issuer="..." />`
or by editing `src/lib/config.js`'s `DEFAULT_INRUPT_ISSUER`.

Custom URL scheme: `folio://auth/callback` (declared in `app.json`).

Refresh tokens go to `expo-secure-store` (iOS Keychain / Android
Keystore).  See `src/auth/OidcSessionRN.js` for the storage keys.

## Known iOS limitations

- **Custom URL scheme on Android Expo Go is flaky** — use a dev build
  for sign-in testing.  Expo Go does not understand
  `folio://auth/callback`.
- **Background fetch is best-effort.**  iOS schedules background-fetch
  opportunistically; the configured cadence is a *floor*, not a
  guarantee.  Android applies Doze.  See the C1 plan §Q-C1.4.
- **DPoP / token-binding is not implemented** at v0.  Bearer-token
  auth is sufficient against `storage.inrupt.com`; pods that REQUIRE
  DPoP will reject our writes with 401.  Track via the follow-up plan.
- **iOS filesystem model (sandbox, document picker, security-scoped
  bookmarks, no folder watcher).**  Folio mobile is Android-only at
  this stage; iOS is not on the roadmap.  Design notes for the iOS
  filesystem story (so the work isn't lost) live in
  [`docs/IOS-FILESYSTEM-NOTES.md`](docs/IOS-FILESYSTEM-NOTES.md).

## Tests

```bash
npm test --prefix apps/folio-mobile
```

Tests use vitest with mocked Expo + RN modules (see `test/setup.js`).
The tests do NOT touch a real device, real Inrupt issuer, or real
filesystem — they exercise the auth state machine, ServiceContext
wiring, screen logic, and conflict-merge helpers in isolation.

## Settings layout

Folio-mobile shares its settings namespace with the desktop Folio
app — both write to `<pod>/folio/...`, NOT separate per-platform
containers. The layout follows the project-wide convention in
[`Project Files/conventions/cross-app-settings.md`](../../Project%20Files/conventions/cross-app-settings.md):

```
<pod>/folio/settings/shared.json              user-portable; shared with desktop Folio
<pod>/folio/settings/devices/<deviceId>.json  per-install (this phone, local-only)
```

The `deviceId`
([`core.AgentIdentity.deviceId`](../../packages/core/src/identity/AgentIdentity.js))
is fresh on every install — re-installing the mobile app gets a new
`devices/...` blob and starts from defaults. `shared.json` carries
over (it's pod-side and follows the user).

**Mobile-specific concerns** that belong in the per-device blob:

- Battery / online-window cadence (mobile-only; desktop Folio
  ignores these fields).
- Push-notification preferences (per device).
- "Allow background sync on cellular" — per device.

User preferences (display name, default sharing, locale) live in
`shared.json` and SHOULD be set the same way on both desktop and
mobile.

**Cross-app shared-defaults (Rule 3):** see the desktop Folio
README's Settings layout section. Mobile inherits the same
sibling-app seeding behaviour automatically since it reads the
same `shared.json`.

**Status (2026-05-07):** folio-mobile doesn't ship persisted
settings yet. Update this section when they land.

## What's in here

```
src/
  ServiceContext.js          — React context owning engine + oidc
  auth/
    folioAuth.js             — expo-auth-session + PKCE wrapper
    OidcSessionRN.js         — secure-store-backed session adapter
  screens/
    SignInScreen.js          — Solid sign-in + pod-root setup
    StatusScreen.js          — last sync, pending counts, sync now
    NotesListScreen.js       — FlatList of local notes
    NoteEditScreen.js        — plain multiline TextInput editor
    ConflictsScreen.js       — list + per-conflict resolution
    ShareScreen.js           — mint capability tokens
    SettingsScreen.js        — WebID, pod root, diagnostics, sign-out
  components/
    SyncStatusPill.js
    FileRow.js
  lib/
    config.js                — non-secret app config (pod root, issuer)
    serviceBuilder.js        — bridges to C1 RN serviceFactory
    notesList.js             — pure walker over engine.fs
    useEngineEvents.js       — re-render hook
test/
  setup.js                   — vitest mocks for Expo + RN
  auth.test.js
  ServiceContext.test.js
  screens/
    StatusScreen.test.js
    NotesListScreen.test.js
    NoteEditScreen.test.js
```

## Pinned versions

Per CLAUDE.md "Decisions already made":

- Expo 52 / React Native 0.76.9 / React 18.3.1 — match
  `apps/mesh-demo/package.json` exactly
- `react-native-webrtc 124.0.7` — needed transitively by
  `@canopy/react-native`'s WebRTC transport even when the mobile UI
  doesn't use it directly

## Hand-off pointers

- Folio.C1 (`apps/folio/src/rn/serviceFactory.js`) — the engine
  factory this app drives
- `coding-plans/track-H-folio-C1.md` §"Mobile auth flow" — auth UX
  reference
- `coding-plans/track-H-app-folio.md` §Phase C — the full Folio mobile
  vision (this slice covers v0)
