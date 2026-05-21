# L1b (item-store) — open/closed items, attribution, audit

> **Refactored 2026-05-04 (Phase 5.2).** The pre-refactor V0
> `Backend` interface + `InMemoryBackend` were deleted — they
> duplicated `core.DataSource`. The substrate now composes any
> `core.DataSource` directly: `MemorySource` for tests, an adapter
> over `pod-client.PodClient` at the app layer for production.
> Constructor is now `{dataSource, rootContainer, rolePolicy?}`.
> Pragmatic deviation from the L1b audit: the audit prescribed a full
> PodClient integration with MergeContracts + FederatedReader; on
> inspection, the substrate's actual surface (read/write/list/delete +
> JSON values) maps cleanly to `core.DataSource` — the SDK's lower
> primitive. PodClient's tombstones / etag-conflict / multi-pod
> federation features belong at the app layer (apps that need them
> wrap `pod-client.PodClient` in a small DataSource adapter).

| | |
|---|---|
| **Package** | `@canopy/item-store` (v0.2.0 post-refactor) |
| **Status** | shipped — Phase 5.2 of substrate refactor |
| **Driven by** | H2 (household V2) + H4 (tasks V0) + H5 (neighborhood V0) + H8 (presence V0) |
| **Pattern source** | `apps/household/src/storage/` + `apps/household/src/skills/{addItem,markComplete,removeItem}.js` (the original H2-shipping code) |
| **RN variant?** | No — pure data layer over `core.DataSource` (works on RN out of the box). |
| **Storage layout** | `<rootContainer>/items/<id>.json` per item, `<rootContainer>/audit/<entry-id>.json` per audit entry (one file each). |

---

## What it is

A substrate for **collections of items in a hybrid pod with
lifecycle states** (open / closed), per-item attribution
(addedBy, completedBy), an audit log, and pluggable per-field
merge contracts (LWW for body, compare-and-swap for assignee,
append-only for audit).  Pluggable role-policy gate.  Extensible
optional fields for use cases beyond simple lists (DAG dependencies,
required skills, due dates, visibility classes).

The substrate makes no assumptions about *what* items are.  Some
apps treat them as shopping items, some as tasks with skills, some
as proof-of-presence claims.  The substrate ships the
collection mechanics; the apps decide what fields fit their domain.

---

## Consumer specs driving the design

- **Primary: H2 (household V2).**  Items are shopping/errand/repair/schedule entries with attribution + audit; no DAG, no skills, no assignee.  Single role.
- **Secondary: H4 (tasks V0).**  Items are tasks with attribution + audit + DAG dependencies + required skills + assignee + role-policy gate.  Five standard roles.

The substrate's API must express both.  Approach: superset schema
(H4-shape with H2 fields as a subset); H4-extension fields are all
optional and default to none; H2 simply doesn't set them.

---

## Public API shape

### Item document

```ts
type Item = {
  id:               string;            // ULID
  type:             string;            // app-defined: 'shopping' | 'errand' | 'repair' | 'schedule' | 'task' | ...
  text:             string;            // primary content
  notes?:           string;
  addedBy:          string;            // webid
  addedByDisplayName?: string;
  addedAt:          number;            // ms epoch

  // Lifecycle
  completedAt?:     number;            // ms epoch | null
  completedBy?:     string;            // webid | null

  // H4-extension fields (all optional)
  dependencies?:    string[];          // task ids
  requiredSkills?:  string[];
  dueAt?:           number;
  assignee?:        string;            // webid
  claimedAt?:       number;
  visibility?:      'household' | `role:${string}` | 'private';

  // Provenance
  source?:          object;            // app-specific opaque metadata (e.g. {tg: {chatId, messageId}})
};
```

### Methods

```ts
// Open one collection — typically once per app per pod.
// Post-Phase 5.2 the constructor takes `dataSource` directly (any
// `core.DataSource`), not a substrate-internal `Backend`.
const store = new ItemStore({
  dataSource:    new MemorySource(),                  // tests
  // OR: a PodClient-wrapped adapter (e.g. via SolidPodSource) for prod
  rootContainer: 'https://test.example/h2-household/',
  rolePolicy:    ...,                                  // optional gate (see below)
});

// Add — bulk in one call to support H2's chat-driven multi-add
await store.addItems(items: Partial<Item>[], context: {actor: webid}): Promise<Item[]>

// List — open items by filter
await store.listOpen(filter?: {
  type?: string | string[],
  assignee?: string | null,           // null = unassigned
  requiredSkill?: string,
  visibility?: string,
}): Promise<Item[]>

// Mark complete — by id or fuzzy text match (latter for chat UX)
await store.markComplete(refs: Array<{id: string} | {match: string}>, context: {actor: webid}): Promise<Item[]>

// Remove (hard delete)
await store.removeItems(refs: Array<{id: string}>, context: {actor: webid}): Promise<void>

// Claim (compare-and-swap on assignee)
await store.claim(id: string, context: {actor: webid}): Promise<Item | {error: 'already-claimed', current: Item}>

// Reassign (role-policy-gated)
await store.reassign(id: string, newAssignee: string, context: {actor: webid}): Promise<Item>

// Edit body fields (LWW)
await store.update(id: string, patch: Partial<Item>, context: {actor: webid}): Promise<Item>

// Subscribe to changes (live updates for UI)
store.on('item-added', handler);
store.on('item-completed', handler);
store.on('item-removed', handler);
store.on('item-claimed', handler);
store.on('item-updated', handler);
```

### Audit access

