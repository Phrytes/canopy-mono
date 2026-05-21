# L1d Phase 3.1 — apps rewrite handoff

> **Status update 2026-05-04 (later in same session):** This doc was
> drafted before Phase 3.1 started; significant progress has since
> landed. Current state:
>
> - ✅ `buildIdentitySkills` migrated to `defineSkill` shape.
> - ✅ `apps/neighborhood-v0` migrated to real `core.Agent`. 9/9 tests pass.
> - ✅ `apps/tasks-v0` migrated to real `core.Agent`. 21/21 tests pass.
> - ⏳ `apps/archive` (third consumer; audit missed it) still uses
>   `SkillRouter` + `EventBroadcaster`. **Blocks legacy primitive deletion.**
> - ⏳ Legacy primitives still exported as deprecated shims.
>
> Next session: migrate `apps/archive`, then run the deletion sweep
> at the bottom of this doc.

| | |
|---|---|
| **Phase** | 3.1 of `01-Execution-Checklist.md` |
| **Estimated effort** | ~2 days tasks-v0 + ~1 day neighborhood-v0 |
| **Status** | NOT STARTED. Phase 3.0 / 3.2 / 3.4 / e2e test all DONE 2026-05-04. |
| **Authoritative spec** | [`./L1d-agent-ui-refactor.md`](./L1d-agent-ui-refactor.md) — read § "Refactor plan" Phase 1 + "Migration path for downstream consumers" |

---

## What's already in place (verify before starting)

```bash
# These files exist:
ls packages/agent-ui/src/server/mountLocalUi.js
ls packages/agent-ui/src/client/LocalAgentClient.js

# These exports are live:
grep -n "mountLocalUi\|LocalAgentClient" packages/agent-ui/src/index.js \
  packages/agent-ui/src/server/index.js \
  packages/agent-ui/src/client/index.js

# Tests pass:
cd packages/agent-ui && npm test    # 33/33 expected
```

If any of those fail, something has drifted since 2026-05-04 — read this
session's commits (or the decision log in `01-Execution-Checklist.md`)
before continuing.

---

## Migration sequence

Do **neighborhood-v0 first** (smaller — fewer skills, no DAG, no role
policy). Tasks-v0 second after neighborhood-v0 confirms the pattern.

### Step 1 — neighborhood-v0 Agent rewrite

**File:** `apps/neighborhood-v0/src/Agent.js`

**Current state (2026-05-04):**
- Imports: `composeAgent` from `@canopy/agent-ui`, `buildIdentitySkills` from `@canopy/identity-resolver`, `SkillMatch` from `@canopy/skill-match`.
- Builds a synthetic `agent = {invokeSkill}` shape via `composeAgent`.
- Returns a bundle with `agent`, `itemStore`, `members`, `skillMatch`, `notifier`, `broadcaster`, `skills`, `buildRouter`.

**Target state:**
- Construct a real `core.Agent` via `Agent.createNew({transport, label})` (use `InternalTransport` for in-process; the UI layer will spin up `A2ATransport` separately when an app wants HTTP exposure).
- Register each skill via `agent.register(id, handler, {visibility, ...})` instead of building a `{[id]: handler}` map.
- Drop the `broadcaster` field from the returned bundle. Apps that need fan-out events register a streaming skill (`async function*`) and let the client open `POST /tasks/sendSubscribe`. See L1d audit § Phase 3 (in `L1d-agent-ui-refactor.md`).
- Drop `buildRouter`. The HTTP exposure is `mountLocalUi(agent, opts)` called from the consuming app (or test).

**Key API differences when rewriting skill handlers:**

