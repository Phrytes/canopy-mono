/**
 * CircleItemStore (cluster L · L1) — the per-circle, type-indexed generic store.
 *
 * Proves the keystone contract: typed CRUD + a `type` index + registry validation on write, over an
 * injected DataSource (so a sealed/pod-backed source plugs in unchanged). The registry is a stub here —
 * the real `@onderling/item-types` `createRegistry()` injects the same `validate(item)→{ok,errors}` shape,
 * and third-party types extend it via `registerType` (the extensibility corner).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CircleItemStore } from '../src/CircleItemStore.js';

/** A Map-backed in-memory DataSource (read/write/delete/list). */
function memSource() {
  const m = new Map();
  return {
    _map: m,
    async read(uri)        { return m.has(uri) ? m.get(uri) : null; },
    async write(uri, str)  { m.set(uri, str); },
    async delete(uri)      { m.delete(uri); },
    async list(prefix)     { return [...m.keys()].filter((k) => k.startsWith(prefix)); },
  };
}

/** A registry stub: knows `task` + `note`; rejects everything else (mirrors @onderling/item-types `validate`). */
const KNOWN = new Set(['task', 'note', 'list', 'offer']);
const registry = {
  validate: (item) => KNOWN.has(item.type)
    ? { ok: true }
    : { ok: false, errors: [{ message: `unknown type: "${item.type}"` }] },
};

describe('CircleItemStore (L1)', () => {
  let store;
  let source;
  beforeEach(() => {
    source = memSource();
    store = new CircleItemStore({ dataSource: source, rootContainer: 'mem://circles/c1/', registry });
  });

  it('put assigns a ULID id, validates, and round-trips via get', async () => {
    const saved = await store.put({ type: 'task', text: 'fix the tap' });
    expect(saved.id).toMatch(/^[0-9A-Za-z]{20,}$/);   // a ULID
    expect(saved.type).toBe('task');
    const got = await store.get(saved.id);
    expect(got).toEqual(saved);
  });

  it('preserves a caller-supplied id', async () => {
    const saved = await store.put({ id: 'fixed-1', type: 'note', text: 'hi' });
    expect(saved.id).toBe('fixed-1');
    expect(await store.get('fixed-1')).toMatchObject({ id: 'fixed-1', type: 'note' });
  });

  it('rejects an item whose type fails registry validation', async () => {
    await expect(store.put({ type: 'bogus', text: 'x' })).rejects.toThrow(/invalid "bogus"/);
  });

  it('requires a type', async () => {
    await expect(store.put({ text: 'no type' })).rejects.toThrow(/item\.type is required/);
  });

  it('listByType is the type index — segregates heterogeneous items in one circle store', async () => {
    await store.put({ type: 'task',  text: 't1' });
    await store.put({ type: 'task',  text: 't2' });
    await store.put({ type: 'note',  text: 'n1' });
    await store.put({ type: 'offer', text: 'o1' });
    expect(await store.list()).toHaveLength(4);
    expect((await store.listByType('task')).map((i) => i.text).sort()).toEqual(['t1', 't2']);
    expect(await store.listByType('note')).toHaveLength(1);
    expect(await store.listByType('calendar-event')).toHaveLength(0);
  });

  it('delete removes an item', async () => {
    const { id } = await store.put({ type: 'note', text: 'temp' });
    await store.delete(id);
    expect(await store.get(id)).toBeNull();
    expect(await store.list()).toHaveLength(0);
  });

  it('works with NO registry injected (validation simply skipped)', async () => {
    const s = new CircleItemStore({ dataSource: memSource(), rootContainer: 'mem://circles/c2/' });
    const saved = await s.put({ type: 'anything', text: 'x' });
    expect(saved.type).toBe('anything');
  });

  it('two circles get fully separate stores (no cross-circle bleed)', async () => {
    const shared = memSource();
    const a = new CircleItemStore({ dataSource: shared, rootContainer: 'mem://circles/A/', registry });
    const b = new CircleItemStore({ dataSource: shared, rootContainer: 'mem://circles/B/', registry });
    await a.put({ type: 'task', text: 'in A' });
    await b.put({ type: 'task', text: 'in B' });
    expect((await a.list()).map((i) => i.text)).toEqual(['in A']);
    expect((await b.list()).map((i) => i.text)).toEqual(['in B']);
  });

  it('rejects construction without a dataSource or rootContainer', () => {
    expect(() => new CircleItemStore({ rootContainer: 'x/' })).toThrow(/dataSource/);
    expect(() => new CircleItemStore({ dataSource: memSource() })).toThrow(/rootContainer/);
  });
});
