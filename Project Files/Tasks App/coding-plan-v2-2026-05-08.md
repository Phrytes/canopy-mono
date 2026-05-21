# Tasks V2 — coding plan

> **Status:** draft, 2026-05-08.
> **Predecessors:**
> - [`./functional-design-v2-2026-05-08.md`](./functional-design-v2-2026-05-08.md) — V2 functional design
> - [`./coding-plan-2026-05-07.md`](./coding-plan-2026-05-07.md) — V1+V1.5 sequencing
> - [`apps/tasks-v0/CHANGELOG.md`](../../apps/tasks-v0/CHANGELOG.md) — what's actually shipped (current: 0.2.5)
>
> **Conventions honoured (same as V1):**
> - [`Project Files/conventions/architectural-layering.md`](../conventions/architectural-layering.md)
> - [`Project Files/conventions/app-readme-scheme.md`](../conventions/app-readme-scheme.md)
> - [`Project Files/conventions/localisation.md`](../conventions/localisation.md)
> - [`Project Files/conventions/cross-app-settings.md`](../conventions/cross-app-settings.md)
> - [`Project Files/Substrates/policies.md`](../Substrates/policies.md) — rule-of-two before substrate promotion

## Headline numbers

| Phase | Item | Effort | Substrate touch | Tests added |
|---|---|---|---|---|
| **V2.0** | R1 — tasks-agent identity persistence | ½ d | `core` (additive: `Agent` accepts an injected vault path; no API break) | ~3 |
| **V2.1** | N — calendar write-side + bot `calendar` | 3 d | none (app-local; `ical.js` already a dep) | ~9 |
| **V2.2** | P — compensated-role + invoicing + bot `invoice` | 2 d | none (app-local) | ~7 |
| **V2.3** | Q — availability hints + bot `available` / `week` | 5 d | none (app-local; reuses `chat-p2p` for broadcast) | ~12 |
| **V2.4** | O — auto-scheduling planner + bot `plan` / `accept` | 6 d | none (app-local; reuses V1 calendar adapter + ItemStore) | ~14 |
| **V2.5** | S — cross-crew dashboard + bot `crews` | 2 d | none (app-local aggregator over V1 per-crew skills) | ~5 |
| **V2.7** | U — hard subtask dependencies (substrate gate + post-submit consent flow) | 2.5 d | `@canopy/item-store` (additive: `enforceDependencies` flag + `DependenciesOpenError` + `actionOverride` ctx field) | ~14 |
| **V2.8** | V — single-agent + per-crew state (Stoop refactor handoff) | 3-4 d | `@canopy/core` (consume Stoop's additive `SkillRegistry.replace` + `unregister`) | ~10 |
| **V2.6** (deferred) | R2 — persisted revocation list, plus the externally-blocked items | n/a | TBD | n/a |

**Total ~18-19 dev-days for V2.0–V2.5.** Phases V2.1, V2.2, V2.3, V2.5 touch disjoint surfaces and can ship in parallel; V2.4 depends on V2.1 for the calendar feedback loop.

Each phase's bot additions are baked into the same PR — the bot surface is part of the capability, not a separate sprint. Per the V1.5 cap-token-bound bot agent design, every new `bot.*` skill declares `policy: 'requires-token'` so PolicyEngine actually validates the held token, AND uses `effectiveActor({from, envelope})` to honour the token's `actingAs` constraint (cap-token mode) or fall through to the bound webid (legacy trust-map mode). No re-issuance needed for existing bindings — the `bot.*` token already covers any new `bot.X` skill via `skillMatches('bot.*', skillId)` (V1.5 follow-up A).

**No new substrates in V2.** Per the rule-of-two analysis in the functional design § 5, every V2 capability stays app-local pending a second consumer (Folio's calendar emission would trigger the calendar-substrate lift; nothing else is at the rule-of-two threshold yet).

## Out-of-band prerequisites

Before any V2 phase starts:

- ✅ V1 + V1.5 follow-ups landed (CHANGELOG `[0.2.5]`). Confirmed.
- ☐ Decide whether V2.0 ships as a separate small PR before V2.1 starts (recommended) or piggy-backs onto V2.1's branch. **Recommendation: separate.** Substrate-touching changes deserve their own review window.
- ☐ Confirm `apps/tasks-v0/locales/{en,nl}.json` has no pending edits — V2 phases each add a locale key block, conflicts get expensive if shipped concurrently.
- ☐ Update `apps/tasks-v0/CHANGELOG.md` with a `[Unreleased — V2]` stub at the start of each phase so PRs roll up coherently.

## Phase V2.0 — Tasks-agent identity persistence (½ day)

R1 from the functional design § 2. Closes the open loop the V1.5 cap-token persistence (B) left dangling: the tasks agent regenerates its identity each boot, so persisted bot tokens auto-rotate. Persisting the tasks agent's vault means tokens survive untouched.

### Tasks

- `apps/tasks-v0/src/Agent.js`:
  - `createTasksAgent` gains an optional `identityVault` parameter (path string under the local-store cache). Default: `mem://tasks/agent/identity-vault.json`.
  - At boot:
    1. If `localStoreBundle` is supplied, attempt to read the vault snapshot from `identityVault`.
    2. If found, restore via `VaultMemory.fromSnapshot()` + `AgentIdentity.restore(vault)`.
    3. If absent, `AgentIdentity.generate()` and write the snapshot back.
    4. Also persist the `TrustRegistry` self-trust entry (already lives in the same vault, so this falls out of the snapshot).
- `apps/tasks-v0/src/Crew.js`: pass the `identityVault` path through (use `mem://tasks/crews/<crewId>/agent/identity-vault.json` so multi-crew installs don't collide).
- `apps/tasks-v0/src/bot/BotAgentRegistry.js`: drop the auto-rotate-on-restore branch from `restoreAll` (no longer needed when the tasks agent's pubKey is stable). Leave it as a fallback if `token.agentId !== current` (defensive — corrupted snapshot).

### Tests

- `test/v1_5-bot-cap-token.test.js`:
  - Update the restart-survival test to assert `tokenId` is now stable across restart (was `not.toBe(originalTokenId)`).
  - Add a new test: "tasks-agent identity is stable across two `createCrewAgent` calls with the same `identityVault`".
- `test/v2-agent-identity-persistence.test.js` (new): identity round-trips through snapshot + restore; pubKey, deviceId, stableId all stable.

### Substrate touch

`@canopy/core`: zero changes — `VaultMemory.fromSnapshot()` + `AgentIdentity.restore()` already exist (V1.5 follow-up B added the snapshot helpers).

### Risks

Very low. Pure plumbing on already-shipped substrate primitives.

## Phase V2.1 — Calendar write-side (3 days)

Capability **N** from the functional design. Tasks emits a `VEVENT` calendar to the user's pod under `<member-pod>/tasks/calendars/<crewId>.ics`. The user subscribes once in their phone calendar; new tasks appear automatically.

### Tasks

- `apps/tasks-v0/src/calendar/emitter.js` (new):
  - `buildIcsFor({crewId, tasks, member, now})` → returns the ICS string. Pure function; testable in isolation.
  - One `VEVENT` per task with `dueAt` OR `scheduledAt` (V2.4 adds `scheduledAt`; V2.1 only emits for `dueAt`).
  - `UID = task.id` so calendar clients update existing events on re-import.
  - `SUMMARY = task.text`; `DESCRIPTION = task.notes`; `DTSTART = dueAt` (all-day or timed depending on whether the task has a tz); `LAST-MODIFIED = max(updatedAt, completedAt)`.
  - Completed tasks emit with `STATUS:COMPLETED` so calendars can grey them out.
  - Removed tasks → emit `METHOD:CANCEL` for that UID (clients drop them).
- `apps/tasks-v0/src/calendar/wireCalendarEmission.js` (new):
  - `wireCalendarEmission({itemStore, dataSource, crew, member})` subscribes to `item-added` / `item-removed` / `item-completed` / `item-updated`; debounces 60 s; on tick, rebuilds the ICS and writes to `<pod>/tasks/calendars/<crewId>.ics`.
  - Returns `{detach}` for clean shutdown.
- `apps/tasks-v0/src/Crew.js`:
  - Read `crewConfig.calendarEmission?.enabled` (default false). When enabled, wire `wireCalendarEmission` per-member.
  - Per-member pod paths: write through the local-store cache. Local-only mode → write to the local file system root.
- `apps/tasks-v0/src/skills/calendar.js` (extend the V1 file):
  - New skill `setCalendarEmission({enabled})` — admin/coord per role policy. Toggles the crew-level flag.
  - New skill `getCalendarEmissionUrl()` — returns the URL the user pastes into their phone calendar (resolves the pod path to a `https://` URL when pod-attached; returns a `file://` path in local-only mode).
- `apps/tasks-v0/web/crew.html`:
  - Settings panel adds a "Sync deadlines to calendar" toggle + a copyable URL (visible only when enabled).
- `apps/tasks-v0/locales/{en,nl}.json`:
  - New keys under `calendar.emission.*` with `{text, doc}` leaves.
- `apps/tasks-v0/src/bot/dispatch.js`:
  - Add a `calendar` verb routing to `bot.calendar` (no args).
- `apps/tasks-v0/src/bot/skills.js`:
  - New `bot.calendar` skill — calls `getCalendarEmissionUrl()` for the effectiveActor; replies with the URL + a one-line "paste into your phone calendar" hint. `policy: 'requires-token'` (uses the shared `BOT_SKILL_OPTS`).

### Tests

- `test/v2-calendar-emission.test.js` (new): 8 tests
  - `buildIcsFor` snapshot for a 3-task fixture
  - UID stability across re-emission (same task → same UID)
  - Completed task → `STATUS:COMPLETED`
  - Removed task between two emissions → `METHOD:CANCEL`
  - Debounce (no two writes within 60 s window)
  - `setCalendarEmission` admin gate (member denied)
  - `getCalendarEmissionUrl` returns file:// in local-only mode
  - End-to-end: addTask → ICS file at expected path contains the new VEVENT
- `test/v2-bot-calendar.test.js` (new): 1 test
  - `bot.calendar` returns the same URL as the underlying skill, attributed to the actingAs webid (cap-token mode) and to the bound webid (legacy mode)

### Substrate touch

None. **Substrate candidacy:** if Folio V3 (or any other app) adds calendar emission, lift `calendar/emitter.js` + the wire helper into `@canopy/calendar` (which would also subsume the V1 read-side adapter). Until then, app-local. Tracked in `Project Files/Substrates/substrate-candidates.md` under "calendar (read + write halves)".

### Dependencies

`ical.js` (already a dep). No new packages.

### Risks

- **Pod write rate.** Mitigation: 60 s debounce + diff-before-write (only emit when at least one event payload field changed).
- **Timezone bugs.** `ical.js` handles the heavy lifting; we test the Europe/Amsterdam happy path (matches V1 test fixtures).
- **Local-only mode URL ergonomics.** A `file://` URL isn't subscribable from a phone. Document that local-only mode supports re-import workflows only; pod-mode is required for "live" subscription.

## Phase V2.2 — Compensated-role + invoicing (2 days)

Capability **P** from the functional design. Marks `compensated: true` members; emits an invoice-line blob per (member, ISO month) when they complete tasks; surfaces a per-month total on the Crew page (admin + paid-pro only).

### Tasks

- `apps/tasks-v0/src/skills/invoicing.js` (new):
  - `recordInvoiceLine({task, member, completedAt})` — internal helper. Appends `{taskId, completedAt, hours: estimateMinutes/60, notes}` to `<crew-pod>/tasks/invoicing/<webid>/<isoMonth>.json`.
  - Skill `getCompensation({memberWebid, month?})` — admin OR self only. Returns `{lines: [...], totals: {count, hours, amount?}}` (amount = hours × member.rate, marked informational).
  - Skill `setMemberCompensation({memberWebid, compensated, rate?})` — admin only. Mutates the live crew config (`crewMutator`), patches the member entry.
- `apps/tasks-v0/src/Crew.js`:
  - When `liveCrew.compensation?.enabled === true`, subscribe to `item-completed` events. If the completer is `compensated`, dispatch `recordInvoiceLine` (best-effort; failures don't block the completion path).
- `apps/tasks-v0/src/rolePolicy.js`:
  - Extend the policy table with `getCompensation` (admin OR `actor === memberWebid`) + `setMemberCompensation` (admin-only).
- `apps/tasks-v0/web/crew.html`:
  - New "Compensation" panel after "Bot bindings". Visible only when `crew.compensation?.enabled` AND the actor is admin OR a paid-pro.
  - Per paid-pro: month dropdown (default current ISO month), totals row, optional rate editor (admin only).
- `apps/tasks-v0/locales/{en,nl}.json`:
  - Keys under `compensation.*`; both languages, `{text, doc}` leaves.
- `apps/tasks-v0/src/lib/privacyNotice.js`:
  - New item explaining that completed-task lines are written to the crew pod for paid-pro members. Both languages.
- `apps/tasks-v0/src/bot/dispatch.js`:
  - Add an `invoice` verb routing to `bot.invoice` (no args, defaults to current month).
- `apps/tasks-v0/src/bot/skills.js`:
  - New `bot.invoice` skill — calls `getCompensation({memberWebid: actor})` for the current ISO month. Renders as a chat-formatted table (count + hours + amount?). Non-paid-pros get a polite "no compensation recorded for you" reply. `policy: 'requires-token'`.

### Tests

- `test/v2-invoicing.test.js` (new): 6 tests
  - Non-compensated member completing → no invoice line
  - Compensated member completing → invoice line at expected path
  - Multiple completions same month → all rolled into one JSON
  - `getCompensation` admin → returns lines
  - `getCompensation` self → returns own lines only
  - `getCompensation` other member → 403
- `test/v2-bot-invoice.test.js` (new): 1 test
  - `bot.invoice` for a paid-pro returns the table; non-pro gets the friendly empty message

### Substrate touch

None. The blob shape is intentionally minimal (a list of `{taskId, completedAt, hours, notes}`), portable to any spreadsheet. Resisting substrate promotion until a second app actually invoices.

### Risks

- **Crew page totals diverge from the JSON.** Mitigation: the panel reads the JSON blob directly (single source of truth), never recomputes from the audit log.
- **Rate × hours = amount is "authoritative" temptation.** Mitigation: amount is rendered with an "informational, not authoritative" footnote. No invoice numbers, no payment status, no PDF generation.

## Phase V2.3 — Availability hints (5 days)

Capability **Q** from the functional design. Per (member, ISO-week, half-day) opt-in chip: `open` / `tight` / `unavailable` / `unknown`. Visible to coordinators only.

### Tasks

- `apps/tasks-v0/src/availability/AvailabilityHints.js` (new):
  - Pure data class wrapping `{<isoWeek>: {<dayHalf>: state}}` per member.
  - Helpers: `getHint({week, day, half})`, `setHint({week, day, half, state})`, `serialize()`, `deserialize()`.
- `apps/tasks-v0/src/availability/wireAvailabilitySync.js` (new):
  - Subscribes to a `chat-p2p` topic `tasks/<crewId>/availability` so updates broadcast to all crew members in real-time.
  - Persists own state to `<crew-pod>/tasks/availability/<self-webid>.json` on every change.
  - On boot, loads all members' blobs from `<crew-pod>/tasks/availability/`.
- `apps/tasks-v0/src/skills/availability.js` (new):
  - `setMyAvailability({week, day, half, state})` — self only. Updates own state, broadcasts, persists.
  - `getCrewAvailability({week})` — coordinator/admin only. Returns the full grid for that week.
  - `getMyAvailability({week})` — self only.
  - `setAvailabilityOptIn({optedIn})` — self only. Records per-crew opt-in flag in the member's MemberMap entry.
  - `setCrewAvailabilityEnabled({enabled})` — admin only. Toggles `crew.availabilityHints.enabled`.
- `apps/tasks-v0/src/Crew.js`:
  - When `liveCrew.availabilityHints?.enabled === true`, wire `wireAvailabilitySync` per-member.
- `apps/tasks-v0/src/skills/index.js`:
  - Extend the assignee-picker payload (used by the Workspace UI's "assign to") to include the candidate's hint chip for the deadline's half-day.
- `apps/tasks-v0/web/`:
  - New page `availability.html` — "My week" 7×2 grid; clicking a cell rotates state; persisted in real-time.
  - Workspace assignee-picker dropdown shows the chip next to each candidate.
- `apps/tasks-v0/locales/{en,nl}.json`:
  - Keys under `availability.*` with `{text, doc}` leaves; chip strings explained per state.
- `apps/tasks-v0/src/lib/privacyNotice.js`:
  - New item explaining the half-day-granularity disclosure + opt-in default.
- `apps/tasks-v0/src/bot/dispatch.js`:
  - Add `available <state>` verb → `bot.available`. State must be one of `open` / `tight` / `unavailable`; anything else replies with the valid-states list.
  - Add `week` verb → `bot.week` (no args).
- `apps/tasks-v0/src/bot/skills.js`:
  - New `bot.available` skill — calls `setMyAvailability` for the *current* half-day (computed from `now()` against the actor's tz). Replies with confirmation chip. `policy: 'requires-token'`.
  - New `bot.week` skill — renders own week as a code-fenced 7×2 grid of state chips. `policy: 'requires-token'`.

### Tests

- `test/v2-availability-hints.test.js` (new): 10 tests
  - Pure `AvailabilityHints` round-trip
  - State rotation through the four values
  - `setMyAvailability` writes to pod path + broadcasts on chat topic
  - Boot loads all crew members' blobs
  - Coordinator sees full grid; member sees only own
  - Member without opt-in shows as `unknown` to coordinator (NOT "opted out")
  - Disabling availability hints in crew config detaches the wire (no further broadcasts)
  - Setting hint while disabled → 400 with `availability-hints-disabled`
  - `setAvailabilityOptIn(false)` deletes own pod blob
  - Stale hint (week in past) is filtered out of `getCrewAvailability`
- `test/v2-bot-availability.test.js` (new): 2 tests
  - `available open` sets the current half-day for the actingAs webid
  - `available bogus` replies with the valid-state list

### Substrate touch

None. Reuses `chat-p2p` (already a Tasks dep) for broadcast.

### Risks

- **Social pressure from chip visibility.** Mitigation: per-member toggle to make own chip visible to "self only" (downgrade option). Documented in the privacy notice.
- **Stale hints if a member doesn't update.** Mitigation: the chip auto-fades to `unknown` after 14 days without an update. Pure-fn check at read time.

## Phase V2.4 — Auto-scheduling planner (6 days)

Capability **O** from the functional design. Suggests concrete slots for open tasks given my own free/busy and each task's deadline. Greedy algorithm, no auto-acceptance, every suggestion needs a click.

### Tasks

- `apps/tasks-v0/src/planner/greedy.js` (new):
  - `suggestSchedule({tasks, busySpans, workingHours, now, lookaheadDays = 7})` → `[{taskId, slotStart, slotEnd, reason}]`.
  - Pure function. Logic per the design doc § 2.O.
- `apps/tasks-v0/src/skills/planner.js` (new):
  - Skill `suggestSchedule({lookaheadDays?})` — self only (no admin override).
  - Reads:
    - `listMine()` → my tasks
    - V1 calendar adapter's `freeBusy(timeRange)` → busy spans
    - `liveCrew.workingHours` (fallback to `member.workingHours` per § 4.1)
  - Returns the planner's output.
  - Skill `acceptSchedule({taskId, slotStart, slotEnd})` — self only. Sets `task.scheduledAt = slotStart`. Triggers V2.1's calendar emission to refresh.
  - Skill `rejectSchedule({taskId})` — self only. No-op (UI affordance — the suggestion just disappears).
- `apps/tasks-v0/web/mine.html`:
  - "Suggest a plan" button at the top of "My work" (admin/coord/member; observer not).
  - Suggestion cards in their own panel — `task | proposed slot | reason | [Accept] [Tweak] [Skip]` row each.
  - "Tweak" opens a slot picker (date + time inputs); Accept commits.
- `apps/tasks-v0/src/calendar/wireCalendarEmission.js`:
  - Add `scheduledAt` to the events the emitter cares about (already covered by V2.1's "DUE OR SCHEDULED" branch, just confirm).
- `apps/tasks-v0/locales/{en,nl}.json`:
  - Keys under `planner.*` (suggestion reason labels, button labels, slot picker copy).
- `apps/tasks-v0/src/bot/dispatch.js`:
  - Add `plan` verb → `bot.plan` (no args; defaults to 7-day lookahead).
  - Add `accept <id> [N]` verb → `bot.accept`. Optional `N` (default 1) selects the Nth suggestion for `<id>` from the most-recent `bot.plan` reply (cached per chatId; in-memory, falls back to "show me the plan again" if missing).
- `apps/tasks-v0/src/bot/skills.js`:
  - New `bot.plan` skill — calls `suggestSchedule({lookaheadDays: 7})`. Renders top-3 as a numbered list with reason chips. `policy: 'requires-token'`.
  - New `bot.accept` skill — looks up the cached suggestions for `chatId+taskId`, accepts the Nth via `acceptSchedule`. Reply confirms or "no plan in cache — run `plan` first". `policy: 'requires-token'`.
- `apps/tasks-v0/src/bot/wireBotChannel.js`:
  - Per-chatId in-memory cache of the latest `bot.plan` output (TTL 10 min). Cache lives on the wire, not on the agent — restarts clear it (acceptable; user re-runs `plan`).

### Tests

- `test/v2-planner-greedy.test.js` (new): 8 tests
  - No tasks → no suggestions
  - Single task, plenty of free time → first available working-hours slot
  - Task overdue → reason `'overdue — schedule asap'`
  - Last-chance slot before deadline → reason `'last-chance slot'`
  - Two tasks, same deadline, one rare-skill → rare-skill scheduled first
  - Working hours window respected (no slot at 22:00)
  - Busy span splits a candidate slot → planner skips around it
  - Lookahead exhausted → returns `[]` (don't fabricate slots past horizon)
- `test/v2-planner-skills.test.js` (new): 4 tests
  - `suggestSchedule` end-to-end with mocked freeBusy + tasks
  - `acceptSchedule` writes `scheduledAt` + triggers emission
  - `acceptSchedule` rejects from non-assignee
  - `rejectSchedule` is a true no-op
- `test/v2-bot-planner.test.js` (new): 2 tests
  - `bot.plan` returns top-3 suggestions; `bot.accept <id>` cached path commits
  - `bot.accept <id>` without prior `plan` returns the friendly "run plan first" reply

### Substrate touch

None. **Substrate candidacy:** if a second app needs scheduling, the greedy module is small enough to lift cleanly into `@canopy/scheduler`. No current candidate; defer.

### Dependencies

V2.1 (calendar write-side) — accepted slots flow into the ICS via `scheduledAt`. If V2.1 hasn't shipped, V2.4 still ships (the planner just stores `scheduledAt`; calendar refresh is a no-op).

### Risks

- **Suggestion accuracy.** The greedy algorithm will get edge cases wrong (e.g. a task's `estimateMinutes` of 90 doesn't fit in a 60-min gap). Mitigation: every suggestion shows its reason chip; users learn the planner's heuristic and adjust expectations. Track the accept/reject ratio in observability metrics over a week.
- **Performance.** Worst-case `tasks × slots` is small (dozens × hundreds = ~thousands of comparisons per week per user). Pure-fn synchronous; no perf concern at V2 scale.

## Phase V2.5 — Cross-crew dashboard (2 days)

Capability **S** from the functional design. One screen lists every crew the user belongs to with four counters (open / overdue / awaiting-approval / mine) plus a "Jump in" link. Bot version (`crews`) replies with the same data as plain text.

Promoted from the V1 "deferred" line on the basis that Tasks doesn't actually depend on H7 Archive — V1's per-crew skills already expose every count the dashboard needs. The "deep" dashboard with full-text search + cross-source linking is still V2.6 (depends on Archive's web UI).

### Tasks

- `apps/tasks-v0/src/dashboard/aggregator.js` (new):
  - `aggregateCrews({crews, actor}) → [{crewId, name, kind, counts: {open, overdue, awaitingApproval, mine}}]`.
  - For each crew the user is a member of (resolved from the local-store cache or, in CLI mode, the per-crew configs the launcher knows about), instantiates a thin read-only ItemStore over that crew's pod path and rolls up counts via `listOpen` / `listClosed` / `listAwaitingApproval` / `listMine`.
  - Pure-fn over its inputs (no side effects); easy to test.
- `apps/tasks-v0/src/skills/dashboard.js` (new):
  - Skill `getMyCrews()` — self only. Returns the aggregator's output for every crew the calling actor belongs to.
- `apps/tasks-v0/bin/tasks-ui.js`:
  - New `--crew-list <path>` flag pointing to a JSON file `[{crewId, configPath, podPath?}, …]` so the CLI can serve a dashboard over multiple crews from one process. Single `--crew` mode still works (one-crew dashboard is just a one-row table).
- `apps/tasks-v0/web/crews.html` (new):
  - 7th nav entry; one row per crew with name + kind chip + four counters + "Jump in" → opens the per-crew Workspace in a new tab.
  - `mountLive` subscription to `item-added`/`item-completed`/etc. across crews so counters refresh in real-time.
- `apps/tasks-v0/locales/{en,nl}.json`:
  - Keys under `dashboard.*` with `{text, doc}` leaves.
- `apps/tasks-v0/src/bot/dispatch.js`:
  - Add `crews` verb → `bot.crews` (no args).
- `apps/tasks-v0/src/bot/skills.js`:
  - New `bot.crews` skill — calls `getMyCrews()` for the actingAs webid; renders as one line per crew: `<name> (<kind>): <open> open · <overdue> overdue · <mine> mine`. `policy: 'requires-token'`.

### Tests

- `test/v2-dashboard.test.js` (new): 4 tests
  - `aggregateCrews` over 3 crews returns correct counters
  - User who is a member of only crew A doesn't see crew B's data even when the launcher knows about both
  - Empty crew list → `[]`
  - Counters update after an `addTask` event (live-refresh path)
- `test/v2-bot-crews.test.js` (new): 1 test
  - `bot.crews` returns one line per crew with the expected counters

### Substrate touch

None. Reuses V1's per-crew skill surface. **Substrate candidacy:** if a second app needs cross-source aggregation with the same shape, the aggregator promotes into a tiny `@canopy/cross-source-aggregator` substrate — but the much richer pattern Archive is building is the more likely landing spot. Defer.

### Risks

- **Multi-crew launcher complexity.** Today's CLI launches one crew per process; serving N crews in one UI process means N `createCrewAgent` calls + N InternalBuses. Mitigation: reuse the same bus; per-crew identity vaults stay isolated per the V2.0 path scheme.
- **Counter consistency.** Counters are local-cache snapshots — could diverge briefly after a remote write. Mitigation: dashboard shows a "synced X seconds ago" footer per row; a forced refresh button calls `localStoreBundle.cache.pullFromInner(rootContainer)` to re-pull from the pod.

## Phase V2.7 — Hard subtask dependencies (2.5 days)

Capability **U** from the V2 functional design. Substrate-level gate prevents closing a parent while sub-tasks are open. Spawn-blocked when parent is `submitted` (assignee-consent escape via the new propose/approve flow). Force paths exist for admin overrides; both get distinct audit-log action labels.

### Tasks

#### Substrate (`@canopy/item-store`)

- `src/ItemStore.js`:
  - Constructor accepts `enforceDependencies?: boolean` (default `false` — backward compat).
  - When `true`, `markComplete` and `approve` walk `current.dependencies`, look up each via `#listAllItems`, filter out missing-or-removed entries (treat as satisfied), and reject when any open dep remains.
  - New typed error `DependenciesOpenError extends Error` with `code: 'DEPENDENCIES_OPEN'` + `openDeps: string[]`. Re-exported from the package barrel.
  - `markComplete`/`approve` honor a new `ctx.actionOverride` string. When set, the audit entry's `action` field is replaced (used for `force-complete`); `ctx.reason` is recorded in the audit entry's `details.reason`. Defaults preserved.
  - Same `actionOverride` mechanism on `addItems` so the force-spawn path lands a `force-spawn` audit entry on the parent.

#### App skills (`apps/tasks-v0/src/`)

- `src/Crew.js` — pass `enforceDependencies: true` when constructing the ItemStore.
- `src/skills/forceComplete.js` (new): `forceCompleteTask({id, reason})` — admin only, mandatory `reason`. Calls `itemStore.markComplete([{id}], {actor, reason, actionOverride: 'force-complete'})`. Returns `{ok, task}`.
- `src/skills/index.js` — `completeTask` and `approveTask` translate `DependenciesOpenError` to `{error: 'has-open-dependencies', openDeps: string[]}` instead of letting the error bubble.
- `src/skills/subtasks.js` — extend with the post-submit consent flow:
  - Existing `addSubtask`: when parent's `reviewLog` shows an unanswered `submit`, returns `{error: 'parent-submitted', proposalRequired: true}` with a hint to call `proposeSubtask` instead.
  - New `proposeSubtask({parentTaskId, ...partial})`: master/coord/admin only. Files a `subtask-proposal` queue item targeting the parent's assignee (parallel to V1's `subtask-request` for admin approval). Returns `{queued: true, proposalId}`.
  - New `approveSubtaskProposal({proposalId})`: assignee only. Spawns the proposed subtask via existing `addItems`; updates parent's `dependencies` to include the new child; calls `itemStore.reject(parentId, {note: 'auto-rollback: scope changed via subtask proposal …'}, {...})` to walk parent submitted → claimed (preserves the original `submit` entry in `reviewLog`); marks the proposal complete.
  - New `declineSubtaskProposal({proposalId, note?})`: assignee only. Updates the proposal with the decline note; marks complete; parent submission stays valid.
  - New `forceSpawnSubtask({parentTaskId, partial, reason})`: admin only, mandatory reason. Bypasses both the post-submit gate and (if applicable) the admin-approval-depth threshold; writes an audit entry on the parent with `action: 'force-spawn'` + reason.
- `src/skills/inbox.js` — extend the inbox listener to render `subtask-proposal` items aimed at the calling actor with `[Approve]` / `[Decline]` buttons.

#### Bot translations

- `src/bot/skills.js`:
  - `bot.markComplete` and `bot.approve` translate `error: 'has-open-dependencies'` to a chat-friendly *"Can't close — N open sub-task(s): X, Y, Z."*
  - No new bot verbs for V2.7. The propose/approve flow is web-first; the bot can grow `propose <id>` / `accept-proposal <id>` later if friction shows.

#### UI (`web/`)

- `web/mine.html` + `web/index.html` (assignee-side): the "Mark complete" button on a parent with `computeStatus === 'waiting'` renders disabled with a tooltip listing open-dep short-ids.
- `web/review.html` (approver-side): same disabled-button pattern on the "Approve" button.
- `web/dag.html` + `web/index.html` (master/coord-side): "Add sub-task" button on a `submitted` parent flips into "Propose sub-task" mode — sends `proposeSubtask` instead of `addSubtask` and shows a one-line note explaining the consent step.
- `web/inbox.html`: render `subtask-proposal` items with inline `[Approve]` / `[Decline]` buttons. Approve triggers `approveSubtaskProposal`; decline opens a small text input for the optional note.
- A new "Force complete" admin-only button on the task detail (web only) — disabled unless `computeStatus === 'waiting'` AND actor is admin. Clicking opens a textarea for the mandatory reason.

#### Locales (`apps/tasks-v0/locales/{en,nl}.json`)

- New keys under `dependencies.*` (open-dep tooltip, disabled-button hint, force-complete dialog copy)
- Keys under `subtask_proposal.*` (inbox card title, approve/decline button labels, propose-mode hint)
- ~14 new keys total per language; `{text, doc}` shape per the convention.

### Tests

- `packages/item-store/test/V2_7-enforce-dependencies.test.js` (new): 6 tests
  - Default (`enforceDependencies: false`) — gate doesn't fire (back-compat).
  - `markComplete` rejects when an open dep exists; `DependenciesOpenError.openDeps` populated.
  - `approve` rejects symmetrically.
  - Removed dep is treated as satisfied.
  - `actionOverride: 'force-complete'` bypasses the gate AND writes the override label to the audit entry.
  - `addItems` with `actionOverride` records the override label on the parent's audit row.
- `apps/tasks-v0/test/v2_7-hard-deps.test.js` (new): 8 tests
  - `completeTask` returns `{error: 'has-open-dependencies', openDeps}` when parent has open subtasks.
  - `forceCompleteTask` admin-only; non-admin denied; mandatory reason; bypasses the gate; audit log shows `force-complete`.
  - `approveTask` denied symmetrically when deps open (creator-mode parent).
  - No-cascade: forceComplete leaves sub-tasks open and workable.
  - `addSubtask` on a submitted parent rejects with `proposalRequired: true`.
  - `proposeSubtask` master/coord-only; non-master denied.
  - `approveSubtaskProposal` spawns the subtask AND walks parent submitted → claimed; original `submit` entry preserved in `reviewLog`.
  - `declineSubtaskProposal` closes the proposal; parent submission stays valid.

### Substrate touch summary

| File | Change | Backward-compat |
|---|---|---|
| `packages/item-store/src/ItemStore.js` | + constructor flag, + gate, + actionOverride ctx, + DependenciesOpenError export | ✅ all default-off |
| `packages/item-store/src/index.js` | + DependenciesOpenError re-export | ✅ additive |

### Risks

- **Gate fires on rare edge cases mid-development** (e.g. the dependency edge points at a task that was just removed). Mitigation: missing-or-removed deps treated as satisfied; tests cover this explicitly.
- **`auto-rollback` on subtask-proposal approval surprises the assignee** — they approved adding scope, didn't expect to lose their submission. Mitigation: the proposal card explicitly says "Approving rolls your submission back to claimed."
- **Force paths get used routinely** — see V2 risk register #5. Mitigation: distinct audit-log action labels + `forceCompleteCount` observability metric.

### Acceptance

- All Tasks tests + Stoop's full suite + core's full suite green (Stoop's items don't use `dependencies[]` — gate is opt-in, no impact).
- CHANGELOG bumped to `[0.3.6]`.
- New locale keys present in both `en.json` and `nl.json` with `{text, doc}` leaves.
- Privacy notice unchanged (no new pod paths).

## Phase V2.8 — Single-agent + per-crew state (3-4 days)

Capability **V** from the V2 functional design. Mirrors the handoff in [`Project Files/Stoop/single-agent-refactor-2026-05-08.md`](../Stoop/single-agent-refactor-2026-05-08.md) §"Tasks-app fix propagation." Renames `createCrewAgent` → `buildCrewState`; lifts agent + transports + identity + PolicyEngine + TrustRegistry + TokenRegistry to a process-level shared `meshAgent`; rewires every skill to resolve its crew via `bundleResolver(args, ctx)`.

### Coordination with the Stoop refactor

Stoop's Phase 1 (core additions: `SkillRegistry.replace` + `unregister`) is the ONLY shared code. It's additive, no behaviour change for existing callers. Tasks's V2.8 work depends on it being merged but doesn't depend on Stoop's Phase 2-6 (the Stoop-app rewrite). Tasks can start its rewrite the moment Stoop's PR-1 lands; the Tasks rewrite is independent of Stoop's `buildSkills` rewrite.

### Tasks

#### Substrate consumption (no own substrate work)

- Confirm `core.SkillRegistry.replace(def)` + `unregister(name)` are merged from Stoop's Phase 1. Use them if needed for hot-swap during dev (not load-bearing — Tasks registers skills once at boot).

#### App-side — `apps/tasks-v0/src/`

| # | Task | Files |
|---|---|---|
| V2.8.1 | New `MeshAgent.js` (or extension to `Agent.js`): `buildMeshAgent({identity, transport, identityVault, ...})` returns the shared agent + `policyEngine` + `trustRegistry` + `tokenRegistry`. Identity vault path becomes per-process (`mem://tasks/process/identity-vault.json`), not per-crew. PolicyEngine + TrustRegistry + TokenRegistry constructed once. Self-trust set once. | `apps/tasks-v0/src/MeshAgent.js` |
| V2.8.2 | Rename `createCrewAgent` → `buildCrewState`. Drops `transport`, `identity`, `vault`, `bus` from arg list — takes `meshAgent` instead. Returns `CrewState` (no `agent` field). Per-crew `policyEngine` is gone — the shared one handles every crew (V2.7's `enforceDependencies` flag is on the shared ItemStore? No — different ItemStores, one per crew, each with the flag). | `apps/tasks-v0/src/Crew.js` |
| V2.8.3 | Move skill registration out of `buildCrewState` into a process-level wiring step (`apps/tasks-v0/src/wireSkills.js` or extension to `Agent.js`). Single registration over the shared meshAgent, with `bundleResolver: (args, ctx) => crews.get(args.crewId ?? _crewIdFromTopic(ctx.envelope?.topic)) ?? null`. | `apps/tasks-v0/src/wireSkills.js` |
| V2.8.4 | Mechanical pass over every Tasks skill body (`src/skills/*.js` + `src/bot/skills.js`): preamble `const crew = bundleResolver(args, ctx); if (!crew) return {error: 'crewId required'};` then read `crew.itemStore`, `crew.members`, `crew.liveCrew`, etc. instead of closure-captured ones. ~50 skills total. | `apps/tasks-v0/src/skills/{index,profile,appeal,subtasks,inbox,workspace,observability,crewControls,customRoles,botBindings,calendarEmission,invoicing,availability,planner,dashboard,forceComplete}.js`, `apps/tasks-v0/src/bot/skills.js` |
| V2.8.5 | `bin/tasks-ui.js` rewires: build one meshAgent at startup; for each `--crew` / `--crew-list` entry, build a CrewState; register skills once with the bundleResolver. Multi-crew launches stop spinning N agents. | `apps/tasks-v0/bin/tasks-ui.js` |
| V2.8.6 | UI client: `web/app.js`'s `callSkill` injects `crewId` into every args object (parallels Stoop-mobile's `useSkill`). Web UI gets `crewId` from `tasks-config.json` (which already carries it via `bundle.crew.crewId` in V1.5). | `apps/tasks-v0/web/app.js` (small edit) |
| V2.8.7 | V2.5's `crewBundlesProvider` simplification: now reads from the `crews` Map directly. `aggregateCrews` adapts. `bot.crews` adapts. | `apps/tasks-v0/src/Crew.js`, `apps/tasks-v0/src/skills/dashboard.js`, `apps/tasks-v0/src/bot/skills.js` |
| V2.8.8 | Cap-token bot agents (V1.5): unchanged — they already have their own pubKeys + identities. The shared meshAgent's PolicyEngine validates tokens; bot agents talk to it over the shared bus. Confirm via the existing V1.5 cap-token tests still pass. | (no edit — verification) |

#### Tests

| # | What | Files |
|---|---|---|
| V2.8.9 | Per-skill: every existing test still passes. Most need a one-line setup change: build a meshAgent + crews Map + register skills, then call as before. | `apps/tasks-v0/test/*.test.js` (small adjustments throughout) |
| V2.8.10 | Multi-crew test: build one meshAgent, two CrewStates, two crewIds; calls with different `crewId`s land in the right ItemStore; `getMyCrews` returns both; cross-crew leakage is impossible (test asserts a member of crew A can't read crew B). | `apps/tasks-v0/test/v2_8-single-agent.test.js` (new) |
| V2.8.11 | Strict-resolution test: skill called without `args.crewId` AND without a topic-bearing envelope returns `{error: 'crewId required'}`. | (in `v2_8-single-agent.test.js`) |
| V2.8.12 | Stoop's full suite stays green (proves Stoop's Phase 1 core additions don't regress Tasks's existing item-store consumption). | (Stoop CI) |

### Substrate-touch summary

| File | Change | Backward-compat |
|---|---|---|
| `@canopy/core` (Stoop's Phase 1) | + `SkillRegistry.replace(def)` + expose `unregister(name)` | ✅ additive |
| `apps/tasks-v0/src/Crew.js` | rename + arg-list change | ⚠ breaking for direct callers — `bin/tasks-ui.js` + tests adapt in same PR |
| `apps/tasks-v0/src/skills/*.js` + `bot/skills.js` | mechanical preamble | ⚠ skills now expect `args.crewId` (or topic). Web UI / CLI inject it. |
| `apps/tasks-v0/web/app.js` | inject `crewId` into every `callSkill` | ✅ pure additive on caller side |

### Risks

- **Skill body subtleties.** A skill that closes over `localActor`, `roles`, etc. without going through bundleResolver. Mitigation: test pass after each batch of ~10 skills; the strict-fallback gate fires on any miss.
- **`canEditBody` policy gate.** Today's `buildStandardRolePolicy(roles)` closes over a single `roles` map. After V2.8 the `roles` come from the resolved CrewState. Refactor `buildStandardRolePolicy` to take `(actor, item, patch)` + read `roles` from the surrounding closure that the skill body now builds with `crew.roles`. Pure mechanical; tested by the existing role-policy tests.
- **Hot-reload during dev.** `agent.skills.replace(def)` covers the case where a skill body changes mid-session. Not load-bearing; nice-to-have.

### Acceptance

- All Tasks tests + Stoop's full suite + core's full suite green.
- CHANGELOG bumped to `[0.3.7]`.
- `bin/tasks-ui.js` smoke test: launch with `--crew-list <path>` for two crews; both register; one process; one Agent (verifiable via `process.listeners('msg:*')` count or just `console.log(meshAgent.address)`).
- Privacy notice unchanged (no new pod paths).

### Mobile inheritance

Mobile-V1's `apps/tasks-mobile/src/ServiceContext.js` (Phase 41.2 in the mobile coding plan) is the canonical first consumer of the new shape. With V2.8 landed, Phase 41.2's task list collapses — Tasks-mobile imports `buildMeshAgent` + `buildCrewState` from `apps/tasks-v0` instead of writing them.

## V2 acceptance gates

A V2 PR is mergeable when ALL of:

1. The phase's tests pass green (per-phase totals in the table above).
2. The full Tasks suite passes (currently 232 tests; V2 should land at ~270+).
3. Stoop's full suite (429 tests) passes — proves no substrate regression.
4. Core's full suite (1279 tests) passes — proves no SDK regression.
5. CHANGELOG bumped (`[0.3.x]` per V2 phase).
6. New locale keys present in BOTH `en.json` and `nl.json` with `{text, doc}` leaves.
7. New CrewConfig fields validated in `_normaliseConfig` (defaults match V1 behaviour).
8. New skills declare `visibility` + `policy` explicitly (no defaults).
9. README updated where the substrate composition or "Direct SDK use" sections shift.
10. Privacy notice updated when the phase introduces a new pod-data path.

## V2.6 (deferred) — externally-blocked items

Pulled forward only if external work unblocks them:

- **R2 — persisted revocation list.** ½ d once vault-on-disk is the standard for the tasks agent. Trivial to add then.
- **Cryptographic anonymity.** Depends on Stoop V2's Q-H5 unpark.
- **Federated crew pod ownership pattern (c).** Depends on `pod-client` federated-reader being binding.
- **Real-time collaboration on a deliverable doc.** Depends on the OSS-doc-tool integration project.
- **"Deep" cross-crew dashboard with full-text search + cross-source linking.** Depends on H7 Archive's web UI (the "lightweight" aggregator already shipped in V2.5; the "deep" version layers Archive's index on top).

## Risk register (V2 additions)

In priority order:

1. **Calendar emission writes too often + pod throttles** (V2.1). Mitigation: 60 s debounce + diff-before-write.
2. **Planner suggestions erode trust** (V2.4). Mitigation: visible reason chips; accept-rate metric in observability; revisit algorithm if < 70% over a week.
3. **Availability hint chips create social pressure** (V2.3). Mitigation: per-member visibility toggle ("self only" downgrade).
4. **Invoicing rate × hours misread as authoritative** (V2.2). Mitigation: "informational, not authoritative" footnote in the panel; no invoice numbers, no PDFs.
5. **Multi-crew identity-vault path collisions** (V2.0, V2.5). Mitigation: per-crew vault path; tested explicitly. V2.5 multi-crew launcher reuses the same scheme.
6. **Bot `accept <id> [N]` cache miss after a process restart** (V2.4). Mitigation: when the cache misses, the bot prompts to re-run `plan` rather than guessing — friendly fallback, no surprise commits.

## Dependencies graph

```
V2.0 (½d) ─┬─→ V2.1 (3d) ─┐
           │              ├─→ V2.4 (6d)
           │              │
           ├─→ V2.2 (2d) ─┘  (parallel-safe with V2.1, V2.3, V2.5)
           │
           ├─→ V2.3 (5d)     (parallel-safe with V2.1, V2.2, V2.5)
           │
           └─→ V2.5 (2d)     (parallel-safe with V2.1, V2.2, V2.3)
```

Critical path: V2.0 → V2.1 → V2.4 = ½ + 3 + 6 = **9.5 dev-days**. With parallel execution of V2.2, V2.3, V2.5 alongside V2.1, total wall-clock is bound by the critical path, not the sum.

## Total V2 day estimate

**23.5-25.5 dev-days** sequential (½ + 3 + 2 + 5 + 6 + 2 + 2.5 + 3-4).
**~9.5 dev-days** wall-clock with V2.1 + V2.2 + V2.3 + V2.5 + V2.7 + V2.8 in parallel (V2.8 is independent of V2.1-V2.7; only V2.4 has a hard dep on V2.1).

V2.7 + V2.8 must both land before mobile-V1 implementation begins. Mobile inherits the new behavior (substrate flag, skills, audit semantics, single-agent topology) unchanged.

## Pointers

- Functional design: [`./functional-design-v2-2026-05-08.md`](./functional-design-v2-2026-05-08.md)
- V1 + V1.5 history: [`apps/tasks-v0/CHANGELOG.md`](../../apps/tasks-v0/CHANGELOG.md)
- Substrate candidates index: [`Project Files/Substrates/substrate-candidates.md`](../Substrates/substrate-candidates.md)
- Conventions: [`Project Files/conventions/`](../conventions/)
