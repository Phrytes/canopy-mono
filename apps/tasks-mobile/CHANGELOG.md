# Changelog — @onderling-app/tasks-mobile

## [mobile-0.1.0] — 2026-05-09

Initial release. Tasks-mobile V1 — React Native client mirroring the
desktop tasks-v0 app's V0 + V1 + + V2 surface, plus the
hard-dependency UI gates and single-agent topology. Phase 41
of the Tasks-mobile coding plan.

### Headlines

- One `core.Agent` per process serves N CircleStates (single-agent
  pattern). Skills register once via `wireSkills + multiCircleResolver`;
  joining/leaving a circle mutates the live `circles` Map without a
  re-registration pass.
- 17 substrate primitives lifted from stoop-mobile in Phase 41.0 +
  41.0.b — every `lib/*.js` and `components/*.js` Tasks-mobile
  reaches for is shared with the wider mobile fleet.
- 19 screens + 6 circle-settings sub-sections covering every V1 user
  journey: onboarding, workspace, my-work + planner, review, DAG,
  inbox, circle dashboard, profile, settings, availability grid, circle
  admin, pod sign-in.
aware UI throughout: deps-blocked tasks gate Mark-complete /
  Approve; admins see Force-complete with a mandatory-reason modal;
  Add-subtask flips to Propose-subtask when the parent is submitted
  by someone else; Inbox surfaces subtask-proposal cards with
  Approve/Decline.

### Phase-by-phase summary

| Phase | What shipped | Tests added |
|---|---|---|
| 41.0  | 7 substrate lifts (L1–L7): hooks, online-cadence, picker, qr, mnemonic, push, localisation | 47 |
| 41.0.b | 10 more substrate lifts (A1–A7 + B0–B4): identity-resolver/display, identity bootstrap, storage, deepLinks, theme, components | 13 |
| 41.1  | Workspace scaffold (Expo 52 / RN 0.76.9, navigator skeleton) | 1 |
| 41.2  | ServiceContext (boot, agent, circles Map, identity vault, AppState bridge) | 13 |
| 41.3  | Onboarding (Welcome / Scan / Restore / Issue) + qrClassifiers | 17 |
| 41.4 | Workspace + TaskDetail + Compose; gate UI | 14 |
| 41.5  | MyWork (3 sections) + Planner cards + photo-deliverable submit | 10 |
| 41.6  | Review + DAG + Inbox + circle-context switch | 9 |
| 41.7  | Circles dashboard | 3 |
| 41.8  | Circle settings (6 admin panels) | 5 |
| 41.9  | Availability grid + opt-in | 9 |
| 41.10 | Profile (mine + other) — handle/avatar/skills/recovery | — |
| 41.11 | Settings + push opt-in | — |
| 41.12 | Native calendar (`expo-calendar`) | 7 |
| 41.13 | Bot binding QR (`tasks://bot-token?...`) | 3 |
| 41.14 | AppState bridge + bg-fetch task | — |
| 41.15 | Pod sign-in (`oidc-session-rn`) + bulk-sync + deep-link parser | 17 |
| 41.17 | Documentation + handoff (this entry) | — |
| **Total** | | **128** |

### Substrates

| Package | Used for |
|---|---|
| `@onderling/item-store` (L1b) | Per-circle task ledger with audit + DoD lifecycle + dependency gating |
| `@onderling/identity-resolver` (L1h) | Member webid map + `MemberMapCache` write-through; canonical user-skills profile; display + skills helpers |
| `@onderling/skill-match` (L1e) | Pubsub-of-skills broadcast for circle-wide skill availability |
| `@onderling/notifier` (L1f) | `PushChannel` + `PushPolicy` (humanInTheLoop, daily-cap, quiet hours) |
| `@onderling/chat-p2p` | Appeal flow chat threads |
| `@onderling/local-store` | `CachingDataSource` + `Settings` split |
| `@onderling/online-cadence` | Foreground ticker + AppState bridge + bg-fetch helpers |
| `@onderling/sync-engine-rn` (`./react`) | Skill hooks (useSkill, useAgentEvent, useSkillResult, useSettings, useMemberProfile) |
| `@onderling/oidc-session-rn` (`./hook`) | Pod sign-in (PKCE + DCR + token storage) |
| `@onderling/react-native` | Platform layer + 5 lifted submodules (picker, qr, mnemonic, push, localisation) + theme + components + storage + deepLinks + identity helpers |
| `@onderling-app/tasks-v0` | single-agent factories + role policy (platform-shell exception, locked 2026-05-08) |

### Deferred items (carried into V1.x)

- **Real-device pass (Phase 41.16)** — APK + closed-beta runbook
  needs a physical Android phone. Test plan documented in the
  README's "Bring it up" section.
- **Live wireCalendarEmission listener** that diffs into the native
  calendar in real-time as `task.scheduledAt` changes (currently
  V1 ships native-write-on-demand only).
- **CircleSwitcher** mounted on Workspace/MyWork/Review headers — V1
  reaches the screens via the route table; the bottom-tab shell
  with persistent header chip lands in V1.x polish.
- **Identity restore** — `svc.restoreIdentity({mnemonic})` is wired
  to the substrate's `useMnemonicReveal` hook on the read side; the
  swap-mid-flight write side (Profile recovery section) ships as a
  stub. Implement when V1.x lands on a real device.
- **Push token-relay registration** — V1 logs the registered token;
  the actual relay-side persistence (per-app `pushTokens` map in the
  circle config) is a V1.x follow-up.
**Bottom-tab navigation shell** — uses a flat stack with
  header navigation. Bottom tabs (Workspace / MyWork / Review /
  Inbox / Circles) for thumb-reach are V1.x.

### Test status

- `apps/tasks-mobile`: 106/106 green across 17 test files. No real
  RN tree is rendered — tests exercise pure-fn helpers + the
  underlying primitives (substrate-test pattern matching
  apps/stoop-mobile).
- All upstream suites stay green: apps/stoop-mobile 852/852,
  apps/tasks-v0 324/324, apps/stoop 435/435, plus every substrate.

### Bring-up

See [`README.md`](./README.md) for the full bring-up runbook + the
real-device test plan.
