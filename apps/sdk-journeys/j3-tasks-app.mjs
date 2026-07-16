/**
 * J3 — tasks app: an external tasks application that is data-compatible
 * with the platform's built-in tasks experience.
 *
 * The imagined developer: a third party building their own task manager UI
 * (a CLI, a kanban board, a voice assistant) who wants their tasks to be
 * THE SAME OBJECTS the first-party clients read and write — not a parallel
 * silo with an import/export bridge.
 *
 * What it proves: `@onderling/item-types` + `@onderling/item-store` suffice to
 *   1. run the full task lifecycle (add → claim → complete) on any
 *      `core.DataSource` — here the in-memory one, no pod, no server,
 *   2. enforce the shared semantics for free (claim races resolve to one
 *      winner; an append-only audit trail is written per action),
 *   3. produce items that validate against the CANONICAL `task` schema —
 *      the exact shape any other client of the same storage would parse.
 *
 * Everything here runs offline in one Node process.
 */
import assert from 'node:assert/strict';
import { ItemStore, memoryDataSource } from '@onderling/item-store';
import { CANONICAL_TYPES, validateCanonical, metadata } from '@onderling/item-types';

function step(n, text) { console.log(`  ${n}. ${text}`); }

console.log('J3 tasks-app — an external tasks app over the shared item substrate');

// ── 1. The canonical `task` type is a published contract, not app lore ─────
assert.ok(CANONICAL_TYPES['task'], 'the canonical registry ships a task schema');
const taskMeta = metadata('task');
assert.ok(taskMeta.iri.endsWith('#Task'), `task has a stable IRI (${taskMeta.iri})`);
step(1, `canonical "task" type found in @onderling/item-types (iri: ${taskMeta.iri})`);

// ── 2. Build the store on an in-memory DataSource (no pod, no server) ──────
// Any core.DataSource works here — a Solid-pod-backed one in production,
// the Map-backed one for tests and offline runs. The store cannot tell.
const source = memoryDataSource();
const store  = new ItemStore({
  dataSource:    source,
  rootContainer: 'mem://demo-circle/tasks/',
});
step(2, 'built an ItemStore over memoryDataSource at mem://demo-circle/tasks/');

// ── 3. Add a task ────────────────────────────────────────────────────────────
const alice = 'did:example:alice';
const bob   = 'did:example:bob';
const [task] = await store.addItems(
  [{ type: 'task', text: 'Paint the fence' }],
  { actor: alice },
);
assert.ok(task.id, 'the substrate generated an id');
assert.equal(task.addedBy, alice, 'attribution recorded');
step(3, `alice added a task: "${task.text}" (id ${task.id.slice(0, 8)}…)`);

// ── 4. Claim it — and prove the race resolves to one winner ────────────────
const claimed = await store.claim(task.id, { actor: bob });
assert.equal(claimed.assignee, bob, 'bob is the assignee after claiming');
const lostRace = await store.claim(task.id, { actor: alice });
assert.equal(lostRace.error, 'already-claimed', 'a second claim is rejected');
assert.equal(lostRace.current.assignee, bob, 'the rejection reports the winner');
step(4, 'bob claimed the task; a competing claim by alice was rejected with the winner surfaced');

// ── 5. Complete it ───────────────────────────────────────────────────────────
const [done] = await store.markComplete([{ id: task.id }], { actor: bob });
assert.ok(done.completedAt, 'completion timestamp set');
assert.equal(done.completedBy, bob, 'completion attribution recorded');
const open   = await store.listOpen();
const closed = await store.listClosed();
assert.equal(open.length, 0, 'no open tasks remain');
assert.equal(closed.length, 1, 'the completed task is listed as closed');
step(5, 'bob completed the task; listOpen/listClosed reflect the lifecycle');

// ── 6. The audit trail came for free ────────────────────────────────────────
const audit = await store.auditLog({ itemId: task.id });
const actions = audit.map((e) => e.action).sort();
assert.deepEqual(actions, ['add', 'claim', 'complete'], `audit trail covers the lifecycle (got: ${actions})`);
step(6, `append-only audit trail: [${actions.join(' → ')}]`);

// ── 7. The stored bytes ARE the canonical shape other clients read ─────────
// Read the item back RAW from the DataSource — exactly what any other
// client pointed at the same storage would do — and validate it against
// the canonical task schema from @onderling/item-types.
const [rawUri] = await source.list('mem://demo-circle/tasks/items/');
const rawItem  = JSON.parse(await source.read(rawUri));
assert.equal(rawItem.id, task.id, 'the raw stored object is our task');
const validation = validateCanonical(rawItem);
assert.equal(validation.ok, true,
  `the stored item validates against the canonical task schema (errors: ${JSON.stringify(validation.errors)})`);
step(7, 'raw stored item read straight from the DataSource validates as a canonical task');

console.log('✓ J3 tasks-app: PASS');
