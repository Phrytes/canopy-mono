/**
 * createGenericAtomHandlers — the store-backed generic CRUD that makes "declare a noun → get CRUD free"
 * real (PLAN §1b). Proves add/list/get/update/remove round-trip on an ARBITRARY noun over a real
 * CircleItemStore, with the noun authoritative as the item type and noun-scoping on read/mutate.
 */
import { describe, it, expect } from 'vitest';
import { CircleItemStore } from '../src/CircleItemStore.js';
import { memoryDataSource } from '../src/memoryDataSource.js';
import { createGenericAtomHandlers } from '../src/genericAtomHandlers.js';

const mk = (root = 'mem://c1/') =>
  new CircleItemStore({ dataSource: memoryDataSource(), rootContainer: root, registry: { validate: () => ({ ok: true }) } });

describe('createGenericAtomHandlers — declare a noun, get CRUD free', () => {
  it('add → list → get → update → remove round-trips on an arbitrary noun', async () => {
    const h = createGenericAtomHandlers(mk());
    const added = await h.add('widget', { label: 'sprocket' }, { by: 'webid:alice' });
    expect(added.ok).toBe(true);
    expect(added.item).toMatchObject({ type: 'widget', label: 'sprocket', createdBy: 'webid:alice' });
    const id = added.item.id;
    expect(id).toBeTruthy();

    expect((await h.list('widget')).items.map((i) => i.id)).toContain(id);
    expect((await h.get('widget', { id })).item.label).toBe('sprocket');

    const upd = await h.update('widget', { id, label: 'cog' }, { by: 'webid:bob' });
    expect(upd.item).toMatchObject({ label: 'cog', updatedBy: 'webid:bob' });

    expect(await h.remove('widget', { id })).toEqual({ ok: true, id });
    expect((await h.get('widget', { id })).ok).toBe(false);
    expect((await h.list('widget')).items).toEqual([]);
  });

  it('scopes by noun — get/update/remove refuse an id of a different type', async () => {
    const h = createGenericAtomHandlers(mk());
    const w = (await h.add('widget', { label: 'x' })).item;
    expect((await h.get('gadget', { id: w.id })).ok).toBe(false);
    expect((await h.update('gadget', { id: w.id, label: 'z' })).ok).toBe(false);
    expect((await h.remove('gadget', { id: w.id })).ok).toBe(false);
    expect((await h.list('gadget')).items).toEqual([]);
  });

  it('the noun is authoritative — `type`/`id` in add args are ignored', async () => {
    const h = createGenericAtomHandlers(mk());
    const r = await h.add('widget', { type: 'HACKED', id: 'HACKED', label: 'y' });
    expect(r.item.type).toBe('widget');
    expect(r.item.id).not.toBe('HACKED');
  });

  it('id-required guards on get/update/remove', async () => {
    const h = createGenericAtomHandlers(mk());
    expect((await h.get('widget', {})).ok).toBe(false);
    expect(await h.update('widget', {})).toEqual({ ok: false, code: 'id-required' });
    expect(await h.remove('widget', {})).toEqual({ ok: false, code: 'id-required' });
  });

  it('store validation errors surface (throw)', async () => {
    const store = new CircleItemStore({
      dataSource: memoryDataSource(), rootContainer: 'mem://c2/',
      registry: { validate: (it) => (it.type === 'ok' ? { ok: true } : { ok: false, errors: [{ message: 'nope' }] }) },
    });
    await expect(createGenericAtomHandlers(store).add('widget', {})).rejects.toThrow(/nope/);
  });

  it('requires a store-shaped object', () => {
    expect(() => createGenericAtomHandlers({})).toThrow(/store/i);
  });
});
