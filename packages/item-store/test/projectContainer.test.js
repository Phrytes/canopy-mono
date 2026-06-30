/**
 * projectContainer (cluster K · K2) — recursive child-render projector over containment.
 * The offer→list→tasks nest rendered as one tree, heterogeneous, each via its type's render shape.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CircleItemStore } from '../src/CircleItemStore.js';
import { memoryDataSource } from '../src/memoryDataSource.js';
import { contain } from '../src/containment.js';
import { projectContainer } from '../src/projectContainer.js';

const registry = { validate: () => ({ ok: true }) };   // permissive — shapes under test, not validation

describe('projectContainer (K2 recursive projector)', () => {
  let store;
  beforeEach(() => { store = new CircleItemStore({ dataSource: memoryDataSource(), rootContainer: 'mem://circles/c/', registry }); });
  const put = (item) => store.put({ createdBy: 'alice', ...item });

  it('renders offer→list→tasks as a nested tree (default label = text)', async () => {
    const offer = await put({ type: 'offer', text: 'help moving' });
    const list  = await put({ type: 'list', text: 'moving tasks' });
    const t1 = await put({ type: 'task', text: 'box up books' });
    const t2 = await put({ type: 'task', text: 'rent a van' });
    await contain(store, offer.id, list.id);
    await contain(store, list.id, t1.id);
    await contain(store, list.id, t2.id);

    const tree = await projectContainer(store, offer.id);
    expect(tree.label).toBe('help moving');
    expect(tree.children).toHaveLength(1);
    const listNode = tree.children[0];
    expect(listNode.label).toBe('moving tasks');
    expect(listNode.children.map((c) => c.label).sort()).toEqual(['box up books', 'rent a van']);
    expect(listNode.children.every((c) => c.type === 'task')).toBe(true);   // heterogeneous, typed
  });

  it('uses the injected renderFor (per-type label + row-actions)', async () => {
    const list = await put({ type: 'list', text: 'chores' });
    const task = await put({ type: 'task', text: 'sweep' });
    await contain(store, list.id, task.id);

    const renderFor = (item) => item.type === 'task'
      ? { label: `☐ ${item.text}`, rowActions: ['claimTask', 'completeTask'] }
      : { label: item.text, rowActions: ['addTask'] };
    const tree = await projectContainer(store, list.id, { renderFor });
    expect(tree.rowActions).toEqual(['addTask']);
    expect(tree.children[0]).toMatchObject({ label: '☐ sweep', rowActions: ['claimTask', 'completeTask'] });
  });

  it('skips refs to deleted children (survive-on-delete) + bounds depth', async () => {
    const list = await put({ type: 'list', text: 'L' });
    const a = await put({ type: 'task', text: 'a' });
    const b = await put({ type: 'task', text: 'b' });
    await contain(store, list.id, a.id);
    await contain(store, list.id, b.id);
    await store.delete(a.id);                              // a's ref dangles
    const tree = await projectContainer(store, list.id);
    expect(tree.children.map((c) => c.label)).toEqual(['b']);   // dangling 'a' skipped

    expect(await projectContainer(store, 'nope')).toBeNull();
    expect((await projectContainer(store, list.id, { maxDepth: 0 })).children).toEqual([]);   // depth 0 → no children
  });

  it('guards cycles (a contains b contains a)', async () => {
    const a = await put({ type: 'list', text: 'A' });
    const b = await put({ type: 'list', text: 'B' });
    await contain(store, a.id, b.id);
    await contain(store, b.id, a.id);                      // cycle
    const tree = await projectContainer(store, a.id);
    expect(tree.label).toBe('A');
    expect(tree.children[0].label).toBe('B');
    expect(tree.children[0].children).toEqual([]);         // back-edge to A pruned, no infinite loop
  });
});
