# Tasks V1 — coding plan (2026-05-07)

> Translates [`advice-2026-05-07.md`](./advice-2026-05-07.md)
> into ordered build tasks. Phases run sequentially; tasks
> within a phase mostly parallelise. Day estimates are
> rule-of-thumb for one focused dev; calendar time depends on
> who's available.
>
> The advice doc is locked; this plan walks the implementation
> from there. Open trade-offs from the design review
> ([`critique-2026-05-07.md`](./critique-2026-05-07.md)) that
> the user accepted are folded into the phases. Open trade-offs
> the user explicitly ignored are noted in *Risks* per phase
> and *Acceptance gates* at the bottom.

## Headline numbers (revised again 2026-05-08 — lifts shipped)

- **All planned Stoop lifts have already shipped** (parallel work
  by the author + another local agent, 2026-05-08). Tasks V1 no
  longer carries the lift cost — the substrates are there to
  consume directly.
- **V1 estimate**: **~28-29 dev-days** across 11 phases (~5.5
  calendar weeks at one focused dev, ~3 at two). Net trajectory:
  initial ~30 → trimmed to ~26-27 by the duplicate audit →
  back to ~30 with planned Stoop lifts → finalised at ~35.5
  with full lift detail → **dropped to ~28-29 once the lifts
  shipped externally**. See per-phase breakdown at the bottom.
- **V1.5 estimate** (push + chat-bot + custom-role UI): ~7
  additional dev-days.
- **V1 test target**: **~80 tests** (~30 fewer than the lift-
  inclusive ~110 estimate — substrate test suites are now in
  the substrate packages themselves, not in Tasks).
- **Substrates are READY:**
  - ✅ `@canopy/local-store` — `CachingDataSource` + `SyncCadence` + `createSettingsModule` factory.
  - ✅ `@canopy/chat-p2p` — `wireChat` with `emitEnvelopeType` + `acceptedEnvelopeTypes` for Stoop back-compat.
  - ✅ `@canopy/identity-resolver` — extended with `MemberMapCache`, `onboardingSkills` (`buildOnboardingSkills`), `skillsMatch` + `skillsTaxonomy.json` + `tagNormalisation.json`. (Note: invite/redeem helpers landed in `identity-resolver` not `core.GroupManager` — cleaner split.)
  - ✅ `@canopy/notifier` — extended with `UsageMetrics`.
  - ✅ Stoop's `apps/stoop/src/lib/{CachingDataSource, SyncCadence, Settings, UsageMetrics}.js` and `chat/wireChat.js` are now thin shims; Stoop's 429/429 tests pass.
