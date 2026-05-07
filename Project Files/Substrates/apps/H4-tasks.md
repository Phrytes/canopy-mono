# H4 (tasks) — shared task ledger

| | |
|---|---|
| **Status** | V0 shipped as `apps/tasks-v0`. Substrates fully wired post-Phase 7. Headless API + integration tests done; web UI tracked below. |
| **Code** | `apps/tasks-v0` |
| **Tests** | 24 (21 integration + 3 pod-backed-roster) |
| **Source notes** | `projects/04-tasks-app/README.md`, `coding-plans/track-H-app-tasks.md`, `coding-plans/track-H-app-tasks-questions.md` |
| **App name** | TBD — placeholder: Klus / Beurt / Spar / Ledger |

---

## Current state

**V0 shipped + post-refactor migrated** — `createTasksAgent({roles, members | pod, ...})` factory wires 4 substrates + the SDK directly into a working ledger. Standard 5-role permission table, DAG resolver (`computeStatus`, `detectCycle`), skill-tagged tasks with auto-claim posture. The factory accepts either a hand-built `members: Array` (tests) or a pod-config-backed `pod: {client, configUri, fallback?}` for production deployments — the second path uses `MemberMap.fromPodConfig` (Phase 4.1 contract).

**Substrate consumption (rule-of-two validation pass — post-Phase 7 reality)**:

| Layer | What H4 uses |
|---|---|
| **L1b (item-store)** | Tasks with full schema (DAG deps, skills, due, assignee, visibility); compare-and-swap merge on `assignee`; full role-policy gate. Now `core.DataSource`-shaped (post-Phase 5.2): tests pass `MemorySource`, production wraps `pod-client.PodClient` in a small DataSource adapter. |
| **L1d (agent-ui)** | `mountLocalUi(bundle.agent, {staticDir, a2aTLSLayer})` exposes skills over A2A on `127.0.0.1`. Pre-refactor `SkillRouter` + `EventBroadcaster` were deleted Phase 3.1 — apps subscribe to `bundle.itemStore` directly for events (it extends `core.Emitter`). |
| **L1e (skill-match)** | Pubsub-of-skills; auto-claim on `posture: always`; human prompt on `negotiable`. Composes a real `core.Agent` + `core.protocol.pubSub` directly (Phase 4.2 — synthetic transport deleted). Optional in `createTasksAgent`. |
| **L1f (notifier)** | Deadline reminders; stalled-claim nudges. **Currently optional and not yet auto-wired** — `bundle.notifier` defaults to `null`. Apps that want fires construct a `Notifier` with `PodScheduleStore` (notifier v0.4) and pass via `notifier:`. ~10 lines of glue once an H4 user genuinely wants persistent reminders. |
| **L1h (identity-resolver)** | Member-webid map via `new MemberMap({initial: members})` OR `MemberMap.fromPodConfig({podClient, configUri, fallback?})` (post-Phase 7 — pod-config path wired 2026-05-04). `buildIdentitySkills({members})` registers `resolveMember`. |

**SDK direct use** (per `apps/tasks-v0/README.md` "Direct SDK use" section): `core.{Agent, AgentIdentity, VaultMemory, InternalBus, InternalTransport, MemorySource}` — all foundational primitives, no substrate currently wraps "construct an agent". `mountLocalUi` from `@canopy/agent-ui` exposes the per-app HTTP host.

**App-side glue:**
- DAG resolver (`computeStatus`, `detectCycle`) in `src/dag.js` — pure functions; correctly app-shaped.
- Standard 5-role permission table in `src/rolePolicy.js` — H4 owns the canonical version; ItemStore consumes it via the role-policy gate.
- Skill registry in `src/skills/index.js`: `addTask`, `claimTask`, `completeTask`, `reassignTask`, `removeTask`, `listOpen`, `listMine`, `listClaimable` (+ `resolveMember` from L1h).

**Locked Q-H4.x decisions** (all in V0):
- Q-H4.1 hybrid pod with per-field merge ✓
- Q-H4.2 optimistic + compare-and-swap claim ✓
- Q-H4.3 push primitive shared with H5 ✓ (E2c push send-half shipped Phase 0; receive-half in `@canopy/react-native`)
- Q-H4.4 human-vs-device same primitive ✓
- Q-H4.5 minimal lifecycle (open/claimed/complete/cancelled) ✓
- Q-H4.6 per-task `visibility` field ✓
- Q-H4.7 standard 5-role set ✓
- Q-H4.8 DAG cycle detection at write time ✓
- Q-H4.9 recurring tasks → V1+

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
