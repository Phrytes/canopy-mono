/**
 * γ.2 — objectVersionsStorage: concrete versions adapter for kring stores.
 *
 * Layer above the sync-engine substrate (`objectVersions.js`).  Adds the
 * canopy-chat-specific concerns:
 *   - Per-storeName key prefix (`cc.versions.<storeName>.<circleId>`).
 *   - Store/load round-trip through a generic {load, save} IO.
 *   - Multiple keys / multiple circles don't collide.
 *   - Corrupt JSON in storage falls back to an empty history.
 *   - capture/list defensively no-op on bad circleId.
 */
import { describe, it, expect } from 'vitest';
import {
  createObjectVersionsAdapter,
  localStorageVersionsIo,
  localStorageObjectVersions,
} from '../../src/v2/objectVersionsStorage.js';

/** Map-backed storage matching globalThis.localStorage shape. */
function mockLocalStorage() {
  const m = new Map();
  return {
    map: m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

describe('createObjectVersionsAdapter', () => {
  it('captures + lists through the injected IO', async () => {
    const mem = new Map();
    const io = {
      load: async (k) => (mem.has(k) ? mem.get(k) : null),
      save: async (k, v) => { mem.set(k, v); },
    };
    const adapter = createObjectVersionsAdapter({ storeName: 'policy', io });
    await adapter.capture('c1', { v: 1 });
    await adapter.capture('c1', { v: 2 });
    const list = await adapter.list('c1');
    expect(list.map((e) => e.value)).toEqual([{ v: 2 }, { v: 1 }]);
    // Stored under the namespaced key.
    expect(mem.has('cc.versions.policy.c1')).toBe(true);
  });

  it('namespaces by storeName + circleId — different stores do not collide', async () => {
    const mem = new Map();
    const io = {
      load: async (k) => (mem.has(k) ? mem.get(k) : null),
      save: async (k, v) => { mem.set(k, v); },
    };
    const policy = createObjectVersionsAdapter({ storeName: 'policy', io });
    const recipe = createObjectVersionsAdapter({ storeName: 'recipe', io });
    await policy.capture('c1', { kind: 'p' });
    await recipe.capture('c1', { kind: 'r' });
    expect([...mem.keys()].sort()).toEqual([
      'cc.versions.policy.c1',
      'cc.versions.recipe.c1',
    ]);
    expect((await policy.list('c1'))[0].value).toEqual({ kind: 'p' });
    expect((await recipe.list('c1'))[0].value).toEqual({ kind: 'r' });
  });

  it('different circleIds within the same store do not collide', async () => {
    const mem = new Map();
    const adapter = createObjectVersionsAdapter({
      storeName: 'policy',
      io: {
        load: async (k) => (mem.has(k) ? mem.get(k) : null),
        save: async (k, v) => { mem.set(k, v); },
      },
    });
    await adapter.capture('c1', { v: 1 });
    await adapter.capture('c2', { v: 2 });
    expect((await adapter.list('c1'))[0].value).toEqual({ v: 1 });
    expect((await adapter.list('c2'))[0].value).toEqual({ v: 2 });
  });

  it('capture is a no-op for missing / non-string circleId', async () => {
    const mem = new Map();
    const adapter = createObjectVersionsAdapter({
      storeName: 'policy',
      io: {
        load: async (k) => (mem.has(k) ? mem.get(k) : null),
        save: async (k, v) => { mem.set(k, v); },
      },
    });
    await adapter.capture('', { v: 1 });
    await adapter.capture(null, { v: 1 });
    expect(mem.size).toBe(0);
    expect(await adapter.list('')).toEqual([]);
  });

  it('list tolerates a throwing IO and returns []', async () => {
    const adapter = createObjectVersionsAdapter({
      storeName: 'policy',
      io: {
        load: async () => { throw new Error('disk gone'); },
        save: async () => {},
      },
    });
    expect(await adapter.list('c1')).toEqual([]);
  });

  it('throws on missing storeName / io', () => {
    expect(() => createObjectVersionsAdapter({})).toThrow(/storeName/);
    expect(() => createObjectVersionsAdapter({ storeName: 'x' })).toThrow(/io/);
    expect(() => createObjectVersionsAdapter({ storeName: 'x', io: {} })).toThrow(/io/);
  });

  it('honours a custom retention.perKey', async () => {
    const mem = new Map();
    const adapter = createObjectVersionsAdapter({
      storeName: 'policy',
      io: {
        load: async (k) => (mem.has(k) ? mem.get(k) : null),
        save: async (k, v) => { mem.set(k, v); },
      },
      retention: { perKey: 2 },
    });
    await adapter.capture('c1', { v: 1 });
    await adapter.capture('c1', { v: 2 });
    await adapter.capture('c1', { v: 3 });
    const list = await adapter.list('c1');
    expect(list.map((e) => e.value)).toEqual([{ v: 3 }, { v: 2 }]);
  });
});

describe('localStorageVersionsIo', () => {
  it('round-trips through a Storage-like backend', async () => {
    const storage = mockLocalStorage();
    const io = localStorageVersionsIo(storage);
    await io.save('cc.versions.policy.c1', [{ ts: 1, sha256: 'x', value: 1 }]);
    expect(await io.load('cc.versions.policy.c1'))
      .toEqual([{ ts: 1, sha256: 'x', value: 1 }]);
  });

  it('load returns null for corrupt JSON', async () => {
    const storage = mockLocalStorage();
    storage.map.set('cc.versions.policy.c1', 'not json{');
    expect(await localStorageVersionsIo(storage).load('cc.versions.policy.c1')).toBeNull();
  });

  it('save tolerates a throwing storage (quota / disabled)', async () => {
    const storage = {
      getItem: () => null,
      setItem: () => { throw new Error('quota'); },
    };
    await expect(
      localStorageVersionsIo(storage).save('k', [1, 2])
    ).resolves.toBeUndefined();
  });
});

describe('localStorageObjectVersions × kring scenario', () => {
  it('a fresh adapter over the same storage sees the prior history', async () => {
    const storage = mockLocalStorage();
    const a = localStorageObjectVersions('policy', storage);
    await a.capture('c1', { v: 1 });
    await a.capture('c1', { v: 2 });

    // Simulate a fresh app launch.
    const b = localStorageObjectVersions('policy', storage);
    const list = await b.list('c1');
    expect(list.map((e) => e.value)).toEqual([{ v: 2 }, { v: 1 }]);
  });

  it('corrupt storage value falls back to an empty history (no throw)', async () => {
    const storage = mockLocalStorage();
    storage.map.set('cc.versions.policy.c1', 'garbage');
    const a = localStorageObjectVersions('policy', storage);
    expect(await a.list('c1')).toEqual([]);
    // A subsequent capture overwrites garbage with a clean array.
    await a.capture('c1', { v: 1 });
    expect((await a.list('c1'))[0].value).toEqual({ v: 1 });
  });
});
