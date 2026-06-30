/**
 * listsService (cluster L · L3 live wiring) — the dissolved Lists app, callable via the callSkill shape,
 * scoped per circle. Additive: a new 'lists' app-origin over the substrate, no household-agent retirement.
 */
import { describe, it, expect } from 'vitest';
import { createListsService } from '../src/v2/listsService.js';

describe('listsService — callSkill over the circle store', () => {
  it('routes lists ops to the active circle store + round-trips a list with items', async () => {
    const svc = createListsService();   // in-memory no-pod default, canonical + Lists registry
    const ctx = { circleId: 'c1' };
    const list = await svc.callSkill('createList', { text: 'groceries', createdBy: 'alice' }, ctx);
    await svc.callSkill('addItem', { listId: list.id, text: 'milk', createdBy: 'alice' }, ctx);
    await svc.callSkill('addItem', { listId: list.id, text: 'bread', createdBy: 'alice' }, ctx);

    const got = await svc.callSkill('getList', { listId: list.id }, ctx);
    expect(got.items.map((i) => i.text).sort()).toEqual(['bread', 'milk']);
    expect((await svc.callSkill('listAll', {}, ctx)).map((l) => l.text)).toEqual(['groceries']);
  });

  it('isolates lists per circle', async () => {
    const svc = createListsService();
    await svc.callSkill('createList', { text: 'in A', createdBy: 'a' }, { circleId: 'A' });
    await svc.callSkill('createList', { text: 'in B', createdBy: 'b' }, { circleId: 'B' });
    expect((await svc.callSkill('listAll', {}, { circleId: 'A' })).map((l) => l.text)).toEqual(['in A']);
    expect((await svc.callSkill('listAll', {}, { circleId: 'B' })).map((l) => l.text)).toEqual(['in B']);
  });

  it('complete + remove via callSkill', async () => {
    const svc = createListsService();
    const ctx = { circleId: 'c' };
    const list = await svc.callSkill('createList', { text: 'L', createdBy: 'a' }, ctx);
    const item = await svc.callSkill('addItem', { listId: list.id, text: 'do', createdBy: 'a' }, ctx);
    await svc.callSkill('completeItem', { itemId: item.id }, ctx);
    expect((await svc.callSkill('getList', { listId: list.id }, ctx)).items[0].done).toBe(true);
    await svc.callSkill('removeItem', { listId: list.id, itemId: item.id }, ctx);
    expect((await svc.callSkill('getList', { listId: list.id }, ctx)).items).toEqual([]);
  });

  it('guards: circleId required, unknown op rejected; exposes the accepts policy', async () => {
    const svc = createListsService();
    await expect(svc.callSkill('listAll', {}, {})).rejects.toThrow(/circleId/);
    await expect(svc.callSkill('bogus', {}, { circleId: 'c' })).rejects.toThrow(/unknown op "bogus"/);
    expect(svc.accepts.list[0]).toMatchObject({ type: 'list-item', op: 'lists.addItem' });
  });
});
