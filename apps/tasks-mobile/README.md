# `@canopy-app/tasks-mobile`

> **Layer: app.** Composes substrates from
> `packages/{core, react-native, sync-engine-rn, oidc-session-rn,
> online-cadence, local-store, identity-resolver, item-store, chat-p2p,
> notifier, skill-match, pod-client}`.
>
> Direct SDK use is allowed only when justified in this README's
> `## Direct SDK use` section (per
> [`app-readme-scheme.md`](../../Project%20Files/conventions/app-readme-scheme.md)).
> See [`Project Files/conventions/architectural-layering.md`](../../Project%20Files/conventions/architectural-layering.md).
>
> **Known direct cross-app dep:** `@canopy-app/tasks-v0` for the
> V2.8 single-agent factories (`buildMeshAgent`, `wireSkills`,
> `bundleResolver`, `createCrewAgent`), the role-policy table, and
> the Tasks-vocabulary attachment helpers. Same **platform-shell
> exception** as folio + folio-mobile + stoop-mobile (locked
> 2026-05-08); see the layering doc.

Tasks V1 — React Native mobile client for the per-crew tasks app.
Phase 41 of the [Tasks-mobile coding plan](../../Project%20Files/Tasks%20App/mobile-coding-plan-2026-05-08.md).

## Status (2026-05-09)

Phase 41.1 scaffold landed. The placeholder screen renders inside a
`<NavigationContainer>`; the agent + ServiceContext + screens land in
Phase 41.2 and onwards.

| Phase | Theme | State |
|---|---|---|
| 41.0  | Substrate lifts (L1–L7 from stoop-mobile/src/lib) | ✅ |
| **41.1** | **Workspace scaffold (this commit)** | **✅** |
| 41.2  | ServiceContext + agent bring-up + useSkill hooks | ⏳ |
| 41.3  | Onboarding (Welcome / Scan / Restore / Issue) | ⏳ |
| 41.4  | Workspace + task detail + V2.7 gate UI | ⏳ |
| 41.5  | My work + planner + photo deliverable submit | ⏳ |
| 41.6  | Review + DAG + Inbox + crew context switch | ⏳ |
| 41.7  | Crews dashboard + multi-crew management | ⏳ |
| 41.8  | Crew settings panels | ⏳ |
| 41.9  | Availability grid | ⏳ |
| 41.10 | Profile (avatar, handle, skills, recovery) | ⏳ |
| 41.11 | Settings + push opt-in + per-event toggles | ⏳ |
| 41.12 | Native calendar integration | ⏳ |
| 41.13 | Bot-binding QR | ⏳ |
| 41.14 | AppState bridge + bg-fetch task | ⏳ |
| 41.15 | Sign-in (pod) + bulk sync | ⏳ |
| 41.16 | Real-device pass + closed-beta APK | ⏳ |
| 41.17 | Documentation + handoff | ⏳ |

## Substrates

This app composes the following substrate packages
(see [`Project Files/conventions/architectural-layering.md`](../../Project%20Files/conventions/architectural-layering.md)):

| Package | Used for | Why a substrate, not direct SDK |
|---|---|---|
| `@canopy/item-store` (L1b) | Per-crew task ledger with audit + DoD lifecycle + V2.7 dependency gating. | Pod write paths, role-policy gates, and `enforceDependencies` are reused unchanged from the desktop app. |
| `@canopy/identity-resolver` (L1h) | Member webid map + `MemberMapCache` write-through; canonical user-skills profile. | Same as desktop; substrate amortises across H4/H5/H7. |
| `@canopy/skill-match` (L1e) | Pubsub-of-skills broadcast for crew-wide skill availability. | Same primitive as the desktop. |
| `@canopy/notifier` (L1f) | `PushChannel` + `PushPolicy` (humanInTheLoop, daily-cap, quiet hours). | The whole notifier surface is shared with stoop and the desktop tasks app. |
| `@canopy/chat-p2p` | Appeal flow chat threads (V1 master-revoke recourse). | Shared with stoop V1. |
| `@canopy/local-store` | `CachingDataSource` + `Settings` split (per-device + shared). | Local-only mode is a hard rule in V1; substrate guarantees offline-first. |
| `@canopy/online-cadence` | Foreground ticker + AppState bridge + bg-fetch helpers. | Lifted in Phase 41.0 (rule of two with stoop-mobile). |
| `@canopy/sync-engine-rn` (`./react`) | `useSkill` / `useAgentEvent` / `useSkillResult` hooks bound to ServiceContext. | Hook factory lifted in Phase 41.0 L1. |
| `@canopy/sync-engine-rn` | `createMobileBootstrap`, `bgRunOnce`, `registerBackgroundTask`. | RN-only bootstrap surface. |
| `@canopy/oidc-session-rn` | Pod sign-in (Phase 41.15). | RN-only OIDC flow. |
| `@canopy/react-native` | `KeychainVault`, `AsyncStorageAdapter`, `FileSystemAdapter`, `MdnsTransport`, `BleTransport`, `MobilePushBridge`, `requestMeshPermissions`, `createMeshAgent`, `metro-preset`. | The whole RN platform layer. |
| `@canopy/react-native/picker` | `pickAndResize({mode, preset})` for deliverable photos + avatars. | Phase 41.0 L3 lift. |
| `@canopy/react-native/qr` | `classifyQrPayload(text, classifiers)` + `<QrCodeView>`. | Phase 41.0 L4 lift. Tasks registers its own classifier list (`tasks://invite`, `tasks://bot-token`, BIP-39, contact-share). |
| `@canopy/react-native/mnemonic` | Pure helpers + `useMnemonicReveal` hook + `<MnemonicView>` (recovery phrase). | Phase 41.0 L5 lift. |
| `@canopy/react-native/push` | `setupPush` + `requestPushPermission` + `usePushOptIn` hook. | Phase 41.0 L6 lift. |
| `@canopy/react-native/i18n` | `loadLocale({bundles, defaultLang})` resolver. | Phase 41.0 L7 lift; locales come from `apps/tasks-v0/locales/{en,nl}.json` (and a tasks-mobile-only `locales/{en,nl}.json` for mobile-screen strings). |

