# Single-Agent / Per-Group-State Refactor

**Date:** 2026-05-08
**Status:** Plan, awaiting implementation go-ahead.
**Authors:** the author + Claude (chat session 2026-05-08).

---

## Background

Cross-device bring-up testing on `apps/stoop-mobile` revealed that
each joined group built its own `core.Agent` (via `buildMeshAgent`)
with its own InternalTransport + MdnsTransport + RelayTransport +
PeerGraph + RoutingStrategy.

So a phone with N joined groups (incl. transient bootstrap) ran N
agents × 3 transports each: 4 WebSocket connections to the relay
broker registered under the same pubkey, 4 mDNS service registrations
shouting the same hostname, multiplied native callbacks, etc.

Functionally things worked once we hammered out routing and pubsub
bugs, but it was visibly wasteful and the relay log made it
confusing to reason about.

The repo's design intent — confirmed by the user in this session —
is **one `core.Agent` per service-context, with transports as
routes plugged into that one agent's `RoutingStrategy`.** Stoop's
mobile wiring drifted from this. Other apps (`mesh-demo`,
`folio-mobile`) already follow it. This doc plans the rebuild + the
convention to keep future apps from making the same mistake.

---

## Functional sketch

```
ServiceContext (per app process)
├── meshAgent ← ONE for the app
│     ├── transports (RoutingStrategy picks per-peer):
│     │     ├── InternalTransport (primary; self-loop)
│     │     ├── MdnsTransport     (one registration; LAN reach)
│     │     ├── RelayTransport    (one WebSocket; cross-network)
│     │     └── future: BLE, Rendezvous, NKN…
│     ├── PeerGraph (single, cumulative across groups)
│     ├── identity (single user identity for this app process)
│     └── skills (registered ONCE; group-aware dispatch)
│
├── groups: Map<groupId, GroupState>
│     GroupState (× N, per joined group):
│       itemStore       group-scoped, backed by per-group cache prefix
│       members         MemberMap, group-scoped
│       skillMatch      subscribes to <groupId>/requests on shared agent
│       mirror          subscribes to peers' <groupId>/requests, mirrors → itemStore
│       reveals         per-group bilateral-reveal state
│       evictionRoster  per-group
│       settings, chat, …
│       (NO agent, NO transports of its own)
│
└── activeGroupId
```

**Skill dispatch — group-aware (the key design point).**

Stoop skills register ONCE on `meshAgent.skills`. Each skill's body
resolves the relevant `GroupState` at dispatch time via a
`bundleResolver(args, ctx) → GroupState | null` closure provided at
registration. Resolution order:

1. If `args.groupId` is set → `groups.get(args.groupId)`.
2. Else if `ctx.envelope.topic` matches `<groupId>/…` →
   `groups.get(<groupId>)`.
3. **Strict fallback** (Q1 lock-in): otherwise return `null`; the
   skill replies `{error: 'groupId required'}`. No silent fall-back
   to active.

UI calls (`useSkill`) inject `svc.activeGroupId` into every args
object automatically so direct user actions always carry the
groupId. Inbound peer envelopes carry it via the SkillMatch topic
or via an explicit `args.groupId` for direct calls (chat,
attachment-fetch, etc.).

**Per-group state stays per-group.** Mirror and SkillMatch are
unchanged — each instance subscribes to its own group's topic and
writes to its own ItemStore. They're not part of the skill-bus
dispatch; they're agent-level pubsub listeners with closures bound
to their own group at construction. Cross-group concurrency works
naturally: a chat message arriving from a peer in group A while
the user is focused on group B still lands in group A's bundle.

---

## Code plan (phases)

### Phase 1 — `core` additions (~30 min)

- `SkillRegistry.replace(def)` — atomic `unregister(name)` +
  `register(def)`. Cheap; useful for hot-swap during development
  even after group-aware dispatch lands.
- Audit `SkillRegistry.unregister(name)` — expose if not already
  public.
- Expose both via `agent.skills`.

No changes to transports / RoutingStrategy / Agent.transportFor —
those are already correct after this session's earlier fixes.

