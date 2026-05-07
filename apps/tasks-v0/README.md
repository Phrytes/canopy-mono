# H4 — tasks-v0

> **Layer: app.** Composes substrates from `packages/{item-store, agent-ui, ...}`. Direct SDK use is allowed only when justified in this README's `## Direct SDK use` section (per [`app-readme-scheme.md`](../../Project%20Files/conventions/app-readme-scheme.md)). See [`Project Files/conventions/architectural-layering.md`](../../Project%20Files/conventions/architectural-layering.md).

Single-household task ledger with DAG dependencies + skill-based
dispatch + role-aware governance.  Phase C V0 of the substrate-first
plan; thin composition of L1b/L1d/L1e/L1f/L1h substrates.

## What's in here

- **`src/Agent.js`** — the composition.  `createTasksAgent({roles, members | pod, ...})` returns `{agent, itemStore, members, notifier, skillMatch}` — apps register the agent's skills via `agent.skills.register(defineSkill(...))` and expose them over A2A via `mountLocalUi(agent)` from `@canopy/agent-ui`. The factory accepts either a hand-built `members: Array` (tests) or a pod-config-backed `pod: {client, configUri, fallback?}` (production — uses `MemberMap.fromPodConfig`).
- **`src/rolePolicy.js`** — H4's standard 5-role permission table (admin / coordinator / member / observer / external-volunteer).  Plugs into L1b's `RolePolicy` interface.
- **`src/dag.js`** — DAG resolver.  `computeStatus(task, openItems, closedItems)` returns `'ready' | 'waiting' | 'blocked'`; `detectCycle(task, allTasks)` returns the cycle path or null.
- **`src/skills/index.js`** — skill handlers (returned as `defineSkill` shapes ready for `agent.skills.register`): `addTask`, `claimTask`, `completeTask`, `reassignTask`, `removeTask`, `listOpen`, `listMine`, `listClaimable`, `resolveMember`.
- **`web/`** — static HTML/JS for the V0 web UI (`index.html` open-tasks browse + add form with status filter; `mine.html` assigned-to-me + claimable; `app.js` `fetch()`-based A2A client with role-aware controls; `style.css` includes status pills). Served by `mountLocalUi({staticDir})` over the same origin as the A2A endpoints.
- **`bin/tasks-ui.js`** — CLI launcher: `npm run ui -- --actor <webid> --role <role>` (single-member quick-start) or `npm run ui -- --actor <webid> --config <household.json>` (multi-member). Surfaces `tasks-config.json` to the frontend so the UI knows the actor's role.

## Usage

```js
import { createTasksAgent } from '@canopy-app/tasks-v0';
import { mountLocalUi }     from '@canopy/agent-ui';

const bundle = await createTasksAgent({
  roles: {
    'https://id.example/anne':  'admin',
    'https://id.example/frits': 'coordinator',
    'https://id.example/kid':   'member',
  },
  members: [
    { webid: 'https://id.example/anne',  displayName: 'Anne',  role: 'admin' },
    // ...
  ],
});

// Expose skills over A2A's standard wire shape on 127.0.0.1.
// `mountLocalUi` wraps `core.A2ATransport`; clients use
// `LocalAgentClient` (also from @canopy/agent-ui) to call skills
// + subscribe to events via SSE.
const ui = await mountLocalUi(bundle.agent, { port: 8080 });

// Apps subscribe to itemStore / agent events directly:
bundle.itemStore.on('item-added', (item) => { ... });
bundle.agent.on('task-completed', (e)    => { ... });

// On shutdown:
await ui.close();
```

## Substrates

This app composes the following substrate packages
(see [`Project Files/conventions/architectural-layering.md`](../../Project%20Files/conventions/architectural-layering.md)):

