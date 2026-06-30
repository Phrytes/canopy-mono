/**
 * Lists app over the circle store (cluster L · L3, the dissolve proof).
 * A whole app — create/add/complete/remove/list — as pure functions over a CircleItemStore, with its own
 * types registered via registerType (dogfooding extensibility) and entries related by K2 containment.
 * No agent, no own store.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createRegistry, registerCanonicalTypes } from '@canopy/item-types';
import { CircleItemStore, memoryDataSource, buildAcceptsPolicy, resolveAddInContainer } from '@canopy/item-store';
import * as Lists from '../src/v2/listsApp.js';

describe('Lists app over the circle store (L3 dissolve proof)', () => {
  let store;
  beforeEach(() => {
    const reg = createRegistry();
    registerCanonicalTypes(reg);     // the canonical types
    Lists.registerListTypes(reg);    // + the Lists app's OWN types (third-party-style registration)
    store = new CircleItemStore({ dataSource: memoryDataSource(), rootContainer: 'mem://circles/c/', registry: reg });
  });

  it('a list + its items are typed records in ONE circle store, related by containment', async () => {
    const list = await Lists.createList(store, { text: 'groceries', createdBy: 'alice' });
    expect(list.type).toBe('list');
    const milk = await Lists.addItem(store, list.id, { text: 'milk', createdBy: 'alice' });
    await Lists.addItem(store, list.id, { text: 'bread', createdBy: 'alice' });
    expect(milk.type).toBe('list-item');
    expect(milk.containedBy).toEqual([list.id]);           // K2 containment — not a separate app store

    const got = await Lists.getList(store, list.id);
    expect(got.items.map((i) => i.text).sort()).toEqual(['bread', 'milk']);
  });

  it('complete + remove entries; listAll via the type index', async () => {
    const a = await Lists.createList(store, { text: 'A', createdBy: 'alice' });
    await Lists.createList(store, { text: 'B', createdBy: 'alice' });
    const item = await Lists.addItem(store, a.id, { text: 'do', createdBy: 'alice' });
    await Lists.completeItem(store, item.id);
    expect((await store.get(item.id)).done).toBe(true);
    expect((await Lists.listAll(store)).map((l) => l.text).sort()).toEqual(['A', 'B']);
    await Lists.removeItem(store, a.id, item.id);
    expect(await store.get(item.id)).toBeNull();
    expect((await Lists.getList(store, a.id)).items).toEqual([]);
  });

  it('the registered schema validates on write (a list-item needs text)', async () => {
    await expect(store.put({ type: 'list-item' })).rejects.toThrow(/invalid "list-item"/);
    await expect(store.put({ type: 'made-up-type', text: 'x' })).rejects.toThrow(/invalid "made-up-type"/);
  });

  it('composable: "add milk" in a list resolves to lists.addItem (manifest-driven, K0 verb resolution)', async () => {
    const { acceptsFor } = buildAcceptsPolicy([{ accepts: Lists.LISTS_ACCEPTS }]);
    expect(resolveAddInContainer({ container: { type: 'list' }, acceptsFor, body: 'milk' }))
      .toEqual({ op: 'lists.addItem', type: 'list-item', body: 'milk' });
  });
});