| Old signature                            | New signature                                                  |
|------------------------------------------|----------------------------------------------------------------|
| `async (args, ctx) => result`            | `async ({ parts, from, agent, claims }) => Parts.wrap(result)` |
| `args` = JSON object                     | `parts` = Part[] from `Parts` (TextPart / DataPart / ...)      |
| `ctx.actor.webid`                        | `claims?.sub` (WebID lives in claims after A2AAuth.validateInbound) |
| `ctx.actor.displayName`                  | Resolve via `MemberMap` from `from`/`claims.sub`               |
| Returns a JSON object                    | Returns `Part[]` (use `Parts.wrap(jsonObj)` if convenient)     |

**Mapping for each existing skill:**

| Skill           | Old: args           | New: input parts                              | Old: returns        | New: returns Parts |
|-----------------|---------------------|-----------------------------------------------|---------------------|--------------------|
| `postRequest`   | `{text, requiredSkills, timeoutMs?, expectClaims?}` | one `DataPart` with same fields | `{requestId, claims}` | `[DataPart({requestId, claims})]` |
| `acceptResponder` | `{requestId, responderWebid}` | one `DataPart` | `{request}` or `{error, current}` | `[DataPart(...)]` |
| `cancelRequest` | `{requestId}`       | one `DataPart`                                | `{id}`              | `[DataPart({id})]` |
| `listMyRequests`| `{}`                | `[]` (no input)                               | `{items}`           | `[DataPart({items})]` |
| `listOpen`      | `{skill?}`          | one `DataPart` (optional)                     | `{items}`           | `[DataPart({items})]` |
| `resolveMember` (from L1h) | `{webid}` or `{externalIdNs, externalIdValue}` | one `DataPart` | `{member}` | `[DataPart({member})]` |

The `actor.webid` reads inside `postRequest` etc. need to be replaced
with `claims?.sub`. There's no `displayName` in claims by default —
either (a) drop the displayName field from item-store records (it's
redundant with `MemberMap.resolveByWebid(webid).displayName`), or
(b) the app resolves it before calling `store.addItems`. Recommend (a)
— the substrate audit's L1b/L1h findings already note this duplication.

**buildIdentitySkills migration:**
The existing `buildIdentitySkills({members})` returns
`{resolveMember: (args, ctx) => ...}` (old shape). It needs to migrate
to `defineSkill`-shape handlers. Two options:

1. Rewrite `buildIdentitySkills` in `@canopy/identity-resolver` to
   return `defineSkill(...)` definitions. (The Phase 1 lift was correct
   in spirit but used the wrong signature.) Migrate H4/H5 in lockstep.
2. Inline the skill registration in each consuming app's `Agent.js`:
   ```js
   agent.register('resolveMember', async ({ parts }) => {
     const args = Parts.data(parts).data ?? {};
     // ... existing logic ...
     return Parts.wrap({ member: ... });
   });
   ```

Recommend (1) — keeps the rule-of-two payoff intact.

**Result returned by `createNeighborhoodAgent`:**
- `{agent, itemStore, members, skillMatch, notifier?, skills}` — drop
  `broadcaster` and `buildRouter`. UI hosts call `mountLocalUi(agent, ...)`
  themselves.

**Tests:** `apps/neighborhood-v0/test/integration.test.js` will need
significant rewrites — the current tests pass `{actor: {webid, displayName}}`
through `agent.invokeSkill`. The new tests call
`agent.invoke(targetPubKey, skillId, parts)` or invoke via
`mountLocalUi` + `LocalAgentClient` for the HTTP path. The 9 existing
integration tests must all still pass.

### Step 2 — neighborhood-v0 verify

```bash
cd apps/neighborhood-v0
npm install --legacy-peer-deps
npm test                         # 9/9 must pass
```

### Step 3 — tasks-v0 Agent rewrite

Same pattern as neighborhood-v0, larger scope. Key differences:

- **Role policy.** `apps/tasks-v0/src/rolePolicy.js` builds a
  per-action role-permission table that's currently passed to
  `ItemStore` directly. After the rewrite, this should be expressed
  via `defineSkill({requiredRole, ...})` per-skill, OR via a custom
  `PolicyEngine` injected into the `core.Agent` (recommended). Per
  L1d audit § Cross-substrate dependencies.