- **Substrate movements during V1**:
  - **`@canopy/local-store`** — lift `CachingDataSource` +
    `SyncCadence` from Stoop. Also fold in **Stoop's
    `Settings` split** (shared / per-device persistence shape)
    since it sits on top of the same cache.
  - **`@canopy/identity-resolver` extension** — lift
    `MemberMapCache` (auto-persist MemberMap) from Stoop +
    add a `skills/` submodule that lifts Stoop's
    `skillsTaxonomy.json` + `tagNormalisation.json` +
    `skillsMatch` matcher.
  - **`@canopy/notifier` extension** — fold in Stoop's
    `UsageMetrics` (per-event counter for the feedback loop;
    sits next to cadence config). NOT a new channel — the
    in-app inbox is a `MessagingBridge` (matches existing
    pattern).
  - **`core.GroupManager` extension** — add canonical
    `issueInvite` + `redeemInvite` skill helpers (the underlying
    primitives are already there; lift the small skill
    wrappers from Stoop's `onboarding.js`).
  - **`@canopy/chat-p2p`** — new package; lift Stoop's
    `wireChat` peer-to-peer chat. Tasks V1's `appeal` skill is
    the second consumer.
  - **`@canopy/item-store` extension** — DoD lifecycle states
    + sub-task fields (genuinely new, no prior art).
- **Handoffs to other apps**: calendar source connectors go to
  `apps/import-bridge-v0` (composing existing `LiveSyncSkill`
  + `OAuthVault`).
- **Zero new SDK primitives**.

## Reuse audit summary (changes since first draft)

See [`advice-2026-05-07.md` § Reuse audit](./advice-2026-05-07.md#reuse-audit--what-already-ships-added-2026-05-07)
and [`§ Stoop lift opportunities`](./advice-2026-05-07.md#stoop-lift-opportunities-triggered-by-tasks-v1-added-2026-05-07)
for the full tables. Coding-plan deltas:

**Reduced (prior art found):**

- **Phase 1** drops `LocalFileSource` work — use
  `core.FileSystemSource` / `core.IndexedDBSource` directly
  (~1 day saved).
- **Phase 2** notes that crew-creation skills lift Stoop's
  `onboarding.js` pattern.
- **Phase 5** notes that `core.Roles.registerCustomRole` exists;
  V1 still ships standard roles only, but the SDK side is done.
- **Phase 6** reframes the in-app inbox as a `MessagingBridge`
  (app-level), not a notifier extension (~0.5 day saved).
- **V1.5 chat-bot** estimate halved — `chat-agent.TelegramBridge`
  already ships (~2-3 days saved).

**Added (Stoop-lift opportunities; rule of two now satisfied):**

- **Phase 1** absorbs Stoop's `Settings` split (shared +
  per-device persistence) into `@canopy/local-store`
  (~+0.5 day).
- **Phase 2** lifts `MemberMapCache` to
  `@canopy/identity-resolver` (auto-persist crew rosters)
  AND adds canonical `issueInvite`/`redeemInvite` skill
  helpers to `core.GroupManager` (~+1 day).
- **Phase 3** lifts `skillsTaxonomy` + `tagNormalisation` +
  `skillsMatch` to `@canopy/identity-resolver/skills/`
  (~+1 day).
- **Phase 6** lifts Stoop's `wireChat` peer-to-peer chat
  into a new `@canopy/chat-p2p` package (Tasks V1's
  `appeal` skill is the second consumer and uses it; ~+1
  day) — the lift slots into Phase 6 alongside the appeal
  flow so the consumer ships in the same phase as the
  substrate.
- **Phase 9** absorbs Stoop's `UsageMetrics` into
  `@canopy/notifier` (sits next to cadence config; ~+0.5
  day).

**Net**: ~+3-4 days but each removes future app-side glue.

## Out-of-band prerequisites

These don't block phases 0–1 but block V1 acceptance.

- **Solid pod / cap-token UX cleanup decision.** Tracked in
  `Project Files/TODO-GENERAL.md` 🔴 HIGH. If the Inrupt
  migration lands before V1's pod paths solidify, fold the
  shared component in; otherwise V1 inherits whatever ships
  and notes the inheritance.
- **Mockup `.ics` calendar fixtures.** Required for Phase 4
  testing; one-time author. ~30 min.
- **Choice of `subtasks.adminApprovalDepth` default.** Open
  question 9 in advice doc; recommendation 3. Lock before
  Phase 6.
- **Crew pod ownership default for V1** (open question 1).
  Recommendation (a) admin-hosts-the-crew. Lock before Phase
  1.

## Phase 0 — Bring-up + V0 baseline (1 day)

Validate the V0 surface still works after the substrate refactor
and prep the V1 branch.

- Run V0 test suite end-to-end; fix any drift.
- Branch `track-H-tasks-v1` from `master`.
- Update `apps/tasks-v0/CHANGELOG.md` with a stub entry for V1.
- Document the V0→V1 shape change in the README's V0/V1+
  section (already added in the 2026-05-07 README update;
  verify renders cleanly).
- Add a developer note to `apps/tasks-v0/README.md` pointing at
  this coding plan.

**Tests added**: 0 (regression-only).
**Risks**: V0 has been stable; this should be uneventful.

## Phase 1 — Wire `@canopy/local-store` into Tasks (0.5 day, revised — lift shipped)

The substrate is already shipped (parallel work, 2026-05-08):
`packages/local-store/` with `CachingDataSource`, `SyncCadence`,
and `createSettingsModule({appId, sharedFields, deviceFields,
defaults})` factory. Stoop tests pass. Tasks V1 just consumes.

**Tasks V1 work**:

- Add `@canopy/local-store` to `apps/tasks-v0/package.json`
  dependencies.
- New module `apps/tasks-v0/src/storage/buildBundle.js`:
  - Composes `CachingDataSource` over a configurable inner
    DataSource (`MemorySource` for tests, `FileSystemSource`
    for local-mode default, pod-client adapter for pod-mode).
  - Exposes a `SyncCadence` for foreground polling.
- New module `apps/tasks-v0/src/storage/settings.js`:
  - Calls `createSettingsModule({appId: 'tasks', sharedFields,
    deviceFields, defaults})` with Tasks's schema.
  - Shared fields (V1): `pushPreferences` (per-event opt-out),
    `cadenceOverrides`, `defaultShareLocationForCalendar`.
  - Device fields (V1): `pollIntervalMs`, `localModeRoot`.
  - Re-exports the resulting `loadSettings` / `saveSettings` /
    `updateSettings` so Tasks call sites read like
    `import {loadSettings} from './storage/settings.js'`.
- Update `createTasksAgent` to optionally accept a
  `localStoreBundle` parameter and use it as the underlying
  DataSource for the item-store.
- Leave the existing `MemorySource` zero-config path intact
  (V0 tests continue to pass).

**Tests added**: ~3 (Tasks-side `buildBundle` smoke test,
`settings.js` round-trip, V0 zero-config compatibility).
**Dependencies**: None.
**Risks**: very low — the substrate is well-tested
upstream and Stoop is the proof-of-life consumer.

## Phase 2 — `Crew` envelope (2.5 days, revised — identity-resolver lifts already shipped)

Promote the implicit "household" of V0 to a first-class Crew
container. **`MemberMapCache` and `buildOnboardingSkills` are
already in `@canopy/identity-resolver`** (shipped 2026-05-08
— Stoop's `onboarding.js` is now a wrapper). Tasks V1 just
consumes.

**Tasks app work** (in `apps/tasks-v0/src/`):

- New `Crew.js`:
  - `loadCrewConfig({podClient, configUri})` →
    `{name, kind, members, roleTable, customRoles, skills,
    cadence, dodPolicy, archivePolicy, subtasksAdminApprovalDepth}`.
  - `createCrewAgent({crewId, configUri, roles, members | pod, ...})`
    — wraps `createTasksAgent` with crew context.
- Pod schema additions under `<crew-pod>/crews/<id>/`:
  - `config.json` (the loadable bundle above).
  - `skills.json` (vocabulary list — read in Phase 3).
  - `cadences.json` (deadline-reminder defaults — read in Phase 6).
- Per-crew `MemberMap.fromPodConfig` wiring (already
  structurally supported).
- **Use** `MemberMapCache` (newly lifted in this phase, see
  below) to auto-persist the per-crew member map.
- Single-implicit-crew zero-config path preserved (no crew config
  → defaults to one "household" crew).
- 6-question crew-creation wizard skill (`createCrew`) — name,
  kind, pod-ownership choice (a or b), default approval mode,
  archive policy, admin webids.
- Crew-switcher data-skill (`listMyCrews`) — returns crews this
  agent has a `GroupProof` for.
- `createCrew` skill **calls** the canonical
  `core.GroupManager.issueInviteSkill` / `redeemInviteSkill`
  helpers (newly lifted, see below) for the underlying
  invite/redeem mechanics.

**Substrates already shipped (just consume):**

- `@canopy/identity-resolver` exports `MemberMapCache` (load /
  attach / bootstrap helpers) — auto-persist crew rosters via
  Tasks V1's `local-store` bundle.
- `@canopy/identity-resolver` exports `buildOnboardingSkills({...})`
  which registers `issueInvite` + `redeemInvite` skills with an
  optional `onSpawn` hook. **Note**: this landed in
  `identity-resolver` rather than `core.GroupManager` (parallel
  agent's call — cleaner split: GroupManager owns the crypto
  primitives, identity-resolver owns the skill wrappers).
- `core.GroupManager.issueInvite` / `redeemInvite` instance
  methods are what `buildOnboardingSkills` wraps.

**Tests added**: ~7 (config loading, missing config fallback,
crew creation, switcher list, multi-crew membership, member-
map auto-persist via local-store, zero-config implicit-household
path).
**Dependencies**: Phase 0; Phase 1 (uses `CachingDataSource`
for the member-map persistence).
**Risks**: low — the substrate consumers are well-tested
upstream (Stoop). Watch for skill-name collisions (Tasks V1
shouldn't register its own `issueInvite` / `redeemInvite` if
it imports the identity-resolver helpers).

## Phase 3 — Canonical user profile + per-crew vocabulary (2 days, revised — taxonomy lift shipped)

Skills taxonomy + matcher already in `@canopy/identity-resolver`
(shipped 2026-05-08). Tasks V1 just imports + builds the
skill-import-from-pod pattern on top.

**Substrates already shipped (just consume):**

- `@canopy/identity-resolver` exports `TAXONOMY`,
  `normaliseTag`, `categoryFor`, `matchesProfile`,
  `isKnownCategory` (+ underlying `skillsTaxonomy.json` and
  `tagNormalisation.json` data files). Stoop already uses these
  via its lib shim.

**Tasks app work** (in `apps/tasks-v0/src/skills/`):

- `profile.js`:
  - `readCanonicalProfile({podClient, userPod})` — reads
    `<user-pod>/profile/skills.json`. Schema aligns with
    identity-resolver's `taxonomy.json` (each entry references
    a canonical category + tag).
  - `writeCanonicalProfile({podClient, userPod, profile})` —
    writes back, gated by user opt-in.
  - `readCrewVocabulary({podClient, crewPod, crewId})` — reads
    `<crew-pod>/crews/<id>/skills.json`. Vocabulary is a
    *subset of taxonomy* + crew-specific free-form additions.
  - `prefilledFormShape({canonicalProfile, crewVocabulary, taxonomy})`
    — returns `{prefilled: [...], freeform: [...]}` for the UI.
    Taxonomy passed in so the helper auto-suggests categories
    the user hasn't explicitly listed.
- New skill `editMySkillsForCrew({crewId})` — UI uses the
  prefilled shape; submit writes the per-crew projection
  (`<crew-pod>/crews/<id>/skills/<webid>.json`) and optionally
  writes back to the canonical profile.
- Per-crew posture file convention documented + read at agent
  init: `<member-pod>/posture/<crewId>.json`.

**Tests added**: ~5 (canonical-profile read/write, vocabulary
read, prefilled shape intersect, missing-profile fallback,
crew skill projection).
**Dependencies**: Phase 1 (`CachingDataSource` for offline-mode
profile editing) + Phase 2 (per-crew config).
**Risks**:
- Taxonomy is Stoop-shaped (categories like `vervoer` /
  `huishouden` that fit a buurtcontext). For Tasks-decentralised-
  OSS-project use, this may feel out of place — add OSS-flavour
  categories via a separate PR if a real OSS crew complains.
- Pod-data-share caution principles bite here; add an explicit
  "save back to canonical profile?" checkbox in the prefilled
  form.

## Phase 4 — Local calendar reader + mockup fixtures (2 days)

App-internal `.ics` reader; pure local; no skill registration.

- New module `apps/tasks-v0/src/calendar/iCalReader.js`:
  - Depend on `ical.js` (npm).
  - `readMyCalendar({source: {kind: 'pod' | 'local', ...},
    range})` — returns conflicts.
  - Pod-mode: lists `<user-pod>/calendar/*.ics` via
    `pod-client`, fetches each, parses, expands RRULEs, projects
    to busy intervals within `range`.
  - Local-mode: globs a local directory (default
    `~/.tasks/calendar/` resolved via `LocalFileSource`'s root),
    same parse/project pipeline.
- Test fixtures under `apps/tasks-v0/test/fixtures/calendar/`:
  - `recurring-weekly.ics` (a Tuesday-2pm meeting).
  - `one-shot.ics` (a Friday-evening event).
  - `all-day.ics` (a Saturday all-day vacation).
  - `tz-amsterdam.ics` (an event in `Europe/Amsterdam` to
    exercise VTIMEZONE).
- Pod-mock loader (`apps/tasks-v0/test/utils/podMockCalendar.js`)
  that exposes the fixtures as if they lived under
  `<user-pod>/calendar/`.

**Tests added**: ~5 (single-event range hit, RRULE expansion,
all-day handling, timezone projection, local-mode glob).
**Dependencies**: Phase 1 (`LocalFileSource` for local-mode).
**Risks**: `ical.js`'s RRULE expansion is well-tested upstream;
trust it. Do NOT hand-roll. Edge case to test: events that span
the range boundary (start before, end inside; start inside, end
after).

## Phase 5 — DoD lifecycle on `item-store` + new skills (4 days)

The biggest substrate extension. Schema additions + new states +
new skills + role-policy table extension.

**Substrate work** (in `packages/item-store/`):

- Schema additions to `Item`:
  - `definitionOfDone?: string`
  - `approval?: 'self-mark' | 'creator' | \`webid:${string}\``
    (default `'self-mark'`)
  - `deliverable?: {kind, ref, submittedAt?}`
  - `reviewLog?: Array<{at, by, decision, note?}>`
  - `master?: webid` (defaults to `addedBy`)
  - `parentTaskId?: string`
- New states: `submitted`, `rejected` (both interpreted via
  computed status from `reviewLog` + `completedAt`).
- New methods on `ItemStore`:
  - `submit(id, {deliverable?, note?}, ctx)` —
    `claimed → submitted`.
  - `approve(id, {note?}, ctx)` — `submitted → complete`.
  - `reject(id, {note}, ctx)` — `submitted → rejected → claimed`
    (note required).
  - `revoke(id, {reason}, ctx)` — `claimed → open` (reason
    required); preserves `master`.
- Per-field merge contract for `master` = LWW (rare write,
  no race expected); for `reviewLog` = append-only.

**App-side work** (in `apps/tasks-v0/src/skills/`):

- `submitTask`, `approveTask`, `rejectTask`, `revokeTask`,
  `setApprovalMode` — wrap the substrate methods with role-
  policy gating + audit-log entries.
- Role-policy table extension in `apps/tasks-v0/src/rolePolicy.js`
  per the role × action table in the advice doc.
- Default approval mode is `self-mark` everywhere.
- **Note on custom roles**: `core.Roles.registerCustomRole(id,
  rank)` already supports the Q-H4.7 (c) extension path. V1.0
  doesn't expose it (standard 5 only); V1.1 adds the management
  UI. The SDK side is **already done**, no SDK work needed.

**Tests added**: ~15 (state-transition matrix: 6 transitions
× 2 approval modes × 5 roles = trim to ~15 representative
cases; revoke-without-reason rejection; reject-without-note
rejection; reviewLog append-only; merge contract for master).
**Dependencies**: Phase 0 (V0 baseline).
**Risks**:
- Backwards compat: V0 ledgers must read cleanly without the
  new fields. Add a migration test.
- The `submitted → complete` transition for `self-mark` must
  be atomic so dependents flip to `ready` immediately.

## Phase 6 — In-app inbox bridge + appeal flow + issuer notifications (2.5 days, revised — chat-p2p lift shipped)

`@canopy/chat-p2p` is already shipped (2026-05-08; Stoop's
`wireChat.js` is now a shim around it with envelope-type
back-compat). Tasks V1 just consumes for the `appeal` flow.

**Substrates already shipped (just consume):**

- `@canopy/chat-p2p` exports `wireChat({...})` factory. Apps
  call it during agent construction and get back
  `{ send, detach }`. The substrate handles `agent.on('message',
  ...)` registration, dedup-by-nonce, and item-store
  persistence (caller injects the item-store). Default
  `emitEnvelopeType: 'p2p-chat'`; Stoop emits `'stoop-chat'`
  legacy; both readers accept both for cross-version chat.

**Tasks app — in-app inbox bridge** (in `apps/tasks-v0/src/bridges/`):

- New `InAppInboxBridge.js` — implements `MessagingBridge` (same
  interface as `TelegramBridge` + `InMemoryBridge`):
  - `start()`, `stop()`, `onMessage(handler)`,
    `sendReply({chatId, text, buttons, meta})`.
  - `sendReply` writes a `kind: 'notification'` item to the
    recipient's inbox `ItemStore`. `chatId` is interpreted as
    the recipient's webid.
- Inbox storage convention: `<user-pod>/inbox/<id>.json`. Backed
  by an `ItemStore` over a `CachingDataSource`-wrapped
  `core.FileSystemSource` (local mode) or `pod-client`-adapter
  (pod mode).
- Apps pass the bridge directly into `notifier.channels` (same
  way they pass `TelegramBridge`); no notifier extension.

**Tasks app — appeal flow** (in `apps/tasks-v0/src/skills/`):

- New skill `appealTask({taskId})` — assignee-of-revoked-task only,
  available for 7 days post-revoke. Calls
  `chat-p2p.sendChatMessage` to open a thread between the
  previous assignee and the master, pre-loaded with the revoke
  reason from the task's `reviewLog`.
- The thread's `source.threadId` is `appeal-${taskId}` so
  later UI can list per-task appeal threads.
- Notifier wires: on `revoke`, send to the previous-assignee
  inbox; on a chat-message arriving in an `appeal-*` thread,
  surface in the master's inbox.

**Tasks app — issuer-notification jobs** (in `apps/tasks-v0/src/notifications/`):

- `wireIssuerNotifications({notifier, itemStore, crewConfig})`:
  - On every `item-added` with `dueAt`, schedule a one-shot
    `missed-deadline-${itemId}` at `dueAt`. Cancel on
    `item-completed` / `item-removed`.
  - On `item-completed`, send a notification to
    `item.master ?? item.addedBy` ("Task X was completed by Y").
  - On `item-submitted`, send a notification to the designated
    approver ("Y submitted X for your review"). Throttled per
    the cadence config.
  - On `revoke`, send a notification to the previous assignee
    with the reason + an "Appeal" action that calls
    `appealTask`.
- Per-crew cadence resolution: user override > crew default >
  baseline.

**Tests added**: ~6 (inbox bridge roundtrip, missed-deadline
fire, missed-deadline cancellation on completion, approver
notification, revoke notification + appeal, appeal-thread
routing).
**Dependencies**: Phase 1 (CachingDataSource), Phase 5 (the
events to subscribe to).
**Risks**: scheduling cancellation on rapid add-then-complete
is the race-prone case; test it deterministically with a
mocked clock.

## Phase 7 — Sub-tasks + DAG tree helpers + admin-approval queue (3 days)

Sub-task spawning + DAG navigation + admin escalation past depth
threshold.

**App-side work**:

- New `apps/tasks-v0/src/dag-tree.js`:
  - `treeOf(taskId, allTasks)` — returns the sub-task tree
    rooted at `taskId`.
  - `ancestorChain(taskId, allTasks)` — returns
    `[grandparent, parent, self]` via `parentTaskId` walk.
  - `depthOf(taskId, allTasks)` — integer depth.
- New skill `addSubtask(parentTaskId, partial, ctx)`:
  - Authz: caller must be the parent's `assignee` or its
    `master` (or admin/coord).
  - Computes `depthOf(parentTaskId) + 1`.
  - If depth > `crewConfig.subtasks.adminApprovalDepth`:
    insert a `pending-admin-approval` item in a queue at
    `<crew-pod>/crews/<id>/subtask-requests/`. Notify all crew
    admins via the inbox. Skill returns `{queued: true,
    requestId}`.
  - Otherwise: create the sub-task with `parentTaskId` set;
    add `childId` to parent's `dependencies` (CAS); spawner
    becomes `master` of the new sub-task by default.
- New admin skills `approveSubtaskRequest(requestId)` /
  `declineSubtaskRequest(requestId, note?)`.
- DAG cycle detection extends to consider `parentTaskId` walk
  in addition to the existing `dependencies` walk.

**Tests added**: ~5 (basic spawn, depth-3 cap fires admin queue,
admin approve creates the task, decline doesn't, cycle
detection through parent chain, ancestor-chain helper).
**Dependencies**: Phase 5 (new lifecycle), Phase 6 (admin inbox
notification).
**Risks**: the admin-approval-queue is a small new pod
sub-collection; treat it like a mini item-store with `kind:
'subtask-request'`.

## Phase 8 — Workspace UI shell + 7 screens (5 days)

The web UI surface. Screens map to advice doc § *Workspace
screens (six-screen mapping)* + the inbox sheet.

- `apps/tasks-v0/web/`:
  - `index.html` — workspace home (list of open tasks, status
    pills, kind filter, per-role view filter).
  - `add-task.html` — composer (skill auto-suggest from crew
    vocabulary, deadline picker, conflict badges from local
    calendar reader, approval picker, optional sub-task spawn
    context).
  - `mine.html` — tabs: assigned-to-me, master-of, ready-to-
    claim, submitted.
  - `review.html` — approver inbox.
  - `dag.html` — read-only graph view (`treeOf` rendering).
  - `crew.html` — crew + members + settings + stats sub-tab.
  - `inbox.html` (or modal) — list of inbox items.
- `app.js` — A2A client + per-screen JS controllers.
- `style.css` — reuse Stoop's calmness language (whitespace >
  density). Include status pills (ready/waiting/blocked +
  claimed/submitted/rejected/complete).
- Crew switcher (top-left dropdown) — copies Stoop's
  group-switcher pattern.
- Inbox badge in nav (live update via SSE).

**Tests added**: ~15 UI smoke tests (`puppeteer`-style or
equivalent — same pattern Stoop's `web/` tests use). Cover:
add task → claim → submit → approve flow; revoke + appeal
flow; sub-task spawn; admin-approval queue; conflict-badge
rendering on a fixture calendar.
**Dependencies**: Phases 2–7.
**Risks**: UI sprawl. Time-box. If a screen feels under-
specified, ship the simplest version that exercises the skill
calls; polish later.

## Phase 9 — Observability stats tab + admin cadence config (1.5 days, revised — UsageMetrics lift shipped)

`UsageMetrics` is already in `@canopy/notifier` (shipped
2026-05-08; Stoop's `lib/UsageMetrics.js` is now a shim). Tasks
just imports and composes for its stats tab.

**Tasks app work** (in `apps/tasks-v0/src/observability/`):

- `metrics.js` — composes `notifier.UsageMetrics` to track:
  tasks added, claimed, completed, revoked, rejected, approved,
  missed-deadline; time-to-claim; time-from-submit-to-approval;
  notification arrival → user action.
- Locally aggregated; opt-in to share with crew admin (per the
  pod-data-share caution principles).
- Stats tab in `crew.html` rendering the above (text + tiny
  inline sparklines if budget allows; tables if not).
- Admin cadence config UI in the same tab — editable form for
  crew defaults; writes to `cadences.json` (the file Phase 2
  introduced).
- User cadence overrides UI on `mine.html` settings sub-tab.
  Persists via `Settings` (the user-portable shared blob from
  Phase 1).

**Tests added**: ~3 (Tasks per-event counter increments,
cadence resolution order user > crew > baseline, share-with-
admin gating).
**Dependencies**: Phases 2–6.
**Risks**: keep it simple — don't ship time-series databases
or charting libraries. Tables + numbers are fine for V1.

## Phase 10 — Localisation, archive, pause, privacy notice (2 days)

Polish + ship-readiness.

- `apps/tasks-v0/locales/{en,nl}.json` per the project
  localisation convention — every UI string in `web/` keyed.
- `archiveCrew()` skill — moves the entire ledger to
  `closed/yyyy-mm/` on the crew pod; removes from the agent's
  active subscriptions; reversible.
- `pauseCrew()` skill — sets a `paused` flag in crew config;
  blocks `addTask`; nudges suppressed.
- `apps/tasks-v0/src/lib/privacyNotice.js` — closed-beta
  notice text in `nl` + `en`. Mirrors Stoop's structure.
  Adds the explicit "calendar data stays on your device" line
  + the pod-data-sharing caution principles summary.

**Tests added**: ~3 (locale loading, archive roundtrip, pause
blocks add).
**Dependencies**: Phase 8.
**Risks**: localisation always finds a few hardcoded strings
hiding in JSX; budget a half-day for the back-fill.

## Phase 11 — Documentation + launch checklist (1 day)

- Update `apps/tasks-v0/README.md` with V1 features +
  `npm run` commands + screenshots (text mockups OK).
- Update `Project Files/Substrates/apps/H4-tasks.md` to
  reflect V1 substrate composition (note the
  `local-store` lift + `notifier` extension).
- Author `apps/tasks-v0/CHANGELOG.md` V1 entry.
- Final acceptance pass against the gates below.

**Tests added**: 0.
**Dependencies**: All prior phases green.

## V1 acceptance gates

V1 is ready to ship to a closed beta when:

1. ✅ All ~85 tests pass (Phase 0 V0 baseline + Phases 1–10
   additions).
2. ✅ Local-only mode works end-to-end without a pod
   connection (Phase 1 + 6 tests cover this).
3. ✅ Cold-boot inbox shows cached entries before pod
   connects (Phase 6).
4. ✅ Calendar conflict view shows fixture events on the
   `add-task` screen (Phase 4 + 8).
5. ✅ Sub-task spawn at depth ≤ 3 succeeds; spawn at depth 4
   queues admin approval (Phase 7).
6. ✅ Revoke with reason → previous assignee inbox entry +
   appeal-thread opens cleanly (Phase 6 + 8).
7. ✅ Approval mode `creator` works end-to-end (claim →
   submit → approve / reject) (Phase 5 + 8).
8. ✅ Skill-import-from-pod prefilled form works against the
   canonical profile fixture (Phase 3 + 8).
9. ✅ Crew switcher works for an agent with ≥ 2 crew proofs
   (Phase 2 + 8).
10. ✅ Localisation: every visible string in `web/` resolves
    via `locales/<lang>.json` (Phase 10).
11. ✅ Privacy notice surfaces during onboarding and is in
    both languages (Phase 10).
12. ✅ Stats tab displays metrics for a fixture crew with
    seeded activity (Phase 9).
13. ✅ The "out-of-band" Inrupt-migration TODO has a
    timeline and Tasks V1 either depends on it landing first
    or explicitly inherits the legacy pod-share UX with a
    documented hand-off plan.

## V1.5 (deferred from V1; ~10 dev-days)

Each item is forced by a real consumer or operational need.

- **Push notification channel + `PushPolicy` promotion** (~2
  days) — wires `relay.ExpoPushSender` + `MobilePushBridge`
  into notifier alongside the in-app inbox. Per-event toggle
  in user settings. Requires relay-side push provisioning
  green-lit.
- **Custom-role management UI** (~3 days) — small screen for
  Q-H4.7 (c) extension. **The data path is already in
  `core.Roles.registerCustomRole`**; this phase is purely UI:
  add/edit/remove custom-role rows in `<crew-pod>/crews/<id>/config.json`,
  call `registerCustomRole` on agent boot. Standard 5 roles
  remain default. Forced when a real crew (likely neighborhood-
  maintenance) needs a role beyond standard 5.
- **Chat-bot bridge (Telegram)** (~2-3 days, revised down from 5)
  — import `TelegramBridge` from `@canopy/chat-agent` (already
  shipped, used by household), wire to Tasks agent, register
  `bot.*` skills (`bot.listOpen`, `bot.whatBlocks`,
  `bot.listMine`, `bot.markComplete`, `bot.approve`,
  `bot.appeal`). Capability-token-bound bot agent reuses
  `core.permissions.CapabilityToken`. Audit-log entries
  distinguish "X via web" from "X via TG".

## V2 (no estimate; demand-driven)

- Auto-scheduling planner (calendar input → task slot
  assignment).
- Cross-crew dashboard (depends on archive-app pattern).
- Real-time collaboration on a deliverable doc (depends on
  project #1's OSS-doc-tool integration).
- Compensated-role flag + invoicing primitives.
- Cryptographic anonymity (depends on Stoop V2's Q-H5
  unpark).
- Cross-tool calendar sync write-side (`VEVENT` emission to
  pod when a task is scheduled).
- Federated crew pod ownership pattern (c) (depends on
  `pod-client` federated-reader being binding).
- Cross-member availability hints (would require an opt-in
  flow that makes the privacy trade-off acceptable).

## Risk register

Things that could derail V1, in priority order.

1. **Solid pod / cap-token UX cleanup TODO unresolved.**
   See `TODO-GENERAL.md`. If still undecided when Phase 8
   starts, the workspace UI builds against the legacy share
   UX and absorbs the rework cost in V1.5. **Mitigation**:
   put a decision deadline on Phase 0; refuse to start Phase
   8 without it.
2. **`subtasks.adminApprovalDepth` default contested.** If
   admins feel 3 is too restrictive, the admin-approval
   queue gets noisy. **Mitigation**: ship with the override
   in crew config from Phase 2; let early users tune it.
3. **`ical.js` quirks with non-Western timezones.** RRULE +
   timezone interactions are notoriously fiddly.
   **Mitigation**: test fixtures cover `Europe/Amsterdam`
   only in Phase 4; users in other timezones may hit edge
   cases V1 doesn't catch. Document the limitation.
4. **`@canopy/local-store` lift breaks Stoop tests.** The
   refactor is supposed to be behaviour-preserving; if it
   isn't, Stoop V2 takes collateral damage. **Mitigation**:
   run Stoop's full test suite against the lifted package
   in Phase 1 before merging.
5. **DAG cycle detection across parent-chain + dependencies
   has a subtle bug.** Two ways to create cycles now (`dep`
   edges and `parentTaskId` edges). **Mitigation**: explicit
   test in Phase 7 that constructs each cycle shape and
   verifies rejection.
6. **UI scope creep in Phase 8.** Five days for seven screens
   is tight. **Mitigation**: time-box per screen; if a
   screen needs more, defer the polish to Phase 11.

## Dependencies graph (visual)

```
 Phase 0 (V0 baseline)
   │
   ├─→ Phase 1 (local-store: CachingDS + SyncCadence + Settings)
   │     │
   │     ├─→ Phase 2 (Crew envelope + MemberMapCache lift + GroupManager helpers)
   │     │     │
   │     │     ├─→ Phase 3 (skills lift + profile + per-crew vocab)
   │     │     │
   │     │     └─→ Phase 9 (observability + UsageMetrics lift)
   │     │
   │     ├─→ Phase 4 (calendar reader)
   │     │
   │     └─→ Phase 6 (inbox bridge + chat-p2p lift + appeal + issuer notifications)
   │            │
   │            └─→ Phase 7 (subtasks + admin queue)
   │
   └─→ Phase 5 (DoD lifecycle)
         │
         └─→ Phase 6 (events to subscribe to)
                  │
                  └─→ Phase 8 (UI)
                            │
                            └─→ Phase 10 (localisation + archive + pause + privacy)
                                      │
                                      └─→ Phase 11 (docs + acceptance)
```

Phases 1 and 5 can start in parallel after Phase 0. Phase 2
depends on Phase 1 (uses CachingDataSource for member-map
persistence). Phase 6 fans out the most because it ships THREE
substrate movements (inbox bridge + chat-p2p lift + UsageMetrics
prep).

## Total V1 day estimate (revised again — lifts shipped 2026-05-08)

| Phase | Days | What | Status |
|---|---|---|---|
| 0 | 1 | V0 baseline + branch + CHANGELOG stub | ✅ done |
| 1 | 0.5 | Wire `@canopy/local-store` into Tasks (substrate already shipped) | next |
| 2 | 2.5 | Crew envelope (consumes shipped `MemberMapCache` + `buildOnboardingSkills`) | |
| 3 | 2 | Canonical profile + per-crew vocab (consumes shipped taxonomy + matcher) | |
| 4 | 2 | Local calendar reader + mockup fixtures | |
| 5 | 4 | DoD lifecycle on item-store + new skills (genuinely new) | |
| 6 | 2.5 | In-app inbox bridge + appeal flow + issuer notifications (consumes shipped chat-p2p) | |
| 7 | 3 | Sub-tasks + DAG tree + admin-approval queue (genuinely new) | |
| 8 | 5 | Workspace UI shell + 7 screens (genuinely new) | |
| 9 | 1.5 | Observability stats + cadence config (consumes shipped `UsageMetrics`) | |
| 10 | 2 | Localisation, archive, pause, privacy notice | |
| 11 | 1 | Documentation + launch checklist | |
| **Total** | **~27** | (one focused dev, ~5.5 weeks; ~2.5-3 weeks at two devs) | |

Day-budget trajectory:

- ~30 (initial) → ~26-27 (after duplicate audit) → ~30 (planned
  Stoop lifts) → ~35.5 (lift detail surfaced shim-parity work)
  → **~27** after the lifts shipped externally.
- The lift work didn't disappear — it just moved out of the
  Tasks V1 critical path. The `apps/stoop/src/lib/` shim work
  + substrate test suites are already in place (Stoop 429/429
  passing).

**Each lift removed future app-side glue from Stoop** and
pre-empted duplication if a third app emerges. Same trade,
better outcome — Tasks V1 starts with a cleaner substrate
landscape.

## Pointers

- [`advice-2026-05-07.md`](./advice-2026-05-07.md) — the
  design this plan implements.
- [`critique-2026-05-07.md`](./critique-2026-05-07.md) — the
  honest pushback; user accepted some of it (folded above)
  and ignored the rest.
- `Project Files/Stoop/coding-plan-v1-2026-05-05.md` — the
  reference structure this plan mirrors.
- `Project Files/coding-plans/track-H-app-tasks-questions.md`
  — Q-H4.x worksheet (V0 locks).
- `Project Files/Substrates/substrate-candidates.md` — track
  the `local-store` promotion + the `prefilledFormShape`
  candidate.
- `Project Files/TODO-GENERAL.md` 🔴 HIGH — the Inrupt-
  migration prerequisite.
- `apps/tasks-v0/README.md` — V0 baseline + V0/V1 scope split.
- `apps/stoop/src/lib/{CachingDataSource,SyncCadence}.js` —
  the source files for the Phase 1 lift.
- `apps/import-bridge-v0/` — receiving the calendar source
  connectors (Tasks V1 doesn't depend on them).
