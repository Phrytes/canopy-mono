# Tasks Mobile V1 — coding plan

> **Status:** draft, 2026-05-08.
> **Predecessors:**
> - [`./mobile-functional-design-2026-05-08.md`](./mobile-functional-design-2026-05-08.md) — Mobile V1 functional design (the source of truth for capabilities + screens + scope locks)
> - [`./functional-design-v2-2026-05-08.md`](./functional-design-v2-2026-05-08.md) — V2 web design (V2.7 hard-deps inherited unchanged)
> - [`./coding-plan-v2-2026-05-08.md`](./coding-plan-v2-2026-05-08.md) — V2 web coding plan (parallel structure)
> - [`apps/tasks-v0/CHANGELOG.md`](../../apps/tasks-v0/CHANGELOG.md) — what's actually shipped on the desktop
>
> **Pattern source:** mirrors
> [`Project Files/Stoop/v3-mobile-coding-plan-2026-05-08.md`](../Stoop/v3-mobile-coding-plan-2026-05-08.md) at the structural level. Stoop V3 is the working RN app to copy from; folio-mobile + stoop-mobile are the two consumers that already trip the rule-of-two for the mobile substrates this app needs.
>
> **Conventions honoured (same as the web app):**
> [`Project Files/conventions/architectural-layering.md`](../conventions/architectural-layering.md),
> [`./app-readme-scheme.md`](../conventions/app-readme-scheme.md),
> [`./localisation.md`](../conventions/localisation.md),
> [`./cross-app-settings.md`](../conventions/cross-app-settings.md),
> [`Project Files/Substrates/policies.md`](../Substrates/policies.md) (rule-of-two).
>
> **Pending external input:** the Stoop team is investigating a multi-agent-on-one-device transport issue. Their fix (substrate-level or app-level pattern) lands in `core` or `react-native`; once it does, phases 41.1–41.2 here may need amending. **Tracked separately**; not blocking this plan from being written.

## Scope locks (carried from the functional design)

1. Native Expo / React Native, parallel to `apps/folio-mobile` and `apps/stoop-mobile`. Not a PWA wrap, not a WebView shell.
2. Local-only by default. Pod sign-in (Phase 41.15) wires `@canopy/oidc-session-rn`.
3. `KeychainVault` for the agent identity. V2.0 per-crew identity-vault round-trips through it.
4. `AsyncStorageAdapter` for small data; `FileSystemAdapter` for large data (deliverable photos, calendar `.ics` blobs).
5. `@canopy/sync-engine-rn` for boot.
6. Hub deferred — ships `standalone`.
7. Lazy-on-background, aggressive-when-foreground via `expo-task-manager`.
8. `expo-camera` for QR scan (single-dep path).
9. Push via `MobilePushBridge` + Expo's push service; no `--push` CLI flag — just on with per-event toggle in settings.
10. Deep links: `tasks://...`.
11. iOS out of scope for the project (Android-primary).
12. Bot dispatch on mobile = configuration only. The Telegraf bot stays server-side.

## Phase numbering

