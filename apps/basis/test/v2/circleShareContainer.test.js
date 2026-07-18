/**
 * shareContainerAcrossCircles (journey J5 · SENDABLE LISTS) — the app-level "send this list" op, tested at the
 * SUBSTRATE seam (no DOM, no live pod). Proves the whole list travels: the container + its children (order
 * preserved) each land a `shared-ref` in the target circle, and the recipient surfaces every member — where a
 * bare container share (shareItemAcrossCircles) would land only the self-pointer.
 */
import { describe, it, expect } from 'vitest';
import { makeCircleLists } from '@onderling/kring-host/circleLists';
import { childIdsOf } from '@onderling/item-store';
import {
  shareContainerAcrossCircles, shareItemAcrossCircles, listSharedResolved,
} from '../../src/v2/circleShare.js';

const openPolicyOf = () => ({ sharePosture: 'trusted' });

// A list "chores" with two items, a nested list, and a task — via the SAME container ops the app uses.
async function seedList(svc) {
  const list = await svc.createList('A', 'chores', 'alice');
  const milk = await svc.addItem('A', list.id, 'milk', 'alice');
  const bread = await svc.addItem('A', list.id, 'bread', 'alice');
  const plumber = await svc.addItem('A', list.id, 'call plumber', 'alice', { hint: 'task' });
  // a nested list-item that itself holds a sub-item (list-item accepts list-item = arbitrary nesting)
  const errands = await svc.addItem('A', milk.id, 'errand: bank', 'alice');
  return { list, milk, bread, plumber, errands };
}

describe('shareContainerAcrossCircles — SENDABLE LISTS (app op)', () => {
  it('sends the WHOLE list into another circle: container + every child surface for the recipient, order preserved', async () => {
    const svc = makeCircleLists();
    const resolveService = async () => svc;
    const { list, milk, bread, plumber, errands } = await seedList(svc);

    const r = await shareContainerAcrossCircles({
      resolveService, policyOf: openPolicyOf,
      containerId: list.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
    });
    expect(r.ok).toBe(true);
    // pre-order: list, milk, (milk's child) errands, bread, plumber
    expect(r.order).toEqual([list.id, milk.id, errands.id, bread.id, plumber.id]);
    expect(r.failed).toEqual([]);

    // The recipient circle B surfaces EVERY node — not just the container.
    const surfaced = await listSharedResolved({ resolveService, circleId: 'B' });
    expect(surfaced.map((x) => x.item.text)).toEqual(['chores', 'milk', 'errand: bank', 'bread', 'call plumber']);

    // NESTING travels per-node: the resolved container still carries its containment edges.
    const listItem = surfaced.find((x) => x.item.id === list.id).item;
    expect(childIdsOf(listItem)).toEqual([milk.id, bread.id, plumber.id]);
  });

  it('CONTRAST: the single-item op shares ONLY the container self-pointer (children do NOT travel)', async () => {
    const svc = makeCircleLists();
    const resolveService = async () => svc;
    const { list } = await seedList(svc);

    const r = await shareItemAcrossCircles({
      resolveService, policyOf: openPolicyOf, itemId: list.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
    });
    expect(r.ok).toBe(true);
    const surfaced = await listSharedResolved({ resolveService, circleId: 'B' });
    expect(surfaced).toHaveLength(1);                       // just the list — children did NOT travel
    expect(surfaced[0].item.text).toBe('chores');
  });

  it('inherits the INITIATOR GATE — closed refuses the whole send, nothing written', async () => {
    const svc = makeCircleLists();
    const resolveService = async () => svc;
    const { list } = await seedList(svc);

    const r = await shareContainerAcrossCircles({
      resolveService, policyOf: () => ({ sharePosture: 'closed' }),
      containerId: list.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
    });
    expect(r).toEqual({ ok: false, error: 'sharing-closed' });
    expect(await listSharedResolved({ resolveService, circleId: 'B' })).toEqual([]);
  });

  it('rejects bad args + same-circle', async () => {
    const svc = makeCircleLists();
    const resolveService = async () => svc;
    expect(await shareContainerAcrossCircles({ resolveService, fromCircleId: 'A', toCircleId: 'B' }))
      .toMatchObject({ ok: false, error: 'missing-args' });
    expect(await shareContainerAcrossCircles({ resolveService, containerId: 'x', fromCircleId: 'A', toCircleId: 'A' }))
      .toMatchObject({ ok: false, error: 'same-circle' });
  });
});
