# Tasks V2 — functional design

> **Status:** draft, 2026-05-08.
> **Predecessors:**
> - [`./advice-2026-05-07.md`](./advice-2026-05-07.md) — V1 functional design
> - [`./critique-2026-05-07.md`](./critique-2026-05-07.md) — V1 honest pushback
> - [`./coding-plan-2026-05-07.md`](./coding-plan-2026-05-07.md) — V1+V1.5 sequencing (V2 was "demand-driven, no estimate")
> - [`apps/tasks-v0/CHANGELOG.md`](../../apps/tasks-v0/CHANGELOG.md) — what shipped
>
> **Conventions honoured:**
> - [`Project Files/conventions/architectural-layering.md`](../conventions/architectural-layering.md) — apps depend on substrates, substrates on core
> - [`Project Files/conventions/app-readme-scheme.md`](../conventions/app-readme-scheme.md) — apps document substrate use + Agent Hub compatibility
> - [`Project Files/conventions/localisation.md`](../conventions/localisation.md) — every user-facing string in `locales/{en,nl}.json` with `{text, doc}` leaf shape; substrates emit error codes only
> - [`Project Files/conventions/cross-app-settings.md`](../conventions/cross-app-settings.md) — `shared.json` (user-portable) vs `devices/<deviceId>.json` (per-install)
> - [`Project Files/Substrates/policies.md`](../Substrates/policies.md) — rule-of-two for substrate promotion

## 1. The 30-second pitch

V1 made Tasks **work**: a closed-group task ledger with DAG dependencies, role-aware governance, in-app inbox, optional Telegram chat-bot (cap-token-bound, V1.5).

V2 makes Tasks **fit into people's lives**:

- The crew's tasks become visible in members' regular calendars (write-back via the `import-bridge` pattern). No second app to check.
- Members optionally let the app suggest *when* to do things, given their own calendar load and a task's deadline. Suggestions, never auto-assignments.
- Crews that compensate work get the primitives they need (paid-pro role flag + lightweight invoicing references), without turning Tasks into a billing app.
- A privacy-first availability-hint flow lets members signal "I'm slammed this week" / "I have time Friday afternoon" without revealing actual calendar entries.

Same "data stays local-first" principle as V1; same crew-as-envelope model; no required network dependencies beyond what V1 already had.

## 2. Capabilities the app must offer (V2 deltas from V1)

### N. Calendar write-side (was: only read-side import in V1)

**The ask.** When a task gains a `dueAt` (or, optionally, a scheduled slot), the app emits a `VEVENT` to the user's pod under a Tasks-owned calendar collection. The user subscribes to that collection in their phone/desktop calendar via the existing **import-bridge** pattern (the same direction Folio's calendar read uses, just outbound).

