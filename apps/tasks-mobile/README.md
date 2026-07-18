# `@onderling-app/tasks-mobile`

> **Layer: app.** Composes substrates from
> `packages/{core, react-native, sync-engine-rn, oidc-session-rn,
> online-cadence, local-store, identity-resolver, item-store, chat-p2p,
> notifier, skill-match, pod-client}`.
>
> Direct kernel use is allowed only when justified in this README's
> `## Direct kernel use` section (per
> [`app-readme-scheme.md`](../../docs/conventions/app-readme-scheme.md)).
> See [`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md).
>
> **Known direct cross-app dep:** `@onderling-app/tasks` for the
> V2.8 single-agent factories (`buildMeshAgent`, `wireSkills`,
> `bundleResolver`, `createCircleAgent`), the role-policy table, and
> the Tasks-vocabulary attachment helpers. Same **platform-shell
> exception** as folio + folio-mobile + stoop-mobile (locked
> 2026-05-08); see the layering doc.

Tasks V1 — React Native mobile client for the per-circle tasks app.
Phase 41 of the Tasks-mobile coding plan.

## Status (2026-05-09)

V1 functional surface **complete** — see [CHANGELOG.md](./CHANGELOG.md)
for the full release-summary entry. 19 screens + 6 circle-settings
sub-sections + 5 cross-cutting library helpers. 106/106 tests green.

| Phase | Theme | State |
|---|---|---|
| 41.0  | Substrate lifts (L1–L7 from stoop-mobile/src/lib) | ✅ |
| 41.0.b | Round-2 substrate lifts (A1–A7 + B0–B4) | ✅ |
| 41.1  | Workspace scaffold | ✅ |
| 41.2  | ServiceContext + agent bring-up + useSkill hooks | ✅ |
| 41.3  | Onboarding (Welcome / Scan / Restore / Issue) | ✅ |
| 41.4  | Workspace + task detail + V2.7 gate UI | ✅ |
| 41.5  | My work + planner + photo deliverable submit | ✅ |
| 41.6  | Review + DAG + Inbox + circle context switch | ✅ |
| 41.7  | Circles dashboard + multi-circle management | ✅ |
| 41.8  | Circle settings panels (6 sections) | ✅ |
| 41.9  | Availability grid | ✅ |
| 41.10 | Profile (avatar, handle, skills, recovery) | ✅ |
| 41.11 | Settings + push opt-in + per-event toggles | ✅ |
| 41.12 | Native calendar integration | ✅ |
| 41.13 | Bot-binding QR | ✅ |
| 41.14 | AppState bridge + bg-fetch task | ✅ |
| 41.15 | Sign-in (pod) + bulk sync | ✅ |
| **41.16** | **Real-device pass + closed-beta APK** | ⏳ **Hardware pending** (parallel to Stoop's 40.23) |
| 41.17 | Documentation + handoff | ✅ |

## Phase 52.x substrate adoption (2026-05-15)

Tasks-mobile inherits the substrate-side restructure (Phase 52.x)
through the **platform-shell exception** — `buildMeshAgent` from
`@onderling-app/tasks` wires the substrate primitives once for both
shells, so mobile picks them up without app-side glue:

| Phase | Surface | Adopted via |
|---|---|---|
| 52.1  | `item-types/note` + `task` canonical schemas | desktop barrel (`buildMeshAgent`) |
| 52.9.3 | Tasks substrate-mirror (cross-device task fan-out) | desktop `Circle.js` → `wireTasksSubstrateMirror` |
| 52.10 | agent-registry per-bundle | desktop `MeshAgent` (`buildMeshAgent`) |
| 52.14 | Q-D Lamport `_v` stale-peer auto-heal | desktop `Circle.js` |
| 52.15 | Multi-issuer auth substrate (RN flavour) | `src/auth/useTasksAuth.js` → `useOidcSignIn` from `@onderling/oidc-session-rn/hook` |
| 52.15.5 | `<IssuerPicker>` in PodSignInScreen | `src/screens/PodSignInScreen.jsx` |
| 52.16 | ACP/WAC sharing v2 (`client.sharing.*`) | desktop barrel (no mobile-only sharing flows in V1) |

No mobile-specific changes are required for 52.9.3 / 52.10 / 52.14 —
they're all process-wide primitives that ride on the desktop's
`buildMeshAgent`. The mobile-specific Phase 52 work is 52.15 (the RN
OIDC hook) + 52.15.5 (the picker component), both shipped.

## Substrates

This app composes the following substrate packages
(see [`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md)):

