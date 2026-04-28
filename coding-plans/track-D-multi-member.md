# Track D — Multi-member infrastructure

| | |
|---|---|
| **Status** | in-progress |
| **Started** | 2026-04-28 |
| **Last updated** | 2026-04-28 — D1 done (posture + humanInTheLoop opts shipped) |
| **Owner** | unassigned |
| **Blocked on** | nothing — fully parallel with Track A from day one |

**Goal:** ship the SDK primitives that multi-member apps
(#2 / #4 / #6 / #7) need: per-skill posture metadata, a
broadcast-of-skills primitive, role-aware groups, and the
hybrid-pod-pattern infra (merge contracts + federated reader).
**This track has no dependency on Track A** — it builds on
already-existing substrate (skills framework, pubSub,
GroupManager) and on pure-function modules.  Up to three devs
can work in parallel from day one.

**Refs:**
- [`../Design-v3/topology-implementation.md` §Track D](../Design-v3/topology-implementation.md#track-d--multi-member-infrastructure)
- [`../Design-v3/topology.md`](../Design-v3/topology.md) — architectural map
- [`../Design-v3/topology.md` §Hybrid pod patterns](../Design-v3/topology.md#hybrid-pod-patterns) — what D4 + D5 implement
- [`../projects/02-neighborhood-app/README.md`](../projects/02-neighborhood-app/README.md) — first consumer of D1 + D2
- [`../projects/04-tasks-app/README.md`](../projects/04-tasks-app/README.md) — first consumer of D3 + D4 + D5
- [`../projects/06-proof-of-location/README.md`](../projects/06-proof-of-location/README.md) — consumer of D1 + D2
- [`../projects/07-household-app/README.md`](../projects/07-household-app/README.md) — consumer of D3 + D5

---

## Track-level open questions

Decide before the relevant task starts.  Update with the
answer when locked.

| #     | Question                                                                                                                                                                                                                                                                      | Answer (when known)                                                                                                                              |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q-D.1 | Role taxonomy: minimal set of standard roles only, or fully app-defined?  Per #4 README open question 7. | **Locked 2026-04-28: minimal standard set (5 roles: admin / coordinator / member / observer / external) + app-defined-extension API for custom role IDs with explicit rank.** |
| Q-D.2 | Skill posture orthogonality.  Two valid shapes: (a) single enum; (b) orthogonal flags. | **Locked 2026-04-28: (b) orthogonal — `posture: 'always' \| 'negotiable'` (default `'always'`) AND `humanInTheLoop: 'never' \| 'either' \| 'required'` (default `'never'`).**  Note `humanInTheLoop` is a 3-value enum, NOT boolean — `'either'` means both humans and machines are valid responders (e.g. summarize-this-text); see Q-D.4 for how this surfaces in topics. |
| Q-D.3 | Federated-reader default failure-mode policy. | **Locked 2026-04-28: `partial-success-with-flag` (read returns `{ merged, failures: [{pod, error}] }`); per-call override via `failurePolicy` opt to `fail-on-any` or `best-effort`.** |
| Q-D.4 | Skills-pubsub topic naming convention. | **Locked 2026-04-28: 5-segment hierarchical with wildcards — `skills:<group-id>:<posture>:<audience>:<skill-id>`.**  `<group-id>` is the group id or `none` for ungrouped.  `<posture>` is `always` or `negotiable`.  `<audience>` is the literal value derived from `humanInTheLoop`: `machine` (`'never'`), `human` (`'required'`), or `either` (`'either'`).  Broadcaster emits ONE message per skill (no fan-out).  Subscribers filter by registering multiple patterns through `D2.subscribeToSkills({ audience })` — e.g. `audience: 'human'` subscribes both `*:*:human:*` and `*:*:either:*` against the same handler.  See §D2 §Sequence for the helper API. |
| Q-D.5 | Per-group revocation vs role demotion as separate primitives. | **Locked 2026-04-28: keep `GroupManager.revokeProof` unchanged (full removal, audit event `member-revoked`); add new atomic `GroupManager.setRole(memberPubKey, newRole)` (issues fresh proof at new role + invalidates old proof in one operation, audit event `member-role-changed`).**  Atomic is non-negotiable — the alternative (caller does `revokeProof + issueProof`) leaves a window where the member is briefly out of the group entirely, which races concurrent auth checks. |

---

## Internal parallelism

```
D1 ── D2
D3 ── (independent)
D4 ── D5 ── ⤳ (cross-track: D5 real testing needs A5)
```

- **D1, D3, D4 are independent.**  Up to three devs from day
  one — no cross-task blocking.
- **D2 depends on D1** (the posture metadata D2 broadcasts has
  to exist first).
- **D5 depends on D4** (uses merge contracts).  D5 can be
  *implemented* against a mock pod-client interface, but
  *real integration testing* needs Track A5 to ship — flag
  this as a cross-track hand-off.
- A team of 1: D1 → D3 → D4 → D2 → D5.
- A team of 2: dev1 = D1 → D2 → (wait for A5) → D5;
  dev2 = D3 → D4 → … (or D3 → D5 if A5 ready).
- A team of 3: dev1 = D1 → D2; dev2 = D3; dev3 = D4 → D5.

---

## Hand-off triggers

| When this completes | These tracks unblock |
|---|---|
| **D1** | D2 starts.  Apps can register human-in-loop skills (some app-side use possible immediately) |
| **D1 + D2** | #2 Neighborhood (skill matchmaking), #6 Proof of location (witness-skill broadcast) substrate ready |
| **D3** | #4 Tasks role-based permissions, #2 closed-group governance, #7 household member roles |
| **D4** | D5 starts.  Apps can use merge contracts directly (without federation) for local-history compaction |
| **D5** | #4 Tasks DAG/work-log split, #7 Household state projection across member pods, the projection half of any future hybrid-pod app |

---

## Tasks

### D1 — Skill posture flag

| | |
|---|---|
| **Status** | done |
| **Tag** | [EXTENDS] `defineSkill` opts |
| **Notes** | Independent.  Decide Q-D.2 before starting. |

**Files:**

```
modify:
  packages/core/src/skills/defineSkill.js                 # add posture + humanInTheLoop opts
  packages/core/src/skills/SkillRegistry.js               # expose posture in queries / get
  packages/core/src/skills/capabilities.js                # advertise posture in agent card

tests (create):
  packages/core/test/skills/posture.test.js
```

**Sequence:**

- [x] 1. **Q-D.2 locked** (see §Track-level open questions): two orthogonal opts.
  - `posture: 'always' | 'negotiable'`, default `'always'`.
  - `humanInTheLoop: 'never' | 'either' | 'required'`, default `'never'`.  Three-value enum, NOT boolean.  `'either'` = both humans and machines are valid responders (e.g. summarize-this-text accepts either).
- [x] 2. Read existing `defineSkill.js` carefully.  Note the existing `policy` and `visibility` opts; the new flags are **orthogonal** to those (policy = authorization, posture/humanInTheLoop = how the request is delivered + who answers).  Mirror the validation pattern.
- [x] 3. Add the two new opts to defineSkill, with validation (reject unknown values; both opts are independent — every (posture, humanInTheLoop) combination is valid, all 6 cells of the 2×3 matrix).
- [x] 4. Store in SkillRegistry alongside other skill metadata.
- [x] 5. Surface in `capabilities.js` so the skill listing in the agent card includes both `posture` and `humanInTheLoop` (peers and D2 consume this).
- [x] 6. Add accessor `SkillRegistry.getByPosture({ posture?, humanInTheLoop? })` (filter helper) for D2 to consume.  Both filters optional; combined as AND.
- [x] 7. Tests: register all 6 (posture, humanInTheLoop) combinations including `'either'`, verify metadata round-trip, verify agent card carries both fields, verify backward-compat (skills registered without the new opts default to `'always'` + `'never'` and pre-existing skill tests still pass).

**DoD:**
- Posture flag accepted, validated, stored, exposed.
- Agent card includes posture for each skill.
- Existing skill tests still pass (backward compat).
- New posture tests cover all three behaviours and the default.

**Notes (team scratchpad):**

```
2026-04-28 — D1 shipped on worktree-agent-a0477fd8aebeb0cec.

  Source changes (additive, backward-compatible):
   • defineSkill.js — two new opts validated independently against
     POSTURES = ['always','negotiable'] and HITL = ['never','either',
     'required'].  Defaults: posture='always', humanInTheLoop='never'.
     Boolean humanInTheLoop is rejected (it is a 3-value enum).
   • SkillRegistry.js — new method
       getByPosture({ posture?, humanInTheLoop? }) → SkillDefinition[]
     AND-combines both filters.  Empty/missing filter ⇒ all skills.
     Helper is intended for D2's bucketing into the topic hierarchy
     `skills:<group-id>:<posture>:<audience>:<skill-id>` (Q-D.4).
   • capabilities._snapshot() additively gained
       skills: [{ id, posture, humanInTheLoop }]
     Pre-existing keys (rendezvous, originSig, relay, oracle, tunnel,
     groups) are unchanged — hello.js and tunnel-test.html consumers
     untouched.

  Test coverage (packages/core/test/skills/posture.test.js, 24 tests):
   • Defaults & validation, including bool-rejection for humanInTheLoop.
   • Full 6-cell matrix (2 postures × 3 humanInTheLoop).
   • Orthogonality with policy + visibility.
   • SkillRegistry round-trip + backward-compat default for legacy skills.
   • SkillRegistry.getByPosture: no-filter, posture-only, hitl-only,
     AND-combined, empty-result, defaults-match.
   • capabilities snapshot: per-skill array shape, all 6 cells covered,
     legacy keys preserved (additive only).

  npm run test:core: all green.  All pre-existing skill tests
  (SkillRegistry.test.js, groupVisibility.test.js, Permissions.test.js,
  capabilities.test.js, skillDiscovery.test.js, features.test.js)
  pass unmodified — backward compat verified.

  Hand-off note for D2 / Q-D.4 audience mapping:
    humanInTheLoop ↔ topic <audience> segment
      'never'    → 'machine'
      'either'   → 'either'
      'required' → 'human'
    Mapping should live in the D2 helper (subscribeToSkills /
    publishToSkills), NOT in core.skills — keeping core unaware of
    pubsub topic conventions.

  Worktree caveat: the worktree-agent-a0477fd8aebeb0cec branch was
  created off `master` (commit c563b98), not off `track-D-multi-member`
  (commit 23947d0).  When merging this work to track-D-multi-member,
  cherry-pick the source/test changes; the §D1 status / checkbox flips
  / scratchpad addition need to be re-applied to the doc on that branch
  by the merger.
```

---

### D2 — Skills pubsub

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [NEW, thin] |
| **Notes** | Depends on D1 (consumes posture metadata).  Decide Q-D.4 before starting. |

**Files:**

```
create:
  packages/core/src/protocol/SkillsPubSub.js
  packages/core/test/protocol/SkillsPubSub.test.js

modify:
  packages/core/src/index.js                              # export SkillsPubSub
```

**Sequence:**

- [x] 1. **Q-D.4 locked** (see §Track-level open questions): 5-segment hierarchical with wildcards — `skills:<group-id>:<posture>:<audience>:<skill-id>`.
  - `<group-id>`: group id (e.g. `my-block`) or literal `none` if the skill isn't group-scoped.
  - `<posture>`: `always` or `negotiable` (from D1).
  - `<audience>`: derived from D1's `humanInTheLoop` — `machine` (`'never'`), `human` (`'required'`), or `either` (`'either'`).  Literal value on the wire — no fan-out.
  - `<skill-id>`: the skill id.
- [ ] 2. **Note: existing `pubSub.js` does not support wildcards** — topics are exact-match strings.  D2 needs to add a pattern-matching layer on top.  Use a simple per-segment `*` wildcard convention (`skills:*:*:human:*` matches any group, any posture, audience `human`, any skill).  No alternation operator needed at the pattern level — `D2.subscribeToSkills` registers multiple patterns when needed.
- [ ] 3. Read existing `packages/core/src/protocol/pubSub.js`.  Plan: D2 keeps its own `Map<pattern, handler[]>` and intercepts incoming `'publish'` events to test patterns; broadcasts go through `pubSub.publish(agent, topic, parts)` unchanged.
- [ ] 4. Implement `broadcastSkill(agent, skillId, { group? = 'none' })` — looks up the skill's `posture` + `humanInTheLoop` in the local SkillRegistry, derives the topic, publishes ONE message with payload `{ skillId, agentId, posture, humanInTheLoop, capabilities, expiresAt }`.
- [ ] 5. Implement `subscribeToSkills(agent, publisherAddress, filter, handler)` where `filter = { skill?, posture?, audience?, group? }`.  Translation rules:
  - `audience: 'human'` → register two patterns: `skills:<group>:<posture>:human:<skill>` AND `skills:<group>:<posture>:either:<skill>` against the same handler.
  - `audience: 'machine'` → `*:machine:*` AND `*:either:*`, same handler.
  - `audience: 'any'` (or unset) → single `*` segment.
  - `audience: 'either-only'` → just `*:either:*` (rare; e.g. an audit tool).
  - Unset filter fields collapse to `*` for that segment.
- [ ] 6. Implement `republishOnSkillChange(agent, opts)` helper: re-broadcasts when the local agent's SkillRegistry mutates.  Optional opt-in to keep network chatter low.
- [ ] 7. Tests: two-agent harness — register skill A with `humanInTheLoop: 'either'` on agent X, subscribe with `audience: 'human'` on agent Y, verify event delivery (the `either` topic matches the human-audience subscription).  Same skill with `audience: 'machine'` filter on agent Z — also receives.  `humanInTheLoop: 'required'` skill broadcast → only `audience: 'human'` (and `'any'`) subscribers receive.  Negative cases.
- [ ] 8. Tests: posture changes after broadcast — `republishOnSkillChange` makes subscribers see the update.

**DoD:**
- Broadcast + subscribe APIs work cross-agent.
- Topic patterns match documented convention.
- Optional auto-republish works when enabled.
- Tests green.

**Notes (team scratchpad):**

```
(empty)
```

---

### D3 — Role-aware groups

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [EXTENDS] `GroupManager.js` |
| **Notes** | Independent.  Decide Q-D.1 + Q-D.5 before starting. |

**Files:**

```
modify:
  packages/core/src/permissions/GroupManager.js           # add role to membership proofs
  packages/core/src/permissions/PolicyEngine.js           # check role in inbound auth
  packages/core/src/permissions/index.js                  # export role constants

create:
  packages/core/src/permissions/Roles.js                  # standard role constants + helpers
  packages/core/test/permissions/RoleAwareGroups.test.js
```

**Sequence:**

- [ ] 1. Lock Q-D.1 (standard set vs app-defined).  Likely: ship five standard roles (`admin`, `coordinator`, `member`, `observer`, `external`) + allow apps to register custom role IDs via a registration API.
- [ ] 2. Lock Q-D.5 (revocation vs demotion).  Likely: `revokeProof` continues to fully invalidate; new `setRole(memberPubKey, newRole)` issues a fresh proof at the new role and invalidates the old one.  Re-issuing is the primitive; demotion is `setRole(_, 'observer')`.
- [ ] 3. Read existing `GroupManager.js` carefully.  Note the proof shape (Ed25519-signed membership proof).  Add a `role` field; existing two-role proofs (`admin`/`member`) stay valid by default.
- [ ] 4. Implement `Roles.js` — exports role constants, `isStandardRole(role)`, `roleRank(role)` (numeric ordering for hierarchy checks), `canPromote(actorRole, targetRole)`.
- [ ] 5. Extend GroupManager: `issueProof({ subject, role, ... })`, `getRole(memberPubKey)`, `setRole(...)`, `listMembersByRole(role)`.
- [ ] 6. Backward compat: existing two-role proofs default to standard roles when read; tests for migration scenarios.
- [ ] 7. Wire into `PolicyEngine.checkInbound` — operations can declare a `requiredRole` constraint; engine reads the caller's group proof and verifies the role matches or exceeds.
- [ ] 8. Tests: role hierarchy ordering, promote/demote, revoke vs demote distinction, custom-role registration, policy-engine integration.

**DoD:**
- Five standard roles + custom role registration.
- Role-aware proof issuance + verification.
- Hierarchy + permission checks via PolicyEngine.
- All existing GroupManager tests still pass.
- Migration of existing admin/member proofs is transparent.

**Notes (team scratchpad):**

```
(empty)
```

---

### D4 — Merge contracts library

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [NEW] |
| **Notes** | Independent.  Pure functions — no I/O, no transport. |

**Files:**

```
create:
  packages/core/src/storage/MergeContracts/index.js
  packages/core/src/storage/MergeContracts/setUnionWithDedupe.js
  packages/core/src/storage/MergeContracts/appendOnlyEventLog.js
  packages/core/src/storage/MergeContracts/lastWriteWins.js
  packages/core/test/storage/MergeContracts.test.js

modify:
  packages/core/src/index.js                              # export MergeContracts
```

**Sequence:**

- [ ] 1. Define the merge-contract interface: `merge(versions: Array<{ value, timestamp, sourceId }>) → mergedValue`.  Each input element comes from one peer's pod read.  Output is whatever the contract decides.
- [ ] 2. Implement `setUnionWithDedupe(versions, opts)`:
  - Each `value` is treated as an array of items.
  - Dedup criterion: equal item hash (or equal value if no hash field configured).
  - On duplicates, keep the highest-timestamp instance.
  - Output: union array, deterministic sort order (item-hash ascending).
- [ ] 3. Implement `appendOnlyEventLog(versions, opts)`:
  - Each `value` is an array of events.
  - Concatenate by event timestamp (ascending).
  - Stable sort: tie-break by `sourceId`.
  - Output: single ordered event array.
- [ ] 4. Implement `lastWriteWins(versions, opts)`:
  - Pick the version with the highest timestamp.
  - Tie-break by `sourceId` lexicographic order.
  - Output: that single value.
- [ ] 5. All three contracts are exported as pure functions plus a `MergeContracts` object that maps name → function.
- [ ] 6. Tests: empty input, single input, identical values, conflicting values, timestamp ties, sourceId ties, large inputs (100+ versions).  Property-based tests if convenient.

**DoD:**
- Three contracts with consistent interface.
- Pure functions; deterministic output for same input.
- Tests cover edge cases.
- Documented usage examples in JSDoc + index.

**Notes (team scratchpad):**

```
(empty)
```

---

### D5 — Federated reader

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [NEW] |
| **Notes** | Depends on D4.  Cross-track: real integration tests need Track A5 (`@canopy/pod-client`) shipped.  Implementation can proceed against a mock PodClient interface; integration tests gated until A5 lands. |

**Files:**

```
create:
  packages/core/src/storage/FederatedReader.js
  packages/core/test/storage/FederatedReader.test.js
```

**Sequence:**

- [ ] 1. Lock Q-D.3 (failure-mode default).  Recommended: `partial-success-with-flag` — read returns `{ merged, failures: [{ pod, error }] }`.  Alternative modes available per-call.
- [ ] 2. Define the `PodClient` shape D5 consumes: minimum interface is `{ read(uri): Promise<{ content, lastModified, ... }> }`.  Document this shape so it's testable with mocks AND swappable with the real Track-A5 PodClient.
- [ ] 3. Implement `FederatedReader` constructor: `new FederatedReader({ pods: Array<PodClient>, mergeContract, failurePolicy = 'partial-success-with-flag' })`.
- [ ] 4. Implement `read(path, opts)`:
  - Parallel-fetch `path` from each pod via `Promise.allSettled`.
  - Collect successes + failures.
  - Apply failure policy.
  - Pass successes to `mergeContract.merge(...)`.
  - Return `{ merged, failures }` (or throw per policy).
- [ ] 5. Caching layer (optional, v1 may skip): per-`(pod, path)` cache with TTL.  Flag `--no-cache` per call.  If skipping, leave a TODO in the file referencing this skip.
- [ ] 6. Failure-mode tests with mock PodClients:
  - All succeed.
  - Some fail → partial-success-with-flag includes failure list.
  - All fail → either return empty merged + all failures (best-effort) or throw (fail-on-any).
  - Concurrent reads don't interfere.
- [ ] 7. Integration test gated on Track A5: real PodClient instances against a CSS pod with multiple containers — confirm end-to-end.  Skip with clear message until A5 lands.

**DoD:**
- Parallel reads work.
- All three failure modes work as documented.
- Merge contract applied correctly.
- Mock-based tests green; integration test skipped-with-message until A5 ready.

**Notes (team scratchpad):**

```
(empty)
```

---

## Cross-track dependencies

- **D5 → A5** — D5's integration tests require `@canopy/pod-client`
  to be shippable against a real CSS pod.  Until then, D5 ships with
  unit tests against a mocked PodClient interface.  When A5 lands,
  add the integration test layer and remove the skip.

No other Track-D task has cross-track dependencies.

---

## Cross-references

- `packages/core/src/permissions/GroupManager.js` — D3 extends this.
- `packages/core/src/permissions/PolicyEngine.js` — D3 wires roles in.
- `packages/core/src/skills/defineSkill.js` — D1 extends this.
- `packages/core/src/skills/SkillRegistry.js` — D1 + D2 consume this.
- `packages/core/src/skills/capabilities.js` — D1 surfaces posture here.
- `packages/core/src/protocol/pubSub.js` — D2 builds on this.
- `Design-v3/topology.md` §Hybrid pod patterns — what D4 + D5 implement.