```ts
await store.auditLog({
  itemId?: string,
  actor?: webid,
  since?: number,
  until?: number,
}): Promise<AuditEntry[]>
```

### Role policy (pluggable)

```ts
type RolePolicy = {
  canAdd?: (actor, item) => boolean;
  canComplete?: (actor, item) => boolean;
  canRemove?: (actor, item) => boolean;
  canClaim?: (actor, item) => boolean;
  canReassign?: (actor, item) => boolean;
  canEditBody?: (actor, item) => boolean;
  canRead?: (actor, item) => boolean;     // for visibility filtering
};
```

H2 V0 passes nothing (defaults to "anyone can do anything"); H4 passes the standard role-permission table from Track D's role-aware groups.

---

## Pod schema (storage layout)

```
<rootContainer>/
  open/<ulid>.json            # ALL types in one bucket; type is a field on the item
  closed/yyyy-mm/<ulid>.json  # archived monthly when item completes
  audit/yyyy-mm.jsonl         # append-only log of actions
```

Single bucket for open items (vs per-type subdirectories) chosen for
schema simplicity — the NL-context builder + UI both group by type
on read; storage layout is internal.

### Per-field merge contracts (default)

| Field | Contract |
|---|---|
| `id`, `type`, `text`, `notes`, `dependencies`, `requiredSkills`, `dueAt`, `visibility` | LWW |
| `assignee` | compare-and-swap (claim race resolution) |
| `completedAt`, `completedBy` | LWW; role-policy gates duplicate completes |
| audit log | append-only |

Apps can override via `mergeContracts` option but defaults work for both H2 and H4.

---

## Dependencies

- **`@canopy/core`** — sole runtime dep:
  - `DataSource` (interface) — substrate's storage primitive. Apps inject any concrete (`MemorySource` for tests, `pod-client.PodClient`-wrapping adapter for prod).
  - `Emitter` — for live-update events (`item-added` / `-completed` / `-removed` / `-claimed` / `-updated`).
- **`@canopy/core/permissions/CapabilityToken`** — when role-policy delegates to capability tokens (optional, app-driven).

### Optional integration

- **`@canopy/pod-client`** — at the **app layer**, not the substrate. Apps that want hybrid-pod semantics, `If-Match` etag races, tombstones, or `MergeContracts` / `FederatedReader` wrap PodClient in a small DataSource adapter and pass that into ItemStore. The substrate stays decoupled from the pod stack.
- **L1h (identity-resolver)** — for resolving webid → displayName when annotating audit entries. Optional; substrate works without it.

### No dependency on

- **L1c (chat-agent), L1d (agent-ui), L1e (skill-match), L1f (notifier)** — these are *consumers* of L1b, not dependencies.

---

## RN variant

**None.** L1b is a pure data layer over `core.DataSource`. The
substrate doesn't allocate sockets, files, or platform APIs of its
own; whatever runs on RN is the underlying `DataSource` instance the
app injects (e.g. an RN-flavoured PodClient adapter). The substrate
itself ships a single `index.js`.

---

## Open questions

1. **Audit log retention.**  Default: forever, monthly archives.  Apps can configure shorter retention.  Same shape as H2 audit + H4 audit per the original plans.
2. **Visibility filter — read-time vs index-time.**  Filtering on read scales linearly with item count; at neighborhood-scale (1000s of items) the by-skill / by-assignee indexes become load-bearing.  V0 ships read-time filter; index-time pre-filter is V1 if scale demands.
3. **Display-name resolution timing.**  When the audit log records an action, does it persist `addedByDisplayName` (snapshot) or just the webid (resolve on render)?  Lean: persist snapshot — survives if member leaves household and webid becomes unresolvable.
4. **Cross-pod references.**  H2 v2's hybrid-pod design has the household pod referencing per-member pods.  Does L1b natively support cross-pod refs, or is that app-glue?  Lean: app-glue — L1b operates on a single root container; hybrid-pod composition happens in app code.
5. **Bulk update.**  H4 might want "reassign all of Anne's tasks to the author because Anne's on holiday."  Lean: V0 ships single-item update; bulk is V1 once a real consumer demands it.
6. **Fuzzy text-match resolution for `markComplete({match})`.**  How fuzzy?  Substring, edit-distance, embedding similarity?  Lean: substring for V0; embedding upgrade comes via L1j when needed.

---

## Pattern sources for implementation

- **`packages/item-store/src/ItemStore.js`** — the shipped substrate. Constructor takes `{dataSource, rootContainer, rolePolicy?}`. Storage layout: `items/<id>.json` per item, `audit/<entry-id>.json` per audit entry — one file each on the underlying `DataSource`.
- **`apps/household/src/storage/InMemoryStore.js`** — adapter over the substrate, presenting H2's legacy `{addItem, listOpen, markComplete, remove, getById}` interface to existing skill handlers + tests. Useful template for any app that needs to wrap ItemStore in app-specific shape.
- **`apps/household/src/skills/{addItem,markComplete,removeItem,listOpen,nudgeCompletion}.js`** — skill handlers driving the substrate.
- **App-layer DataSource adapters** — apps wanting full pod semantics wrap `pod-client.PodClient` in a small `core.DataSource` adapter (read/write/list/delete + JSON values). PodClient's `MergeContracts` + `FederatedReader` plug in there, not inside the substrate.

---

## Out of scope for V0

- Recurring items (V1+).
- Multi-claim / co-assignment (single assignee in V0).
- DAG cycle detection (lean: lives in L1b at write time, but optional helper rather than required).
- Sub-tasks (a task spawning child tasks).
- Cross-source references in items (`source` is opaque metadata only).
