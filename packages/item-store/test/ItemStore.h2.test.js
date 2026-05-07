/**
 * H2 (household) consumer profile — shopping/errand/repair items, no
 * roles, no skills, no DAG, no assignee.  Tests that the substrate
 * cleanly expresses H2's V2 spec without bending.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ItemStore, InvalidLifecycleError } from '../src/index.js';
import { MemorySource } from '@canopy/core';

const ANNE  = 'https://id.inrupt.com/anne';
const FRITS = 'https://id.inrupt.com/frits';

let store;
beforeEach(() => {
  store = new ItemStore({ dataSource: new MemorySource(), rootContainer: 'mem://h2/' });
});

describe('H2 — addItems', () => {
  it('adds a single shopping item with attribution', async () => {
    const [item] = await store.addItems(
      [{ type: 'shopping', text: 'appels' }],
      { actor: ANNE, actorDisplayName: 'Anne' },
    );
    expect(item.id).toMatch(/^[0-9A-HJ-NP-TV-Z]{26}$/);
    expect(item.type).toBe('shopping');
    expect(item.text).toBe('appels');
    expect(item.addedBy).toBe(ANNE);
    expect(item.addedByDisplayName).toBe('Anne');
    expect(item.addedAt).toBeTypeOf('number');
    expect(item.completedAt).toBeUndefined();
    expect(item.assignee).toBeUndefined();
  });

  it('bulk-adds multiple items in one call (H2 chat-driven multi-add)', async () => {
    const items = await store.addItems(
      [
        { type: 'shopping', text: 'brood' },
        { type: 'shopping', text: 'melk' },
        { type: 'errand',   text: 'stofzuigen' },
      ],
      { actor: ANNE },
    );
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.text)).toEqual(['brood', 'melk', 'stofzuigen']);
    // Each gets a distinct id
    expect(new Set(items.map((i) => i.id)).size).toBe(3);
  });

  it('rejects items missing type or text', async () => {
    await expect(
      store.addItems([{ text: 'incomplete' }], { actor: ANNE }),
    ).rejects.toThrow(/type/);
    await expect(
      store.addItems([{ type: 'shopping', text: '' }], { actor: ANNE }),
    ).rejects.toThrow(/text/);
  });

  it('rejects without actor webid', async () => {
    await expect(
      store.addItems([{ type: 'shopping', text: 'x' }], {}),
    ).rejects.toThrow(/actor/);
  });

  it('emits item-added events', async () => {
    const events = [];
    store.on('item-added', (it) => events.push(it.text));
    await store.addItems(
      [{ type: 'shopping', text: 'a' }, { type: 'shopping', text: 'b' }],
      { actor: ANNE },
    );
    expect(events).toEqual(['a', 'b']);
  });
});

describe('H2 — listOpen', () => {
  beforeEach(async () => {
    await store.addItems(
      [
        { type: 'shopping', text: 'brood' },
        { type: 'shopping', text: 'melk' },
        { type: 'errand',   text: 'stofzuigen' },
      ],
      { actor: ANNE },
    );
  });

  it('returns all open items', async () => {
    const items = await store.listOpen();
    expect(items).toHaveLength(3);
  });

  it('filters by single type', async () => {
    const items = await store.listOpen({ type: 'shopping' });
    expect(items.map((i) => i.text).sort()).toEqual(['brood', 'melk']);
  });

  it('filters by multiple types', async () => {
    const items = await store.listOpen({ type: ['errand', 'shopping'] });
    expect(items).toHaveLength(3);
  });
});

describe('H2 — markComplete', () => {
  it('marks complete by id', async () => {
    const [item] = await store.addItems(
      [{ type: 'shopping', text: 'brood' }], { actor: ANNE },
    );
    const [completed] = await store.markComplete([{ id: item.id }], { actor: FRITS });
    expect(completed.completedAt).toBeTypeOf('number');
    expect(completed.completedBy).toBe(FRITS);
  });

  it('marks complete by fuzzy text match (chat UX)', async () => {
    await store.addItems(
      [
        { type: 'shopping', text: 'brood' },
        { type: 'shopping', text: 'melk' },
      ],
      { actor: ANNE },
    );
    const completed = await store.markComplete(
      [{ match: 'brood' }, { match: 'melk' }],
      { actor: FRITS },
    );
    expect(completed).toHaveLength(2);
    const open = await store.listOpen();
    expect(open).toHaveLength(0);
  });

  it('silently skips unresolvable refs (chat UX tolerance)', async () => {
    await store.addItems([{ type: 'shopping', text: 'brood' }], { actor: ANNE });
    const completed = await store.markComplete(
      [{ match: 'nonexistent' }],
      { actor: FRITS },
    );
    expect(completed).toHaveLength(0);
  });

  it('throws InvalidLifecycleError on double-complete by id', async () => {
    const [item] = await store.addItems(
      [{ type: 'shopping', text: 'brood' }], { actor: ANNE },
    );
    await store.markComplete([{ id: item.id }], { actor: FRITS });
    await expect(
      store.markComplete([{ id: item.id }], { actor: FRITS }),
    ).rejects.toThrow(InvalidLifecycleError);
  });
});

describe('H2 — removeItems', () => {
  it('hard-deletes items', async () => {
    const [item] = await store.addItems(
      [{ type: 'shopping', text: 'oeps' }], { actor: ANNE },
    );
    const ids = await store.removeItems([{ id: item.id }], { actor: ANNE });
    expect(ids).toEqual([item.id]);
    expect(await store.getById(item.id)).toBeNull();
  });
});

describe('H2 — audit log', () => {
  it('records every action with actor + timestamp', async () => {
    const [item] = await store.addItems(
      [{ type: 'shopping', text: 'brood' }],
      { actor: ANNE, actorDisplayName: 'Anne' },
    );
    await store.markComplete([{ id: item.id }], { actor: FRITS, actorDisplayName: 'the author' });
    const log = await store.auditLog();
    expect(log).toHaveLength(2);
    expect(log[0].action).toBe('add');
    expect(log[0].actor).toBe(ANNE);
    expect(log[0].actorDisplayName).toBe('Anne');
    expect(log[1].action).toBe('complete');
    expect(log[1].actor).toBe(FRITS);
  });

  it('filters by item id + actor', async () => {
    const [a] = await store.addItems([{ type: 'shopping', text: 'a' }], { actor: ANNE });
    const [b] = await store.addItems([{ type: 'shopping', text: 'b' }], { actor: FRITS });
    expect(await store.auditLog({ itemId: a.id })).toHaveLength(1);
    expect(await store.auditLog({ actor: FRITS })).toHaveLength(1);
    expect(await store.auditLog({ actor: FRITS }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ itemId: b.id })]));
  });
});