- **DAG cycle detection.** `apps/tasks-v0/src/dag.js` is pure
  functions — they stay. The skills that call them (`addTask`, etc.)
  rewrite around the same way as neighborhood-v0.
- **More skills:** `addTask`, `claimTask`, `completeTask`, `reassignTask`,
  `removeTask`, `listOpen`, `listMine`, `listClaimable`, `resolveMember`.

**Tests:** `apps/tasks-v0/test/` has 21 tests. Same approach — rewrite
to either use the real `Agent.invoke(...)` API or mountLocalUi+LocalAgentClient.
All 21 must pass.

### Step 4 — Delete legacy primitives

Once neighborhood-v0 + tasks-v0 are migrated and their tests pass:

```bash
# Delete from packages/agent-ui:
rm packages/agent-ui/src/server/SkillRouter.js
rm packages/agent-ui/src/server/EventBroadcaster.js
rm packages/agent-ui/src/server/ctxActor.js
rm packages/agent-ui/src/server/composeAgent.js
rm packages/agent-ui/src/client/AgentUiClient.js

# Delete tests:
rm packages/agent-ui/test/SkillRouter.test.js
rm packages/agent-ui/test/EventBroadcaster.test.js
rm packages/agent-ui/test/ctxActor.test.js
rm packages/agent-ui/test/composeAgent.test.js
rm packages/agent-ui/test/AgentUiClient.test.js
```

Update `packages/agent-ui/src/index.js`, `src/server/index.js`,
`src/client/index.js` to remove the deleted exports. Final exports:

```js
// src/index.js
export { mountLocalUi }     from './server/mountLocalUi.js';
export { LocalAgentClient } from './client/LocalAgentClient.js';
```

Run `cd packages/agent-ui && npm test` — should be 8/8
(`mountLocalUi.test.js`).

### Step 5 — Update L1d sketch + checklist

- Mark Phase 3 complete in `Project Files/Substrates/refactor/01-Execution-Checklist.md`.
- Append to the decision log.
- Cross-link from `apps/tasks-v0/README.md` and `apps/neighborhood-v0/README.md`
  per the app-README scheme (Phase 6.5).

---

## Pitfalls / things that can go wrong

1. **`Parts.wrap(undefined)`** returns `[]` — make sure skill handlers
   return something explicit. Empty handler `async () => {}` → 0-part
   result, which the client can handle but tests may not expect.

2. **`agent.start()` must be awaited** before `mountLocalUi` —
   otherwise the agent's skill registry isn't ready.

3. **`InternalTransport` requires an `InternalBus`** for testing.
   Pattern from `packages/core/test/A2A.test.js:26-32`:
   ```js
   const id = await AgentIdentity.generate(new VaultMemory());
   const bus = new InternalBus();
   const transport = new InternalTransport(bus, id.pubKey);
   const agent = new Agent({ identity: id, transport, label: 'X' });
   await agent.start();
   ```

4. **`agent.register(skillDef)`** can take a full `defineSkill` object
   OR `register(id, handler, opts)` shorthand. Either works; pick the
   one that matches the audit's recommended pattern (`defineSkill`).

5. **Item-store's `actor.webid` reads** are deeply embedded. When
   migrating, audit every `addItems` / `claim` / `markComplete` call —
   the `actor` field shape needs to change from `{webid, displayName}`
   to `webid`-string-only OR continue to be `{webid}` (claims-derived).

6. **Tests that mock `agent.invokeSkill`** will break completely —
   that method doesn't exist on `core.Agent`. Mock `agent.invoke`
   instead, or stand up a real Agent in tests.

---

## What "Phase 3.1 done" looks like

- All legacy primitives deleted from `packages/agent-ui/`.
- Both apps run on real `core.Agent` instances via `mountLocalUi` for
  HTTP exposure.
- All app integration tests still pass (9 + 21).
- `01-Execution-Checklist.md` Phase 3 box checked.
