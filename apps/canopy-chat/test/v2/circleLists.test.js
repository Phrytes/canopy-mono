/**
 * circleLists (cluster K · K2) — the shared composable-lists data layer (web≡mobile). create/add/complete
 * over the container substrate, per-circle scoping, and the PERSISTENCE contract (a fresh service over the
 * same DataSource reads prior data back — what the IDB/AsyncStorage backing gives the live app).
 */
import { describe, it, expect } from 'vitest';
import { memoryDataSource } from '@canopy/item-store';
import { makeCircleLists } from '../../src/v2/circleLists.js';

describe('circleLists', () => {
  it('create → add (contained) → complete', async () => {
    const svc = makeCircleLists({ dataSource: memoryDataSource() });
    const list = await svc.createList('c1', 'groceries');
    await svc.addItem('c1', list.id, 'milk');
    const tree = await svc.tree('c1', list.id);
    expect(tree.label).toBe('groceries');
    expect(tree.canAdd).toBe(true);
    expect(tree.children.map((c) => c.label)).toContain('milk');          // the item is CONTAINED in the list

    await svc.markDone('c1', tree.children[0].id);
    const done = await svc.tree('c1', list.id);
    expect(done.children[0].label).toBe('✓ milk');                        // completed render shape
  });

  it('persists across service instances over the same DataSource', async () => {
    const ds = memoryDataSource();
    const a = makeCircleLists({ dataSource: ds });
    const list = await a.createList('c1', 'groceries');
    await a.addItem('c1', list.id, 'milk');
    // a fresh service over the SAME backing reads it back — the persistence contract the IDB/AsyncStorage gives.
    const b = makeCircleLists({ dataSource: ds });
    expect((await b.listLists('c1')).map((l) => l.text)).toContain('groceries');
    expect((await b.tree('c1', list.id)).children.map((c) => c.label)).toContain('milk');
  });

  it('rootPrefix threads to the store keys (L1b: keys become canonical pod URIs)', async () => {
    // The pod tier passes rootPrefix = `<podRoot>/group/`; the store then keys items under
    // `<rootPrefix><circleId>/items/<id>.json` — i.e. `resourceUriFor('fam','<id>.json')`.
    const ds = memoryDataSource();
    const svc = makeCircleLists({ dataSource: ds, rootPrefix: 'https://alice.pod/group/' });
    const list = await svc.createList('fam', 'groceries');
    const keys = [...ds._map.keys()];
    expect(keys).toContain(`https://alice.pod/group/fam/items/${list.id}.json`);
  });

  it('scopes lists per circle', async () => {
    const svc = makeCircleLists({ dataSource: memoryDataSource() });
    await svc.createList('c1', 'in c1');
    await svc.createList('c2', 'in c2');
    expect((await svc.listLists('c1')).map((l) => l.text)).toEqual(['in c1']);
    expect((await svc.listLists('c2')).map((l) => l.text)).toEqual(['in c2']);
  });

  it('remove drops an item from the list', async () => {
    const svc = makeCircleLists({ dataSource: memoryDataSource() });
    const list = await svc.createList('c1', 'L');
    const item = await svc.addItem('c1', list.id, 'gone');
    await svc.remove('c1', item.id);
    expect((await svc.tree('c1', list.id)).children).toEqual([]);
  });

  // ── manifest-accepts: the child type is policy-driven, and a list-item is itself a container ──────────
  it('addItem resolves the child type from the accepts policy (list → list-item)', async () => {
    const svc = makeCircleLists({ dataSource: memoryDataSource() });
    const list = await svc.createList('c1', 'L');
    const child = await svc.addItem('c1', list.id, 'milk');
    expect(child.type).toBe('list-item');                       // resolved from the policy, not hardcoded at the call site
  });

  it('a list-item ACCEPTS sub-items → composition (arbitrary nesting)', async () => {
    const svc = makeCircleLists({ dataSource: memoryDataSource() });
    const list = await svc.createList('c1', 'groceries');
    const item = await svc.addItem('c1', list.id, 'milk');
    const sub  = await svc.addItem('c1', item.id, 'oat milk');  // add a child to a list-ITEM
    expect(sub.type).toBe('list-item');
    const tree = await svc.tree('c1', list.id);
    expect(tree.canAdd).toBe(true);                             // the list can-add
    expect(tree.children[0].label).toBe('milk');
    expect(tree.children[0].canAdd).toBe(true);                 // the item ALSO can-add (accepts sub-items)
    expect(tree.children[0].children[0].label).toBe('oat milk'); // nested one level deeper
  });

  it('exposes the accepts policy (acceptsFor) for the shell', async () => {
    const svc = makeCircleLists({ dataSource: memoryDataSource() });
    expect(svc.acceptsFor('list').map((a) => a.type)).toEqual(['list-item']);
    expect(svc.acceptsFor('list-item').map((a) => a.type)).toEqual(['list-item']);
    expect(svc.acceptsFor('unknown-type')).toEqual([]);        // not composable → no "+ add"
  });

  it('an injected manifest EXTENDS what a list accepts (other apps compose in)', async () => {
    const notesApp = { app: 'notes', accepts: { list: [{ type: 'note', op: 'addNote' }] } };
    const svc = makeCircleLists({ dataSource: memoryDataSource(), manifests: [notesApp] });
    expect(svc.acceptsFor('list').map((a) => a.type)).toEqual(['list-item', 'note']);  // merged, list-item default wins
  });

  // ── board: a HETEROGENEOUS multi-type container that drives the ambiguous-type picker ────────────────
  it('addKinds flags the board as ambiguous, the list (default) as not', () => {
    const svc = makeCircleLists({ dataSource: memoryDataSource() });
    expect(svc.addKinds('board')).toMatchObject({ ambiguous: true });
    expect(svc.addKinds('board').kinds.map((k) => k.type)).toEqual(['list-item', 'list']);
    expect(svc.addKinds('list').ambiguous).toBe(false);   // a list has a default → no picker
  });

  it('addItem to a board is AMBIGUOUS (returns the choices); a hint resolves it', async () => {
    const svc = makeCircleLists({ dataSource: memoryDataSource() });
    const board = await svc.createBoard('c1', 'project');
    expect(await svc.addItem('c1', board.id, 'buy milk'))                       // no hint → the picker's choices
      .toMatchObject({ ambiguous: [{ type: 'list-item' }, { type: 'list' }] });

    const item = await svc.addItem('c1', board.id, 'buy milk', 'a', { hint: 'list-item' });
    expect(item).toMatchObject({ type: 'list-item', text: 'buy milk' });
    const sub = await svc.addItem('c1', board.id, 'groceries', 'a', { hint: 'list' });
    expect(sub.type).toBe('list');                                              // a nested sub-list

    const tree = await svc.tree('c1', board.id);
    expect(tree.children.map((c) => c.label).sort()).toEqual(['buy milk', 'groceries']);
    expect(tree.children.find((c) => c.type === 'list').canAdd).toBe(true);     // the sub-list is itself a container
  });

  it('listContainers returns lists AND boards', async () => {
    const svc = makeCircleLists({ dataSource: memoryDataSource() });
    await svc.createList('c1', 'a list');
    await svc.createBoard('c1', 'a board');
    expect((await svc.listContainers('c1')).map((c) => `${c.type}:${c.text}`).sort())
      .toEqual(['board:a board', 'list:a list']);
  });
});
