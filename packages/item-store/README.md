# @onderling/item-store

> **Layer: substrate.** Composes the `@onderling/core` SDK. Substrates MUST NOT reinvent SDK primitives (transports, vaults, auth, merge contracts, push, skill registries, identity, emitters, ULID); when the SDK *almost* fits, extend it additively rather than forking. See [`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md).

Open/closed items in a hybrid pod — attribution, audit, per-field
merge contracts, pluggable role policy.

This is **L1b** in the substrate-first plan
(`Project Files/Substrates/L1b-item-store.md`).  Designed by reading
H2 (household V2) and H4 (tasks V0) specs side-by-side per the
rule-of-two policy.

---

## Install

Within the monorepo:

```json
"dependencies": {
  "@onderling/item-store": "file:../../packages/item-store"
}
```

---

## Quick start

### H2-shape (household items — single role, no skills)

```js
import { ItemStore, memoryDataSource } from '@onderling/item-store';

const store = new ItemStore({ dataSource: memoryDataSource(), rootContainer: 'mem://app/items/' });

// Add (bulk supported)
const items = await store.addItems(
  [
    { type: 'shopping', text: 'brood' },
    { type: 'shopping', text: 'melk' },
  ],
  { actor: anneWebid, actorDisplayName: 'Anne' },
);

// List open items by type
const shopping = await store.listOpen({ type: 'shopping' });

// Mark complete by fuzzy match (chat UX) — silent skip if no match
await store.markComplete(
  [{ match: 'brood' }, { match: 'melk' }],
  { actor: bobWebid },
);

// Or by id (explicit)
await store.markComplete([{ id: items[0].id }], { actor: bobWebid });

// Audit log
const log = await store.auditLog({ itemId: items[0].id });
```

### H4-shape (tasks — DAG deps, skills, claim flow, role policy)

```js
import { ItemStore, memoryDataSource, PermissionDeniedError } from '@onderling/item-store';

// Standard 5-role permission table (simplified)
const policy = {
  canAdd:      (actor) => roles[actor] !== 'observer',
  canClaim:    (actor) => ['admin','coordinator','member'].includes(roles[actor]),
  canReassign: (actor) => ['admin','coordinator'].includes(roles[actor]),
  canRemove:   (actor) => roles[actor] === 'admin',
  canComplete: (actor, item) => {
    if (roles[actor] === 'observer') return false;
    if (roles[actor] === 'member')   return item.assignee === actor;
    return true;
  },
  // ...
};

const store = new ItemStore({
  dataSource:    memoryDataSource(),
  rootContainer: 'mem://app/items/',
  rolePolicy:    policy,
});

// Task with H4-extension fields
const [task] = await store.addItems(
  [
    {
      type:           'task',
      text:           'Repaint the hallway',
      requiredSkills: ['paint', 'ladder-7ft'],
      dueAt:          deadline,
      visibility:     'household',
    },
  ],
  { actor: anneWebid },
);

// Claim with compare-and-swap
const result = await store.claim(task.id, { actor: bobWebid });
if (result.error === 'already-claimed') {
  console.log('Lost race; current assignee:', result.current.assignee);
}

// Reassign (role-policy-gated)
await store.reassign(task.id, anneWebid, { actor: coordinatorWebid });

// Filter by skill / assignee
const painters = await store.listOpen({ requiredSkill: 'paint' });
const unclaimed = await store.listOpen({ assignee: null });
const mine = await store.listOpen({ assignee: anneWebid });
```

---

## Item shape

The substrate's item document is the SUPERSET of what H2 and H4
need.  H2-only consumers leave H4-extension fields absent.

| Field | Required | H2 | H4 |
|---|---|---|---|
| `id`, `type`, `text`, `addedBy`, `addedAt` | yes | ✓ | ✓ |
| `notes`, `addedByDisplayName` | optional | ✓ | ✓ |
| `completedAt`, `completedBy`, `completedByDisplayName` | when complete | ✓ | ✓ |
| `dependencies`, `requiredSkills`, `dueAt`, `assignee`, `claimedAt`, `visibility` | optional | — | ✓ |
| `source` (app-specific opaque metadata) | optional | ✓ (e.g. `{tg: {chatId, messageId}}`) | usually absent |
| `_etag` | substrate-managed | — | — |

See `src/types.js` for full JSDoc.

---

## Public API

| Method | Purpose | Merge contract |
|---|---|---|
| `addItems(items[], ctx)` | Bulk add | LWW (each id is unique) |
| `listOpen(filter?)` | Open items by filter | n/a (read) |
| `listClosed(filter?)` | Closed items by filter | n/a (read) |
| `getById(id)` | Single item | n/a (read) |
| `markComplete(refs[], ctx)` | Set completedAt/By | LWW; explicit `{id}` errors on completed item, fuzzy `{match}` silently skips |
| `removeItems(refs[], ctx)` | Hard delete | n/a |
| `claim(id, ctx)` | CAS on assignee | **compare-and-swap** |
| `reassign(id, newAssignee, ctx)` | Set/release assignee | role-policy-gated |
| `update(id, patch, ctx)` | Edit body fields | LWW; forbids edits to attribution / completion / assignment |
| `auditLog(filter?)` | Read audit log | append-only at write time |

### Events

`ItemStore` extends Node's `EventEmitter`.  Apps subscribe to:

| Event | Payload | When |
|---|---|---|
| `item-added` | `Item` | each successful add |
| `item-completed` | `Item` | markComplete success |
| `item-removed` | `{id, item}` | removeItems success |
| `item-claimed` | `Item` | claim success or reassign-to-webid |
| `item-updated` | `Item` | update success or reassign-to-null |

---

## Role policy

Pluggable.  Default = no-op (everything allowed).  Apps inject a
`RolePolicy` object with optional methods:

```ts
{
  canAdd?:      (actor: webid, item: Partial<Item>) => boolean,
  canComplete?: (actor: webid, item: Item) => boolean,
  canRemove?:   (actor: webid, item: Item) => boolean,
  canClaim?:    (actor: webid, item: Item) => boolean,
  canReassign?: (actor: webid, item: Item) => boolean,
  canEditBody?: (actor: webid, item: Item, patch: Partial<Item>) => boolean,
  canRead?:     (actor: webid, item: Item) => boolean,
}
```

Returning `false` triggers `PermissionDeniedError`.

H4 ships the canonical 5-role permission table (admin / coordinator
/ member / observer / external-volunteer); H2 V0 uses the no-op
default.

---

## Backends

V0 ships:

- **`InMemoryBackend`** — Map-backed, defensive copies, in-process
  CAS via `_etag`.  Used by tests and any non-pod scenario.

V1+ adds:

- **PodBackend** — pod-backed via `@onderling/pod-client` (Track A).
  Implements the same Backend interface.  Pluggable from the
  consuming app's bootstrap.

The `Backend` interface is documented in `src/types.js` for apps
that want a custom backend.

---

## Errors

```js
import {
  ItemNotFoundError,
  PermissionDeniedError,
  ClaimRaceError,
  InvalidLifecycleError,
} from '@onderling/item-store';
```

Each carries a `code` field for branching:
- `ITEM_NOT_FOUND`
- `PERMISSION_DENIED`
- `CLAIM_RACE`
- `INVALID_LIFECYCLE`

`claim()` returns `{error: 'already-claimed', current}` rather than
throwing — claim races are an expected control-flow case, not
an error.

---

## Pattern source

Generalised from
`apps/household/src/{storage/InMemoryStore.js, storage/Store.js,
skills/addItem.js, skills/markComplete.js, skills/removeItem.js,
skills/listOpen.js}`.

When `apps/household` migrates to consume this substrate (Phase C),
the existing storage layer retires.

---

## See also

- `Project Files/Substrates/L1b-item-store.md` — substrate sketch.
- `Project Files/Substrates/policies.md` — rule-of-two + versioning.
- `Project Files/Substrates/apps/H2-household.md` — primary consumer.
- `Project Files/Substrates/apps/H4-tasks.md` — secondary consumer.
