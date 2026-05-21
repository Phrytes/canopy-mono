# H4 (tasks) — shared task ledger

| | |
|---|---|
| **Status** | **V1 shipped 2026-05-08** as `apps/tasks-v0` (`0.2.0`). Crew envelope + DoD lifecycle + sub-tasks + in-app inbox + local calendar + observability + localisation + lifecycle controls. 7-screen workspace UI. **176/176 tests passing.** |
| **Code** | `apps/tasks-v0` (~1100 LOC of app glue on top of 7 substrate packages) |
| **Tests** | 176 across 13 files (V0 baseline 34 + V1 phases 1-10 add 142) |
| **Source notes** | `projects/04-tasks-app/README.md`, `Tasks App/advice-2026-05-07.md`, `Tasks App/critique-2026-05-07.md`, `Tasks App/coding-plan-2026-05-07.md`, `apps/tasks-v0/CHANGELOG.md` |
| **App name** | **Tasks** (locked 2026-05-07; Crew is the working term for the tenant envelope) |

---

## Current state

**V1 shipped 2026-05-08** — `createCrewAgent({crewConfig, localStoreBundle, ...})` is the V1 entry point; `createTasksAgent` keeps working for V0 callers (zero-config single-household path). Both wire into the same item-store / role-policy / DAG; V1 adds the Crew envelope + DoD lifecycle + sub-tasks + in-app inbox + local calendar + per-event observability + localisation + lifecycle controls (pause/archive) on top.

**Substrate consumption (V1 reality)**:

