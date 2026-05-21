# V2.8 part 2 — single-agent / bundleResolver runbook

> Targeted runbook for the next session. Continues V2.8 part 1 (CHANGELOG `[0.3.7-pre]`, foundation extracted into `MeshAgent.js`). This doc walks through the remaining mechanical refactor: convert every skill builder + Crew.js + tests + CLI/UI to the bundleResolver shape. Mirrors Stoop's 2026-05-08 single-agent refactor in full.
>
> **Current state:** 319/319 tests green. `apps/tasks-v0/src/MeshAgent.js` exists; `createTasksAgent` delegates to `buildMeshAgent`. **Nothing else V2.8-shaped exists yet.**

## Pre-session checklist

- [ ] Confirm 319/319 tests pass on a fresh `npx vitest run`.
- [ ] Read `Project Files/Stoop/single-agent-refactor-2026-05-08.md` § "Tasks-app fix propagation" for the canonical handoff.
- [ ] Have `Project Files/Tasks App/coding-plan-v2-2026-05-08.md` § "Phase V2.8" open for reference.
- [ ] Set aside ~3-4 hours uninterrupted (this is a 17-file refactor — mid-session breakage cascades).

## The CrewState contract

Every skill body resolves a `CrewState` via `bundleResolver(parts, ctx) → CrewState | null`. The CrewState exposes:

| Field | Type | Replaces (closure-captured today) |
|---|---|---|
| `crew.crewId` | string | (was `liveCrew.crewId`) |
| `crew.liveCrew` | object (frozen CrewConfig) | `crewProvider()` |
| `crew.crewMutator(patch)` | function | `crewMutator(patch)` |
| `crew.roles` | `{[webid]: roleId}` | `roles` map |
| `crew.itemStore` | ItemStore | `itemStore` / `store` |
| `crew.dataSource` | core.DataSource | `dataSource` (the local-store cache) |
| `crew.members` | MemberMap | `members` |
| `crew.notifierChannels` | object (mutable map) | `notifierChannels` |
| `crew.botAgentRegistry` | BotAgentRegistry | (V1.5 — `botAgentRegistry`) |
| `crew.chatController` | wireChat result | `chatController` |
| `crew.notifier` | Notifier | (used by issuerNotify wiring; not by skills directly) |

Helper accessors for ergonomic skill bodies:
- `crew.roleOf = (actor) => crew.roles?.[actor]`

## Per-skill-body pattern (the mechanical edit)

Every `defineSkill` body opens with:

```js
defineSkill('whatever', async ({ parts, from, envelope, actorDisplayName }) => {
  const crew = bundleResolver(parts, { envelope, from });
  if (!crew) return { error: 'crewId required' };

  // existing body, with:
  //   itemStore  → crew.itemStore
  //   store      → crew.itemStore  (if `index.js` calls it `store`)
  //   crewProvider() → crew.liveCrew
  //   crewMutator(p) → crew.crewMutator(p)
  //   roleOf(actor)  → crew.roles?.[actor]   (or crew.roleOf(actor))
  //   dataSource     → crew.dataSource
  //   members        → crew.members
  //   chatController → crew.chatController
  //   botAgentRegistry → crew.botAgentRegistry
}, { ... }),
```

Skill builder signature (every file):

```js
export function buildXxxSkills({ bundleResolver } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildXxxSkills: bundleResolver(parts, ctx) required');
  }
  return [ ... ];
}
```

## File-by-file checklist (~17 files)

Order (smallest first to validate the pattern; the big ones at the bottom):

