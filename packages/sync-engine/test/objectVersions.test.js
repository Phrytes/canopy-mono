/**
 * objectVersions.test.js — γ.2 keyed-object version capture.
 *
 * Coverage:
 *   - capture → list round-trip (single + multi key isolation)
 *   - identical-sha dedup: capturing the same value twice keeps one entry
 *   - retention prunes oldest beyond N
 *   - deterministic newest-first ordering by ts (even if storage is shuffled)
 *   - input validation (bad key / missing storage)
 *   - corrupt stored list normalises to []
 *   - getLatestObjectVersion
 *   - value round-trips through JSON (post-capture mutation doesn't leak)
 */
import { describe, it, expect } from 'vitest';
import {
  captureObjectVersion,
  listObjectVersions,
  getLatestObjectVersion,
  DEFAULT_OBJECT_VERSIONS_PER_KEY,
  fingerprintHex,
} from '../src/objectVersions.js';
const sha256Of = (s) => fingerprintHex(s);

/** Map-backed mock storage matching the {getList, setList} adapter shape. */
function mockStorage() {
  const m = new Map();
  return {
    map: m,
    async getList(key) {
      return m.has(key) ? JSON.parse(JSON.stringify(m.get(key))) : [];
    },
    async setList(key, entries) {
      m.set(key, JSON.parse(JSON.stringify(entries)));
    },
  };
}

