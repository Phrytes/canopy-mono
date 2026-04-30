# @canopy-app/folio-mobile

Folio.C2 — React Native mobile client for [Folio](../folio/), the
Solid-pod-backed markdown notes app built on the @canopy SDK.

This is a separate workspace from `apps/mesh-demo` (per Q-C1.3); the two
apps share `packages/*` but maintain independent Expo configurations.

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

## Quick start

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

## Tests

```bash
npm test --prefix apps/folio-mobile
```

Tests use vitest with mocked Expo + RN modules (see `test/setup.js`).
The tests do NOT touch a real device, real Inrupt issuer, or real
filesystem — they exercise the auth state machine, ServiceContext
wiring, screen logic, and conflict-merge helpers in isolation.

## Layout

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