### Phase 2 — `apps/stoop`'s `buildSkills` rewrite (~3-4 h, the bulk)

Signature change:

```js
// Before
buildSkills({ store, skillMatch, mirror, members, muted, localActor, groupId, ... })

// After
buildSkills({ bundleResolver, agent, ... cross-bundle deps ... })
```

Each skill body:

```js
defineSkill('listOpen', async ({ parts, from, envelope }) => {
  const args   = dataArgs(parts);
  const bundle = bundleResolver(args, { envelope, from });
  if (!bundle) return { error: 'unknown-group' };
  const open   = await bundle.store.listOpen(filter);
  return { items: await hydrateItems(open, {
    members:    bundle.members,
    reveals:    bundle.reveals,
    viewerWebid: from,
    groupId:    bundle.groupId,
  })};
});
```

Mechanical pass over every defineSkill — they all resolve the
bundle from args/ctx instead of closing over a single one.

**Stoop test side**: testbed (`apps/stoop/bin/stoop-testbed.js`) +
the integration tests get a thin facelift — instead of constructing
N agents in one process they construct one agent + N group-states.
Same end-to-end behaviour, fewer in-flight Agents.

### Phase 3 — `apps/stoop-mobile/ServiceContext` rebuild (~1-2 h)

- ServiceContext builds ONE `meshAgent` at boot:
  ```js
  meshAgent = await buildMeshAgent({ identity, ... });
  ```
- `buildBundleForGroup` renamed → `buildGroupState({ meshAgent, ... })`,
  no longer creates an Agent / transports / PeerGraph.
- `buildBootstrapBundle` becomes `buildGroupState({ meshAgent,
  groupId: '_bootstrap', ... })`.
- `relabelBundleGroup` deleted; first-group transition is
  ```js
  const newState = await buildGroupState({ meshAgent, groupId, ... });
  groups.set(groupId, newState);
  groups.delete('_bootstrap');
  ```
  with item-store / member-map content carried over inline.
- Skills register on the meshAgent ONCE at boot:
  ```js
  for (const def of buildSkills({
    bundleResolver: (args) => groups.get(args.groupId)?.bundle ?? null,
    ...
  })) meshAgent.skills.register(def);
  ```
- `useSkill` injects `groupId: svc.activeGroupId` into every args
  object that doesn't already carry one.

### Phase 4 — other RN apps (~30 min audit)

- `mesh-demo` — already correct (single agent via `createMeshAgent`).
- `folio-mobile` — already correct (per-account, single agent).
- `tasks-v0` — no mobile shell yet; future Tasks-mobile bring-up
  follows the same pattern by reading the convention doc.

### Phase 5 — documentation rollout (~30 min)

- **`README.md`** (repo root) — new "Architecture" section.
- **`Project Files/conventions/single-agent.md`** (new) — full rule
  + rationale + rule-of-two on lifting to substrate.
- **`apps/stoop-mobile/README.md`** — short reminder under
  Architecture section.
- **`apps/folio-mobile/README.md`** — same.
- **`apps/mesh-demo/README.md`** — same.
- **`apps/tasks-v0/README.md`** — same (it's the next likely
  consumer of the pattern).
- **`packages/react-native/docs/BRING-UP-NOTES.md`** — new
  "Trap: per-bundle agent" entry linking to the convention.

### Phase 6 — orphan cleanup (~15 min)

On first boot of the refactored ServiceContext, scan AsyncStorage
for stale per-group PeerGraph keys (`stoop:peers:<groupId>:…`) and
delete them in one pass. New code uses `stoop:peers:…` (no group
suffix) as a single namespace. Tracked under a "v3-migrated"
boolean so the cleanup runs once.

---

## Open questions (resolved)

**Q1 — `bundleResolver` fallback when no groupId.** **Strict.**
Skill replies `{error: 'groupId required'}` if neither args nor
topic provides it. Fewer footguns; UI always knows the active
group; peer envelopes always carry it.

**Q2 — Orphaned per-group PeerGraph data.** **Clean up.** One-time
cleanup pass on first boot of the new code. No reason to retain.
Substrate lift of the per-group state pattern itself: deferred
until a second consumer (likely Tasks-mobile) needs it — rule of
two.

