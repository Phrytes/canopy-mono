/**
 * shareIntoAudience (cluster K · K2) — the cross-circle share op. A per-item `shared-ref` into a target
 * circle (NOT a copy, NOT a transitive grant), the posture floor (no confidentiality downgrade), and
 * resolution back to the source (the 🔒-gated cross-pod read, in-memory here).
 */
import { describe, it, expect } from 'vitest';
import {
  createCircleStores, memoryDataSource, contain,
  shareIntoAudience, resolveSharedRef, listShared,
} from '../src/index.js';

function mkStores() {
  const registry = { validate: () => ({ ok: true }) };   // permissive — the shared-ref schema is tested in @canopy/item-types
  return createCircleStores({ dataSource: memoryDataSource(), registry });
}

describe('shareIntoAudience', () => {
  it('shares an item into another circle as a per-item ref; resolves back to the source', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'task', text: 'secret plan' });
    const r = await shareIntoAudience(stores, { itemId: item.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice' });
    expect(r.ok).toBe(true);
    expect(r.ref).toMatchObject({ type: 'shared-ref', sourceCircle: 'A', sourceId: item.id, sourceType: 'task', sharedBy: 'alice' });

    const shared = await listShared(stores, 'B');                   // B sees the shared-ref
    expect(shared.map((s) => s.sourceId)).toEqual([item.id]);
    expect((await resolveSharedRef(stores, r.ref)).text).toBe('secret plan');   // resolves to A's item
  });

  it('enforces the POSTURE FLOOR — refuses a downgrade into a less-confidential circle', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'task', text: 'confidential' });
    const postureOf = (c) => ({ A: 3, Public: 0, Private: 3 }[c] ?? 0);
    // item required posture 3 → into a public (0) circle = downgrade → refused
    expect(await shareIntoAudience(stores, { itemId: item.id, fromCircleId: 'A', toCircleId: 'Public', posture: 3, postureOf }))
      .toMatchObject({ ok: false, error: 'posture-floor', required: 3, target: 0 });
    // into an equally-confidential (3) circle → allowed
    expect((await shareIntoAudience(stores, { itemId: item.id, fromCircleId: 'A', toCircleId: 'Private', posture: 3, postureOf })).ok).toBe(true);
  });

  it('NO transitive grant — sharing one item exposes only it, not its container or siblings', async () => {
    const stores = mkStores();
    const A = stores.getStore('A');
    const list = await A.put({ type: 'task', text: 'the list' });   // stand-in container
    const a = await A.put({ type: 'task', text: 'item A' });
    const b = await A.put({ type: 'task', text: 'item B' });
    await contain(A, list.id, a.id);
    await contain(A, list.id, b.id);

    const r = await shareIntoAudience(stores, { itemId: a.id, fromCircleId: 'A', toCircleId: 'B' });
    expect(r.ok).toBe(true);
    const shared = await listShared(stores, 'B');
    expect(shared).toHaveLength(1);
    expect(shared[0].sourceId).toBe(a.id);                          // ONLY a — not the list, not b
    expect((await resolveSharedRef(stores, shared[0])).text).toBe('item A');
    expect(await stores.getStore('B').listByType('task')).toEqual([]);   // B holds no copy of A's items
  });

  it('rejects bad args', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'task', text: 'x' });
    expect(await shareIntoAudience(stores, { itemId: item.id, fromCircleId: 'A', toCircleId: 'A' })).toMatchObject({ ok: false, error: 'same-circle' });
    expect(await shareIntoAudience(stores, { itemId: 'nope', fromCircleId: 'A', toCircleId: 'B' })).toMatchObject({ ok: false, error: 'item-not-found' });
    expect(await shareIntoAudience(stores, { fromCircleId: 'A', toCircleId: 'B' })).toMatchObject({ ok: false, error: 'missing-args' });
    expect(await resolveSharedRef(stores, { type: 'task' })).toBeNull();
  });
});