| Package | Used for | Why a substrate, not direct kernel |
|---|---|---|
| `@onderling/item-store` (L1b) | Per-circle task ledger with audit + DoD lifecycle + V2.7 dependency gating. | Pod write paths, role-policy gates, and `enforceDependencies` are reused unchanged from the desktop app. |
| `@onderling/identity-resolver` (L1h) | Member webid map + `MemberMapCache` write-through; canonical user-skills profile. | Same as desktop; substrate amortises across H4/H5/H7. |
| `@onderling/offering-match` (L1e) | Pubsub-of-skills broadcast for circle-wide skill availability. | Same primitive as the desktop. |
| `@onderling/notifier` (L1f) | `PushChannel` + `PushPolicy` (humanInTheLoop, daily-cap, quiet hours). | The whole notifier surface is shared with stoop and the desktop tasks app. |
| `@onderling/chat-p2p` | Appeal flow chat threads (V1 master-revoke recourse). | Shared with stoop V1. |
| `@onderling/local-store` | `CachingDataSource` + `Settings` split (per-device + shared). | Local-only mode is a hard rule in V1; substrate guarantees offline-first. |
| `@onderling/online-cadence` | Foreground ticker + AppState bridge + bg-fetch helpers. | Lifted in Phase 41.0 (rule of two with stoop-mobile). |
| `@onderling/sync-engine-rn` (`./react`) | `useSkill` / `useAgentEvent` / `useSkillResult` hooks bound to ServiceContext. | Hook factory lifted in Phase 41.0 L1. |
| `@onderling/sync-engine-rn` | `createMobileBootstrap`, `bgRunOnce`, `registerBackgroundTask`. | RN-only bootstrap surface. |
| `@onderling/oidc-session-rn` | Pod sign-in (Phase 41.15). | RN-only OIDC flow. |
| `@onderling/react-native` | `KeychainVault`, `AsyncStorageAdapter`, `FileSystemAdapter`, `MdnsTransport`, `BleTransport`, `MobilePushBridge`, `requestMeshPermissions`, `createMeshAgent`, `metro-preset`. | The whole RN platform layer. |
| `@onderling/react-native/picker` | `pickAndResize({mode, preset})` for deliverable photos + avatars. | Phase 41.0 L3 lift. |
| `@onderling/react-native/qr` | `classifyQrPayload(text, classifiers)` + `<QrCodeView>`. | Phase 41.0 L4 lift. Tasks registers its own classifier list (`tasks://invite`, `tasks://bot-token`, BIP-39, contact-share). |
| `@onderling/react-native/mnemonic` | Pure helpers + `useMnemonicReveal` hook + `<MnemonicView>` (recovery phrase). | Phase 41.0 L5 lift. |
| `@onderling/react-native/push` | `setupPush` + `requestPushPermission` + `usePushOptIn` hook. | Phase 41.0 L6 lift. |
| `@onderling/react-native/localisation` | `loadLocale({bundles, defaultLang})` resolver. | Phase 41.0 L7 lift; locales come from `apps/tasks-v0/locales/{en,nl}.json` (and a tasks-mobile-only `locales/{en,nl}.json` for mobile-screen strings). |

## Direct kernel use

