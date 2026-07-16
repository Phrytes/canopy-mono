# Tutorial 3 — a compatible tasks app

Build an external tasks application whose tasks are **the same objects** a Basis client reads —
not an integration, not an import/export bridge: shared substrate. Two packages do the work:
`@onderling/item-types` (the canonical vocabulary) and `@onderling/item-store` (the lifecycle
substrate).

Runnable version: [`apps/sdk-journeys/j3-tasks-app.mjs`](../../apps/sdk-journeys/j3-tasks-app.mjs).

## 1. The canonical type is a published contract

```js
import { CANONICAL_TYPES, validateCanonical, metadata } from '@onderling/item-types';

CANONICAL_TYPES['task'];        // the schema every compatible app shares
metadata('task').iri;           // a stable IRI ending in #Task
```

Because the `task` shape ships as a package, "compatible" is a checkable property, not a
promise.

## 2. A store over any data source

`ItemStore` works over the kernel's `DataSource` port — a Solid pod in production, an in-memory
source for development. The store cannot tell the difference:

```js
import { ItemStore, memoryDataSource } from '@onderling/item-store';

const store = new ItemStore({
  dataSource:    memoryDataSource(),
  rootContainer: 'mem://demo-circle/tasks/',
});
```

## 3. The task lifecycle

```js
const alice = 'did:example:alice';
const bob   = 'did:example:bob';

// Add
const [task] = await store.addItems(
  [{ type: 'task', text: 'Paint the fence' }],
  { actor: alice },
);

// Claim — races resolve to one winner
const claimed  = await store.claim(task.id, { actor: bob });   // bob wins
const lostRace = await store.claim(task.id, { actor: alice });
lostRace.error;                    // → 'already-claimed'
lostRace.current.assignee;         // → bob (the rejection reports the winner)

// Complete
await store.markComplete([{ id: task.id }], { actor: bob });
await store.listOpen();            // → []
await store.listClosed();          // → [the completed task]
```

Attribution (`addedBy`, `completedBy`), timestamps, and an append-only audit trail come with the
substrate:

```js
const audit = await store.auditLog({ itemId: task.id });
audit.map((e) => e.action);        // → ['add', 'claim', 'complete']
```

## 4. The compatibility proof

Read the raw stored bytes straight from the data source and validate them against the canonical
schema — this is the exact check the journey runs:

```js
import { validateCanonical } from '@onderling/item-types';

// the stored record IS a canonical task — a Basis client reads it unchanged
validateCanonical(storedRecord);   // → ok
```

Point the same store at a pod-backed `DataSource` — the bridge is `createSealedPodDataSource`
from `@onderling/pod-client` (it works unsealed too; see the how-to guide
[persist items to a Solid pod](../how-to/persist-items-to-a-solid-pod.md)) — and your app and
Basis are operating on one shared task list — claims, completions, and audit included.

Further: [the package index](../packages.md) · [building compatible agents](../building-compatible-agents.md).