1. [ ] `src/skills/forceComplete.js` — 1 skill (`forceCompleteTask`).
2. [ ] `src/skills/appeal.js` — 1 skill (`appealTask`). Uses `crew.itemStore` + `crew.chatController`.
3. [ ] `src/skills/profile.js` — 2 skills. Uses `crew.dataSource` + `crew.crewId`. The args.crewId field becomes redundant (still accept it but prefer `crew.crewId`).
4. [ ] `src/skills/crewControls.js` — 5 skills. Uses `crew.liveCrew` + `crew.crewMutator` + `crew.roles`.
5. [ ] `src/skills/customRoles.js` — 3 skills. Same.
6. [ ] `src/skills/botBindings.js` — 5 skills (V1.5). Uses `crew.liveCrew` + `crew.botAgentRegistry`.
7. [ ] `src/skills/calendarEmission.js` — 3 skills (V2.1). Uses `crew.liveCrew` + `crew.crewMutator`. `onChange` callback stays (it's how Crew.js re-wires the per-member emission loop).
8. [ ] `src/skills/invoicing.js` — 3 skills (V2.2). Uses `crew.dataSource` + `crew.liveCrew` + `crew.crewMutator` + `crew.roles`.
9. [ ] `src/skills/availability.js` — 5 skills (V2.3). Uses `crew.dataSource` + `crew.liveCrew` + `crew.crewMutator` + `crew.roles`.
10. [ ] `src/skills/planner.js` — 3 skills (V2.4). Uses `crew.itemStore` + `crew.dataSource` + `crew.liveCrew`.
11. [ ] `src/skills/inbox.js` — uses `crew.dataSource`. (Plus the inbox bridge — that's wired in Crew.js, not in skill bodies.)
12. [ ] `src/skills/workspace.js` — uses `crew.itemStore` + `crew.roles`.
13. [ ] `src/skills/observability.js` — uses `crew.liveCrew` + `crew.crewMutator` + various tracker/userSettings deps. Heavier refactor — the tracker is per-CrewState; pull it onto the CrewState as `crew.metricsTracker`.
14. [ ] `src/skills/subtasks.js` — 6 skills incl. V2.7's propose flow. Uses `crew.itemStore` + `crew.liveCrew` + `crew.roles`. The PROPOSAL_TYPE export stays.
15. [ ] `src/skills/index.js` — 13+ skills (the main task surface). Biggest single file. `store` → `crew.itemStore`; `_crew()` → `crew.liveCrew`.
16. [ ] `src/skills/dashboard.js` — special: takes `crewBundlesProvider` (already a multi-crew shape). Refactor to use the shared `crews` Map directly via the wireSkills helper.
17. [ ] `src/bot/skills.js` — 18 skills. Each uses `effectiveActor({from, envelope})`. Wraps underlying skills via `callUnderlying`. Refactor `callUnderlying` to ALSO inject `crewId` into the inner skill's args (so the inner skill's bundleResolver picks the right crew).

## After all builders are done — wire it together

1. [ ] **Crew.js refactor:**
   - Add `buildCrewState({meshAgent, crewConfig, localStoreBundle, ...})` — creates the CrewState (no agent inside, no skill registrations).
   - `createCrewAgent` becomes a single-crew convenience wrapper: builds meshAgent via `buildMeshAgent`, builds CrewState via `buildCrewState`, registers skills via `wireSkills` with `singleCrewResolver(crewState)`. Returns the same bundle shape today's tests expect (with `bundle.agent = meshAgent`, `bundle.itemStore = crewState.itemStore`, etc.).
2. [ ] **`src/wireSkills.js`** (already drafted in the part-1 spike — re-add). Imports every builder; takes `{meshAgent, bundleResolver, crewsIter?, opts?}`; registers all skills once.
3. [ ] **`src/bundleResolver.js`** (extract from wireSkills): exports `singleCrewResolver(crewState)` + `multiCrewResolver(crews: Map)`.
4. [ ] **`bin/tasks-ui.js`:**
   - For `--crew` (single): build meshAgent once, build one CrewState, wire skills with singleCrewResolver.
   - For `--crew-list` (multi): build meshAgent once, build N CrewStates, wire skills with multiCrewResolver.
5. [ ] **`web/app.js`'s `callSkill`:** auto-inject `crewId` into every args object from `tasks-config.json` (which already carries `crew.crewId`).

## Tests

1. [ ] Existing tests should keep passing — they all go through `createCrewAgent`, which uses `singleCrewResolver`. The single-crew resolver doesn't require `crewId` in args.
2. [ ] **Confirmed: no test calls a skill builder directly** — every test uses `createCrewAgent`. So the test impact is zero in single-crew mode.
3. [ ] **New test:** `test/v2_8-single-agent.test.js`. Asserts:
   - Two crews on one meshAgent — calls with different `crewId` land in the right ItemStore.
   - Strict resolution — call without `crewId` AND without a topic envelope returns `{error: 'crewId required'}` (in multi-crew mode only).
   - Cross-crew leakage impossible — KID (member of crew A only) calling `listOpen` with `crewId: 'crew-b'` returns... actually the role policy denies them, but bundleResolver itself happily resolves crew-b. The cross-crew gate is the role-policy check inside the skill body. Verify it.

## Wrinkles I discovered during the part-1 spike (avoid these traps)

1. **`buildIdentitySkills` already supports `getBundle`** (Stoop landed it). When wireSkills imports it, pass `getBundle: (args, ctx) => bundleResolver(_argsToParts(args), ctx)` instead of writing a MemberMap proxy. The substrate already does the right thing.

2. **CrewState cache vs isolation.** `crew.dataSource` is the local-store cache shared across crews (one process, one Map). Each crew's ItemStore writes to a per-crew prefix. That keeps isolation despite a shared cache.

3. **Botskills `callUnderlying` needs crewId injection.** Today it calls `agent.skills.get(skillId).handler({parts, from, agent, envelope: null, actorDisplayName})`. After V2.8 the inner skill's `bundleResolver(parts, ...)` won't find a crewId in `parts`. Fix: `callUnderlying` builds parts with `[{type: 'DataPart', data: {crewId: <resolved-crew-id>, ...args}}]`. Resolved crew comes from the bot skill's own bundleResolver call.

4. **Tests that bypass createCrewAgent** — none today, but the new `v2_8-single-agent.test.js` will. It needs to construct meshAgent + crews + wireSkills directly.

5. **`buildBotAgentRegistry` — V1.5 cap-token bot agents.** They're per-binding agents that share the bus with the meshAgent. Their cap-tokens validate against the meshAgent's PolicyEngine. After V2.8 refactor, the registry stays per-CrewState (each crew has its own bindings). Verify V1.5 cap-token tests still pass.

6. **Force-complete + force-spawn audit overrides** — V2.7's `actionOverride` ctx passthrough through ItemStore is unaffected. Skill bodies just need to call `crew.itemStore.markComplete(..., {actionOverride, reason})` — same shape as today.

7. **`PROPOSAL_TYPE` export from subtasks.js** — Crew.js imports it for the listener. After V2.8 the listener still attaches per-crew (in `buildCrewState`); the import stays.

## Acceptance for V2.8 part 2 to ship

- [ ] All 319 existing tests pass unchanged.
- [ ] New `v2_8-single-agent.test.js` adds ~5 tests covering multi-crew + strict-resolution + cross-crew isolation.
- [ ] `bin/tasks-ui.js` smoke: launch with `--crew` (one crew, one process, one agent observable via `process.listeners('msg:*')` count or `meshAgent.address`).
- [ ] `bin/tasks-ui.js --crew-list <path>` smoke: launch with two crews, ONE meshAgent, two CrewStates, both work.
- [ ] CHANGELOG bumped to `[0.3.7]` (drops the `-pre` suffix).
- [ ] `apps/stoop` full suite still passes (Stoop's items don't use `dependencies[]` — V2.8 has no impact).

## What this enables

After V2.8 part 2 ships:
- Tasks-mobile Phase 41.2 ServiceContext can `import { buildMeshAgent, buildCrewState, wireSkills, multiCrewResolver }` from `apps/tasks-v0` and have the V2.8 shape from day one.
- Multi-crew CLI launches stop spinning N agents (today's V2.5 path).
- The path is ready to absorb a future `@canopy/scoped-skill-bus` lift if Stoop or another app ends up needing the same factory shape.