| Package | Used for | Why a substrate, not direct SDK |
|---|---|---|
| `@canopy/item-store` (L1b) | Open/closed tasks with attribution + audit + per-field merge contracts; H4 plugs `buildStandardRolePolicy(roles)` into the substrate's role-policy gate. | Pod write paths + per-field merge are shared with H2/H5/H8. |
| `@canopy/skill-match` (L1e) | Pubsub-of-skills claim flow when a skill-tagged task is added (post-Phase 4.2: composes a real `core.Agent` + `core.protocol.pubSub`). | Pubsub-of-skills + posture flag is the H5/H4/H8 shared primitive; deleting the per-substrate fork was the entire reason for the refactor. |
| `@canopy/identity-resolver` (L1h) | webid ↔ Telegram-uid ↔ display-name resolution via `MemberMap`. | Cross-app identity reconciliation. |
| `@canopy/notifier` (L1f) | Deadline reminders, daily digest (apps wire the cadence). | Scheduling + push channel shared with H2/H5/H8. |
| `@canopy/agent-ui` (L1d) | `mountLocalUi(bundle.agent)` exposes skills over A2A's standard wire shape on `127.0.0.1`; the post-Phase 3 path replaces the legacy `SkillRouter` + `EventBroadcaster` shown in the Usage example below. | Localhost-A2A dispatch is shared across H4/H5/H7. |

H4-specific glue is `src/{rolePolicy,dag,skills,Agent}.js` — ~600 LOC total.

## Direct SDK use

| SDK package | Primitive | Used for | Justification |
|---|---|---|---|
| `@canopy/core` | `Agent`, `AgentIdentity`, `VaultMemory`, `InternalBus`, `InternalTransport`, `MemorySource` | Constructing the per-household agent that the substrates compose; `MemorySource` is the default DataSource for `ItemStore`. | No substrate wraps "construct an agent"; `MemorySource` is the in-memory `core.DataSource` concrete (apps swap in a `pod-client.PodClient` adapter for production). |

## Bring it up

```bash
cd apps/tasks-v0
npm install
npm test          # 34 tests (24 integration + 10 web smoke)

# Run the V0 web UI (single-member admin — fastest to play with):
npm run ui -- --actor https://id.example/anne --role admin
# H4 UI ready at http://127.0.0.1:<port>
# Add a task; it appears with status 'ready'. Claim it from /mine.html.

# Multi-member household via config file:
cat > household.json <<'EOF'
{
  "roles":   {
    "https://id.example/anne":  "admin",
    "https://id.example/frits": "coordinator",
    "https://id.example/kid":   "member"
  },
  "members": [
    {"webid": "https://id.example/anne",  "displayName": "Anne",  "role": "admin"},
    {"webid": "https://id.example/frits", "displayName": "the author", "role": "coordinator"},
    {"webid": "https://id.example/kid",   "displayName": "Kid",   "role": "member"}
  ]
}
EOF
npm run ui -- --actor https://id.example/anne --config ./household.json
```

Skill exposure over A2A is via `mountLocalUi` (post-Phase 3) — see Usage above.

## V0 vs V1+

V0 (this package):
- Single household, 4-6 members, high trust.
- Standard 5-role policy.
- DAG dependencies + cycle detection.
- Compare-and-swap claim flow.
- Skill-tagged tasks (via L1e).
- All skills exposed through L1d's REST + SSE.

V1+:
- Mobile RN client.
- Multi-tenant (friend groups, businesses, neighborhood).
- DAG editor UI.
- Custom-roles UI.
- Recurring tasks.
- Multi-claim / co-assignment.
- Notifier wiring with concrete deadline-reminder cadences.

## Test coverage

21 integration tests in `test/integration.test.js` cover:
- Role-policy enforcement on add / claim / complete / reassign / remove.
- DAG dependency resolution (ready / waiting / blocked).
- Cycle detection.
- Compare-and-swap claim races.
- Skill-tagged task filtering (`listClaimable`).
- Member-webid resolution via Telegram uid.
- SkillRouter integration.
- Broadcaster event emission.

## See also

- `Project Files/Substrates/apps/H4-tasks.md` — the app sketch.
- `Project Files/Substrates/L1b-item-store.md` — primary substrate.
- `Project Files/Substrates/policies.md` — rule-of-two methodology.
