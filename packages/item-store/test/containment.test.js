/**
 * containment over a CircleItemStore — the offer→list→tasks model.
 * Covers: contain (ref + back-ref), heterogeneous + nested children, multi-parent, uncontain,
 * cascade=SURVIVE on delete, and the "loose items"/orphans list.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CircleItemStore } from '../src/CircleItemStore.js';
import { memoryDataSource } from '../src/memoryDataSource.js';
import { contain, uncontain, listChildren, parentsOf, deleteContainer, listLoose, childIdsOf } from '../src/containment.js';

const registry = {
  validate: (it) => (['offer', 'list', 'task', 'note'].includes(it.type) ? { ok: true } : { ok: false, errors: [{ message: `bad ${it.type}` }] }),
};

describe('containment (K2)', () => {
  let store;
  beforeEach(() => { store = new CircleItemStore({ dataSource: memoryDataSource(), rootContainer: 'mem://circles/c/', registry }); });

  const put = (item) => store.put({ createdBy: 'alice', ...item });

  it('contain adds a ref edge on the parent + a back-ref on the child (heterogeneous children)', async () => {
    const list = await put({ type: 'list', text: 'chores' });
    const task = await put({ type: 'task', text: 'fix tap' });
    const note = await put({ type: 'note', text: 'remember' });
    await contain(store, list.id, task.id);
    await contain(store, list.id, note.id);

    const reloaded = await store.get(list.id);
    expect(childIdsOf(reloaded).sort()).toEqual([task.id, note.id].sort());
    expect(reloaded.embeds.every((e) => e.rel === 'contains')).toBe(true);
    expect((await store.get(task.id)).containedBy).toEqual([list.id]);
    expect((await store.get(task.id)).wasContained).toBe(true);

    const kids = await listChildren(store, list.id);
    expect(kids.map((k) => k.type).sort()).toEqual(['note', 'task']);
  });

  it('models the offer→list→tasks nest (2 levels)', async () => {
    const offer = await put({ type: 'offer', text: 'help moving' });
    const list  = await put({ type: 'list', text: 'moving tasks' });
    const t1 = await put({ type: 'task', text: 'box up books' });
    const t2 = await put({ type: 'task', text: 'rent a van' });
    await contain(store, offer.id, list.id);
    await contain(store, list.id, t1.id);
    await contain(store, list.id, t2.id);

    expect((await listChildren(store, offer.id)).map((c) => c.type)).toEqual(['list']);
    expect((await listChildren(store, list.id)).map((c) => c.text).sort()).toEqual(['box up books', 'rent a van']);
  });

  it('supports multi-parent (a task in two lists)', async () => {
    const a = await put({ type: 'list', text: 'A' });
    const b = await put({ type: 'list', text: 'B' });
    const t = await put({ type: 'task', text: 'shared' });
    await contain(store, a.id, t.id);
    await contain(store, b.id, t.id);
    expect((await parentsOf(store, t.id)).sort()).toEqual([a.id, b.id].sort());
    // uncontain from A keeps B
    await uncontain(store, a.id, t.id);
    expect(await parentsOf(store, t.id)).toEqual([b.id]);
    expect(childIdsOf(await store.get(a.id))).toEqual([]);
  });

  it('cascade = SURVIVE: deleting a container leaves children alive + orphaned', async () => {
    const list = await put({ type: 'list', text: 'temp' });
    const t1 = await put({ type: 'task', text: 'keep me' });
    const t2 = await put({ type: 'task', text: 'keep me too' });
    await contain(store, list.id, t1.id);
    await contain(store, list.id, t2.id);

    const orphaned = await deleteContainer(store, list.id);
    expect(orphaned.sort()).toEqual([t1.id, t2.id].sort());
    expect(await store.get(list.id)).toBeNull();         // the container is gone
    expect(await store.get(t1.id)).not.toBeNull();       // the children SURVIVE
    expect((await store.get(t1.id)).containedBy).toEqual([]);  // detached
  });

  it('listLoose finds uncontained owned items; orphansOnly excludes never-nested top-level items', async () => {
    const offer = await put({ type: 'offer', text: 'top-level, never nested' });
    const list  = await put({ type: 'list', text: 'doomed' });
    const task  = await put({ type: 'task', text: 'will be orphaned' });
    const bobItem = await store.put({ createdBy: 'bob', type: 'task', text: 'not alices' });
    await contain(store, list.id, task.id);
    await deleteContainer(store, list.id);   // task → orphaned

    const loose = await listLoose(store, 'alice');
    expect(loose.map((i) => i.text).sort()).toEqual(['top-level, never nested', 'will be orphaned']);
    expect(loose.some((i) => i.id === bobItem.id)).toBe(false);   // owner-scoped

    const orphans = await listLoose(store, 'alice', { orphansOnly: true });
    expect(orphans.map((i) => i.text)).toEqual(['will be orphaned']);   // the offer (never nested) is excluded
  });

  it('contain is idempotent + rejects self-containment', async () => {
    const a = await put({ type: 'list', text: 'a' });
    const t = await put({ type: 'task', text: 't' });
    await contain(store, a.id, t.id);
    await contain(store, a.id, t.id);   // again
    expect(childIdsOf(await store.get(a.id))).toEqual([t.id]);   // not duplicated
    expect((await store.get(t.id)).containedBy).toEqual([a.id]);
    await expect(contain(store, a.id, a.id)).rejects.toThrow(/cannot contain itself/);
  });
});
