// γ.2 (2026-06-01) — AsyncStorage-backed versions adapter round-trip.
//
// Mirrors `apps/canopy-chat/test/v2/objectVersionsStorage.test.js`:
// proves the AsyncStorage adapter produces the same key shape
// (`cc.versions.<storeName>.<circleId>`) so a future pod-sync sees
// one shape on both surfaces.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  asyncObjectVersionsIo,
  asyncStorageObjectVersions,
} from '../src/core/objectVersionsStorageRN.js';

function mockAsyncStorage() {
  const m = new Map();
  return {
    map: m,
    async getItem(k)    { return m.has(k) ? m.get(k) : null; },
    async setItem(k, v) { m.set(k, String(v)); },
    async removeItem(k) { m.delete(k); },
  };
}

describe('γ.2 — objectVersionsStorageRN', () => {
  let storage;
  beforeEach(() => { storage = mockAsyncStorage(); });

  it('round-trips through cc.versions.<storeName>.<circleId>', async () => {
    const adapter = asyncStorageObjectVersions('policy', storage);
    await adapter.capture('c1', { features: { tasks: true } });
    expect([...storage.map.keys()]).toContain('cc.versions.policy.c1');
    const list = await adapter.list('c1');
    expect(list).toHaveLength(1);
    expect(list[0].value).toEqual({ features: { tasks: true } });
  });

  it('mobile + web key shape is identical (cc.versions.<storeName>.<id>)', async () => {
    const adapter = asyncStorageObjectVersions('recipe', storage);
    await adapter.capture('circle-42', { recipes: [], activeId: null });
    expect([...storage.map.keys()]).toEqual(['cc.versions.recipe.circle-42']);
  });

  it('asyncObjectVersionsIo tolerates corrupt JSON (returns null)', async () => {
    storage.map.set('cc.versions.policy.bad', '{not json');
    expect(await asyncObjectVersionsIo(storage).load('cc.versions.policy.bad')).toBeNull();
  });

  it('list spans capture sessions (a fresh adapter sees prior history)', async () => {
    const a = asyncStorageObjectVersions('rules', storage);
    await a.capture('c1', { purpose: 'A' });
    await a.capture('c1', { purpose: 'B' });

    const b = asyncStorageObjectVersions('rules', storage);
    const list = await b.list('c1');
    expect(list.map((e) => e.value)).toEqual([{ purpose: 'B' }, { purpose: 'A' }]);
  });

  it('honours custom retention.perKey', async () => {
    const adapter = asyncStorageObjectVersions('policy', storage, { perKey: 2 });
    await adapter.capture('c1', { v: 1 });
    await adapter.capture('c1', { v: 2 });
    await adapter.capture('c1', { v: 3 });
    const list = await adapter.list('c1');
    expect(list.map((e) => e.value)).toEqual([{ v: 3 }, { v: 2 }]);
  });
});