| Layer | What Tasks V1 uses |
|---|---|
| **L1b (item-store)** | Tasks + DoD lifecycle (Phase 5 substrate extension: `submitted`/`rejected` states; `definitionOfDone` / `approval` / `deliverable` / `master` / `parentTaskId` / `reviewLog` fields; `submit` / `approve` / `reject` / `revoke` / `setApprovalMode` methods + `computeStatus` helper). Role-policy gate extended with `canSubmit` / `canApprove` / `canReject` / `canRevoke`. |
| **L1d (agent-ui)** | `mountLocalUi(bundle.agent, {staticDir, a2aTLSLayer, extraStaticFiles})` exposes the workspace UI's 7 pages on `127.0.0.1`. |
| **L1e (skill-match)** | Optional in V1; `createTasksAgent({skillMatch})` parameter still works. |
| **L1f (notifier)** | `Notifier` + `InMemoryScheduleStore` + `NoopChannel` for the in-app inbox routing; `UsageMetrics` for Phase 9 counters. Per-recipient `InAppInboxBridge` channels added at runtime via the shared `channels` map. |
| **L1h (identity-resolver)** | `MemberMap` + `MemberMapCache` (Phase 11 lift; auto-persist roster) + `buildOnboardingSkills` (`issueInvite`/`redeemInvite` skill helpers; lifted from Stoop's `onboarding.js`) + `TAXONOMY` / `normaliseTag` / `matchesProfile` (Phase 11 lift; cross-language skill canonicalisation). |
| **`@canopy/local-store`** (NEW substrate, lifted from Stoop 2026-05-08) | `CachingDataSource` + `SyncCadence` + `createSettingsModule` factory bound with Tasks's field schema. |
| **`@canopy/chat-p2p`** (NEW substrate, lifted from Stoop 2026-05-08) | `wireChat({...})` for the Phase 6 appeal flow — peer-to-peer chat thread between previous-assignee and master. |

**SDK direct use** (per `apps/tasks-v0/README.md` "Direct SDK use" section): `core.{Agent, AgentIdentity, VaultMemory, InternalBus, InternalTransport, MemorySource, FileSystemSource, GroupManager, defineSkill, DataPart}`. `GroupManager` is composed by Crew envelope for invite issuance.

**App-side glue (~1100 LOC):**
- `src/Agent.js` — V0 factory.
- `src/Crew.js` — V1 factory wires Crew envelope + every Phase 1-10 substrate composition.
- `src/dag.js` — `computeStatus(task, open, closed)` + `detectCycle`.
- `src/dag-tree.js` — `childrenOf` / `treeOf` / `ancestorChain` / `depthOf` / `wouldCreateParentCycle`.
- `src/rolePolicy.js` — standard 5 roles + Phase 5 DoD gates + Phase 7 narrow exception.
- `src/skills/{index, profile, subtasks, appeal, inbox, workspace, observability, crewControls}.js` — V1 skill set.
- `src/storage/{buildBundle, settings}.js` — local-store + Tasks-bound Settings.
- `src/calendar/iCalReader.js` — local-only calendar conflict view.
- `src/notifications/wireIssuerNotifications.js` — itemStore-event-to-inbox routing.
- `src/observability/{metrics, cadence}.js` — UsageMetrics + cadence resolution.
- `src/bridges/InAppInboxBridge.js` — per-recipient `MessagingBridge` (substrate-candidate flagged).
- `src/lib/{localisation, privacyNotice}.js` — localisation + privacy notice.

**Locked Q-H4.x decisions:**
- Q-H4.1 hybrid pod with per-field merge ✓
- Q-H4.2 optimistic + compare-and-swap claim ✓
- Q-H4.3 push primitive shared with H5 ✓ (push send-half shipped; V1.5 wires the bridge in Tasks)
- Q-H4.4 human-vs-device same primitive ✓
- Q-H4.5 minimal lifecycle (open/claimed/complete/cancelled) ✓ V0; V1 added `submitted` + `rejected` (Phase 5)
- Q-H4.6 per-task `visibility` field ✓
- Q-H4.7 standard 5-role set ✓ (V1.5 adds custom-role UI)
- Q-H4.8 DAG cycle detection at write time ✓
- Q-H4.9 recurring tasks → V1.5+

**V1 design locks (Tasks App/advice-2026-05-07.md):**
- Calendar matching is local-only (no network freebusy skill).
- Calendar sync (Google / Outlook / iCloud) lives in `apps/import-bridge-v0`, not Tasks.
- DoD-with-approver lifecycle landed at the substrate (item-store) layer.
- Sub-task spawn past `crew.subtasksAdminApprovalDepth` queues admin approval.
- Master per task; revoke requires reason; assignee can appeal (7-day window) via chat-p2p.
- In-app inbox first; push behind a feature flag until V1.5 relay-side push lands.
- Local-only mode is a hard rule (works without a Solid pod).
- Crew name "Crew" picked as the working envelope term; app name is "Tasks".

---

## Open work

### Web UI (the biggest V0-incomplete item)

The original sketch called for "Web client (V0 primary surface)". Today H4 ships only a headless skill API — the UI is the next product item. **The infrastructure is the same as H5's V0 web UI** (which shipped Phase 7, 2026-05-04):

- Static HTML/JS in `apps/tasks-v0/web/` served by `mountLocalUi(bundle.agent, {staticDir, a2aTLSLayer: new LocalUiAuth({localActor: webid})})`.
- Browser POSTs to `/tasks/send` directly via `fetch()` — no SDK in the page.
- `LocalUiAuth` shim treats localhost-bound traffic as authenticated for the configured actor (V0 trade-off vs OIDC; V1 swap is cap-token-in-cookie or OIDC-PKCE).
- CLI launcher under `bin/tasks-ui.js` (single-actor — pick a role from the config).

**H4-specific UI views:**
- Task list with status pills (`ready` / `waiting` / `blocked` from `computeStatus`).
- Claim / complete buttons (gated by role; UI surfaces the policy errors).
- Reassign dropdown (admin / coordinator only).
- DAG editor UI — V1+; V0 ships a flat task list that surfaces dependencies as readable tags.
- Audit-log viewer — V1+; substrate-side `auditLog(filter)` exists in ItemStore.
- Role config — V1+; today the role map is a constructor argument.

### Notifier wiring (small, ~10 lines)

`bundle.notifier` is currently `null` by default. To get deadline-reminder + stalled-claim fires:

```js
const notifier = new Notifier({
  channels: { chat: chatAgent.bridge },
  store:    new PodScheduleStore({ podClient, uri: '...' }),
});
const bundle = await createTasksAgent({ roles, pod: ..., notifier });
// Wire deadline-watcher hook on the itemStore:
bundle.itemStore.on('item-added', (item) => {
  if (item.dueAt) {
    notifier.scheduleOnce({
      triggerAt: item.dueAt - 24*60*60*1000,
      recipient: item.assignee ?? item.addedBy,
      channel:   'chat',
      builder:   async () => ({ text: `Due tomorrow: ${item.text}` }),
      cancelKey: `due-nudge-${item.id}`,
    });
  }
});
```

### V1+ scope (unchanged)

- Multi-tenant: friend groups, businesses, neighborhood-mixed-orgs.
- Mobile RN client (composes `@canopy/react-native` metro preset).
- Custom-role config UX (full UI vs. config-file edit).
- Recurring tasks.
- Multi-claim / co-assignment.
- Sub-tasks (one task spawning child tasks).
- Stalled-claim auto-detection (with notifier wired).
- Cross-org integration patterns.
- Optional chat-agent mode (composes L1c on top of the same ledger).

### Substrate-side polish (post-Phase-7 status)

- **L1f `PodScheduleStore`** — substrate-side ✓ (notifier v0.3 → v0.4); needs app-side wiring (see "Notifier wiring" above).
- **`mountLocalUi` operational routes** — for "operational" endpoints (config edit, member admin) that don't fit the skill model, the substrate is intentionally minimal. Apps either (a) wrap the operation in a skill, or (b) compose `mountLocalUi` with a sibling Express server on a different port. V0 H4 fits within skills; V1+ may need (b).
- **Migrate to lifted helpers** — DONE (Phase 3.1, 2026-05-04). H4 consumes `buildIdentitySkills` from `@canopy/identity-resolver` directly; `composeAgent` was deleted (no longer needed — `core.Agent` is the composition root); `ctxActor` was deleted (handlers receive `from` via the SDK dispatch path).

---

## Pod schema (unchanged)

```
<household-pod>/tasks/
  config.json                # household name, members, member-webid map (L1h)
  open/<ulid>.json           # ALL types in one bucket
  closed/yyyy-mm/<ulid>.json
  by-skill/<skill>.jsonl     # cached index for skill-match
  by-assignee/<webid>.jsonl  # cached index for assignee filter
  audit/yyyy-mm.jsonl
```