Phases run **41.1 → 41.17** (Tasks-mobile claims the 41 series — Stoop V3 used 40, folio-mobile didn't number explicitly). Sub-tasks are `41.X.Y`.

## Substrate touches (overview)

> **2026-05-08 audit finding** — initial draft said "no new substrates" by misreading the rule of two. On closer inspection, **stoop-mobile + tasks-mobile is the second consumer for seven shareable mobile-only patterns**. The rule trips. New Phase **41.0** (below) lifts them into existing or new packages BEFORE Tasks-mobile reuses them. Same pattern Tasks V1 used to lift seven Stoop V1 helpers into substrates (`apps/tasks-v0/CHANGELOG.md` `[0.2.0]` lifts) — except the lifts now happen on the mobile side.

### Substrates that already cover what we need (reuse)

| Substrate | Consumer count after Tasks-mobile lands | Action |
|---|---|---|
| `@canopy/sync-engine-rn` (`createMobileBootstrap`, `bgRunOnce`, `registerBackgroundTask`) | 3 (folio-mobile, stoop-mobile, tasks-mobile) | reuse |
| `@canopy/oidc-session-rn` | 3 | reuse |
| `@canopy/react-native` (`KeychainVault`, `AsyncStorageAdapter`, `FileSystemAdapter`, `MdnsTransport`, `BleTransport`, `MobilePushBridge`, `createMeshAgent`, `requestMeshPermissions`) | 3 | reuse |
| `@canopy/notifier` (PushChannel, PushPolicy) | 2+ (Stoop, Tasks web, Tasks mobile) | reuse |
| All Tasks domain substrates (item-store, identity-resolver, skill-match, local-store, chat-p2p, chat-agent bridge interface) | 2 (web + mobile) | reuse |

### Substrates to LIFT NOW (rule-of-two trip — Stoop V3 + Tasks-mobile)

Each row is a stoop-mobile `lib/*` or `components/*` file whose shape Tasks-mobile would re-implement near-identically. Phase 41.0 below executes the lifts; stoop-mobile's existing files become thin re-exports (mirrors how Stoop's `lib/PushPolicy.js` became a re-export when V1.5's PushPolicy promotion landed).

| # | First consumer (`apps/stoop-mobile/`) | Lift target | Tasks-mobile use |
|---|---|---|---|
| L1 | `src/lib/useSkill.js` (119 lines) + `src/lib/useAgentEvent.js` (41) | extend `@canopy/sync-engine-rn` (it owns the agent/engine surface; React hooks fit naturally) | every Tasks-mobile screen invokes skills + listens for events through these |
| L2 | `src/lib/activeCadence.js` (156) + `src/lib/appStateBridge.js` (81) + `src/lib/bgRunOnce.js` (30) | new `@canopy/online-cadence` (already flagged in `Project Files/Substrates/substrate-candidates.md` as "🔴 LIFT NOW when 2nd consumer") | Phase 41.14 (AppState bridge + bg-fetch task) reuses |
| L3 | `src/lib/imagePicker.js` (222 — `pickAndResize({preset})` wrapping `expo-image-picker` + `expo-image-manipulator`) | extend `@canopy/react-native` (sits next to MobilePushBridge — both are platform-glue substrates) | Phase 41.5 (deliverable photo) + Phase 41.10 (avatar) |
| L4 | `src/lib/qrScanner.js` (128 — payload classifier; pluggable for new payload shapes) + `src/components/QrCode.js` (renderer wrapping `react-native-qrcode-svg`) | **extend `@canopy/react-native`** (locked 2026-05-08 — flat package count over a separate `qr-onboarding` package) | Phase 41.3 (Scan/Issue) + Phase 41.13 (bot-token QR — adds the 4th payload shape via the classifier's plugin point) |
| L5 | `src/lib/mnemonic.js` (83 — recovery-phrase reveal/restore UX wrapping the existing `getMnemonicOnce` substrate skill) | extend `@canopy/react-native` (UX glue belongs next to platform glue) | Phase 41.10 (Profile recovery section) |
| L6 | `src/lib/push.js` (136 — permission rationale → request → token registration over `MobilePushBridge`) | extend `@canopy/react-native` (next to MobilePushBridge itself) | Phase 41.11 (Settings + push opt-in) |
| L7 | `src/lib/i18n.js` (137 — RN-friendly locale resolver + `t(key, fallback)` over `{lang: {key: {text, doc}}}`) | **extend `@canopy/react-native`** (locked 2026-05-08 — flat package count over a separate `i18n-rn` package) | every screen with localised copy |

**Decision locked 2026-05-08:** L4 + L7 land as submodules in `@canopy/react-native` rather than as separate packages. Final package count after Phase 41.0: existing N + 1 (`@canopy/online-cadence` — that one stays separate because it's already flagged on the substrate-candidates index and may grow its own scheduler primitives). Trade-off accepted: `@canopy/react-native`'s import surface grows by 5 submodules (`picker/`, `mnemonic/`, `push/usePushOptIn`, `qr/`, `i18n/`). All sit alongside the existing platform-glue (`vault`, `transport`, `push/MobilePushBridge`); coherent enough.

### Still-deferred candidates (NOT promoting yet — second consumer hasn't materialized)

- `@canopy/calendar` (read + write halves) — Tasks web + mobile both consume; if Folio adds outbound calendar emission this becomes the third consumer and the substrate gets promoted.
- `@canopy/contacts` — Stoop V2 has it; Tasks-mobile doesn't need contacts. One consumer; defer.
- `@canopy/geo-grid` — Stoop only.
- `@canopy/closed-group-onboarding` (issue/redeem helpers) — already in `core.GroupManager`; mobile reuse is fine without extraction.
- Multi-bundle / multi-crew agent management (`groupRegistry.js` in stoop-mobile vs `CrewBundles.js` in tasks-mobile) — different domain semantics; same shape may emerge but defer until both apps are running.

## Out-of-band prerequisites

Before any phase starts:

- ✅ V1 + V1.5 + V2 + V2.7 desktop landed (CHANGELOG `[0.3.6]`). Confirmed.
- ✅ Mobile functional design signed off (`./mobile-functional-design-2026-05-08.md`).
- ☐ Confirm Expo SDK target (likely 52, matching stoop-mobile + folio-mobile to share dev-client builds).
- ✅ **Stoop's single-agent refactor landed 2026-05-08** ([`Project Files/Stoop/single-agent-refactor-2026-05-08.md`](../Stoop/single-agent-refactor-2026-05-08.md)). Tasks's V2.8 (single-agent + per-crew state) is the desktop-side mirror; **mobile-V1 starts after V2.8 ships**. Tasks-mobile then imports `buildMeshAgent` + `buildCrewState` from `apps/tasks-v0` rather than re-implementing the agent topology.
- ☐ Confirm V2.8 has merged before kicking off Phase 41.2.

## Phase 41.0 — Substrate lifts (Stoop V3 → mobile-substrate trigger pass)

> **Pre-Tasks-mobile work.** Lifts the seven shareable mobile-only patterns from `apps/stoop-mobile/src/lib/*` into existing or new substrates. Stoop V3's existing files become thin re-exports (mirrors how Stoop's `lib/PushPolicy.js` became a re-export when V1.5 promoted PushPolicy to `@canopy/notifier`).
>
> **Why this happens before 41.1:** if we lift after Tasks-mobile builds against its own copies, we get duplicate implementations + a follow-up "rationalize" sprint. Substrate-first means lift first, then both apps consume.
>
> **Substrate decisions (locked 2026-05-08):** L1 → `sync-engine-rn` extension, L2 → new `@canopy/online-cadence`, L3 + L4 + L5 + L6 + L7 → `@canopy/react-native` extension. Final package count grows by exactly one (`@canopy/online-cadence`).

### Tasks

| # | Task | Files |
|---|---|---|
| 41.0.1 (L1) | Promote `useSkill` + `useAgentEvent` into `@canopy/sync-engine-rn`. Public API: `import { useSkill, useAgentEvent } from '@canopy/sync-engine-rn'`. The hook reads from a `<ServiceContext>` the consumer wires; `ServiceContext` itself stays app-local (each app picks its own service shape). Stoop V3's `src/lib/{useSkill, useAgentEvent}.js` → re-export shims. | `packages/sync-engine-rn/src/react/{useSkill,useAgentEvent}.js`, `packages/sync-engine-rn/src/index.js`, `apps/stoop-mobile/src/lib/{useSkill,useAgentEvent}.js` |
| 41.0.2 (L2) | New package `@canopy/online-cadence` with three modules: `cadence.js` (foreground/background poll calculus, pure fn), `appStateBridge.js` (RN AppState hook → setOnline), `bgTask.js` (re-exports from `sync-engine-rn`'s existing `bgRunOnce` for convenience). Stoop V3's `lib/{activeCadence, appStateBridge, bgRunOnce}.js` → re-exports. | `packages/online-cadence/{src/*.js, package.json, README.md}`, `apps/stoop-mobile/src/lib/{activeCadence,appStateBridge,bgRunOnce}.js` |
| 41.0.3 (L3) | Extend `@canopy/react-native` with a `picker/` submodule containing `pickAndResize({preset})`. Presets are passed in by callers (Stoop's three: `prikbord` / `chat` / `avatar`; Tasks's two new: `deliverable` / `avatar` — caller provides the preset object, substrate provides the wrapper). Stoop V3's `src/lib/imagePicker.js` → re-export with the Stoop preset table baked in. | `packages/react-native/src/picker/{pickAndResize.js, presets.js, index.js}`, `apps/stoop-mobile/src/lib/imagePicker.js` |
| 41.0.4 (L4) | Extend `@canopy/react-native` with `qr/` submodule: `classifyQrPayload(text, classifiers)` (pure-fn, plugin classifier list), `<QrCodeView value={...}>` component re-exporting `react-native-qrcode-svg`. Stoop's three classifiers stay in stoop-mobile (they're Stoop-payload-shaped); Tasks adds its own bot-token classifier. Stoop V3's `src/lib/qrScanner.js` → calls the substrate with its three classifiers; `src/components/QrCode.js` → re-export shim. | `packages/react-native/src/qr/{classifyQrPayload.js, QrCodeView.js, index.js}`, `apps/stoop-mobile/src/lib/qrScanner.js`, `apps/stoop-mobile/src/components/QrCode.js` |
| 41.0.5 (L5) | Extend `@canopy/react-native` with `mnemonic/` submodule: `useMnemonicReveal()` hook (calls `getMnemonicOnce` + `markMnemonicShown`); `<MnemonicView words={[...]}>` component (12/24-word grid + copy-to-clipboard + screenshot warning). Stoop V3's `src/lib/mnemonic.js` → re-export. | `packages/react-native/src/mnemonic/{useMnemonicReveal.js, MnemonicView.js, index.js}`, `apps/stoop-mobile/src/lib/mnemonic.js` |
| 41.0.6 (L6) | Extend `@canopy/react-native` with `push/` submodule: `usePushOptIn({onTokenChange})` hook (handles permission rationale → `Notifications.requestPermissionsAsync` → token via Expo → callback with the token blob the app ships to its relay registry). The `MobilePushBridge` substrate stays unchanged. Stoop V3's `src/lib/push.js` → re-export. | `packages/react-native/src/push/{usePushOptIn.js, index.js}`, `apps/stoop-mobile/src/lib/push.js` |
| 41.0.7 (L7) | Extend `@canopy/react-native` with `i18n/` submodule: `loadLocale({en, nl, default})` returns `{t(key, fallback), setLanguage(lang)}`. Mirrors Stoop's `i18n.js` 1:1. Stoop V3's `src/lib/i18n.js` → re-export. | `packages/react-native/src/i18n/{loadLocale.js, index.js}`, `apps/stoop-mobile/src/lib/i18n.js` |
| 41.0.8 | Tests: each lifted substrate gets a focused test suite at the package level. Stoop V3's existing tests (which exercised the lib copies) keep passing through the re-export shims — proves the lift is back-compat. | `packages/{sync-engine-rn,online-cadence,react-native}/test/*.test.js` |
| 41.0.9 | `Project Files/Substrates/substrate-candidates.md` — strike the lifted candidates from the active list. | `Project Files/Substrates/substrate-candidates.md` |
| 41.0.10 | Update each new/extended substrate's README per `app-readme-scheme.md`'s "lifted from" line (e.g. "Lifted from `apps/stoop-mobile/src/lib/imagePicker.js` 2026-05-08; Tasks-mobile is the second consumer."). | per-substrate READMEs |

### Substrate touch summary

| Package | Change | Backward-compat |
|---|---|---|
| `@canopy/sync-engine-rn` | + `useSkill` + `useAgentEvent` | ✅ additive |
| `@canopy/react-native` | + `picker/`, `mnemonic/`, `push/usePushOptIn`, `qr/`, `i18n/` submodules | ✅ additive |
| `@canopy/online-cadence` | new package | ✅ Stoop's lib files become re-exports |
| `apps/stoop-mobile/*` | re-export shims (5 files) | ✅ user-visible behaviour unchanged |

**Estimate:** 2 days.
**Substrate touch:** all seven lifts.
**Acceptance:** Stoop V3's full suite passes through the re-export shims (no behaviour change). Each new substrate has a smoke test that imports + exercises one happy path.
**Risks:** package count goes from N → N+1 (just `@canopy/online-cadence`). `@canopy/react-native` grows by 5 submodules. Mitigation: each submodule has its own subpath export so consumers import with intent (`@canopy/react-native/qr` not `@canopy/react-native`).
**Depends on:** Stoop V3 mobile-V1 having shipped (it has, per `Project Files/Stoop/v3-mobile-coding-plan-2026-05-08.md` Phase 40.x history).

## Phase 41.1 — Scaffold `apps/tasks-mobile/`

> Creates the empty Expo app, mirrors stoop-mobile's package.json + app.json + babel + metro configs, wires the `@canopy/*` deps. No agent yet — that's Phase 41.2.

| # | Task | Files |
|---|---|---|
| 41.1.1 | `apps/tasks-mobile/package.json` — copy stoop-mobile's shape; add `@canopy-app/tasks-v0`, `@canopy/sync-engine-rn`, `@canopy/oidc-session-rn`, `@canopy/react-native`, all Tasks substrates the desktop uses; pin Expo 52 + RN 0.76.9. | `apps/tasks-mobile/package.json` |
| 41.1.2 | `apps/tasks-mobile/app.json` — `name: "Tasks"`, `slug: "tasks"`, `scheme: "tasks"` (deep-link URL scheme); permissions for camera (QR + photo deliverables), notifications, BLE, location (Android-BLE prerequisite). | `apps/tasks-mobile/app.json` |
| 41.1.3 | `babel.config.js` + `metro.config.js` — Expo defaults + monorepo workspace resolution (mirror stoop-mobile). | `apps/tasks-mobile/babel.config.js`, `metro.config.js` |
| 41.1.4 | `index.js` + `App.js` — Expo entry + a placeholder `<NavigationContainer>` with one screen showing "Tasks Mobile — bring-up TODO." | `apps/tasks-mobile/index.js`, `App.js` |
| 41.1.5 | `apps/tasks-mobile/README.md` — follows the app-readme-scheme convention: substrates list, direct SDK use justification, Agent Hub compatibility (deferred), bring-up steps, what's-in-here. | `apps/tasks-mobile/README.md` |
| 41.1.6 | `vitest.config.js` + a one-test smoke (`test/scaffold.test.js`) confirming the package builds and `App.js` exports a function. | `apps/tasks-mobile/vitest.config.js`, `test/scaffold.test.js` |
| 41.1.7 | `npm install` runs cleanly; `expo start` boots the placeholder app on a real Android device. | (verification) |

**Estimate:** 1 day.
**Substrate touch:** none.
**Acceptance:** `cd apps/tasks-mobile && npm test` passes; `expo start --clear` boots; the placeholder screen renders on a real Android phone.
**Risks:** Expo SDK pin mismatch with stoop-mobile's dev-client (which is built once and reused). Mitigation: use the same Expo 52 / RN 0.76.9 versions.

## Phase 41.2 — ServiceContext + agent bring-up + `useSkill` / `useAgentEvent` hooks

> **Critical path** — every other phase needs this. Mirrors `apps/folio-mobile/src/ServiceContext.js` + `apps/stoop-mobile/src/ServiceContext.js` (post their 2026-05-08 single-agent refactor). Boots ONE `meshAgent` via `createMobileBootstrap` from `@canopy/sync-engine-rn`, then constructs `Map<crewId, CrewState>` over it via `buildCrewState` from `@canopy-app/tasks-v0` (V2.8 shape). Skills register once with `bundleResolver: (args) => crews.get(args.crewId) ?? null`.

| # | Task | Files |
|---|---|---|
| 41.2.1 | `src/ServiceContext.js` — boots ONE `meshAgent` via `createMobileBootstrap` from `@canopy/sync-engine-rn`, attaches `KeychainVault`, `AsyncStorageAdapter` (small data), `FileSystemAdapter` (large data — calendar `.ics` blobs, deliverable photos), `MdnsTransport`, `BleTransport`, `MobilePushBridge`. Then `crews: Map<crewId, CrewState>` constructed via `buildCrewState` from `@canopy-app/tasks-v0` (V2.8 shape) — one CrewState per active crew, all sharing the `meshAgent`. Skills register ONCE on `meshAgent.skills` with `bundleResolver: (args) => crews.get(args.crewId) ?? null`. | `apps/tasks-mobile/src/ServiceContext.js` |
| 41.2.2 | `useSkill` + `useAgentEvent` — **import from `@canopy/sync-engine-rn`** (lifted in Phase 41.0 L1). Tasks-mobile only wires them to its `<ServiceContext>`. | (no new app file) |
| 41.2.4 | `App.js` wraps the navigator in `<ServiceProvider>`. Provider blocks rendering until the agent is identity-bootstrapped (small splash for ~200 ms). | `apps/tasks-mobile/App.js` |
| 41.2.5 | AppState bridge — **import from `@canopy/online-cadence`** (lifted in Phase 41.0 L2). Tasks-mobile passes `bundle.cache.setOnline` as the callback. | (no new app file) |
| 41.2.6 | Locale resolver — **import `loadLocale` from `@canopy/react-native/i18n`** (lifted in 41.0 L7). Tasks-mobile passes its `apps/tasks-v0/locales/{en,nl}.json`; resolver returns `t(key)`. Wrap in a small `<I18nProvider>` mounted alongside `<ServiceProvider>`. | `apps/tasks-mobile/src/I18nProvider.js` |
| 41.2.7 | Tests: ServiceContext renders, agent boots, `useSkill` invokes a stub skill end-to-end, identity persists across hot-reloads via `KeychainVault`, `t()` resolves keys. | `apps/tasks-mobile/test/ServiceContext.test.js` |

**Estimate:** 2 days.
**Substrate touch:** none.
**Acceptance:** `<ServiceProvider>` mounts on a real device; a test screen invokes `getCrewConfig` and renders the response; identity survives an app restart.
**Risks:** see Stoop multi-agent caveat above.
**Depends on:** 41.1.

## Phase 41.3 — Onboarding screens (Welcome / Scan / Restore / Issue)

> Three onboarding paths: New (Scan QR for invite), Restore (mnemonic input), Issue (admin generates QR for someone else to scan).

| # | Task | Files |
|---|---|---|
| 41.3.1 | `src/screens/WelcomeScreen.js` — three buttons (New / Restore / Scan QR). | `apps/tasks-mobile/src/screens/WelcomeScreen.js` |
| 41.3.2 | `src/screens/ScanScreen.js` — wraps `expo-camera`'s scanner. **QR classifier imported from `@canopy/react-native/qr`** (lifted in 41.0 L4); Tasks-mobile registers its own classifier list (`tasks://invite`, `tasks://bot-token`, `tasks://contact`, BIP-39 recovery). Wires `redeemInviteWithGate` for the invite path. | `apps/tasks-mobile/src/screens/ScanScreen.js`, `apps/tasks-mobile/src/lib/qrClassifiers.js` |
| 41.3.3 | `src/screens/RestoreScreen.js` — mnemonic input → `restoreFromMnemonic` mid-flight identity swap → confirmation. | `apps/tasks-mobile/src/screens/RestoreScreen.js` |
| 41.3.4 | `src/screens/IssueScreen.js` — admin generates an invite payload via `getInviteQrPayload`. **QR rendering via `<QrCodeView>` from `@canopy/react-native/qr`** (lifted in 41.0 L4). | `apps/tasks-mobile/src/screens/IssueScreen.js` |
| 41.3.5 | Permission rationale modal: explains why camera + notifications are needed (Tasks privacy notice copy). | `apps/tasks-mobile/src/components/PermissionRationale.js` |
| 41.3.6 | `locales/en.json` + `nl.json` — `mobile.welcome.*`, `mobile.scan.*` keys (4–6 each). | `apps/tasks-mobile/locales/{en,nl}.json` |
| 41.3.7 | Tests: classifier handles all 3 QR shapes; invite flow → `redeemInviteWithGate` is called with the right payload. | `apps/tasks-mobile/test/screens/ScanScreen.test.js` |

**Estimate:** 2 days.
**Substrate touch:** none — `expo-camera`, `expo-image-picker`, `react-native-qrcode-svg` are direct deps.
**Acceptance:** real-device test — install fresh, tap "Scan QR," scan an invite QR generated from the desktop app's bot-bindings panel (or a stub), join a crew, see the Workspace.
**Depends on:** 41.2.

## Phase 41.4 — Workspace + task detail + filter chips + FAB-create (V2.7-aware)

| # | Task | Files |
|---|---|---|
| 41.4.1 | `src/screens/WorkspaceScreen.js` — wires `listOpen` (with `status` field for V2.7 disabled-button decisions); pull-to-refresh; filter chips (status: ready / waiting / blocked / claimed / submitted; `requiredSkill`). FAB opens compose modal. | `apps/tasks-mobile/src/screens/WorkspaceScreen.js` |
| 41.4.2 | `src/screens/TaskDetailScreen.js` — full-screen detail: title, status pill, deliverable, submitter's note, reviewer's reject reason (mirror web `renderTasks` block layout). All action buttons wire the appropriate skill via `useSkill`. | `apps/tasks-mobile/src/screens/TaskDetailScreen.js` |
| 41.4.3 | `src/components/TaskCard.js` — reusable card for the task list. Renders status chip, dependencies-blocked indicator (open-deps count chip when `item.status === 'waiting'`), assignee chip. | `apps/tasks-mobile/src/components/TaskCard.js` |
| 41.4.4 | **V2.7 Mark complete:** the close button is disabled with a tooltip listing open-dep short-ids when `item.status === 'waiting' || 'blocked'`. Tooltip on iOS = long-press alert; on Android = `accessibilityLabel` + visible chip. | (in TaskCard / TaskDetailScreen) |
| 41.4.5 | **V2.7 Force complete (admin only):** when the gate is the reason for the disabled close, a "Force complete" button appears with red styling. Tap opens a sheet with a mandatory-reason text input → calls `forceCompleteTask`. | (in TaskDetailScreen) |
| 41.4.6 | **V2.7 Add sub-task → Propose mode:** when parent is `submitted` and caller isn't the assignee, the "Add sub-task" button label flips to "Propose sub-task — needs <assignee>'s approval"; calls `proposeSubtask` instead of `addSubtask`. Self-spawn (assignee on own task) takes the normal path. | (in TaskDetailScreen) |
| 41.4.7 | `src/screens/ComposeScreen.js` — modal compose form for new tasks. Fields: text, dueAt (date picker), required skills (chip selector), DoD kind (text / photo) — when photo, the eventual submit will use the camera flow (Phase 41.5). | `apps/tasks-mobile/src/screens/ComposeScreen.js` |
| 41.4.8 | Locales: `mobile.workspace.*`, `mobile.task_detail.*`, `mobile.compose.*` (~8 keys per language). Use existing `dependencies.*` and `subtask_proposal.*` keys for V2.7 surfaces. | `apps/tasks-mobile/locales/{en,nl}.json` |
| 41.4.9 | Tests: filter-chip toggle re-fetches; `claimTask` updates the visible card; `completeTask` returns `{error: 'has-open-dependencies'}` → shown in a toast. | `apps/tasks-mobile/test/screens/WorkspaceScreen.test.js`, `TaskDetailScreen.test.js` |

**Estimate:** 1.75 days.
**Substrate touch:** none.
**Acceptance:** real-device test — list shows all open tasks with status chips; tapping opens detail; claim → mark complete works on a no-deps task; on a deps-blocked task the button is disabled and tooltips correctly.
**Depends on:** 41.2.

## Phase 41.5 — My work + planner cards + photo deliverable submit flow (V2.7-aware)

| # | Task | Files |
|---|---|---|
| 41.5.1 | `src/screens/MyWorkScreen.js` — three sections: Assigned / Mastered / Claimable. Wires `listMine` + `listMyMasteredTasks` + `listClaimable`. **V2.7:** chip showing open-dep count when `item.status === 'waiting'`; the disabled-close behaviour from `<TaskCard>` is reused. | `apps/tasks-mobile/src/screens/MyWorkScreen.js` |
| 41.5.2 | `src/components/PlannerCards.js` — V2.4 suggestion cards: title, proposed slot, reason chip, [Accept] / [Tweak] / [Skip] buttons. Tap "Suggest a plan" calls `suggestSchedule`; cards render the top 3. | `apps/tasks-mobile/src/components/PlannerCards.js` |
| 41.5.3 | `src/screens/SubmitScreen.js` — submit flow for tasks with `definitionOfDone.kind === 'photo'`: opens `expo-camera`, shows preview, "Confirm" uploads via `FileSystemAdapter` + sets `task.deliverable.ref` then calls `submitTask`. Free-text submit for non-photo DoD. | `apps/tasks-mobile/src/screens/SubmitScreen.js` |
| 41.5.4 | Photo picker — **import `pickAndResize` from `@canopy/react-native/picker`** (lifted in 41.0 L3). Tasks-mobile defines its presets table (`deliverable` 1280px JPEG q=0.82; `avatar` 256px). | `apps/tasks-mobile/src/lib/photoPresets.js` |
| 41.5.5 | Locales: `mobile.deliverable_photo.*` (3 keys), `mobile.planner.*` (~5). | `apps/tasks-mobile/locales/{en,nl}.json` |
| 41.5.6 | Tests: photo flow stubbed (`jest.mock('expo-camera')`); `acceptSchedule` updates `scheduledAt`; planner empty state. | `apps/tasks-mobile/test/screens/MyWorkScreen.test.js`, `SubmitScreen.test.js` |

**Estimate:** 2.5 days.
**Substrate touch:** none — `expo-image-picker` + `expo-image-manipulator` are direct deps.
**Acceptance:** real-device test — claim a photo-DoD task; tap "Submit" → camera opens; snap; confirm; deliverable URL ends up at `<pod>/tasks/deliverables/<taskId>/<photoId>.jpg`; approver sees the inline thumbnail in Phase 41.6.
**Depends on:** 41.2, 41.4.

## Phase 41.6 — Review + DAG + Inbox + crew-context switch (V2.7-aware)

| # | Task | Files |
|---|---|---|
| 41.6.1 | `src/screens/ReviewScreen.js` — wires `listAwaitingApproval`. **V2.7:** disabled "Approve" button + tooltip when `item.status === 'waiting'` (the approve-creator-mode path also gates on deps). | `apps/tasks-mobile/src/screens/ReviewScreen.js` |
| 41.6.2 | `src/components/DeliverablePhoto.js` — inline thumbnail + tap-to-zoom modal. Reads `deliverable.ref` via `dataSource.read`; lazy-loads. | `apps/tasks-mobile/src/components/DeliverablePhoto.js` |
| 41.6.3 | `src/screens/DagScreen.js` — sub-task tree view. Wires `getDagTree`. Collapsible nodes; tap a node → TaskDetail. | `apps/tasks-mobile/src/screens/DagScreen.js` |
| 41.6.4 | `src/screens/InboxScreen.js` — wires `listMyInbox`. Renders generic notifications + special handling: **V2.7 `subtask-proposal` cards** with `[Approve]` / `[Decline]` buttons. Approve shows a confirm-sheet warning about the auto-rollback to claimed; Decline opens a small note input. Mirrors web `inbox.html`'s button-id router. | `apps/tasks-mobile/src/screens/InboxScreen.js` |
| 41.6.5 | Crew-context switch — global navigator state holds `activeCrewId`. Switching restarts `<ServiceProvider>` against the new crew's bundle. | `apps/tasks-mobile/src/lib/CrewContext.js`, `src/navigation.js` |
| 41.6.6 | Locales: `mobile.review.*`, `mobile.dag.*`, `mobile.inbox.*`, `mobile.crew_switch.*` (~10 keys per language). The V2.7 strings reuse `subtask_proposal.*` already in tasks-v0 locales. | `apps/tasks-mobile/locales/{en,nl}.json` |
| 41.6.7 | Tests: Approve → `approveTask` returns `has-open-dependencies` → toast; subtask-proposal Approve flow end-to-end (Approve → `approveSubtaskProposal` → parent rolled back). | `apps/tasks-mobile/test/screens/{Review,Dag,Inbox}Screen.test.js` |

**Estimate:** 2 days.
**Substrate touch:** none.
**Acceptance:** real-device test — Anne (admin) submits a parent task with an open subtask; Bob (approver) sees disabled Approve + open-dep tooltip; Anne creates a subtask-proposal; Bob's inbox shows the card + Approve flow rolls the parent back to claimed.
**Depends on:** 41.2, 41.4.

## Phase 41.7 — Crews dashboard + per-crew jump-in + multi-crew agent management

| # | Task | Files |
|---|---|---|
| 41.7.1 | `src/screens/CrewsDashboardScreen.js` — wires `getMyCrews`. One row per crew with four counters (open / overdue / awaiting-approval / mine). Tap → switches `CrewContext` and navigates to that crew's Workspace. | `apps/tasks-mobile/src/screens/CrewsDashboardScreen.js` |
| 41.7.2 | `src/lib/CrewBundles.js` — manages the `Map<crewId, CrewState>` from 41.2's ServiceContext. Stores the crew-config list `[{crewId, configRef}]` in AsyncStorage; calls `buildCrewState({meshAgent, ...})` on demand; closes idle CrewStates after a timeout (detach mirror + skillMatch listeners; ItemStore lives on local-store cache, no shutdown needed). **Much simpler than V2.5's web `crewBundlesProvider` was — V2.8's single-agent topology means we're managing per-crew state, not per-crew agents.** | `apps/tasks-mobile/src/lib/CrewBundles.js` |
| 41.7.3 | `src/lib/CrewContext.js` — React context exposing `activeCrew + setActiveCrew(crewId)`. Switching is now cheap: `useSkill` from `@canopy/sync-engine-rn` injects the new `crewId` into every call automatically; the agent doesn't restart. | `apps/tasks-mobile/src/lib/CrewContext.js` |
| 41.7.4 | Locales: `mobile.crews.*` (~5 keys). | `apps/tasks-mobile/locales/{en,nl}.json` |
| 41.7.5 | Tests: counter aggregation across two stub crews; crew switch tears down old bundle + boots new. | `apps/tasks-mobile/test/screens/CrewsDashboardScreen.test.js` |

**Estimate:** 0.5 day (down from initial estimate now that V2.8 owns the single-agent topology).
**Substrate touch:** none.
**Acceptance:** real-device test — install with two crews configured; dashboard shows both; tap one → workspace switches; counters refresh on `item-added`. Process opens ONE relay WebSocket regardless of crew count.
**Depends on:** 41.2, 41.6, **V2.8 (desktop) merged**.

## Phase 41.8 — Crew settings panels (members, custom roles, bot bindings, compensation, calendar sync, availability admin toggle)

| # | Task | Files |
|---|---|---|
| 41.8.1 | `src/screens/CrewSettingsScreen.js` — top-level container with tabs / accordion sections. Each section maps 1:1 to a web crew.html panel. | `apps/tasks-mobile/src/screens/CrewSettingsScreen.js` |
| 41.8.2 | Members section: read-only list with role chips (admin / coordinator / member / observer / external + custom). Tap a member → ProfileOther. | (in CrewSettingsScreen) |
| 41.8.3 | Custom roles section (admin only): wires `listKnownRoles` + `registerCrewCustomRole` + `unregisterCrewCustomRole`. | (in CrewSettingsScreen) |
| 41.8.4 | Bot bindings section (admin only): wires `getBotChatBindings` + `setBotChatBinding` + `removeBotChatBinding` + V1.5 `issueBotToken` + `revokeBotToken`. "Issue token" generates a QR via `react-native-qrcode-svg` for someone else to scan. | (in CrewSettingsScreen) |
| 41.8.5 | Compensation section (admin OR self-paid-pro): wires `setCompensationEnabled` + `setMemberCompensation` + per-pro per-month rollup via `getCompensation`. | (in CrewSettingsScreen) |
| 41.8.6 | Calendar sync section (admin/coord toggle + per-member URL): wires `setCalendarEmission` + `getCalendarEmissionUrl` + `getCalendarEmissionStatus`. The native-calendar-write opt-in (Phase 41.12) lives next to the URL. | (in CrewSettingsScreen) |
| 41.8.7 | Availability admin toggle (admin only): wires `setAvailabilityEnabled`. The actual member-side opt-in + grid is Phase 41.9. | (in CrewSettingsScreen) |
| 41.8.8 | Tests: each section's permission gate respected; mutations re-render. | `apps/tasks-mobile/test/screens/CrewSettingsScreen.test.js` |

**Estimate:** 2 days.
**Substrate touch:** none.
**Acceptance:** real-device test — Anne (admin) toggles every panel's enable flag, sees state persist; KID (member) sees only sections they're allowed to see.
**Depends on:** 41.2.

## Phase 41.9 — Availability grid + opt-in flow

| # | Task | Files |
|---|---|---|
| 41.9.1 | `src/screens/AvailabilityScreen.js` — 7×2 grid (days × half-days). Tap a cell to rotate state (unknown → open → tight → unavailable → unknown). Wires `getMyAvailability` + `setMyAvailability`. | `apps/tasks-mobile/src/screens/AvailabilityScreen.js` |
| 41.9.2 | Per-member opt-in toggle. Wires `setAvailabilityOptIn`. Off-state empty-state copy when crew has hints disabled. | (in AvailabilityScreen) |
| 41.9.3 | Locales: reuse existing `availability.*` keys from tasks-v0 locales. Mobile-only adds: `mobile.availability.tap_hint`. | `apps/tasks-mobile/locales/{en,nl}.json` |
| 41.9.4 | Tests: cell tap cycles state; opt-out clears persisted blob. | `apps/tasks-mobile/test/screens/AvailabilityScreen.test.js` |

**Estimate:** 1 day.
**Substrate touch:** none.
**Acceptance:** real-device test — opt in, set Tue PM to "tight," see chip in coordinator's assignee picker (which surfaces in 41.4 / 41.6).
**Depends on:** 41.2.

## Phase 41.10 — Profile (avatar, handle, skills, recovery)

| # | Task | Files |
|---|---|---|
| 41.10.1 | `src/screens/ProfileMineScreen.js` — handle, displayName, avatar, skills. Wires `setMyHandle`, `setMyProfile`, `setMyAvatarUrl`, `addMySkill`, `removeMySkill`. Avatar via `pickAndResize({preset: 'avatar'})` (lifted in 41.0 L3). **Recovery-phrase reveal: `useMnemonicReveal` + `<MnemonicView>` imported from `@canopy/react-native/mnemonic`** (lifted in 41.0 L5). | `apps/tasks-mobile/src/screens/ProfileMineScreen.js` |
| 41.10.2 | `src/screens/ProfileOtherScreen.js` — read-only view of another member. | `apps/tasks-mobile/src/screens/ProfileOtherScreen.js` |
| 41.10.3 | `src/components/SkillPicker.js` — categorised skill picker (mirror Stoop V3's `<SkillPicker>`; uses Tasks's existing skill taxonomy). | `apps/tasks-mobile/src/components/SkillPicker.js` |
| 41.10.4 | Tests. | `apps/tasks-mobile/test/screens/ProfileMineScreen.test.js` |

**Estimate:** 1 day.
**Substrate touch:** none.
**Acceptance:** real-device — set handle, take avatar photo, add 3 skills, see recovery phrase. Survives restart.
**Depends on:** 41.2, 41.5 (photo helper).

## Phase 41.11 — Settings (per-device + shared) + push opt-in + per-event toggle

| # | Task | Files |
|---|---|---|
| 41.11.1 | `src/screens/SettingsScreen.js` — two-section layout (per-device / shared). Wires `loadSettings` + `updateSettings` per the V1 schema. | `apps/tasks-mobile/src/screens/SettingsScreen.js` |
| 41.11.2 | Per-device fields: `pollIntervalMs.foreground` (default 5000), `pollIntervalMs.background` (default null), `onlineWindow`, `allowHopThrough`, `calendarSyncMethod` ('ics' / 'native' / 'both'). | (in SettingsScreen) |
| 41.11.3 | Shared fields: `pushPreferences` (per-event opt-out), `cadenceOverrides`. | (in SettingsScreen) |
| 41.11.4 | Push opt-in: **import `usePushOptIn` from `@canopy/react-native/push`** (lifted in 41.0 L6). Tasks-mobile passes a callback that ships the token to the relay registry; per-event toggles map to `pushPreferences`. | (in SettingsScreen) |
| 41.11.5 | Test-push button + status: `subscribe` / `unsubscribe` button surfaces current state. | (in SettingsScreen) |
| 41.11.6 | Locales: `mobile.settings.*`, `mobile.push.*` (~10 keys). | `apps/tasks-mobile/locales/{en,nl}.json` |
| 41.11.7 | Tests: per-device-setting round-trips; shared-setting persists across crews; push subscribe → token-registry receives. | `apps/tasks-mobile/test/screens/SettingsScreen.test.js` |

**Estimate:** 1.5 days.
**Substrate touch:** none — `MobilePushBridge` already shipped in `@canopy/react-native`.
**Acceptance:** real-device — toggle a setting, restart app, value persists; subscribe to push, send a test, notification appears.
**Depends on:** 41.2.

## Phase 41.12 — Native calendar integration (`expo-calendar`) + ICS-URL fallback

| # | Task | Files |
|---|---|---|
| 41.12.1 | `src/lib/nativeCalendar.js` — given a list of tasks (`task.dueAt` / `task.scheduledAt`), creates / updates / deletes events in a Tasks-owned calendar via `Calendar.createEventAsync` / `updateEventAsync` / `deleteEventAsync`. Stores per-task `calendarEventId` mapping in AsyncStorage so re-emissions update existing events. | `apps/tasks-mobile/src/lib/nativeCalendar.js` |
| 41.12.2 | Permission rationale modal for `expo-calendar`. | `apps/tasks-mobile/src/components/PermissionRationale.js` (extend) |
| 41.12.3 | Tie-in to `wireCalendarEmission` events from V2.1: when the .ics file changes, the native-calendar wire diffs prev vs next and applies the delta. Same diffRemoved logic as the web emitter. | (in `lib/nativeCalendar.js`) |
| 41.12.4 | UI: SettingsScreen exposes `calendarSyncMethod` selector ('ics' / 'native' / 'both'). User can pick one or both at first run. | (extend SettingsScreen from 41.11) |
| 41.12.5 | Tests: native-write stubbed via mock; diff logic correctness. | `apps/tasks-mobile/test/lib/nativeCalendar.test.js` |

**Estimate:** 1 day.
**Substrate touch:** none — `expo-calendar` is a direct dep.
**Acceptance:** real-device — enable native calendar; add a task with `dueAt`; event appears in the system calendar within 60 s; complete the task → event marked done; remove task → event deleted.
**Depends on:** 41.2, 41.11.

## Phase 41.13 — Bot binding QR (admin issue + scanner classifier)

| # | Task | Files |
|---|---|---|
| 41.13.1 | Admin "Issue token" flow: in CrewSettingsScreen's bot bindings panel, "Issue token" generates a `tasks://bot-token?...` URL (encoding chatId + webid + tokenBlob), renders via `<QrCodeView>` from `@canopy/react-native/qr` (lifted in 41.0 L4). The bot client (server-side or another phone) scans + loads. | (extend CrewSettingsScreen + a new `src/lib/botTokenQr.js` for the encode/decode helpers) |
| 41.13.2 | Add a `bot-token` classifier to Tasks-mobile's classifier list (registered against the substrate's `classifyQrPayload` plug-in slot). | `apps/tasks-mobile/src/lib/qrClassifiers.js` (extend) |
| 41.13.3 | Tests: encoder/decoder round-trip; oversized-payload fallback (token blob may be a few hundred bytes — fits in a Version 25 QR). | `apps/tasks-mobile/test/lib/botTokenQr.test.js` |

**Estimate:** 0.5 day.
**Substrate touch:** none.
**Acceptance:** admin issues token → QR renders → another phone scans → cap-token loaded into the receiver's vault.
**Depends on:** 41.3 (scanner), 41.8 (bot bindings panel).

## Phase 41.14 — AppState bridge + background-fetch task registration

| # | Task | Files |
|---|---|---|
| 41.14.1 | AppState polish — uses `@canopy/online-cadence`'s `appStateBridge` (lifted in 41.0 L2). Tasks-mobile passes the `pollIntervalMs.foreground` cadence. | (no new app file) |
| 41.14.2 | Bg-fetch task — uses `@canopy/sync-engine-rn`'s `registerBackgroundTask` (already shipped) + `@canopy/online-cadence` for the cadence math. Tasks-mobile registers a task that runs `bundle.cache.pullFromInner(...)` on wake. | `apps/tasks-mobile/src/lib/bgFetch.js` (small wiring) |
| 41.14.3 | Wire registration in `App.js`. | `apps/tasks-mobile/App.js` (extend) |
| 41.14.4 | Tests: pure-fn cadence math; mock `expo-task-manager`. | `apps/tasks-mobile/test/lib/bgFetch.test.js` |

**Estimate:** 0.5 day.
**Substrate touch:** none.
**Acceptance:** background app gets pinged at the configured cadence; pull happens; no battery drain regression.
**Depends on:** 41.2, 41.11.

## Phase 41.15 — Sign-in (Pod) — wire `oidc-session-rn`; pod-side bulk sync

| # | Task | Files |
|---|---|---|
| 41.15.1 | `src/screens/PodSignInScreen.js` — wires `useSignInHook` from `@canopy/oidc-session-rn`. Handles the OIDC flow + token storage. | `apps/tasks-mobile/src/screens/PodSignInScreen.js` |
| 41.15.2 | `src/screens/AuthCallbackScreen.js` — bulk-sync progress bar after sign-in. Wires `bundle.attachInner(podClient)` then `cache.bulkSync()`. | `apps/tasks-mobile/src/screens/AuthCallbackScreen.js` |
| 41.15.3 | Deep link handler: `tasks://auth-callback?...` triggers AuthCallbackScreen. | `apps/tasks-mobile/App.js` (extend) |
| 41.15.4 | Tests: stub OIDC flow, verify token storage + bulk-sync trigger. | `apps/tasks-mobile/test/screens/PodSignInScreen.test.js` |

**Estimate:** 1.5 days.
**Substrate touch:** none — `@canopy/oidc-session-rn` already shipped (folio-mobile is the proof-of-life consumer).
**Acceptance:** real-device — tap "Sign in to Solid pod"; OIDC flow completes; pod-side `<pod>/tasks/...` paths populate; offline mode still works after sign-out.
**Depends on:** 41.2.

## Phase 41.16 — Real-device pass + closed-beta APK build

> Final integration pass. Mirrors stoop-mobile's Phase 40.23 runbook.

| # | Task | Files |
|---|---|---|
| 41.16.1 | Real-device runbook: install, walk through all 8 user journeys from the functional design (Welcome → Workspace → Claim → Submit → Approve → Cross-crew → Bot binding QR → Calendar sync). Document any blockers. | (no files; verification + bug fixes) |
| 41.16.2 | EAS Build preview profile: `eas build --platform android --profile preview` → APK. Test on a clean phone (one not used for development). | `apps/tasks-mobile/eas.json`, build artifact |
| 41.16.3 | Crash-free target: 0 unhandled rejections + 0 native crashes during the runbook walkthrough. Add `process.on('unhandledRejection', ...)` filtering for telegraf-style background errors (mirror tasks-v0 CLI). | (varies) |
| 41.16.4 | Performance smoke: cold-start to first Workspace render < 3 s on a Pixel 5; pull-to-refresh < 500 ms. | (verification) |

**Estimate:** 1-2 days (varies with bug-fix volume).
**Substrate touch:** none.
**Acceptance:** clean APK on a clean phone, all 8 journeys complete without intervention.
**Depends on:** every prior phase.

## Phase 41.17 — Documentation + handoff (README + privacy update)

| # | Task | Files |
|---|---|---|
| 41.17.1 | `apps/tasks-mobile/README.md` — fill in the substrates list, direct SDK use justification, Agent Hub compatibility (deferred), bring-up steps, what's-in-here, real-device runbook. Mirrors stoop-mobile's README. | `apps/tasks-mobile/README.md` |
| 41.17.2 | Privacy notice update: extend `apps/tasks-v0/src/lib/privacyNotice.js` with mobile-only items (camera, push, expo-calendar, location for BLE). 4 new items × 2 languages = 8 entries. | `apps/tasks-v0/src/lib/privacyNotice.js` (extend) |
| 41.17.3 | `Project Files/Tasks App/CHANGELOG-mobile.md` (or extend the main app's CHANGELOG) — release-summary entry for `[mobile-0.1.0]`. | `apps/tasks-mobile/CHANGELOG.md` |

**Estimate:** 0.5 day.
**Substrate touch:** none.
**Acceptance:** new contributor can read the README + run the app on a real phone in 30 minutes.

## Phase 41.18 — Desktop-parity completion (post-real-device audit)

> **Why this exists** — the 41.1–41.17 build shipped a working mobile app on a real phone (2026-05-09). On first hands-on use, the user observed that several desktop capabilities were missing: only the *first-order* skills landed (claim/submit/approve/reject/etc.), and the second-order admin/lifecycle/maintenance skills (`revokeTask`, `pauseCrew`, `editMySkillsForCrew`, `appealTask`, …) were absent from the UI even though the underlying skills already exist on the desktop and are exposed by the same single-agent topology mobile uses. The desktop registers 67 skills today; mobile only used 30 of them. Phase 41.18 closes the gap.
>
> **Audit method**: per-skill grep over `apps/tasks-v0/src/skills/index.js` vs the mobile screens. Eleven tiers of missing surface emerged. Telegram bot remains intentionally server-side (item 12 of scope locks); on mobile, users use the Telegram client itself rather than hosting the bot.

### Batch 1 — Task-detail expansion + Compose expansion (Tier 1 + Tier 2)

| # | Task | Files |
|---|---|---|
| 41.18.1.1 | TaskDetail: revoke (admin/coordinator/master) — confirm sheet + reason field. Calls `revokeTask({taskId, reason})`. | `apps/tasks-mobile/src/screens/TaskDetailScreen.jsx` |
| 41.18.1.2 | TaskDetail: reassign (admin/coordinator/master). Member-picker bottom-sheet (skills + availability chips). Calls `reassignTask({taskId, assignee})`. | `apps/tasks-mobile/src/screens/TaskDetailScreen.jsx` + new `MemberPickerSheet.jsx` (or reuse compose flow's helper if already there) |
| 41.18.1.3 | TaskDetail: remove (admin only) — destructive confirm. Calls `removeTask({taskId})`. | `apps/tasks-mobile/src/screens/TaskDetailScreen.jsx` |
| 41.18.1.4 | TaskDetail: change approval-mode (master, when applicable). Single-select "auto / approval / dual-approval". Calls `setApprovalMode({taskId, approvalMode})`. | `apps/tasks-mobile/src/screens/TaskDetailScreen.jsx` |
| 41.18.1.5 | TaskDetail: force-spawn-subtask (admin override). Re-uses Compose with `master`/`approvalMode` pre-filled and parent set; calls `forceSpawnSubtask({parentId, ...payload})`. | `apps/tasks-mobile/src/screens/TaskDetailScreen.jsx` (CTA) + `ComposeScreen.jsx` (accept the override flag) |
| 41.18.1.6 | Compose: add `dependencies[]` field — multi-select against the crew's open tasks. Persist into `composeTask`. | `apps/tasks-mobile/src/screens/ComposeScreen.jsx` |
| 41.18.1.7 | Compose: add `master` selector (defaults to caller). Member-picker against the crew. | `apps/tasks-mobile/src/screens/ComposeScreen.jsx` |
| 41.18.1.8 | Compose: add `approvalMode` selector (`auto` / `approval` / `dual-approval`). | `apps/tasks-mobile/src/screens/ComposeScreen.jsx` |
| 41.18.1.9 | Compose: "Sub-task of <parent>" shortcut. From a TaskDetail's "Add sub-task" CTA, route to Compose with `parentId` pre-set; route the submit through `proposeSubtask` when V2.7 propose-mode applies, otherwise `composeTask` with `parent: <id>`. | `apps/tasks-mobile/src/screens/{TaskDetailScreen,ComposeScreen}.jsx` |
| 41.18.1.10 | Compose: surface skills via the substrate's `<SkillPicker>` (lifted from `@canopy/identity-resolver/skills`) — replaces the current free-text input. | `apps/tasks-mobile/src/screens/ComposeScreen.jsx` |
| 41.18.1.11 | Locale: ~25 new keys in `mobile.taskDetail.*` and `mobile.compose.*` (en + nl). | `apps/tasks-mobile/locales/{en,nl}.json` |
| 41.18.1.12 | Tests for the new TaskDetail/Compose helpers + tier-1 flows. | `apps/tasks-mobile/test/lib/*.test.js` |

**Estimate:** 0.5 day.
**Substrate touch:** none — `<SkillPicker>` already lifted in Phase 41.0.b.
**Acceptance:** admin can revoke / reassign / remove / change approval-mode from a phone; coordinator can compose a task with dependencies + master + approvalMode; user can tap "Add sub-task" from a parent and reach Compose pre-populated.

### Batch 2 — Inbox housekeeping + crew lifecycle + misc (Tier 3 + Tier 4 + Tier 11)

| # | Task | Files |
|---|---|---|
| 41.18.2.1 | Inbox: pull-to-mark-read on a row → `clearInboxItem({inboxId})`. | `apps/tasks-mobile/src/screens/InboxScreen.jsx` |
| 41.18.2.2 | Inbox: "Clear all read" CTA → `clearInbox({onlyRead: true})` (+ "Clear all" with destructive confirm). | `apps/tasks-mobile/src/screens/InboxScreen.jsx` |
| 41.18.2.3 | Tab badges: bottom-tab bar's Inbox icon shows unread count via `inboxBadgeCount` (5-second poll while foreground; refreshed by `useAgentEvent('inboxChanged')`). | `apps/tasks-mobile/src/navigation.js` (tab options) |
| 41.18.2.4 | CrewSettings → Lifecycle panel (admin only): pause / unpause / archive / unarchive. Each is a confirm-sheet → matching skill (`pauseCrew` / `unpauseCrew` / `archiveCrew` / `unarchiveCrew`). | `apps/tasks-mobile/src/screens/crewSettings/Lifecycle.jsx` (new) |
| 41.18.2.5 | CrewsDashboard: visually distinguish paused/archived crews (greyed row + "Paused" / "Archived" chip). | `apps/tasks-mobile/src/screens/CrewsDashboardScreen.jsx` |
| 41.18.2.6 | Settings: add a "Metrics" sub-page surfacing `getMetrics({crewId})` — relay rtt, queue depth, last-sync, skill-call counts. Read-only, hidden behind a "Diagnostics" disclosure. | `apps/tasks-mobile/src/screens/SettingsScreen.jsx` (extend) + `apps/tasks-mobile/src/screens/MetricsScreen.jsx` (new) |
| 41.18.2.7 | Privacy notice screen: render `getPrivacyNotice({lang})` (uses `apps/tasks-v0/src/lib/privacyNotice.js`'s extended list with the four mobile items). | `apps/tasks-mobile/src/screens/PrivacyScreen.jsx` (new) + locale entry "settings.privacy_link" |
| 41.18.2.8 | CrewSettings → Availability panel (admin): "see all crew availability" view via `getCrewAvailability({crewId, weekStart})`. Matrix of (member × half-day chips). | `apps/tasks-mobile/src/screens/crewSettings/AvailabilityAdmin.jsx` (extend) |
| 41.18.2.9 | CrewSettings → Crew config (admin): show `getCrewConfig({crewId})` raw — read-only debug view; useful for support flows. | `apps/tasks-mobile/src/screens/crewSettings/CrewConfig.jsx` (new) |
| 41.18.2.10 | Locale: ~20 new keys (`mobile.inbox.*`, `mobile.crewSettings.lifecycle.*`, `mobile.metrics.*`, `mobile.privacy.*`, `mobile.crewSettings.availabilityAdmin.*`). | `apps/tasks-mobile/locales/{en,nl}.json` |

**Estimate:** 0.5 day.
**Substrate touch:** none.
**Acceptance:** unread badge appears on the Inbox tab; admin can pause/unpause/archive/unarchive a crew; the Settings → Diagnostics page renders metrics; the Privacy screen renders the closed-beta notice including the four mobile items.

### Batch 3 — Skills editor + cadence config + V1 subtask-requests (Tier 5 + Tier 7 + Tier 8)

| # | Task | Files |
|---|---|---|
| 41.18.3.1 | Profile (mine) → "Edit my skills for this crew" CTA. Reads form shape via `getMySkillsFormShape({crewId})` → renders a hierarchical multi-select. Save calls `editMySkillsForCrew({crewId, skills})`. | `apps/tasks-mobile/src/screens/ProfileMineScreen.jsx` (extend) + `apps/tasks-mobile/src/screens/EditSkillsScreen.jsx` (new) |
| 41.18.3.2 | Substrate use: re-use the `<SkillTaxonomyForm>` component from `@canopy/identity-resolver/skills` if it ships one; otherwise inline a small form (lift to substrate when stoop-mobile needs the same shape — i.e. **don't lift now**, prior-art rule). | as above |
| 41.18.3.3 | CrewSettings → Cadence panel (admin). Reads `getCrewCadences({crewId})` + writes via `setCrewCadences({crewId, cadences})`. Per-event-kind toggle + interval. | `apps/tasks-mobile/src/screens/crewSettings/Cadence.jsx` (new) |
| 41.18.3.4 | Settings → "My cadence overrides" sub-page. `getMyCadenceOverrides({crewId})` + `setMyCadenceOverrides({crewId, overrides})`. Surfaces effective cadence via `resolveMyCadence({crewId})` so user sees what'll actually fire. | `apps/tasks-mobile/src/screens/SettingsScreen.jsx` (extend) + `apps/tasks-mobile/src/screens/CadenceOverridesScreen.jsx` (new) |
| 41.18.3.5 | TaskDetail (admin): when `task.parent` is set + status `subtask-requested`, surface the V1-style approve/decline pair via `approveSubtaskRequest` / `declineSubtaskRequest`. (Distinct from V2.7 propose-mode — V1 has its own request-flow used when an admin pre-approval is required.) | `apps/tasks-mobile/src/screens/TaskDetailScreen.jsx` |
| 41.18.3.6 | Inbox: add a "Subtask requests" filter chip; renders `listSubtaskRequests({crewId})` rows. (Already partially covered by V2.7's `subtask-proposal` cards — this completes the V1 path.) | `apps/tasks-mobile/src/screens/InboxScreen.jsx` |
| 41.18.3.7 | Locale: ~30 new keys across the three sub-tiers (en + nl). | `apps/tasks-mobile/locales/{en,nl}.json` |
| 41.18.3.8 | Tests: skills editor form shape, cadence override resolver, V1 subtask-request flow. | `apps/tasks-mobile/test/lib/*.test.js` |

**Estimate:** 1 day.
**Substrate touch:** none required for V1; if `<SkillTaxonomyForm>` isn't yet exported from `@canopy/identity-resolver/skills`, we add it to the substrate (Stoop will be the second consumer when it lands its own profile-skills screen).
**Acceptance:** I can edit my own skills from a phone; admin can configure crew-wide cadences + I can override per-event from settings; admin can approve/decline V1 subtask-requests from the Inbox.

### Batch 4 — Appeal flow with chat thread (Tier 6)

> Single tier in its own batch because of the chat-thread component's size — about half a day on its own.

| # | Task | Files |
|---|---|---|
| 41.18.4.1 | TaskDetail: when `task.status === 'rejected'` and the caller is the previous assignee, surface "Appeal this rejection" CTA. Calls `appealTask({taskId, note})` and routes to ChatThreadScreen. | `apps/tasks-mobile/src/screens/TaskDetailScreen.jsx` |
| 41.18.4.2 | New ChatThreadScreen (RN — mirrors stoop-mobile's chat surface). Wraps `chat-p2p`'s `<ChatThread>` substrate hook + bubble component (already in `@canopy/chat-p2p` per the Stoop V3 build). Threads keyed by `{crewId, taskId}`. | `apps/tasks-mobile/src/screens/ChatThreadScreen.jsx` (new — ~200 LOC JSX) |
| 41.18.4.3 | Inbox: render `appeal` events as cards with deep-link back into ChatThreadScreen. | `apps/tasks-mobile/src/screens/InboxScreen.jsx` |
| 41.18.4.4 | Deep-link: `tasks://appeal?crewId=&taskId=` opens the right thread directly (mirrors Stoop's `stoop://chat?...` deep-link). Wire via `apps/tasks-mobile/src/lib/deepLinks.js`. | `apps/tasks-mobile/src/lib/deepLinks.js` |
| 41.18.4.5 | Push: when an appeal posts a message, the existing `chat-p2p` notifier event already fires through PushChannel — verify the mobile receiver renders it (no skill change). | (verification only) |
| 41.18.4.6 | Locale: ~12 new keys (`mobile.appeal.*`, `mobile.chat.*`). | `apps/tasks-mobile/locales/{en,nl}.json` |
| 41.18.4.7 | Tests: appeal-skill smoke test + ChatThreadScreen render. | `apps/tasks-mobile/test/lib/*.test.js` |

**Estimate:** 0.5 day.
**Substrate touch:** none — `chat-p2p` already shipped to mobile via Phase 41.0 (it's already a watch-folder + extraNodeModules entry in the metro config).
**Acceptance:** rejected assignee can tap "Appeal" → lands in a chat thread; thread persists in `chat-p2p`'s store; admin sees the appeal in Inbox + can deep-link in.

### Batch 5 — Push relay registration + native calendar live diff (Tier 9 + Tier 10)

> Substrate touch: this batch carries the only substrate-level change of Phase 41.18 — the per-app push-token map.

| # | Task | Files |
|---|---|---|
| 41.18.5.1 | New skill `setMyPushToken({pushToken, platform})` on tasks-v0. Writes to `crew.config.pushTokens[webid]` (already exists in Stoop's pattern) — adds the `tasks` app key under a per-app map: `pushTokens[webid] = {tasks: {expo: token}, stoop: {expo: token}}`. | `apps/tasks-v0/src/skills/index.js` (new skill) + `apps/tasks-v0/src/lib/pushTokens.js` (new helper if needed) |
| 41.18.5.2 | Substrate touch: `@canopy/notifier`'s `PushChannel` learns the per-app key shape. Today it accepts `{webid → token}`; extend to `{webid → {appKey → {transport → token}}}`. Stoop's existing reads stay green via a fallback path (read `pushTokens[webid].stoop?.expo ?? pushTokens[webid]`). | `packages/notifier/src/PushChannel.js` (or wherever the lookup lives) |
| 41.18.5.3 | Mobile wiring: at boot (after permission grant), tasks-mobile registers its token via the new skill. Settings shows the registration status. Token rotates on Expo's notification + we re-register. | `apps/tasks-mobile/src/ServiceContext.js` (boot hook) + `apps/tasks-mobile/src/screens/SettingsScreen.jsx` (status row) |
| 41.18.5.4 | Substrate test: `packages/notifier/test/PushChannel.test.js` — extend to cover both the legacy single-token and new per-app shape. | `packages/notifier/test/PushChannel.test.js` |
| 41.18.5.5 | Mobile: `wireCalendarEmission` listener — when the calendarSyncMethod is `native` (or `both`) and the agent emits a calendar-changed event, run `nativeCalendar.diffEvents` + `applyDiff` immediately rather than only on Settings → "Sync now". | `apps/tasks-mobile/src/ServiceContext.js` (listener wire-up) + `apps/tasks-mobile/src/lib/nativeCalendar.js` (consume-loop) |
| 41.18.5.6 | Locale: ~6 new keys (`mobile.settings.push_status_*`, `mobile.calendar.live_sync_*`). | `apps/tasks-mobile/locales/{en,nl}.json` |
| 41.18.5.7 | Tests: per-app push token registry shape; live-diff listener end-to-end. | `apps/tasks-mobile/test/lib/*.test.js` + `packages/notifier/test/*` |

**Estimate:** 0.5 day.
**Substrate touch:** ⭐ `@canopy/notifier` learns per-app push-token map shape (with legacy fallback). The `setMyPushToken` skill is app-local on `tasks-v0`.
**Acceptance:** mobile push survives a Stoop-mobile install on the same device (different app keys, different tokens); native calendar updates within 5 seconds of a task being claimed/rescheduled; legacy Stoop push path still green.

### Phase 41.18 acceptance gates

A mobile-V1 phone APK is parity-complete when ALL of:

1. The 11 tiers above have at least one CTA reachable on the phone for each missing skill.
2. The desktop's full skill suite passes — proves no regression from the new `setMyPushToken` skill or per-app pushTokens shape.
3. The `chat-p2p` substrate suite passes — Batch 4's appeal-thread reuse hasn't regressed it.
4. Locale parity: every new key has both `en` + `nl` `{text, doc}` leaves.
5. Privacy notice unchanged (no new pod-data path or device permission introduced — the appeal-thread reuses chat-p2p; native calendar is already covered by the V1 mobile-only items).
6. Real-device run: each batch's acceptance criterion verified on a physical Android phone.

### Phase 41.18 estimate (rolled up)

**~3 dev-days sequential** (0.5 + 0.5 + 1 + 0.5 + 0.5).
**~1.5–2 dev-days wall-clock** if Batches 2 + 3 + 5 run in parallel after Batch 1 lands.

### Phase 41.18 dependencies

```
[41.17 shipped + real-device pass green]
              │
              ▼
   Batch 1 (TaskDetail + Compose) ─┐
                                   ▼
              Batch 2 (Inbox + lifecycle + misc) ─┐
              Batch 3 (Skills + cadence + V1) ────┤
              Batch 5 (push relay + cal-diff) ────┤
                                                  ▼
                                         Batch 4 (Appeal + chat thread)
```

Batch 4 lands last because the chat-thread component is the heaviest single surface and benefits from the inbox / deep-link work in Batches 2 + 5 already being settled.

## V1 acceptance gates

A mobile-V1 PR is mergeable when ALL of:

1. The phase's tests pass green.
2. The full Tasks suite (`apps/tasks-v0` 319 tests today) passes — proves no desktop regression.
3. The full Stoop suite passes — proves no substrate regression.
4. The full core suite passes — proves no SDK regression.
5. CHANGELOG bumped (per-phase or per-PR).
6. New locale keys present in BOTH `en.json` and `nl.json` with `{text, doc}` leaves.
7. New skills (none expected — skill registry is fixed) declare `visibility` + `policy` explicitly.
8. README updated where the substrate composition or "Direct SDK use" sections shift.
9. Privacy notice updated when the phase introduces a new pod-data path or a new device permission.
10. **Real-device test** — the phase's acceptance criterion passes on a physical Android phone.

## Risk register (mobile-V1 additions)

In priority order:

1. ~~**Stoop multi-agent transport investigation amends 41.1–41.2.**~~ ✅ **Resolved 2026-05-08** by Stoop's single-agent refactor + Tasks V2.8. Mobile-V1 inherits the new topology. No mid-build amendments expected.
2. **Push delivery on Doze / battery saver.** Same risk as Stoop V3. Mitigation: background-fetch fallback (41.14) + daily-digest opt-in (deferred to V1.5 if needed).
3. **Camera permission denials cascade.** Tap-to-scan QR / take-photo flows broken. Mitigation: gentle "you can paste an invite link instead" / "you can mark complete without a photo" affordances; permission-rationale modal up front.
4. **Photo deliverable size on slow networks.** 1280px JPEG ≈ 300 KB. Mitigation: queue retry via `local-store.SyncCadence`; "uploading" badge until acked.
5. **Native calendar drift.** User deletes events from the system calendar app. Mitigation: store `calendarEventId` per task; re-create on next sync if missing.
6. **OIDC-RN sign-in surface gap.** Pod sign-in lands in 41.15. Until then, mobile is local-only. Mitigation: explicit "local-only mode" indicator + "what does this mean?" help link.
7. **Multi-bundle memory pressure.** N crews × per-bundle bot agents × per-binding bot identities can pile up. Mitigation: idle-bundle close-out timer in `CrewBundles.js` (41.7.2).

## Dependencies graph

```
[Tasks V2.8 (single-agent refactor) merged]
              │
              ▼
41.0 (substrate lifts) ─┐
                        ▼
41.1 → 41.2 → 41.3 (onboarding)
              ├→ 41.4 (workspace + V2.7)
              │   ├→ 41.5 (my work + planner + photo)
              │   └→ 41.6 (review + dag + inbox + V2.7)
              │       └→ 41.7 (crews dashboard) ──┐
              ├→ 41.8 (crew settings) ────────────┤
              ├→ 41.9 (availability) ─────────────┤
              ├→ 41.10 (profile) ─────────────────┤
              ├→ 41.11 (settings + push) ─────────┤
              │   └→ 41.12 (native calendar) ─────┤
              ├→ 41.13 (bot QR — needs 41.3 + 41.8)
              ├→ 41.14 (bg-fetch — needs 41.11)
              └→ 41.15 (pod sign-in)             │
                                                  ▼
                                          41.16 (real-device pass)
                                                  │
                                                  ▼
                                          41.17 (docs)
```

Critical path: 41.0 → 41.1 → 41.2 → 41.4 → 41.6 → 41.7 → 41.16 → 41.17 = ~11 days.
With parallelism on 41.5 + 41.8 + 41.9 + 41.10 + 41.11 + 41.12 + 41.13 + 41.14 + 41.15: wall-clock ~12-14 days.

## Total V1 day estimate

**~24-25 dev-days** sequential (2 + 1 + 2 + 2 + 1.75 + 2.5 + 2 + 0.5 + 2 + 1 + 1 + 1.5 + 1 + 0.5 + 0.5 + 1.5 + 1.5 + 0.5).
**~12-14 dev-days** wall-clock with 4-5 parallel streams after 41.4 lands.

The 2-day Phase 41.0 substrate-lift cost more than pays for itself: it removes ~3-4 days of work that would have been duplicated across stoop-mobile + tasks-mobile, and removes a "rationalize duplicates" follow-up sprint. Tasks-mobile's per-phase scope drops because the screens just import substrates instead of writing each helper from scratch.

## Pointers

- Functional design: [`./mobile-functional-design-2026-05-08.md`](./mobile-functional-design-2026-05-08.md)
- Web V2 + V2.7 (the source of truth for skills + behavior): [`./functional-design-v2-2026-05-08.md`](./functional-design-v2-2026-05-08.md), [`./coding-plan-v2-2026-05-08.md`](./coding-plan-v2-2026-05-08.md)
- Stoop V3 mobile (the working RN pattern to copy): [`Project Files/Stoop/v3-mobile-coding-plan-2026-05-08.md`](../Stoop/v3-mobile-coding-plan-2026-05-08.md), [`apps/stoop-mobile/`](../../apps/stoop-mobile/)
- folio-mobile (sister RN pattern): [`apps/folio-mobile/`](../../apps/folio-mobile/)
- RN platform layer: [`packages/react-native/`](../../packages/react-native/), [`Project Files/Substrates/L0-react-native.md`](../Substrates/L0-react-native.md)
- Mobile bootstrap substrate: [`packages/sync-engine-rn/`](../../packages/sync-engine-rn/)
- Pod sign-in substrate: [`packages/oidc-session-rn/`](../../packages/oidc-session-rn/)
- Conventions: [`Project Files/conventions/`](../conventions/) (architectural-layering, app-readme-scheme, localisation, cross-app-settings)
- Substrate policies: [`Project Files/Substrates/policies.md`](../Substrates/policies.md)
- Mobile-substrates rule: [`Project Files/conventions/architectural-layering.md`](../conventions/architectural-layering.md#mobile-substrates-live-in-their-own-packages-locked-2026-05-08)
- iOS-out-of-scope: [main `README.md`](../../README.md#platform-support--ios-deliberately-out-of-scope-locked-2026-05-08)