| Kernel/adapter package | Primitive | Used for | Justification |
|---|---|---|---|
| `@onderling/core` | `Agent`, `defineSkill`, `MemorySource`, `DataPart` | App constructs the meshAgent + per-circle CircleStates via the V2.8 factories from `@onderling-app/tasks`. Direct core imports come along because the platform-shell exception applies. | The V2.8 single-agent topology is a layering primitive; constructing it goes through the desktop barrel by design. |
| `@onderling-app/tasks` | `buildMeshAgent`, `wireSkills`, `bundleResolver`, `createCircleAgent`, `buildStandardRolePolicy` | Skill registration + per-circle state + role-policy. | **Platform-shell exception** (locked 2026-05-08, same as folio + stoop) — the desktop barrel owns the skill-builder factory; mobile imports it instead of forking. |

## Agent Hub compatibility

**Attachment model:** `standalone`. The Hub does not exist yet (per the
2026-05-08 Hub design pivot, hub-attachment is deferred until the Hub
ships as a separate phone app). This app embeds the substrate
directly. Designed so a future migration to `hub-attached (lite)` is
possible — see the four design rules in
[`Project Files/conventions/app-readme-scheme.md`](../../docs/conventions/app-readme-scheme.md#template--the--agent-hub-compatibility-section).

**Agent topology:** runs ONE process-wide meshAgent (V2.8 shape) that
serves N CircleStates. Multiple circles share the agent's transports +
identity vault; per-circle state (ItemStore, MemberMap, chat
controller, calendar emission, invoicing, bot agents) lives in
`Map<circleId, CircleState>`. Same factory exposed by the desktop tasks
app (`@onderling-app/tasks/MeshAgent`).

**Capability scope:** subscribe to each joined circle's group;
broadcast skill requests + collect claims within those groups; pod
writes go through `item-store` (no direct pod-client use).
Cap-token-bound bot agents (V1.5) spin up per binding and share the
meshAgent's bus.

## Shared UI helpers

UI-glue helpers (`taskStatus`, `composeArgs`, `inboxClassify`,
`effectiveActor`, `localisationMerge`) come from
`@onderling-app/tasks/ui/*` — the desktop shell's `src/ui/`
directory. Both shells consume the same code so the V2.7 deps
gate, the addTask payload shape, the inbox event classifier, and
the pubKey↔webid resolver stay in step. See the desktop shell's
[`README.md`](../tasks-v0/README.md#shared-ui-helpers) for the
surface table + the project rule
[`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md#shared-ui-glue-helpers-between-platform-shells-locked-2026-05-10)
for the policy.

The genuinely-shared locale strings (status pills, role labels,
circle-kind chips, approval modes) live in
`apps/tasks-v0/locales/shared/{en,nl}.json` and merge under both
`@onderling-app/tasks/locales/<lang>` and `apps/tasks-mobile/locales/<lang>`
in `LocalisationProvider.js` — shell-local keys win on collision.

## Bring it up

```bash
cd apps/tasks-mobile
npm install
npm test                           # 106 tests across 17 files
```

Real-device bring-up (Android — iOS is out of scope):

```bash
expo start --dev-client            # builds the JS bundle
expo run:android --device          # sideloads on a real phone
```

The dev client must be built once with the full @onderling/react-native
autolinking (mDNS + BLE + push). Reuse stoop-mobile's dev client when
you can — same Expo 52 / RN 0.76.9 pin.

### Real-device test plan (Phase 41.16 runbook)

> **Pair-test scenarios** (Tasks-desktop ↔ Tasks-mobile, T1–T6) live
> in the cross-app pair-test runbook:
> `Project Files/conventions/pair-test-runbook-2026-05-15.md`.
> The walkthrough below covers the single-device journeys; pair
> the two when running 41.16 on hardware.


Walk through the full V1 user journey on a clean Android phone:

1. **Onboarding (Phase 41.3)** — install fresh, tap "Scan invite QR",
   scan a `tasks://invite?token=...` payload generated from the
   desktop CLI (`bin/tasks-ui.js --circle-list <path>`) or from another
   admin's IssueScreen. Land on Workspace.
2. **Workspace (41.4)** — see the open-tasks list. Tap +, compose a
   task with `text` + `dueAt` + DoD `text`. Submit. Card appears.
3. **TaskDetail (41.4)** — tap the card. Claim. Mark complete (when
   DoD is text + status is `claimed`). Verify the V2.7 gate by
   creating a parent + child where the child is open: parent's
   "Mark complete" should be disabled with the open-deps tooltip;
   admin should see "Force complete" red CTA.
4. **MyWork + Planner (41.5)** — navigate to MyWork (push a route
   manually until the bottom-tab shell lands). Tap "Suggest a plan";
   Accept a suggestion → `task.scheduledAt` updates → V2.1 calendar
   emission picks it up.
5. **Photo deliverable (41.5)** — for a task with DoD `photo`, tap
   Submit → camera opens → snap → confirm. Approver should see the
   inline thumbnail in Review.
6. **Review + Inbox (41.6)** — as approver, see the awaiting-approval
   row + tap to open. Approve. Test V2.7 propose-subtask: parent in
   `submitted`, second member proposes a sub-task → original
   assignee's Inbox shows the proposal card → Approve rolls parent
   back to `claimed`.
7. **Circles dashboard (41.7)** — install with two circles; both rows
   render. Tap "Jump in" to switch active circle + navigate Workspace.
   Counters refresh on `item-added`.
8. **Circle settings (41.8)** — open CircleSettings; verify the six
   sections respect role gates (KID-as-member sees only Members;
   admin sees all six). Issue a bot-token QR, scan from another
   device, verify the cap-token loads.
9. **Profile (41.10)** — set a handle, take an avatar photo, add
   skills. Reveal the recovery phrase + copy. Restart the app —
   identity persists.
10. **Push (41.11)** — toggle a per-event preference, send a test
    push from the relay, notification appears.
11. **Native calendar (41.12)** — flip Settings.calendarSyncMethod
    to `native`. A task with `dueAt` produces an event in the
    system calendar's "Tasks" calendar within 60s.
12. **Pod sign-in (41.15)** — tap "Sign in to Solid pod". OIDC flow
    completes; AuthCallback shows bulk-sync progress; pod-side
    `<pod>/tasks/...` paths populate.
13. **Offline mode** — toggle airplane mode; the app continues
    working (local-only mode), and a queued addTask survives the
    next online window.

Crash-free target: 0 unhandled rejections + 0 native crashes during
the walkthrough. Performance: cold-start to first Workspace render
< 3s on a Pixel 5.

### Localisation

Supported locales: **en**, **nl**. Locales are split between two
sources:

- **App-level strings** (workspace, my-work, planner, deliverable
  photo, mobile-only inbox copy) live at `apps/tasks-mobile/locales/{en,nl}.json`.
- **Circle + role + DoD + skill-taxonomy strings** are reused from
  `apps/tasks-v0/locales/{en,nl}.json` so desktop + mobile stay in
  sync.

Both bundles get merged at boot and fed to
`loadLocale({bundles, defaultLang})` from
`@onderling/react-native/localisation`. To add a locale: drop a new
`locales/<lang>.json` matching the en shape, add it to the merge
call in `src/LocalisationProvider.js`, declare the `<lang>` key on
`loadLocale({bundles})`.

## What's in here

```
apps/tasks-mobile/
├── README.md                ← this file
├── package.json
├── app.json                 ← Expo config (slug "tasks", scheme "tasks://")
├── babel.config.js
├── metro.config.js          ← @onderling/react-native/metro-preset + Tasks-specific watch folders
├── vitest.config.js
├── index.js                 ← polyfills + Expo registerRootComponent
├── App.js                   ← placeholder NavigationContainer (Phase 41.1)
├── locales/                 ← mobile-only screen strings (Phase 41.3 onwards)
├── src/                     ← screens, lib, ServiceContext (Phase 41.2 onwards)
└── test/
    └── scaffold.test.js     ← smoke: App.js exports a function
```
