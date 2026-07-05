# `@canopy-app/stoop-mobile`

> **Direction (decided 2026-06-11; agent path confirmed 2026-06-18):** like `@canopy-app/stoop`, this
> shell **dissolves into canopy-chat** — `stoop` becomes a navigation label inside the unified chat
> surface, not a separate app/build/shell. **Agent/transport consequence (T5.3b-ii):** the cross-peer
> agent for stoop on mobile is **canopy-chat-mobile's secure-mesh agent** (the unified
> `createSecureMeshAgent`, via `createRealHouseholdAgent` → `realAgent`), inside which Stoop runs as a
> real in-process `NeighborhoodAgent` on the shared bus. That path is verified (32/32 canopy-chat stoop
> integration tests green through the migrated agent). The hand-rolled mesh in
> [`src/lib/agentBundle.js`](./src/lib/agentBundle.js) — its own `new Agent` + `RoutingStrategy` +
> `PeerGraph` — is therefore the **legacy standalone path; it retires with this shell and is NOT
> migrated in place.** (Both already seal with the *same* core `SecurityLayer`/envelope — there is no
> seal-vs-plaintext break between this bundle and the secure-mesh agent; the only deltas are the
> superset layers + hello/discovery posture, which the canopy-chat path already carries.)

> **Layer: app.** Composes substrates from
> `packages/{core, react-native, sync-engine-rn, oidc-session-rn,
> local-store, identity-resolver, item-store, chat-p2p, notifier,
> skill-match, pod-client}`.
>
> Direct kernel use is allowed only when justified in this README's
> `## Direct kernel use` section (per
> [`app-readme-scheme.md`](../../docs/conventions/app-readme-scheme.md)).
> See [`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md).
>
> **Known direct cross-app dep:** `@canopy-app/stoop` for the
> SyncEngine-shaped factory, the skill builder, groupMirror, and
> the Stoop-vocabulary attachment helpers. Same **platform-shell
> exception** as folio + folio-mobile (locked 2026-05-08); see the
> layering doc.

Stoop V3 — React Native mobile client for the buurt-skill-app.
Phase 40 of the V3 mobile coding plan.

## Status (2026-05-14 — V4 C-track shipped)

V3 mobile wiring complete 2026-05-08. **V4 C-track (mobile mirror
of Stoop V2 web's A-track) shipped 2026-05-14:**

- **C2** stale-peer auto-heal inherits from `wireSubstrateMirror`
  (no mobile-side code change).
- **C3** agent-registry registration in all three bundle bring-up
  paths (`bootstrapBundle.js` + `agentBundle.js` × 2). `bundle.podRouting`
  exposed.
- **C4** storage-policy picker step on
  `CreateGroupScreen.js` (4-radio + conditional pod-URI input).
- **C5a** "My Solid pods" section on `ProfileMineScreen.js`
  (status display via `podSignInStatus` + sign-out). Two-pod
  preset placeholder for V3+.
- **C5b** embed-ref slot on `PostComposeScreen.js` (cap 8 +
  inline validation).

EN+NL locales added; `localesIntegrity` test expanded to 593
keys (593/593 pass).

All planned coding-plan phases have shipped except **40.23**
(real-device pass — hardware-dependent) and **40.24** (this
README / handoff). The app boots an in-process agent, drives
every Stoop skill (post / chat / contacts / groups / profile /
settings / push / sign-in / skill-match), and is ready for an
end-to-end smoke test on a physical Android.

See [`../stoop/CHANGELOG.md`](../stoop/CHANGELOG.md) `0.3.0` for
the full Q-B retirement + A-track + C-track breakdown.

| Phase | Theme | State |
|---|---|---|
| 40.1  | Workspace scaffold | ✅ |
| 40.2  | `@canopy/sync-engine-rn` substrate (lifted from folio-mobile) | ✅ |
| 40.3  | `@canopy/oidc-session-rn` substrate | ✅ |
| 40.4  | `FileSystemAdapter` in `@canopy/react-native` | ✅ |
| 40.5  | Native picker (camera + library + resize); PRIKBORD / CHAT / AVATAR presets | ✅ |
| 40.6  | QR scan + render (`expo-camera` + `react-native-qrcode-svg`) | ✅ |
| 40.7  | GPS via `expo-location` | ✅ |
| 40.8  | Foreground/background ticker primitives | ✅ |
| 40.9  | Native push primitives | ✅ |
| 40.10 | UI screens (20 routes; bottom-tab shell) | ✅ |
| 40.11 | `stoop://` deep links + `DeepLinkHandler` | ✅ |
| 40.14 | ServiceContext + `useSkill` hook (critical-path bring-up) | ✅ |
| 40.15 | Profile + identity wiring | ✅ |
| 40.16 | Posts + items + new compose-controls (distance / audience picker) | ✅ |
| 40.17 | Chat + reveal handshake | ✅ |
| 40.18 | Contacts + groups + new CreateGroupScreen | ✅ |
| 40.19 | Settings + Push + SignIn + new AuthCallbackScreen | ✅ |
| 40.20 | SkillMatch broadcast-scope extension + SkillMatchInbox screen | ✅ |
| 40.21 | AppState bridge + `expo-task-manager` background-fetch | ✅ |
| 40.22 | Privacy polish — rotate-identity CTA + first-launch metadata warning | ✅ |
| **40.23** | **Real-device pass (Android)** | ⏳ **TODO — see runbook below** |
| 40.24 | Documentation + handoff | ✅ (this update) |

**Tests: 832/832 across 28 files (vitest)** — locale-integrity covers
every key the screens reference; pure-helper coverage on every lib
module; the JSX components themselves are render-tested in
spirit-only since vitest doesn't run a JSX-in-`.js` transform here.

## Real-device runbook (Phase 40.23 — hardware-dependent)

Phase 40.23 is yours to run. The wiring all lands (including the
V4 C-track shipped 2026-05-14 — storage-policy picker, embed-ref
slot, My-Solid-pods section); what's left is to walk every
journey on a connected Android, capture battery / push /
background-fetch numbers, and produce a closed-beta APK.

**Structured checklist:** [`docs/phase-40-23-checklist.md`](docs/phase-40-23-checklist.md)
— tick-off list for J1-J9 + V4 C-track checks + APK build.

**Battery measurement template:** [`docs/battery.md`](docs/battery.md)
— scenarios A/B/C + push latency capture.

Use the runbook below for context; the checklist above is the
authoritative sequence to follow on the device.

### Prerequisites

- A physical Android device (or Android Studio AVD).
- USB-debugging on; `adb devices` shows the phone.
- Java 17, Android SDK Platform-Tools.
- Two devices (or a device + a desktop Stoop install) for the
  group-onboarding journey — Anne creates a group on phone A,
  Bob scans the invite QR on phone B / desktop.

### First install

```bash
cd apps/stoop-mobile
npm install --legacy-peer-deps        # one-time

# First-time native build + install. Takes 2–10 min on a clean tree.
# DO NOT use `npx expo run:android` from outside this directory —
# npx may pull a different Expo CLI version (Expo 55 vs our pinned 52).
./node_modules/.bin/expo run:android   # OR `npm run android`
```

After the dev-client APK lands on the phone, subsequent JS-only
changes can use the lighter `npm start` path:

```bash
cd apps/stoop-mobile
npm start                              # `expo start` against the local pin
# Press 'a' on the prompt to attach to the running dev-client.
```

### Suggested smoke walkthrough

The app wires every web journey from the V1 functional design;
walk the seven of them in order:

1. **First launch.** Should land on the metadata-public privacy
   warning (Phase 40.22). Acknowledge → Welcome.
2. **Welcome → Beginnen.** Identity is auto-generated via
   KeychainVault; status flips to `'no-groups'`. The bottom-tab
   shell shows but Profile / Feed / etc. show their "join a group
   first" empty states.
3. **Welcome → Maak een nieuwe groep.** Two-question wizard →
   `createGroupV2` → ServiceContext.addGroup → admin invite QR
   shown on OnboardIssueScreen. Verify the QR renders.
4. **Second device → Welcome → Scan QR-code.** Camera opens →
   scan the admin's QR → redeem → land in the Feed of the joined
   group.
5. **Profile.** Set handle, displayName, avatar (camera /
   library), location via GPS, holiday toggle, three skills, view
   recovery phrase. Reload app → values survive.
6. **Post a vraag.** Camera-first photo, distance preset, audience
   = active group, optionally tick "Also auto-match across
   contacts." Post. Other device should see it on their Feed.
7. **Respond → chat.** From Feed, tap the post → "Ik help" → chat
   thread opens. Send a text + a photo. Trigger the reveal
   handshake. Both sides should see each other's displayName after
   the round-trip.
8. **Settings → Rotate my address now** (Phase 40.22). Confirm
   modal → rotation. New pubKey shows. Verify chat with the other
   device still works (grace period).
9. **Push.** Settings → Notifications → enable. Tap the test-push
   button. Expect a notification on the device.
10. **Background fetch.** Settings → set `onlineWindow.everyMinutes`
    to e.g. 15. Background the app. Send a message from the other
    device. Wait ≥ 15 min. Verify the receive arrived (cadence is
    OS-clamped on Doze, so 15 min is the floor).

Capture rough battery numbers per cadence preset and add to
`apps/stoop-mobile/docs/battery.md` (the file lands in 40.23 — not
yet present).

### Closed-beta build

After the smoke pass:

```bash
cd apps/stoop-mobile
./node_modules/.bin/expo prebuild      # ensures android/ exists
cd android && ./gradlew assembleRelease
# APK at android/app/build/outputs/apk/release/app-release.apk
```

Sign with EAS managed signing OR your own keystore, then drop
under `apps/stoop-mobile/release/` for distribution.

### iOS

Out-of-scope per the project-wide rule (see [main `README.md`](../../README.md#platform-support--ios-deliberately-out-of-scope-locked-2026-05-08)).
The app may run on iOS via Expo, but no iOS code paths, tests, or
release process.

## Architecture: ONE `core.Agent` for the app

ServiceContext owns a single `meshAgent` for the whole RN process.
mDNS, relay, internal-loopback, etc. are routes attached to that
agent via `addTransport()` + `RoutingStrategy`. Per-group state
(`ItemStore`, `MemberMap`, `SkillMatch`, mirror) lives in
`buildGroupState({meshAgent, ...})` and references the shared agent.
Stoop's full skill set registers on the shared agent ONCE, with a
group-aware `getBundle` resolver that picks the right group from
`args.groupId` / pubsub topic.

This is a project-wide convention — see
[`Project Files/conventions/single-agent.md`](../../docs/conventions/single-agent.md).
Don't introduce a per-group Agent. Concrete plan + rationale:
`Project Files/Stoop/single-agent-refactor-2026-05-08.md`.

## Substrates

| Package | Used for |
|---|---|
| `@canopy/core` | `Agent`, `AgentIdentity`, `KeychainVault` (via `@canopy/react-native`); identity bring-up via mnemonic-restore. |
| `@canopy/react-native` | RN platform layer: polyfills, Metro preset, `KeychainVault`, `AsyncStorageAdapter`, `FileSystemAdapter`, `MdnsTransport`, `BleTransport`, `MobilePushBridge`. |
| `@canopy/sync-engine-rn` | RN bootstrap: `setBgRunOnce`/`bgRunOnce`/`defineBackgroundTask` + the BackgroundFetch helpers. |
| `@canopy/oidc-session-rn` | RN-side Solid OIDC: `OidcSessionRN` token persistence + `useOidcSignIn` hook (at `/hook` subpath). Stoop V3 pre-binds `appId: 'stoop'`. |
| `@canopy/local-store` | `CachingDataSource`, `SyncCadence`, `createSettingsModule({appId: 'stoop', ...})`. |
| `@canopy/identity-resolver` | `MemberMap`, `MemberMapCache`, `buildOnboardingSkills`, `matchesProfile`, `TAXONOMY`. |
| `@canopy/item-store` | `ItemStore` for posts, chat-messages, claims, redemptions. |
| `@canopy/chat-p2p` | `wireChat({...})` peer-to-peer chat. |
| `@canopy/notifier` | `Notifier`, `UsageMetrics`, push channels, scheduled reminders. |
| `@canopy/skill-match` | Pubsub-of-skills broadcast over the closed group + claim flow. **Phase 40.20:** broadcast-scope extension (`extraAudience` constructor + `scope: 'group'\|'group+contacts'\|'group+contacts+hops'` on broadcast). |
| `@canopy/pod-client` | Pod read/write/list when the user signs in with their Solid pod. |

## Direct kernel use

Same as desktop Stoop — composing substrates only. The cross-app
dep `@canopy-app/stoop` is the platform-shell exception (skill
builder, group-mirror, Agent factory).

## Authentication

V3 ships **local-only by default**. Pod sign-in is opt-in via
SignInScreen (Phase 40.19): `startPodSignIn` →
`WebBrowser.openAuthSessionAsync` → `stoop://auth/callback` deep
link → `completePodSignIn` → AuthCallbackScreen polls
`getBulkSyncStatus` for the bulk-sync progress.

Token persistence rides on `@canopy/oidc-session-rn` — keys
under `stoop-oidc-*` in `expo-secure-store`.

An eventual cleanup of pod-share/auth UX across all apps is planned;
Stoop V3's auth surface migrates with the rest.

## Settings layout

Stoop V3 mobile uses the same `mem://stoop/settings/...` pod path
as desktop Stoop (per
[`Project Files/conventions/cross-app-settings.md`](../../docs/conventions/cross-app-settings.md)):

```
<pod>/stoop/settings/shared.json              user-portable
<pod>/stoop/settings/devices/<deviceId>.json  per-install (this phone)
```

The `deviceId` is fresh per install (Phase 33.1's UUIDv4); the same
mnemonic restored on phone + laptop produces matching `stableId`
(Phase 32 HKDF) but distinct `deviceId`s, so per-device settings
don't cross-contaminate.

**Mobile-default field overrides** (per
`v3-mobile-functional-design-2026-05-08.md` §4g):

- `pollIntervalMs`: 5000 (vs desktop's 2000) — battery-aware.
- `onlineWindow.everyMinutes`: null on first run — push is the
  primary wakeup; background-fetch is opt-in.

## Personal-pod URLs do not travel peer-to-peer

Same project-wide rule as desktop Stoop (see
`Project Files/projects/README.md`).
Image attachments ship as bytes (resized on the device); no pod
URL ever crosses the wire.

## Localisation

Stoop V3 mobile reuses [`apps/stoop/locales/`](../stoop/locales/)
— same keys, same `{text, doc}` leaf shape. Mobile-only strings
(camera permission rationale, "Take a photo" CTA, distance preset
labels, audience-picker copy, metadata-warning copy, skill-match
inbox copy, ...) live under per-screen namespaces (`mobile.*`,
`welcome.*`, `onboard_*`, `feed.*`, `compose.*`, `chat_thread.*`,
`contact.*`, `group.*`, `settings.*`, `signin.*`, `auth_callback.*`,
`metadata_warning.*`, `skillmatch.*`, etc.).

The locale resolver (`src/lib/localisation.js`) auto-detects the device
locale at boot via `Intl.DateTimeFormat().resolvedOptions().locale`
— `nl` if Dutch, else `en`. Settings can override later (deferred
to a follow-up).

## Agent Hub compatibility

**Attachment model:** `standalone`. Same as desktop Stoop. Hub is
planned as a **separate phone app** (per the 2026-05-08 update in
`projects/README.md`);
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

Vitest with mocked Expo + RN modules (no real device). Each phase
ships its pure-helper coverage; render-level coverage of the JSX
components is intentionally deferred (vitest's default transform
doesn't process JSX in `.js`, and adding the transform across an
RN tree introduces its own risks — the helpers + locale-integrity
catches the bulk of regressions).

The platform-side broadcast-scope extension lives in
`packages/skill-match/test/SkillMatch.test.js` (14 tests, all
green, including the four Phase 40.20 cases).

## Known limitations

- **Per-screen render tests** — deferred (see Tests section).
- **`broadcastScope: 'group+contacts+hops'`** — the platform extension
  ships with the receive-side machinery, but the *send* side
  doesn't yet auto-resolve contacts / hops to `extraAudience`
  pubKeys at bundle bring-up. Stoop's `postRequest` accepts the
  `scope` arg + tags the broadcast; the bundle's
  `extraAudience` registration awaits a small bring-up addition
  (resolve from ContactBook + MemberMap hop-flags). Documented
  here so the gap doesn't get lost; small follow-up.
- **iOS:** out of scope.
- **Auto-rotation cadence** — Phase 40.22 ships opt-in
  user-triggered rotation only. An automatic-cadence policy is
  deferred (the kernel plumbing is in place — `Agent.rotateIdentity()`
  + grace-period — but no scheduled-rotation UI yet).
- **Sub-flow polish** — handle-claim collisions, group-rule
  preview on join, attachment download progress, failed-push
  retry — these are platform behaviours that work but the mobile UI
  doesn't yet surface them prominently.
- **mDNS reliability on real Wi-Fi** — bring-up testing
  2026-05-08: same-Wi-Fi peer discovery works in some sessions,
  fails in others (one phone discovers the other but not vice
  versa, or both stop discovering after a few JS reloads).
  The relay path is the reliable fallback (`./scripts/start-relay.sh`
  + `Settings → Relay-server`). Likely contributors:
  Android NSD's native-module state surviving JS reloads in dev,
  multicast throttling on consumer routers, NSD's
  announce-on-startup model missing already-running services.
  Worth investigating: explicit `mdns.disconnect()` cycle on
  Re-probe, exposing `MdnsTransport.connectionCount` in the
  diagnostic, raising `FRESHNESS_MS` past the gossip cadence so
  routing doesn't go stale between rounds. **Filed 2026-05-08.**

## File layout

```
apps/stoop-mobile/
├── README.md                  ← this file
├── package.json               ← @canopy-app/stoop-mobile
├── app.json                   ← Expo config (scheme: stoop, perms)
├── babel.config.js
├── metro.config.js            ← @canopy/react-native preset + stoop-shaped pins
├── vitest.config.js           ← vitest aliases for testing
├── index.js                   ← entry: polyfills + defineBackgroundTask + registerRootComponent
├── App.js                     ← root: ServiceProvider + NavigationContainer + DeepLinkHandler + ShellTabs
├── src/
│   ├── ServiceContext.js      ← per-group bundle owner
│   ├── navigation.js          ← ROUTES, ROUTE_ORDER, SHELL_TAB_ROUTES
│   ├── screens/               ← 22 screens (one per route)
│   ├── components/            ← AvatarCircle, ChipRow, PostCard, ConfirmModal,
│   │                              AttachmentModal, SkillPicker, AudiencePicker, QrCode
│   └── lib/                   ← hooks + pure helpers
│       ├── localisation.js, theme.js, navigation helpers
│       ├── identityBootstrap.js, groupRegistry.js, agentBundle.js
│       ├── useSkill.js, useSkillResult.js, useAgentEvent.js
│       ├── useProfile.js, useMemberProfile.js, useSettings.js
│       ├── imagePicker.js, qrScanner.js, push.js, geo.js
│       ├── compose.js, audience.js, feedFilter.js, post.js, avatar.js
│       ├── chat.js, contacts.js, mnemonic.js, handle.js
│       ├── deepLinks.js, onboardScanRouting.js, skillPicker.js
│       ├── settings.js, skillParts.js
│       ├── skillMatchListener.js, metadataWarning.js
│       └── activeCadence.js, appStateBridge.js, bgRunOnce.js
└── test/                      ← 28 vitest files (832 tests)
```