describe('captureObjectVersion', () => {
  it('captures the first save and returns the entry shape', async () => {
    const storage = mockStorage();
    const r = await captureObjectVersion({
      storage, key: 'k1', value: { a: 1 }, now: 1_700_000_000_000,
    });
    expect(r.captured).toBe(true);
    expect(r.ts).toBe(1_700_000_000_000);
    expect(r.sha256).toBe(sha256Of(JSON.stringify({ a: 1 })));
    expect(r.value).toEqual({ a: 1 });
    const list = await listObjectVersions({ storage, key: 'k1' });
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      ts: 1_700_000_000_000,
      sha256: r.sha256,
      value: { a: 1 },
    });
  });

  it('appends a second distinct save newest-first', async () => {
    const storage = mockStorage();
    await captureObjectVersion({ storage, key: 'k', value: { v: 1 }, now: 100 });
    await captureObjectVersion({ storage, key: 'k', value: { v: 2 }, now: 200 });
    const list = await listObjectVersions({ storage, key: 'k' });
    expect(list.map((e) => e.value)).toEqual([{ v: 2 }, { v: 1 }]);
    expect(list.map((e) => e.ts)).toEqual([200, 100]);
  });

  it('dedupes identical-sha back-to-back saves (no second entry)', async () => {
    const storage = mockStorage();
    await captureObjectVersion({ storage, key: 'k', value: { v: 1 }, now: 100 });
    const dup = await captureObjectVersion({ storage, key: 'k', value: { v: 1 }, now: 200 });
    expect(dup.captured).toBe(false);
    // Returned ts/sha reflect the EXISTING latest, not the dropped now.
    expect(dup.ts).toBe(100);
    const list = await listObjectVersions({ storage, key: 'k' });
    expect(list).toHaveLength(1);
    expect(list[0].ts).toBe(100);
  });

  it('does NOT dedupe when the latest sha differs (even if older entries match)', async () => {
    const storage = mockStorage();
    await captureObjectVersion({ storage, key: 'k', value: { v: 1 }, now: 100 });
    await captureObjectVersion({ storage, key: 'k', value: { v: 2 }, now: 200 });
    // Save v:1 again — latest is v:2 so this is NOT a dedup.
    const r = await captureObjectVersion({ storage, key: 'k', value: { v: 1 }, now: 300 });
    expect(r.captured).toBe(true);
    const list = await listObjectVersions({ storage, key: 'k' });
    expect(list.map((e) => e.value)).toEqual([{ v: 1 }, { v: 2 }, { v: 1 }]);
  });

  it('prunes oldest beyond the per-key retention cap', async () => {
    const storage = mockStorage();
    // Capture 5 distinct values with retention.perKey = 3.
    for (let i = 1; i <= 5; i++) {
      await captureObjectVersion({
        storage, key: 'k', value: { v: i }, now: i * 100,
        retention: { perKey: 3 },
      });
    }
    const list = await listObjectVersions({ storage, key: 'k' });
    expect(list).toHaveLength(3);
    // Newest three values, newest-first.
    expect(list.map((e) => e.value)).toEqual([{ v: 5 }, { v: 4 }, { v: 3 }]);
  });

  it('keys are isolated — capturing on one does not affect the other', async () => {
    const storage = mockStorage();
    await captureObjectVersion({ storage, key: 'a', value: { x: 1 }, now: 100 });
    await captureObjectVersion({ storage, key: 'b', value: { x: 2 }, now: 200 });
    expect((await listObjectVersions({ storage, key: 'a' }))[0].value).toEqual({ x: 1 });
    expect((await listObjectVersions({ storage, key: 'b' }))[0].value).toEqual({ x: 2 });
  });

  it('orders the returned list newest-first even if stored out-of-order', async () => {
    // Simulate a hand-edited (or migrated) storage blob with stale ordering.
    const storage = mockStorage();
    const shaA = sha256Of(JSON.stringify({ v: 1 }));
    const shaB = sha256Of(JSON.stringify({ v: 2 }));
    storage.map.set('k', [
      { ts: 100, sha256: shaA, value: { v: 1 } },
      { ts: 300, sha256: shaB, value: { v: 2 } },
      { ts: 200, sha256: shaA, value: { v: 1 } },
    ]);
    const list = await listObjectVersions({ storage, key: 'k' });
    expect(list.map((e) => e.ts)).toEqual([300, 200, 100]);
  });

  it('drops malformed entries from the stored list', async () => {
    const storage = mockStorage();
    const ok = { ts: 100, sha256: 'a'.repeat(64), value: 1 };
    storage.map.set('k', [
      ok,
      'not an object',
      { ts: 'bad', sha256: 'a'.repeat(64), value: 2 },
      { ts: 200, sha256: 'short', value: 3 },
      { ts: 300, sha256: 'A'.repeat(64) /* uppercase, fails hex check */, value: 4 },
    ]);
    const list = await listObjectVersions({ storage, key: 'k' });
    expect(list).toEqual([ok]);
  });

  it('returns [] for a corrupt / non-array stored value', async () => {
    const storage = mockStorage();
    storage.map.set('k', 'not-an-array');
    expect(await listObjectVersions({ storage, key: 'k' })).toEqual([]);
  });

  it('returns [] when getList throws', async () => {
    const storage = {
      getList: async () => { throw new Error('disk gone'); },
      setList: async () => {},
    };
    expect(await listObjectVersions({ storage, key: 'k' })).toEqual([]);
  });

  it('default per-key retention is DEFAULT_OBJECT_VERSIONS_PER_KEY (=50)', async () => {
    expect(DEFAULT_OBJECT_VERSIONS_PER_KEY).toBe(50);
    const storage = mockStorage();
    for (let i = 1; i <= 52; i++) {
      await captureObjectVersion({ storage, key: 'k', value: { v: i }, now: i });
    }
    const list = await listObjectVersions({ storage, key: 'k' });
    expect(list).toHaveLength(50);
    expect(list[0].value).toEqual({ v: 52 });
    expect(list[list.length - 1].value).toEqual({ v: 3 });
  });

  it('throws when storage adapter is missing or malformed', async () => {
    await expect(captureObjectVersion({ key: 'k', value: 1 })).rejects.toThrow(/storage/);
    await expect(captureObjectVersion({ storage: {}, key: 'k', value: 1 })).rejects.toThrow(/storage/);
  });

  it('throws when key is empty / non-string', async () => {
    const storage = mockStorage();
    await expect(captureObjectVersion({ storage, key: '', value: 1 })).rejects.toThrow(/key/);
    await expect(captureObjectVersion({ storage, key: null, value: 1 })).rejects.toThrow(/key/);
  });

  it('captured value is JSON-cloned (post-capture mutation does not leak)', async () => {
    const storage = mockStorage();
    const v = { a: 1, nested: { b: 2 } };
    await captureObjectVersion({ storage, key: 'k', value: v, now: 100 });
    // Mutate the source AFTER capture.
    v.a = 99;
    v.nested.b = 99;
    const list = await listObjectVersions({ storage, key: 'k' });
    expect(list[0].value).toEqual({ a: 1, nested: { b: 2 } });
  });
});

describe('getLatestObjectVersion', () => {
  it('returns null when no history', async () => {
    const storage = mockStorage();
    expect(await getLatestObjectVersion({ storage, key: 'k' })).toBeNull();
  });
  it('returns the newest entry', async () => {
    const storage = mockStorage();
    await captureObjectVersion({ storage, key: 'k', value: { v: 1 }, now: 100 });
    await captureObjectVersion({ storage, key: 'k', value: { v: 2 }, now: 200 });
    const latest = await getLatestObjectVersion({ storage, key: 'k' });
    expect(latest.value).toEqual({ v: 2 });
    expect(latest.ts).toBe(200);
  });
});