---

## Convention text (for the docs)

> **Single-agent rule.** Each app's service-context owns exactly
> ONE `core.Agent` instance. Transports (mDNS / BLE / relay /
> rendezvous / NKN / …) are routes plugged into that one agent
> via `addTransport()` + `RoutingStrategy`. Apps with multiple
> scopes (groups, accounts, projects, …) maintain per-scope state
> outside the agent — typically a `Map<scopeId, ScopeState>` where
> each ScopeState has its own ItemStore / MemberMap / SkillMatch /
> mirror but references the shared agent.
>
> Skills register on the agent ONCE with a `bundleResolver` (or
> equivalent context-resolver) so dispatch picks the right scope
> based on the call's args / topic.
>
> **Anti-pattern:** spinning up N agents to model N scopes. This
> creates N transport stacks, N mDNS registrations, N relay
> connections, and N PeerGraphs — wasteful, racy, and confusing
> in transport-level logs.

---

## Risks

- `buildSkills` is large (~2k lines of Stoop-specific skill code).
  The mechanical rewrite is straightforward but tedious; risk of
  mistakes is in skills with subtle closure dependencies on
  `localActor` / `groupId` that the bundleResolver doesn't
  immediately surface. Mitigation: test pass after every batch of
  ~20 skills.
- Stoop's existing tests assume the old N-agent shape. Most
  rewrite to the new shape cleanly (one agent + N group-states is
  the same behaviour); a few that exercise per-agent identities
  may need a small reshape.

---

## When to start

After the user confirms the plan with an explicit "go". Estimate:
~6-8 hours wall-clock. Phases 1-3 are the load-bearing work; 4-6
are short.

---

## Tasks-app fix propagation (handoff)

This section is for whoever picks up `apps/tasks-v0` next — likely
the Tasks-mobile bring-up. **Read it before adding any RN /
multi-crew shell on top of `createCrewAgent`.**

### Why this is relevant to Tasks

`apps/tasks-v0/src/Crew.js#createCrewAgent` mirrors Stoop's
`createNeighborhoodAgent`: it takes a single `transport` and
constructs one `core.Agent` per crew. That's fine for the current
single-crew CLI tests. **It's a trap the moment Tasks gains:**

- a mobile / multi-crew shell (one user, several crews active),
- multiple bridges (calendar / chat / IM) per process,
- a long-running agent that should keep working as crews are
  added / archived.

Tasks-mobile would replicate Stoop-mobile's mistake exactly: N
crews → N `Agent`s → N transport stacks → N mDNS registrations
under one identity → confusion. Don't.

### The pattern Tasks should adopt (mirror of this doc's plan)

