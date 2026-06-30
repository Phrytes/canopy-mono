/**
 * containerOps (cluster K · K2) — the composable-op engine: addChildTo + resolveContainerAdd
 * (the K0-deferred natural-verb "add X picks the child type by the active container").
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CircleItemStore } from '../src/CircleItemStore.js';
import { memoryDataSource } from '../src/memoryDataSource.js';
import { addChildTo, resolveContainerAdd } from '../src/containerOps.js';
import { childIdsOf } from '../src/containment.js';

const registry = {
  validate: (it) => (['list', 'task', 'note', 'list-item'].includes(it.type) ? { ok: true } : { ok: false, errors: [{ message: `bad ${it.type}` }] }),
};

describe('addChildTo', () => {
  let store;
  beforeEach(() => { store = new CircleItemStore({ dataSource: memoryDataSource(), rootContainer: 'mem://circles/c/', registry }); });

  it('creates the child in the same store + contains it (ref + back-ref)', async () => {
    const list = await store.put({ type: 'list', text: 'chores' });
    const child = await addChildTo(store, list.id, { type: 'task', text: 'fix tap', createdBy: 'alice' });
    expect(child.id).toBeTruthy();
    expect(child.type).toBe('task');
    expect(child.containedBy).toEqual([list.id]);                 // back-ref
    expect(childIdsOf(await store.get(list.id))).toEqual([child.id]);  // edge on the container
  });

  it('validates the child type via the store + guards bad input', async () => {
    const list = await store.put({ type: 'list', text: 'x' });
    await expect(addChildTo(store, list.id, { type: 'bogus' })).rejects.toThrow(/bad bogus/);
    await expect(addChildTo(store, list.id, {})).rejects.toThrow(/childItem\.type/);
    await expect(addChildTo(store, 'nope', { type: 'task' })).rejects.toThrow(/container "nope" not found/);
  });
});

describe('resolveContainerAdd (K0 natural-verb context resolution)', () => {
  it('no accepts → null (not composable here → normal add)', () => {
    expect(resolveContainerAdd({ accepts: [] })).toBeNull();
    expect(resolveContainerAdd({})).toBeNull();
  });

  it('single accepted type → that one', () => {
    expect(resolveContainerAdd({ accepts: [{ type: 'list-item', op: 'addItem' }] }))
      .toEqual({ type: 'list-item', op: 'addItem' });
  });

  it('multiple with a default → the default (e.g. a list defaults to list-item over task)', () => {
    const accepts = [{ type: 'task', op: 'addTask' }, { type: 'list-item', op: 'addItem', default: true }];
    expect(resolveContainerAdd({ accepts })).toEqual({ type: 'list-item', op: 'addItem' });
  });

  it('multiple, no default → ambiguous (the caller asks which)', () => {
    const accepts = [{ type: 'task', op: 'addTask' }, { type: 'note', op: 'addNote' }];
    expect(resolveContainerAdd({ accepts })).toEqual({ ambiguous: [{ type: 'task', op: 'addTask' }, { type: 'note', op: 'addNote' }] });
  });

  it('an explicit hint wins over default/ambiguity ("add a TASK …")', () => {
    const accepts = [{ type: 'task', op: 'addTask' }, { type: 'note', op: 'addNote', default: true }];
    expect(resolveContainerAdd({ accepts, hint: 'task' })).toEqual({ type: 'task', op: 'addTask' });
    // a hint that isn't accepted is ignored → falls back to default
    expect(resolveContainerAdd({ accepts, hint: 'event' })).toEqual({ type: 'note', op: 'addNote' });
  });
});
