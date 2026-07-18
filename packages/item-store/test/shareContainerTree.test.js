/**
 * shareContainerTree (journey J5 · SENDABLE LISTS) — a whole list (container + children, order preserved)
 * travels across a circle boundary by FANNING the existing single-item share over every subtree node. No
 * bundle format: each node lands its own `shared-ref`, and the recipient rebuilds the nesting from the shared
 * items' own `embeds`/`containedBy` structure.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createCircleStores, memoryDataSource, addChildTo, contain,
  shareContainerTree, collectSubtree,
  resolveSharedRef, listShared, childIdsOf,
} from '../src/index.js';

function mkStores() {
  // permissive registry — the container types (list / list-item / task) are exercised structurally here.
  const registry = { validate: () => ({ ok: true }) };
  return createCircleStores({ dataSource: memoryDataSource(), registry });
}

/**
 * Build a nested list in circle A:
 *   list "chores"
 *     ├─ list-item "milk"
 *     ├─ list-item "bread"
 *     ├─ list "errands"            (nested list)
 *     │    └─ list-item "bank"
 *     └─ task "call plumber"
 * Returns the created items + the ids in the SAME pre-order the share fan should visit.
 */
async function seedList(A) {
  const list = await A.put({ type: 'list', text: 'chores' });
  const milk = await addChildTo(A, list.id, { type: 'list-item', text: 'milk', createdBy: 'alice' });
  const bread = await addChildTo(A, list.id, { type: 'list-item', text: 'bread', createdBy: 'alice' });
  const errands = await addChildTo(A, list.id, { type: 'list', text: 'errands', createdBy: 'alice' });
  const bank = await addChildTo(A, errands.id, { type: 'list-item', text: 'bank', createdBy: 'alice' });
  const plumber = await addChildTo(A, list.id, { type: 'task', text: 'call plumber', createdBy: 'alice' });
  return { list, milk, bread, errands, bank, plumber,
    preOrder: [list.id, milk.id, bread.id, errands.id, bank.id, plumber.id] };
}

describe('collectSubtree', () => {
  let stores, A;
  beforeEach(() => { stores = mkStores(); A = stores.getStore('A'); });

  it('enumerates the whole subtree in pre-order (container first, children in declaration order)', async () => {
    const { preOrder } = await seedList(A);
    expect(await collectSubtree(A, preOrder[0])).toEqual(preOrder);
  });

  it('is idempotent for a multi-parent child — enumerates it once', async () => {
    const { list, milk, errands } = await seedList(A);
    await contain(A, errands.id, milk.id);            // milk is now reachable via BOTH list and errands
    const order = await collectSubtree(A, list.id);
    expect(order.filter((id) => id === milk.id)).toHaveLength(1);   // visited once, never twice
  });

  it('bounds depth (maxDepth guard) and returns [] for a missing root', async () => {
    expect(await collectSubtree(A, 'nope')).toEqual([]);
    const { preOrder } = await seedList(A);
    expect(await collectSubtree(A, preOrder[0], { maxDepth: 0 })).toEqual([preOrder[0]]);  // only the root
  });
});

describe('shareContainerTree — SENDABLE LISTS', () => {
  it('sends the WHOLE list into another circle: every node gets a shared-ref, order preserved', async () => {
    const stores = mkStores();
    const A = stores.getStore('A');
    const { preOrder, list, milk, bread, errands, bank, plumber } = await seedList(A);

    const r = await shareContainerTree(stores, {
      containerId: list.id, fromCircleId: 'A', toCircleId: 'C', by: 'alice',
    });
    expect(r.ok).toBe(true);
    expect(r.order).toEqual(preOrder);                          // fan visited the subtree in pre-order
    expect(r.shared.map((s) => s.itemId)).toEqual(preOrder);    // one shared-ref per node, in order
    expect(r.failed).toEqual([]);

    // Recipient side: C holds a shared-ref for EVERY subtree node, in the same order the list reads.
    const shared = await listShared(stores, 'C');
    expect(shared.map((s) => s.sourceId)).toEqual(preOrder);
    // the container's ref carries its type so the recipient knows it's the list root
    expect(shared[0]).toMatchObject({ type: 'shared-ref', sourceCircle: 'A', sourceType: 'list', sharedBy: 'alice' });

    // NESTING travels per-node: each ref resolves to the SOURCE item, which still carries its containment edges,
    // so the recipient rebuilds the tree from the shared items' own structure (no bundle format).
    const listItem = await resolveSharedRef(stores, shared.find((s) => s.sourceId === list.id));
    expect(childIdsOf(listItem)).toEqual([milk.id, bread.id, errands.id, plumber.id]);  // list's edges intact

    const errandsItem = await resolveSharedRef(stores, shared.find((s) => s.sourceId === errands.id));
    expect(childIdsOf(errandsItem)).toEqual([bank.id]);                                 // nested list's edge intact

    const bankItem = await resolveSharedRef(stores, shared.find((s) => s.sourceId === bank.id));
    expect(bankItem.text).toBe('bank');
    expect(bankItem.containedBy).toContain(errands.id);          // bank's back-ref points at the nested list
  });

  it('shares each node ONCE (idempotent) even with a multi-parent child', async () => {
    const stores = mkStores();
    const A = stores.getStore('A');
    const { list, milk, errands } = await seedList(A);
    await contain(A, errands.id, milk.id);    // milk now has two parents

    const r = await shareContainerTree(stores, { containerId: list.id, fromCircleId: 'A', toCircleId: 'C' });
    expect(r.ok).toBe(true);
    const refsForMilk = (await listShared(stores, 'C')).filter((s) => s.sourceId === milk.id);
    expect(refsForMilk).toHaveLength(1);     // never shared twice
  });

  it('honours the posture floor via the fanned single-item share (refuses a downgrade)', async () => {
    const stores = mkStores();
    const A = stores.getStore('A');
    const { list } = await seedList(A);
    const postureOf = (c) => ({ A: 3, Public: 0 }[c] ?? 0);
    const r = await shareContainerTree(stores, {
      containerId: list.id, fromCircleId: 'A', toCircleId: 'Public', posture: 3, postureOf,
    });
    expect(r.ok).toBe(false);
    // every node refused with the floor error — nothing landed in the less-confidential circle
    expect(r.failed.every((f) => f.error === 'posture-floor')).toBe(true);
    expect(await listShared(stores, 'Public')).toEqual([]);
  });

  it('rejects bad args + same-circle + a missing container', async () => {
    const stores = mkStores();
    expect(await shareContainerTree(stores, { containerId: 'x', fromCircleId: 'A', toCircleId: 'A' }))
      .toMatchObject({ ok: false, error: 'same-circle' });
    expect(await shareContainerTree(stores, { fromCircleId: 'A', toCircleId: 'B' }))
      .toMatchObject({ ok: false, error: 'missing-args' });
    expect(await shareContainerTree(stores, { containerId: 'nope', fromCircleId: 'A', toCircleId: 'B' }))
      .toMatchObject({ ok: false, error: 'container-not-found' });
  });
});