1. **One `meshAgent` per service-context** (the RN process's
   `ServiceContext`, the CLI's `main.js`, …). Built once at
   process boot via the same `buildMeshAgent` helper Stoop uses
   (or, for Tasks-CLI, `createMeshAgent` from
   `@canopy/react-native` if running as a long-lived node
   process — same shape).

2. **`createCrewAgent` becomes `buildCrewState`** — drops the
   `transport` / `vault` / identity-creation logic from its
   arguments. It now takes `{ meshAgent, crewConfig, ... }` and
   returns a `CrewState`:
   ```js
   {
     itemStore,            // crew-scoped
     members,              // MemberMap, crew-scoped
     skillMatch,           // subscribes to <crewId>/requests on shared agent
     mirror,               // subscribes to peers' <crewId>/requests
     groupManager,         // crew-scoped, references shared agent for proofs
     bot, bridges, ...,    // crew-scoped wirings
     // NO agent, NO transports
   }
   ```

3. **`buildTaskSkills` (or the equivalent in Tasks) takes
   `bundleResolver`** instead of closing over a single CrewState.
   Skills resolve their crew at dispatch time:
   - first from `args.crewId`,
   - then from `ctx.envelope.topic` if it matches `<crewId>/…`,
   - else strict reject `{error: 'crewId required'}`.

4. **Skills register ONCE on `meshAgent.skills`** at boot, with
   `bundleResolver: (args) => crews.get(args.crewId) ?? null`.

5. **Per-crew state is in a `Map<crewId, CrewState>`** owned by
   the service-context. Adding a crew = build a new CrewState
   over the shared `meshAgent`. Removing a crew = stop the
   CrewState's mirror + skillMatch, drop the map entry.

6. **Mobile UI hooks (`useSkill`-equivalent) inject `crewId`** into
   every args object so direct UI calls always carry it (cf.
   Stoop's `useSkill` injecting `groupId`).

7. **Identity stays singular** — one user identity for the app
   process, shared across all crews. The CrewState's per-crew
   `localActor` (a webid) is what differs across crews; the
   underlying pubKey is the same.

### Concrete file deltas Tasks will need

| File | Change |
|---|---|
| `apps/tasks-v0/src/Crew.js` | Rename `createCrewAgent` → `buildCrewState`. Drop transport/identity/vault args. Take `meshAgent` + `crewConfig`. Return CrewState (no agent inside). |
| `apps/tasks-v0/src/skills/*` (or the per-skill files Tasks uses) | Each `defineSkill` body opens with `const crew = bundleResolver(args, ctx); if (!crew) return {error: 'crewId required'};`. |
| `apps/tasks-v0/src/index.js` (or wherever the CLI/app entrypoint is) | Build one `meshAgent`. Build `crews: Map<crewId, CrewState>`. Register skills once with `bundleResolver: (args) => crews.get(args.crewId)`. |
| `apps/tasks-v0/test/*` | The single-crew tests adapt cleanly; multi-crew tests should construct one agent + N CrewStates rather than N `createCrewAgent` calls. |
| Future `apps/tasks-mobile/src/ServiceContext.js` (when it exists) | Build it from the start with the single-agent pattern — copy Stoop-mobile's ServiceContext as a template once Stoop's refactor lands. |

### Coordination with the Stoop refactor

Tasks doesn't need to wait for Stoop's refactor to finish — the
`core` additions (Phase 1: `SkillRegistry.replace`,
`unregister`) are the only shared bit, and they're additive. Once
Stoop's Phase 1 is merged, Tasks can start its rewrite
independently.

If Tasks starts before Stoop's Phase 2 ships, Tasks will be the
**second consumer** of the bundleResolver pattern — at which
point it qualifies for substrate lift. Concretely the helper
worth lifting is:

- A factory like `buildScopedSkillBus({ meshAgent, scopes,
  buildSkills })` that wires `bundleResolver` + `scopes.get(args.scopeId)`
  + skill-replace-on-scope-add behaviour, taking the boilerplate
  out of both apps. Lift target: `@canopy/scoped-skill-bus` (or
  fold into `@canopy/skill-match` if it fits).

But don't pre-lift. Wait for Tasks's actual implementation to
exercise the API surface, then lift the common bits. Until then,
each app copies the pattern from this doc.

### What Tasks should NOT change

- Don't change `core.Agent`, `RoutingStrategy`, transports,
  PeerGraph, or any other substrate primitive. Those are already
  correct — the bug was always app-level wiring.
- Don't introduce a "TasksAgent" base class or any Tasks-specific
  agent type. The whole point is that there's just `core.Agent`,
  shared.
- Don't reach for parallel agents to model "crew isolation" —
  isolation is a property of the per-crew state (separate
  ItemStore + MemberMap + SkillMatch topics), not of the agent.

### Open questions for the Tasks team

- **Bridge scoping.** Tasks-v0's `bridges/` (calendar, chat, IM)
  are presumably per-crew today. Confirm they're constructed
  inside `buildCrewState` and carry no agent of their own.
- **GroupManager.** Tasks uses `core.GroupManager` for proofs —
  is it shared across crews or per-crew? If per-crew, it lives
  inside `CrewState`. If shared, one instance lives at the
  service-context level beside the `meshAgent`.
- **`bot/`** — Tasks's bot is a long-running responder. With one
  agent + N crews, the bot needs to be scope-aware too (probably
  via `bundleResolver`).

When in doubt: mirror what Stoop does after this refactor lands.
Stoop is the reference implementation of the single-agent
pattern.