## Direct SDK use

| SDK package | Primitive | Used for | Justification |
|---|---|---|---|
| `@canopy/core` | `Agent`, `defineSkill`, `MemorySource`, `DataPart` | App constructs the meshAgent + per-crew CrewStates via the V2.8 factories from `@canopy-app/tasks-v0`. Direct core imports come along because the platform-shell exception applies. | The V2.8 single-agent topology is a layering primitive; constructing it goes through the desktop barrel by design. |
| `@canopy-app/tasks-v0` | `buildMeshAgent`, `wireSkills`, `bundleResolver`, `createCrewAgent`, `buildStandardRolePolicy` | Skill registration + per-crew state + role-policy. | **Platform-shell exception** (locked 2026-05-08, same as folio + stoop) — the desktop barrel owns the skill-builder factory; mobile imports it instead of forking. |

## Agent Hub compatibility

**Attachment model:** `standalone`. The Hub does not exist yet (per the
2026-05-08 Hub design pivot, hub-attachment is deferred until the Hub
ships as a separate phone app). This app embeds the substrate
directly. Designed so a future migration to `hub-attached (lite)` is
possible — see the four design rules in
[`Project Files/conventions/app-readme-scheme.md`](../../Project%20Files/conventions/app-readme-scheme.md#template--the--agent-hub-compatibility-section).

**Agent topology:** runs ONE process-wide meshAgent (V2.8 shape) that
serves N CrewStates. Multiple crews share the agent's transports +
identity vault; per-crew state (ItemStore, MemberMap, chat
controller, calendar emission, invoicing, bot agents) lives in
`Map<crewId, CrewState>`. Same factory exposed by the desktop tasks
app (`@canopy-app/tasks-v0/MeshAgent`).

**Capability scope:** subscribe to each joined crew's group;
broadcast skill requests + collect claims within those groups; pod
writes go through `item-store` (no direct pod-client use).
Cap-token-bound bot agents (V1.5) spin up per binding and share the
meshAgent's bus.

## Bring it up

```bash
cd apps/tasks-mobile
npm install
npm test                           # scaffold smoke (Phase 41.1) + future per-phase tests
```

Real-device bring-up (Android — iOS is out of scope):

```bash
expo start --dev-client            # builds the JS bundle
expo run:android --device          # sideloads on a real phone
```

The dev client must be built once with the full @canopy/react-native
autolinking (mDNS + BLE + push). Reuse stoop-mobile's dev client when
you can — same Expo 52 / RN 0.76.9 pin.

### Localisation

Supported locales: **en**, **nl**. Locales are split between two
sources:

- **App-level strings** (workspace, my-work, planner, deliverable
  photo, mobile-only inbox copy) live at `apps/tasks-mobile/locales/{en,nl}.json`.
- **Crew + role + DoD + skill-taxonomy strings** are reused from
  `apps/tasks-v0/locales/{en,nl}.json` so desktop + mobile stay in
  sync.

Both bundles get merged at boot and fed to
`loadLocale({bundles, defaultLang})` from
`@canopy/react-native/i18n`. To add a locale: drop a new
`locales/<lang>.json` matching the en shape, add it to the merge
call in `src/I18nProvider.js`, declare the `<lang>` key on
`loadLocale({bundles})`.

## What's in here

```
apps/tasks-mobile/
├── README.md                ← this file
├── package.json
├── app.json                 ← Expo config (slug "tasks", scheme "tasks://")
├── babel.config.js
├── metro.config.js          ← @canopy/react-native/metro-preset + Tasks-specific watch folders
├── vitest.config.js
├── index.js                 ← polyfills + Expo registerRootComponent
├── App.js                   ← placeholder NavigationContainer (Phase 41.1)
├── locales/                 ← mobile-only screen strings (Phase 41.3 onwards)
├── src/                     ← screens, lib, ServiceContext (Phase 41.2 onwards)
└── test/
    └── scaffold.test.js     ← smoke: App.js exports a function
```
