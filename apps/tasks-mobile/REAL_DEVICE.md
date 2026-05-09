# Real-device gotchas (Phase 41.16 reference)

> **Audience:** the developer running `expo run:android --device`
> against tasks-mobile for the first time.
>
> Treat this as a debugging cheat sheet, not a runbook. The runbook
> (the 13 user journeys to walk through) is in
> [`README.md`](./README.md#real-device-test-plan-phase-4116-runbook).

## Pre-flight

1. **Reuse stoop-mobile's dev client when you can.** Same Expo 52 +
   RN 0.76.9 pin; the autolinked native modules are a strict
   superset (Tasks adds expo-calendar, otherwise identical). Saves
   30–40 min of native-build time.
2. **`npx expo prebuild --clean`** if you've changed `app.json`'s
   permissions list — the Android manifest is regenerated from
   that.
3. **Clear the Metro cache** when you swap dev clients between
   stoop-mobile and tasks-mobile in the same session:
   `expo start --clear`. The metro-preset's alias map has
   per-app subpath resolvers (Trap 2 in BRING-UP-NOTES); a stale
   cache hands tasks-mobile stoop's `@canopy-app/stoop` resolution.

## First-run checklist

- [ ] App launches → Welcome screen renders. If the splash hangs >
      5 s, the boot pipeline is stuck — `adb logcat | grep
      ServiceContext` for the trace. Likely culprits: KeychainVault
      (autolinking failure), AsyncStorage (also autolinking), or a
      `react-native-keychain` upgrade that broke ABI.
- [ ] Welcome → "Scan invite QR" pops the camera. If "Camera
      permission denied" loops, the OS permissions request returned
      `denied` once; clear app data + retry.
- [ ] Scan a QR generated from `bin/tasks-ui.js --crew-list
      ./tmp/two-crews.list.json` (encoded as `tasks://invite?token=`
      via the desktop IssueScreen flow, or `expo url` to deep-link
      directly with a valid invite token).
- [ ] After joining, Workspace renders. The FAB is bottom-right;
      tap to compose.

## Common failure modes

### Boot fails with "ServiceContext: bootstrapIdentity failed"

- **Symptom:** error overlay says `bootstrapIdentity: vault or
  vaultFactory required`, or the keychain throws `code:
  E_USER_AUTH_FAILED`.
- **Cause #1:** `react-native-keychain` not autolinked. Verify
  `cd android && ./gradlew :react-native-keychain:tasks` lists
  Tasks; if not, `expo run:android` to rebuild the dev client.
- **Cause #2:** the device locks itself between launches and
  `KeychainVault.get('agent-privkey')` throws `BIOMETRY_LOCKOUT`.
  Add a fallback in `useTasksAuth` if this matters; for V1 we ship
  the Stoop-shape (no biometry gate on the agent identity).

### Camera doesn't open / "permission denied" loop

- The permission rationale modal (`PermissionRationale`) is wired
  to `expo-camera`'s `useCameraPermissions()`; tap "Continue" once
  to allow. If you tapped "Don't allow" once, the OS suppresses
  subsequent requests — open System Settings → Apps → Tasks →
  Permissions and toggle Camera back on.

### Bot-token QR shows but the receiver "rejects token"

- Cap-tokens are bound to the issuing agent's pubKey + the chatId.
  If the bot client was rebuilt against a different identity (e.g.
  you re-installed the app), revoke the old token in CrewSettings
  and re-issue.
- The `tasks://bot-token?...` payload is a few hundred bytes —
  fits in a Version 25 QR. If a phone struggles to scan, increase
  the QR size in `IssueBotTokenScreen` (currently 256 px).

### Pod sign-in: "redirect didn't return"

- `app.json` declares `scheme: "tasks"`. `expo-auth-session`'s
  redirect URI computes to `tasks://auth/callback`. Check the
  intent filter in `android/app/src/main/AndroidManifest.xml`
  after `expo prebuild`:
  ```xml
  <data android:scheme="tasks" android:host="auth" android:pathPrefix="/callback" />
  ```
- The Inrupt IdP's Dynamic Client Registration (DCR) caches the
  client_id under SecureStore key `tasks-oidc-client`. If you rotate
  identities, run `clearStoredClient` or wipe app data.

### Native calendar: events don't appear

- Phase 41.12 ships native-write-on-demand only — the live
  `wireCalendarEmission` listener that pushes diffs in real time
  is V1.x deferred. For V1 you have to flip
  `Settings.calendarSyncMethod` to `native` AND complete + submit
  a task to trigger a write.
- The Tasks-owned calendar is created with `accessLevel: 'owner'`.
  If your phone has multiple calendar accounts, check the system
  Calendar app's sidebar — the Tasks calendar will be under the
  local source.

### bg-fetch never fires

- `defineBackgroundTask` runs at JS-bundle load (`index.js`).
  `registerBackgroundFetch` runs after the meshAgent boots
  (ServiceContext). The task only fires when the OS schedules it —
  Android batches bg-fetch every 15 min minimum, often longer.
  Test with `adb shell cmd jobscheduler run -f
  ag.canopy.tasksmobile <jobId>`.

## Performance baseline (Pixel 5, dev client)

- Cold start → first Workspace render: target < 3 s. Most of the
  time is `buildMeshAgent` (~600 ms) + `wireSkills` registering
  the 60+ skills (~200 ms) + the React tree mount (~400 ms).
- Pull-to-refresh on Workspace: target < 500 ms. The skill itself
  resolves in ~10 ms locally; the rest is RN's FlatList re-render.

## EAS Build (closed beta)

```bash
cd apps/tasks-mobile
eas login                      # once per machine
eas build --platform android --profile preview
```

`eas.json` defines three profiles:
- `development`  — debug APK with the dev client.
- `preview`      — release-build APK, internal distribution.
- `production`   — AAB for the Play Store, store distribution.

The closed-beta APK is the `preview` profile. Distribute the
download URL (`expo build:status` shows it) to closed-beta testers.