**Bound to.** App-level. Calendar emission is composed from `ical.js` (already a Tasks dep) + `core.DataSource.write` to a Tasks-owned pod path. **No new substrate** — see § 5 for the rule-of-two analysis (Folio currently consumes calendars but doesn't emit; Tasks emission is the first use, so we keep it app-local; if a second emitter shows up, lift to a `@canopy/calendar` substrate).

**Trust boundary.** Each member's calendar emission is per-user, written to *their own* pod path under `<pod>/tasks/calendars/<crewId>.ics`. Other members never see it. Privacy stays within the existing pod-data-sharing caution principles.

### O. Auto-scheduling planner

**The ask.** Given (a) my own free/busy from the calendar read-side that V1 already has, (b) the open tasks I'm assigned to, and (c) each task's `dueAt`, suggest concrete slots to do them. Suggestions only — the user accepts/edits/rejects each one. Accepted slots flow into capability **N** (calendar write-side) so they show up in the regular calendar.

**Bound to.** App-level for V2 (rule-of-two not satisfied — no other app needs auto-scheduling yet). Pure function over inputs the substrates already supply: `freeBusy(timeRange) → busySpans[]` (V1 calendar adapter), `listMine() → tasks[]` (V1 itemStore skill), `crewConfig.workingHours` (new field, see § 4.1).

**Algorithm.** Greedy with tie-breakers:
1. Order open tasks by `dueAt` ascending, then by `requiredSkills` rarity (rare-skill tasks earlier).
2. For each task, walk forward from `now` in 30-minute slots within the user's `workingHours` until a free slot of `estimateMinutes` (default 60) fits without crossing `dueAt`.
3. Tag each suggestion with reason: `'fits before deadline'` / `'last-chance slot'` / `'overdue — schedule asap'`.
4. Return as `[{taskId, slotStart, slotEnd, reason}, …]`.

No backtracking, no constraint solver. Honest about its limitations: if a task is over-scheduled, suggest the user reassign or adjust the deadline.

### P. Compensated-role flag + invoicing primitives

**The ask.** Some crews include paid-pro members (cleaner, contractor, accountant). The app needs to:
- Mark a member as `compensated: true` in the crew config (already a field — V1 ignores it; V2 honors it).
- When a paid-pro member completes a task, optionally emit an `invoice-line.json` blob to the *crew's* shared pod path under `<crew-pod>/tasks/invoicing/<memberWebid>/<isoMonth>.json` containing `[{taskId, completedAt, hours, rate?, notes?}, …]`.
- Surface a per-member "this month so far" total on the Crew page, **only visible to admins + the paid-pro themselves** (per role policy).

**Bound to.** App-level. Invoicing logic is thin — a list of completed tasks per pro per month, rendered as a JSON blob the crew's bookkeeper can pull. **Not** a billing app. The Tasks app does not collect rates, totals, or payment status; that's downstream.

**Trust boundary.** Invoice blobs use the same crew-pod-shared visibility V1 uses for the task ledger itself. Members not in the `paid-pro` view get a 403 from the role policy; the blob exists but is unreadable.

### Q. Cross-member availability hints

**The ask.** Coordinator wants to know "who's likely free Friday afternoon to take task X" without seeing every member's calendar. Members opt in to a coarse-grained signal: per (member × ISO-week × half-day-block), one of `'open'` / `'tight'` / `'unavailable'`. Updated by the member, broadcast on the crew bus, persisted in the crew pod under `<crew-pod>/tasks/availability/<memberWebid>.json`.

**Bound to.** App-level. The signal is deliberately coarse — half-days, not appointments — so the privacy disclosure is bounded.

**Trust boundary.** Members opt in per-crew. A member who hasn't opted in shows as `'unknown'` in the coordinator view (NOT "not opted in" — disclosure of opt-in status is itself a leak). Hints are per-crew; opting in to crew A doesn't flow to crew B.

### U. Hard subtask dependencies (added 2026-05-08; ships before mobile)

**The ask.** Today, a parent task can be marked complete (or approved) while its sub-tasks are still open. The `dependencies` field is informational — `computeStatus` (in `apps/tasks-v0/src/dag.js`) reports `'waiting'` purely for UI rendering. Closing the parent is unblocked.

V2.7 makes the dependency contract **load-bearing**: a task with at least one open dependency cannot transition to a closed state. The crew can no longer accidentally "finish" a project whose pieces aren't done.

**Why it goes in V2 (not V3 or mobile):** the desktop app is the source of truth for the data model. If we land this *after* mobile ships, every mobile install needs a migration path. Doing it on the desktop first means mobile inherits the new behavior cleanly.

#### Behavior change in one paragraph

`completeTask` and `approveTask` (the two skills that flip an item to closed) now refuse with `error: 'has-open-dependencies'` (carrying `{openDeps: string[]}` so the caller can render a useful message) when any of `task.dependencies` is still open. Removed-or-missing deps don't block — they're treated as satisfied (a dependency that doesn't exist anymore can't be a blocker forever). `subtask-request` queue items are filtered out before the check (they aren't real tasks yet).

#### Substrate vs app placement (the load-bearing decision)

Two viable positions, with tradeoffs:

| Option                              | Where the gate lives                                                                                 | Pros                                                                                                                                                                                  | Cons                                                                                                                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Substrate gate (recommended)** | `@canopy/item-store`, behind a constructor flag `enforceDependencies: true`                        | Generic shape ("items with `dependencies[]` cannot close while any dep is open"); other apps that adopt DAGs get the rule for free; gate runs *before* `markComplete` writes anything | Substrate gains a behavior; needs a feature flag so Stoop's Phase-12-era items aren't surprised                                                                                  |
| **B. App-side wrapper**             | `apps/tasks-v0/src/skills/index.js` — pre-check inside the `completeTask` and `approveTask` handlers | Substrate stays untouched; Tasks owns the rule; trivial to back out                                                                                                                   | The substrate's `markComplete` is bypassable (a different app or a future skill could call `itemStore.markComplete` directly without the gate); rule is duplicated in two places |

**Recommendation: A.** The rule is genuinely about the data model ("a parent's invariant depends on its children's state"), not about Tasks-app UX. Putting it in the substrate means future apps with DAGs (an Archive deep-tree-of-references view? a project-tree app?) inherit the invariant without re-implementing it. The opt-in flag keeps Stoop unchanged.

Concretely on the substrate side:
- `ItemStore` constructor accepts `enforceDependencies?: boolean` (default `false` for backward compat).
- When `true`, both `markComplete` and `approve` walk `current.dependencies`, look up each one via the existing `#listAllItems`, filter out missing-or-removed, and reject if any are open.
- Throws a typed `DependenciesOpenError extends Error` with `code: 'DEPENDENCIES_OPEN'` and `openDeps: string[]`.
- `apps/tasks-v0/src/Crew.js` constructs ItemStore with `enforceDependencies: true`; Stoop's path stays at the default.
- Rule-of-two friendly: when a second app needs the gate (likely never), the constructor flag stays the API and Stoop opts in too if relevant.

#### Consequences across the surface

1. **DoD lifecycle.** Both transitions to closed must check: `markComplete` (used in self-mark mode) and `approve` (used in creator/webid mode). `submit` does NOT need the check — submission is a mid-state, not a close. `revoke` and `reject` also stay open — they walk the task back to claimed/open.

2. **Sub-task spawning during work.** Two regimes, split by the parent's lifecycle stage:
   - **Parent is `open` or `claimed`:** spawning works as in V1. The assignee is still building the deliverable; adding scope is normal collaborative refinement. Web UI shows a small notice ("This will block the parent's completion") but no consent step.
   - **Parent is `submitted`:** spawning is **blocked by default**. The assignee has handed in "I'm done with what was asked"; adding scope after that point would change the rules during the game. The escape valve is an explicit assignee-consent flow, mirroring V1 Phase 7's admin-approval-queue pattern but with the gate flipped to the assignee:
     - Master/coord calls `proposeSubtask({parentTaskId, ...partial})` → files a `subtask-proposal` queue item targeting the assignee.
     - Assignee gets it in their inbox.
     - Assignee `approveSubtaskProposal({proposalId})` → sub-task spawns; parent's submission is rolled back to `claimed` (the scope changed, so the previous "done" claim no longer applies). The original `submit` entry stays in `reviewLog` as history.
     - Or `declineSubtaskProposal({proposalId, note?})` → proposal closes, parent's submission stays valid.
     - Force path (admin only): `forceSpawnSubtask({parentTaskId, ...partial, reason})` for unreachable-assignee cases. Mirrors `forceCompleteTask` — mandatory reason, audit-log entry under `force-spawn` action label.
   - **Parent is `approved` (closed):** spawning is rejected unconditionally. The parent is closed; if you need more work, create a new top-level task. The hard-dependency gate already enforces this (a closed task isn't a valid `parentTaskId` candidate).
   - **Parent is `rejected` → reverts to `claimed`:** spawning works as in the `claimed` regime — the assignee is mid-rework anyway.

3. **Removed dependencies.** When `removeItems(parentDeps[k])` runs, the parent's `dependencies` array isn't touched (substrate doesn't auto-update parents — same as V1). The gate honors the V1 `computeStatus` rule: missing deps are treated as `'satisfied'` for the close-check (NOT `'blocked'`). A task whose only deps were removed becomes closeable. If the user wants to know *why* a dep is missing, they look at the audit log of the removed task.

4. **Override path (the escape hatch).** Sometimes a parent really needs to close and the rule is in the way (sub-tasks were a mistake; deps got out of sync). New skill `forceCompleteTask({id, reason})` — admin-only, mandatory `reason`, single-purpose. It bypasses the dependency gate but writes a distinct audit-log entry with `action: 'force-complete'` and the reason text, so the deviation is visible to the next reviewer. **Not** a generic "admin can do anything" override; the rest of the system stays gated.

5. **UI feedback (web).** The "Mark complete" / "Approve" buttons render disabled when `computeStatus(task) === 'waiting'`, with a tooltip listing the open dep count and short-id list. The DAG view already shows the tree; the tooltip just makes the button-disabled state self-explanatory.

6. **Bot feedback.** `bot.markComplete` and `bot.approve` already wrap the underlying skills; the new error code `'has-open-dependencies'` translates to a chat-friendly *"Can't close — N open sub-task(s): X, Y, Z."* No new bot command for force-complete in V2 (admin uses the web UI; the chat surface isn't where you'd want to bypass an invariant).

7. **Audit log.** A rejection at the gate is NOT audited (the action didn't happen — same as today's role-policy denial). A successful `forceCompleteTask` IS audited with the reason text and the `force-complete` action label. Audit viewers can filter by action to find every override.

8. **Cascade.** **No** — each task closes independently. Approving the deepest leaf doesn't auto-close anything above it. The user (or the master) approves each level explicitly. (We considered cascade-on-approve and rejected it: a parent's approver may have additional checks beyond "all kids are done" — final review of the deliverable, sign-off on quality, etc. Cascade would skip those.)

9. **Migration / backward compat.** Existing data is safe: parents already in the closed state stay closed (no automatic re-opening). The gate only fires on *new* close attempts. Crews that started under V1 keep their existing state; the gate kicks in for the next close after V2.7 ships.

10. **Performance.** Walking `dependencies` is O(deps). A V1 task has typically ~3 deps; pathological DAGs cap at the existing `subtasksAdminApprovalDepth` (default 3). Sub-millisecond per close. No concern.

11. **Notifier interaction.** When a sub-task closes, V1 already emits `item-completed`. The parent, if all siblings are now closed, becomes `'ready'` — but its state field doesn't change (it's still `claimed` or whatever). The notifier doesn't need any new event: the parent's master sees the deps-cleared state in their next UI refresh, and *they* fire the close.

#### Trust boundary + privacy

This change does not introduce any new pod paths, no new visibility rules, no new network calls. The rule lives entirely inside the existing item-store and skill surface. Existing role-policy gates apply unchanged (admin can still `removeTask`; member still owns their own assignments).

#### Mobile inheritance

Mobile inherits everything in this section automatically — same skills, same substrate flag, same audit semantics. The mobile-specific note: the disabled-button + open-dep-count rendering in the iOS/Android UI mirrors the web's, with the count rendered as a small chip on the task card so it's visible without opening the detail sheet.

### V. Single-agent + per-crew state (added 2026-05-08; ships before mobile)

**The ask.** Today, `createCrewAgent` constructs one `core.Agent` per crew — fine for single-crew CLI tests, broken for V2.5's multi-crew dashboard (N crews → N Agents → N transports per process) and a death trap for the planned mobile app. Stoop-mobile hit the same trap and shipped a refactor 2026-05-08; per the handoff section in [`Project Files/Stoop/single-agent-refactor-2026-05-08.md`](../Stoop/single-agent-refactor-2026-05-08.md) §"Tasks-app fix propagation," Tasks should mirror their pattern.

V2.8 makes the agent boundary single-instance:

- **One `core.Agent` per service-context** (the CLI's `bin/tasks-ui.js`, the future `apps/tasks-mobile/src/ServiceContext.js`).
- **Per-crew state in a `Map<crewId, CrewState>`.** Each `CrewState` owns the crew-scoped `ItemStore`, `MemberMap`, `SkillMatch`, `mirror`, `groupManager`, bot bindings, calendar emitters, etc. — but **no Agent and no transports of its own.**
- **Skills register ONCE** on the shared agent's `skills` registry, with a `bundleResolver(args, ctx) → CrewState | null` closure that resolves the right crew per call.
- **Strict resolution** (no silent active-crew fallback): caller must supply `args.crewId`, OR the inbound envelope's topic must match `<crewId>/…`, OR the skill rejects with `{error: 'crewId required'}`.

**Why it goes in V2 (not V3 or mobile):** the desktop app is the source of truth for the data model + the shape of `createCrewAgent`. Landing this in mobile-V1 would mean the desktop CLI shipped a different agent topology than the mobile app — confusing enough to outweigh the refactor cost. Doing it on the desktop first gives mobile a clean starting point.

#### Why the current shape is wrong (concrete)

`apps/tasks-v0/src/Crew.js#createCrewAgent` builds:

- a fresh `AgentIdentity` (V2.0 made it stable across restarts via vault-snapshot) — fine
- a fresh `InternalTransport` per crew — *not* fine when N crews share one process (each is a separate listener on a separate `InternalBus`)
- a fresh `policyEngine`, `trustRegistry`, `tokenRegistry` per crew — coherent today only because each crew runs in its own CLI process
- skill registration happens inside `createCrewAgent`'s closure, capturing this single crew's `liveCrew`, `roles`, etc. → no path for cross-crew dispatch

V2.5's `crewBundlesProvider` works around this by treating each crew as its own bundle and aggregating in `aggregateCrews`. That kept multi-crew alive in the dashboard, but did not fix the underlying topology — every `--crew-list` launch still spawns N agents.

#### Behavior after V2.8

- `createCrewAgent({crewConfig, ...}) → bundle` is renamed `buildCrewState({meshAgent, crewConfig, ...}) → CrewState`. Drops `transport`, `identity`, `vault`, `policyEngine`, `trustRegistry`, `tokenRegistry` from its arg list — those come from the shared `meshAgent`.
- A new `apps/tasks-v0/src/MeshAgent.js` (or extension to `Agent.js`) builds the shared agent: identity (V2.0 vault-snapshot), all transports the deployment needs (Internal for tests, Mesh / mDNS / BLE / Relay for production), `policyEngine` + `trustRegistry` + `tokenRegistry` once. Identity vault path becomes per-process, not per-crew.
- Skill registration moves out of `Crew.js` into a process-level wiring step. Each `defineSkill` body opens with `const crew = bundleResolver(args, ctx); if (!crew) return {error: 'crewId required'};` — minimal mechanical change, no behavioural change.
- `bin/tasks-ui.js` builds one meshAgent at startup, registers skills once, then constructs `CrewState` per `--crew` / `--crew-list` entry over the shared agent.
- `getMyCrews` / `crewBundlesProvider` from V2.5 simplifies: the `crews` map IS the bundle list; aggregator iterates `Map<crewId, CrewState>`.

#### Consequences across the surface

1. **Skill signatures.** Every Tasks skill — `addTask`, `claimTask`, `completeTask`, `submitTask`, `approveTask`, `rejectTask`, `revokeTask`, `setApprovalMode`, `addSubtask`, `proposeSubtask`, `approveSubtaskProposal`, `declineSubtaskProposal`, `forceCompleteTask`, `forceSpawnSubtask`, `getCrewConfig`, `getDagTree`, `listMine`, `listMyMasteredTasks`, `listAwaitingApproval`, `listOpen`, `listClaimable`, `listSubtaskRequests`, `listMyInbox`, `clearInboxItem`, `clearInbox`, `appealTask`, `getMetrics`, `getCrewCadences`, `setCrewCadences`, `setMyCadenceOverrides`, `getMyCadenceOverrides`, `pauseCrew`, `unpauseCrew`, `archiveCrew`, `unarchiveCrew`, `getPrivacyNotice`, `setBotChatBinding`, `removeBotChatBinding`, `getBotChatBindings`, `issueBotToken`, `revokeBotToken`, `registerCrewCustomRole`, `unregisterCrewCustomRole`, `listKnownRoles`, `setCalendarEmission`, `getCalendarEmissionUrl`, `getCalendarEmissionStatus`, `recordInvoiceLine`, `getCompensation`, `setMemberCompensation`, `setCompensationEnabled`, `setMyAvailability`, `getMyAvailability`, `getCrewAvailability`, `setAvailabilityOptIn`, `setAvailabilityEnabled`, `suggestSchedule`, `acceptSchedule`, `rejectSchedule`, `getMyCrews`, all `bot.*` skills — gets a one-line preamble: resolve the crew or reject. Pure mechanical; no behaviour change for the single-crew CLI mode.

2. **`bot.*` skills.** Already use `effectiveActor({from, envelope})` for actingAs resolution. The bundleResolver is one tier above — resolves the crew, THEN the actor inside that crew. `bot.crews` (V2.5) is special-cased: it iterates the `crews` Map directly without going through bundleResolver.

3. **Cap-token bot agents (V1.5).** Stay per-binding identities (per-binding bot agents). They don't change shape — they were already separate agents with their own pubKeys. The shared meshAgent's PolicyEngine still validates their tokens; the bot agents talk to it over the shared bus.

4. **Calendar emission, invoicing, availability hints (V2.1–V2.3).** All wire per CrewState. Each CrewState gets its own emission / invoicing / availability listener attached to its own ItemStore. No cross-crew leakage; the shared agent doesn't see crew-scoped events directly.

5. **Tests.** Single-crew tests adapt by passing the shared meshAgent + one CrewState explicitly. Multi-crew tests get easier — one agent, N CrewStates over the same bus. ItemStore tests are unaffected (they never went through Agent).

6. **No skill-registry hot-swap needed.** Stoop's plan adds `SkillRegistry.replace(def)` to `core` for hot-swap during dev. Tasks doesn't strictly need it (the registration happens once at boot); we'll consume it if Stoop ships it but won't block on it.

#### Trust boundary + privacy

No new pod paths, no new network surface. The shared agent's PolicyEngine is the same gate the per-crew agents had — consolidated. The cap-token-bound bot agent flow (V1.5) is unchanged. Audit log per crew is still attributed to the actor's webid (resolved per-crew via the bundleResolver).

#### Mobile inheritance

Mobile-V1 inherits the new shape from day one (the mobile coding plan's Phase 41.2 ServiceContext was already designed against this pattern in anticipation; it now becomes the canonical implementation).

### S. Cross-crew dashboard

**The ask.** A user typically belongs to several crews (household, OSS group, neighborhood maintenance). Today they have to switch between web instances or restart the CLI per crew to see status. V2 adds one screen that lists *all* the user's crews with a few key counters (open / overdue / awaiting-approval / mine) plus a "jump to crew" link.

**Bound to.** App-level. The pattern (read pod data from multiple sources, present a unified view) is what `apps/archive/` is solving for the broader case via H7. For Tasks specifically, the work is small because each crew already exposes the right counts via V1's `getMetrics` + `listOpen` + `listMine` skills — the dashboard just needs to instantiate a thin read-only ItemStore per crew the user belongs to.

**Trust boundary.** The dashboard reads only crews the user is already a member of (per their pod's existing access). It does not reveal cross-crew correlations to anyone else; it's a single-user-only view.

**Why this got promoted from V2.5 → V2:** the original deferral cited "depends on archive-app pattern". On second read, Tasks doesn't need Archive — V1 already exposes everything the dashboard needs at the per-crew skill level. The pattern Archive is building (cross-source aggregation with full-text search) would be the *next* tier of dashboard if/when needed.

### T. Bot surface — chat command additions per capability

V1.5 shipped 13 `bot.*` commands plus a cap-token-bound bot agent (per-binding identity, scoped to `bot.*`, expirable + revocable). V2 extends the bot's command surface in step with each capability — same dispatch grammar, same role-policy gate, same audit-log "(via bot)" attribution.

| V2 capability | New bot command | What it does | Authz |
|---|---|---|---|
| **N. Calendar write-side** | `calendar` | Replies with the user's `getCalendarEmissionUrl()` so they can paste it into their phone calendar. | self |
| **P. Invoicing** | `invoice` | Lists this-month invoice lines + total for the calling member. | self (paid-pro only — non-pros get "no compensation recorded for you") |
| **Q. Availability hints** | `available <state>` | Sets the calling member's hint for the *current* half-day to one of `open` / `tight` / `unavailable`. Replies with confirmation. | self (and only when the crew has availability hints enabled + the member opted in) |
| **Q. Availability hints** | `week` | Renders the calling member's own week as a 7×2 grid (text-fenced). | self |
| **O. Auto-scheduling** | `plan` | Calls `suggestSchedule({lookaheadDays: 7})`; renders the top-3 suggested slots as a numbered list with reason chips. | self |
| **O. Auto-scheduling** | `accept <id> [N]` | Accepts the Nth suggestion (default 1 = the top-ranked) for task `<id>`. Sets `scheduledAt`; calendar emission picks it up if enabled. | self (only the assignee can accept) |
| **S. Cross-crew dashboard** | `crews` | Lists every crew the calling user belongs to with one-line counters: `<crewName>: <openCount> open · <overdueCount> overdue · <mineCount> mine`. | self |

**Constraints inherited from V1.5:**
- Each new command is a `bot.*` skill with `policy: 'requires-token'` (so PolicyEngine actually validates the cap-token on the transport path).
- Handler reads `effectiveActor({from, envelope})` to honour the `actingAs` constraint when called via cap-token, falls through to legacy trust-map mode otherwise.
- New skills get exact-id tokens via the `skillMatches('bot.*', skillId)` rule already in core — no extra token re-issuance needed.
- All replies use the same `{text, buttons?}` shape; locale strings live in `bot.*` keys per the `localisation.md` convention (substrate emits codes; app translates).

### R. Carryover from V1.5 follow-ups (already shipped in 0.2.5)

The three V1.5 follow-ups completed before V2 work started:
- **A** — cap-tokens scoped to `bot.*` (PolicyEngine + TokenRegistry both honour the `prefix.*` pattern via `core.skillMatches`)
- **B** — bot identities persisted; cap-token bindings survive CLI restart (auto-rotates token at restore-time pending tasks-agent identity persistence in V2)
- **C** — server-side revocation list (`PolicyEngine.setRevocationCheck`)

V2 inherits these. No re-work needed, but two follow-ups remain visible from V2:
- **R1.** **Tasks-agent identity persistence.** Currently `createTasksAgent` calls `AgentIdentity.generate(new VaultMemory())` each boot. For full restart-survival of cap-token bindings (without auto-rotate), the tasks agent's vault needs to persist via the local-store cache. Mirrors the bot-identity persistence pattern from 0.2.5; ~½ day; pure plumbing.
- **R2.** **Persisted revocation list.** In-memory `Set<tokenId>` for V1.5; for cross-process bots we want a `vault.has('revoked-issued:<tokenId>')` check. Lift to a `RevocationRegistry` class on core if a second app needs it (rule-of-two not yet satisfied).

## 3. User journeys (the new ones V2 enables)

### Journey N — Tasks land in my regular calendar

1. **Anne** opens the Tasks workspace, ticks "Sync deadlines to my calendar" in her settings. (UI lives on the existing Crew page.)
2. The app writes `<anne-pod>/tasks/calendars/<crewId>.ics` whenever a task with `dueAt` is added/updated/completed in any of Anne's crews. Each VEVENT carries the task's `id` in the iCal `UID` field so future updates patch the right event.
3. Anne subscribes to that ICS URL once in her phone calendar (Google / Apple / Proton — anything that speaks ICS). New tasks now show up automatically.

**Acceptance:** a calendar that ingests the ICS file shows the same set of deadline events the app's `listMine()` would.

### Journey O — Suggest when I should do my work

1. **the author** opens "My work", clicks the new "Suggest a plan" button.
2. App calls `suggestSchedule({timeRange: nextSevenDays})` skill which:
   - Reads his free/busy from the V1 calendar adapter.
   - Lists his open assignments.
   - Honors `crewConfig.workingHours` (default Mon–Fri 09:00–17:00 in user's tz).
   - Returns a list of `{task, suggestedSlot, reason}` proposals.
3. the author sees them as cards. Each has "Accept" / "Tweak" / "Skip".
4. Accepting a suggestion updates the task's `scheduledAt` field; if Journey N is enabled, the calendar entry rolls in.

**Acceptance:** the planner never auto-accepts. Every slot needs a click. Rejection is silent (no "are you sure?" dialog — friction taxes the planner's trustworthiness).

### Journey P — Paid-pro completes a task, the bookkeeper sees the line

1. **Carol** is the crew's accountant; she's marked `compensated: true` in the crew config and her role is `member` (or a custom role like `accountant`).
2. She completes a task. As part of the markComplete handler, an invoice line is appended to `<crew-pod>/tasks/invoicing/<carol-webid>/2026-05.json`.
3. **Anne** (admin) or Carol opens the Crew page → "Compensation" panel and sees Carol's per-month totals (count of tasks; hours if `estimateMinutes` was set on the task; rate is *not* in scope for V2).
4. Members other than Anne and Carol don't see the panel; the role policy refuses the `getCompensation` skill call.

**Acceptance:** the panel shows Carol's invoice lines for the current and previous month. Other crews' invoice blobs are inaccessible (different pod paths). Members who aren't admin and aren't the pro get a `403 admin-or-pro-self required` from the skill.

### Journey Q — Coordinator picks an assignee with hint visibility

1. **the author** (coordinator) opens a task with a Friday deadline that no one's claimed.
2. The assignee picker shows each candidate with a small chip: `open` / `tight` / `unavailable` / `unknown` for the relevant half-day.
3. the author assigns to whoever has `open`. (No automated decision; the chip is informational.)
4. Members update their hints from a one-screen "My week" panel — clicking a half-day cell rotates through the four states.

**Acceptance:** opting out leaves your chip as `unknown` to coordinators, and the coordinator UI doesn't distinguish "opted out" from "never opened the panel" (both = `unknown`).

### Journey U — A parent task waits for its sub-tasks

1. **the author** has been working on "Build the bookshelf." It has three sub-tasks: "Cut the wood," "Drill holes," "Assemble." Cut and drill are done; assemble is still open.
2. the author taps "Mark complete" on the parent. The button is disabled with a tooltip: *"1 open sub-task: Assemble."*
3. He clicks the sub-task in the tooltip → sub-task detail → claims it himself → marks it complete.
4. Now the parent's tooltip clears; "Mark complete" is enabled. He closes the parent.

If the author wanted to close the parent without finishing assemble (e.g. the bookshelf collapsed and the project is dead): admin **Anne** opens the parent → "Force complete" → enters a reason ("project cancelled — bookshelf failed structural check") → audit log records `force-complete` with the reason. Visible to anyone reading the parent's history.

**Acceptance:** member-level users cannot close a parent with open sub-tasks. Admin can override via the explicit `forceCompleteTask` skill with a mandatory reason. The audit log distinguishes normal close vs forced close.

### Journey U' — Adding scope after submission, with consent

1. **Bob** has been working on "Paint the fence" and just submitted it for approval (parent state: `submitted`).
2. **Anne** (the master) realizes the gate hinge is rusted and should be addressed alongside the paint job. She opens the parent and clicks "Add sub-task" — the button is in a different mode than usual ("Propose sub-task — needs Bob's approval"). She fills in the new sub-task's text + deadline and submits.
3. The proposal lands in Bob's inbox: *"Anne wants to add a sub-task to 'Paint the fence': 'Replace gate hinge.' Approving rolls your submission back to claimed."* with `[Approve]` `[Decline]` buttons.
4. Bob approves. The new sub-task spawns; the parent rolls back to `claimed`. Bob's original `submit` entry stays in the parent's `reviewLog` as history. He picks up the gate hinge work, finishes it, and re-submits the parent when both sub-tasks are done.
5. (If Bob had declined: the proposal closes, the parent stays `submitted`, Anne can either accept the submission as-is or open the gate-hinge work as a separate top-level task.)

**Acceptance:** master/coord can't unilaterally add work to a submitted parent. The assignee is the gate; the explicit propose/approve roundtrip makes the scope change visible in the audit log. The force path (`forceSpawnSubtask`) exists for unreachable-assignee edge cases but writes a distinct audit entry so the override is auditable.

### Journey S — One screen for every crew I'm in

1. **Anne** opens the new Crews dashboard at `/crews.html` (or DMs `crews` to the bot).
2. The page lists every crew she's a member of (resolved from her local Tasks installs / per-crew configs the CLI was launched with). Per row: crew name, kind chip, four counters (`open` / `overdue` / `awaiting-approval` / `mine`), a "Jump in" link.
3. Counters refresh on the same `mountLive` event hook the per-crew pages use. Stale crews (no opens) fade lower in the list.
4. Bot version (`crews`): same data as text. Useful when Anne's on her phone and wants a quick "do I need to do anything tonight" glance without opening the web UI.

**Acceptance:** counters per crew match the same numbers shown on each per-crew Workspace page. The dashboard reveals nothing about crews Anne isn't a member of (it can't — she has no pod access).

## 4. Information model deltas

### 4.1 — CrewConfig new fields

```json
{
  "workingHours": {
    "tz":      "Europe/Amsterdam",
    "windows": [{"day": "mon", "start": "09:00", "end": "17:00"}, …]
  },
  "compensation": {
    "enabled":       true,
    "defaultRate":   null,
    "currency":      "EUR"
  },
  "availabilityHints": {
    "enabled":       true,
    "halfDays":      ["am", "pm"]
  }
}
```

All optional; absent = V1 behaviour. Validated in `_normaliseConfig` (matches the pattern V1.5 used for `pushTokens` + `bot.chatBindings`).

### 4.2 — Member new field

```json
{
  "webid":        "https://id.example/carol",
  "displayName":  "Carol",
  "role":         "member",
  "compensated":  true,
  "rate":         null
}
```

`compensated` and `rate` are already accepted in V1's normalise pass (V1 just ignored them). V2 honors both.

### 4.3 — Task new fields

```json
{
  "scheduledAt":   1715000000000,
  "estimateMinutes": 60
}
```

Both optional. `scheduledAt` is the user-accepted suggested slot from Journey O; `estimateMinutes` is what the planner uses to size slots and what the invoicing path uses to roll up hours.

### 4.4 — New pod paths

Pod paths follow the cross-app-settings convention (under `<pod>/<app>/...`):

- `<member-pod>/tasks/calendars/<crewId>.ics` — Journey N (per-member)
- `<crew-pod>/tasks/invoicing/<memberWebid>/<isoMonth>.json` — Journey P (per-crew, per-pro, per-month)
- `<crew-pod>/tasks/availability/<memberWebid>.json` — Journey Q (per-crew, per-member)

The first lives on the **member's** pod (it's their calendar); the latter two live on the **crew's** pod (others need to read them, gated by role policy).

## 5. Substrate composition + rule-of-two analysis

V2 adds **no new substrates**. Each capability either reuses V1 substrates or stays app-local pending a second consumer.

| V2 capability | Substrate(s) used | Rule-of-two for substrate promotion |
|---|---|---|
| **N. Calendar write-side** | `core.DataSource.write` + `ical.js` directly | First emitter. Folio reads calendars but doesn't emit. **Stays app-local.** When a second app emits (likely Stoop V3 for buurt-event broadcasts, or a future Coordinator app), promote to `@canopy/calendar` (read + write halves together). |
| **O. Auto-scheduling planner** | `@canopy/item-store` (listMine) + V1 calendar adapter (freeBusy) + new local `lib/planner.js` | First scheduler. **Stays app-local.** Greedy algorithm; the substrate would be `@canopy/scheduler` if a second app needs it (no current candidate). |
| **P. Compensated-role + invoicing** | `@canopy/item-store` (audit log → invoice lines) + `core.DataSource.write` (invoice blobs) | First invoicing surface. **Stays app-local.** The blob shape is intentionally minimal so a downstream tool (any spreadsheet) can pull it without a custom reader. |
| **Q. Availability hints** | `@canopy/identity-resolver.MemberMap` (per-member opt-in flag) + `core.DataSource` (hint blobs) + V1 chat-p2p (broadcast updates over crew bus) | First availability-hint surface. **Stays app-local.** Stoop's V2 "presence" idea (deferred) might be the second consumer; check `Project Files/Substrates/apps/H8-presence.md` if it lands. |
| **S. Cross-crew dashboard** | V1's `getMetrics` + `listOpen` + `listMine` skills (per-crew); thin app-side aggregator iterates crews | First aggregator. **Stays app-local.** When/if H7 Archive's web UI ships, a future "deep dashboard" with full-text search + cross-source linking layers on top — not a dependency for V2. |
| **T. Bot command additions** | V1.5 `bot.*` skill set (cap-token-bound dispatch, `policy: 'requires-token'`, `effectiveActor` actingAs resolution) | Additive to the existing bot surface. **No substrate touch** — `defineSkill` + the existing `wireBotChannel` cover it. |
| **U. Hard subtask dependencies** | `@canopy/item-store` (constructor flag `enforceDependencies`); new typed error `DependenciesOpenError`; new skill `forceCompleteTask` | **Substrate touch — opt-in flag**. Stoop's items don't use `dependencies[]` so it stays opt-out by default. Tasks turns it on via `Crew.js`. The flag is the rule-of-two API: when a second app needs the same gate, it flips the same flag. |
| **V. Single-agent + per-crew state** | `core.Agent` + `core.SkillRegistry` (consume the additive `replace` / `unregister` methods Stoop's Phase 1 ships) | **No substrate promotion now.** App-level pattern (mirror of Stoop's). If Tasks's `bundleResolver` shape ends up identical to Stoop's, that's the rule-of-two trigger for `@canopy/scoped-skill-bus` (or fold into `@canopy/skill-match`) — but per the Stoop handoff, "wait for Tasks's actual implementation to exercise the API surface, then lift the common bits." Defer. |

**Substrate-touching changes (additive only).** None planned for V2. If implementation reveals an awkward fit (e.g. ItemStore's audit-log-as-source-of-truth for invoicing turns out to need an extra event), the change goes in additively (new optional event payload field, never a renaming or breaking the existing shape). Substrates MUST NOT reinvent SDK primitives — same rule as V1.

## 6. Locale + UI conventions

Per [`localisation.md`](../conventions/localisation.md):

- All new UI strings land under `apps/tasks-v0/locales/{en,nl}.json` with `{text, doc}` leaf shape.
- `doc` is mandatory. Keys nested by capability (e.g. `planner.suggestionAccepted.text`).
- Substrates emit error codes only — Tasks-side handlers translate them. New error codes Tasks expects from substrates:
  - `core.permissions.PolicyDeniedError` codes (already used in V1.5)
  - `local-store.cache.dataSource.write` failure → app surfaces `errors.calendar.write_failed`
- V1.5 added the bot-bindings panel; V2 adds:
  - Settings panel: "Sync deadlines to my calendar" toggle (Journey N)
  - "My week" panel: 7×2 grid of half-days for hint-setting (Journey Q)
  - "Suggest a plan" button + suggestion-cards on My work (Journey O)
  - "Compensation" panel on Crew page (admin / paid-pro only) (Journey P)

Each new key in the locale file MUST have a `doc` field naming the surface, the trigger, and the tone.

## 7. Privacy + data-sharing follow-up

V2 keeps the V1 [pod-data-sharing caution principles](./advice-2026-05-07.md#pod-data-sharing--caution-principles):

- **Calendar write-side (N):** writes to *member's own pod*. Other members never see it. The ICS file is unauthenticated by URL — same threat model as a Google Calendar share-link. Document the URL-based threat in the privacy notice.
- **Invoicing (P):** writes to crew pod, but role-policy gated. Per-month JSON is the smallest aggregation that's still useful; finer aggregations get added only if a real bookkeeping flow needs them.
- **Availability hints (Q):** half-day granularity; opt-in per crew; "unknown" indistinguishable from "opted out". Default is `enabled: false` in the crew config (admin enables; member then opts in).

The privacy notice (V1 `getPrivacyNotice` skill) gets three new items in `lib/privacyNotice.js`, English + Dutch, with the same six-item layout V1 used.

## 8. Risk register (V2)

In priority order:

1. **Auto-scheduling produces obviously-wrong suggestions** that erode trust faster than they save time. **Mitigation:** every suggestion has a visible reason chip. Suggestions are batched (don't fire one-off auto-suggestions on every task add); the user opens the panel deliberately. If the suggestion engine has < 70% accept rate over a week of use, document and revisit the algorithm.
2. **Calendar emission writes too often** and pod-side rate-limits hit. **Mitigation:** debounce writes to once per 60 s per crew; only re-emit when at least one task's `dueAt`/`scheduledAt`/`completedAt` actually changed since the last emission. Pure-fn diff at the emission boundary.
3. **Invoicing drift** — the Crew page totals show a different number than the per-month JSON because of an audit-log race. **Mitigation:** the Crew page panel reads the JSON blob, not a recompute from the audit log. Single source of truth.
4. **Availability-hint chips invite social pressure** ("Why are you `tight` again?"). **Mitigation:** chips are visible to coordinators only by default; member can downgrade visibility to "self only" via a per-crew toggle. Document the social dynamic in the privacy notice.
5. **`forceCompleteTask` becomes a casual override** rather than an exception. **Mitigation:** mandatory `reason` is recorded in the audit log under a distinct `force-complete` action label so reviewers can audit usage. Add an observability metric (`forceCompleteCount` per crew) so admins can monitor frequency. If a crew's frequency is high, the V2.7 gate may be too tight or the data model is wrong — revisit, don't paper over.
6. **Sub-task spawning on a "closed-soon" parent feels surprising** when it suddenly blocks the close. **Mitigation:** the web UI's "Add sub-task" button on a non-`open` parent shows a confirm-dialog explaining the consequence ("This will block the parent's completion until the sub-task is done — proceed?"); the bot's `addSubtask` reply text says the same.
7. **`bundleResolver` rewrite touches every skill** (V2.8). Mistakes most likely in skills with subtle closure-captured state (`localActor`, role lookups). **Mitigation:** test pass after every batch of ~10 skills. Stoop's same refactor took ~3-4h on a ~2k-line skill set; Tasks's skill set is similar size. The strict-fallback policy (no silent active-crew default) catches any forgotten resolver early — if it doesn't fire, the call is genuinely scope-aware.

## 9. Open TODOs / questions to resolve before coding

1. **Working-hours UX.** Is the per-day window in CrewConfig the right place, or per-member? V2 ships per-crew default + per-member override (added to MemberMap). Confirm during journey-O implementation.
2. **Invoice rate handling.** V2 stops at *recording hours*. Does the user want the Crew page to multiply hours × member.rate? If yes, that's a one-line UI addition; if no, the `rate` field stays informational. **Default answer: yes, multiply, but mark as "informational, not authoritative".**
3. **Availability-hint write throttling.** A member could spam updates and bloat the hint blob's history. V2 keeps only the *current* state per (member, week) — no history. Confirmed acceptable per Journey Q's privacy framing.
4. **Tasks-agent identity persistence (V1.5 R1).** Schedule alongside the V2 work or split into a separate small PR? **Recommendation:** separate small PR before V2 lands so V2 PRs don't carry the substrate-touching change.
5. **Hard-dependency gate scope (V2.7 §U).** ✅ **Locked 2026-05-08:** apply to ALL items with non-empty `dependencies[]`, regardless of `parentTaskId`. A task that lists a manually-set dep on another task (V1's DAG primitive — not just sub-tasks) deserves the same invariant. `parentTaskId` is just one of several shapes that produce a dependency edge.
6. **Force-complete cascade (V2.7 §U).** Recommendation: sub-tasks stay open. The override closes the parent only; the sub-tasks remain workable (or removable, by admin). Cascading would silently delete in-flight work. (Not yet user-confirmed; default is no-cascade.)
7. **Submission auto-rollback on subtask-proposal approval (V2.7 §U).** When the assignee approves a `subtask-proposal` on a `submitted` parent, two options:
   - **a) Auto-rollback to `claimed`** *(recommended)* — the previous submission claimed "I finished what was asked," and what was asked just changed. Rolling back makes the contract honest: the assignee re-submits when the new sub-task is done. Original `submit` entry stays in `reviewLog` as history.
   - **b) Keep submission on file, parent becomes `submitted-but-blocked`** — less work lost, but introduces a new state and the approver might forget what they were approving. Auto-resolution when the new sub-task closes (parent re-enters its previous `submitted` state) is non-trivial to make UI-clear.
   Going with (a) by default. Flag if you'd rather keep submissions on file.

## 10. Suggested phasing

Sized by effort + dependencies. Each phase is independently shippable.

| Phase | Item | Effort | Depends on |
|---|---|---|---|
| **V2.0** | R1 (tasks-agent identity persistence) | ½ d | — |
| **V2.1** | N (calendar write-side) + bot `calendar` | 3 d | Existing `ical.js` dep |
| **V2.2** | P (compensated-role + invoicing) + bot `invoice` | 2 d | — |
| **V2.3** | Q (availability hints) + bot `available` / `week` | 5 d | MemberMap opt-in flag |
| **V2.4** | O (auto-scheduling planner) + bot `plan` / `accept` | 6 d | N (write-side wires accepted slots back) |
| **V2.5** | S (cross-crew dashboard) + bot `crews` | 2 d | V1's per-crew `getMetrics` (already shipped) |
| **V2.7** | U (hard subtask dependencies — substrate gate + force-complete + post-submit consent flow + UI/bot polish) | 2.5 d | Independent of V2.1-V2.5; **must land before mobile** |
| **V2.8** | V (single-agent + per-crew state — Stoop refactor handoff: rename `createCrewAgent`→`buildCrewState`, one meshAgent per process, `bundleResolver` on every skill) | 3-4 d | Depends on Stoop's Phase 1 `core` additions (`SkillRegistry.replace` + `unregister`). Otherwise independent. **Hard gate before mobile-V1 starts.** |

Total ~23.5-25.5 dev-days. Phases V2.1–V2.3 + V2.5 + V2.7 + V2.8 can be parallel since they touch disjoint surfaces (V2.8 is a mechanical refactor of skill bodies; V2.1-V2.7 add new skills + UI). V2.4 depends on V2.1 for the calendar feedback loop. V2.8 is the final gate before mobile-V1; mobile inherits the new agent shape from day one.

V2.7 expanded from 1.5 → 2.5 days when the post-submission spawn rule + assignee-consent flow locked in 2026-05-08:
- Substrate: `enforceDependencies` flag + `DependenciesOpenError` (½ d)
- App skills: `forceCompleteTask` + `proposeSubtask` + `approveSubtaskProposal` + `declineSubtaskProposal` + `forceSpawnSubtask` (1 d)
- UI: disabled-button + tooltip on web; "Propose sub-task" mode on submitted parents; assignee inbox cards for proposals (½ d)
- Bot translations + tests (½ d)

A V2.6 line — pulled forward only if there's external demand:
- Cryptographic anonymity (depends on Stoop V2's Q-H5 unpark)
- Federated crew pod ownership pattern (c) (depends on `pod-client` federated-reader being binding)
- Real-time collaboration on a deliverable doc (depends on OSS-doc-tool integration project)
- "Deep" dashboard with full-text search + cross-source linking (depends on H7 Archive's web UI landing — separate from V2.5's lightweight aggregator)

## 11. Cross-app integration TODOs (added 2026-05-08)

V2.1 (calendar write-side) is the second consumer of an outbound calendar pattern. **If Folio's V3 adds outbound calendar emission (rumoured), Tasks V2.1 becomes the first half of the rule-of-two for `@canopy/calendar`. Substrate decision deferred to that point — for now, both apps stay self-contained.**

V2.4 (auto-scheduling) consumes `freeBusy(timeRange) → busySpans[]` from V1's calendar adapter. That adapter is currently in `apps/tasks-v0/src/calendar/`; if a second app needs free/busy reading, lift the adapter to `@canopy/calendar` first (probably as part of the V2.1-triggered substrate, if the timing aligns).

No app-to-app imports added. The convention from `architectural-layering.md` holds.
