/**
 * basis — storage tests. v0.2.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';   // installs indexedDB + IDBKeyRange globals

import { IndexedDBStore, attachPersistence } from '../src/storage/local.js';
import { PodSyncStore }                       from '../src/storage/podSync.js';
import { ThreadStore }                        from '../src/threadStore.js';
import { Thread }                             from '../src/thread.js';

async function freshStore() {
  const s = new IndexedDBStore();
  await s.clear();
  return s;
}

describe('IndexedDBStore — basic CRUD', () => {
  let s;
  beforeEach(async () => { s = await freshStore(); });
  afterEach(async  () => { await s.close(); });

  it('starts empty', async () => {
    expect(await s.loadAll()).toEqual([]);
  });

  it('saves + loads a thread', async () => {
    const t = new Thread({
      id: 'a', name: 'Alpha', createdAt: 1_000,
      filter: { apps: ['household'] },
      permissions: { allowCommands: true },
    });
    t.addUserMessage('hi');
    await s.saveThread(t);

    const loaded = await s.loadAll();
    expect(loaded.length).toBe(1);
    const round = loaded[0];
    expect(round).toBeInstanceOf(Thread);
    expect(round.id).toBe('a');
    expect(round.name).toBe('Alpha');
    expect(round.createdAt).toBe(1_000);
    expect(round.filter).toEqual({ apps: ['household'] });
    expect(round.permissions.allowCommands).toBe(true);
    expect(round.messages.length).toBe(1);
    expect(round.messages[0].text).toBe('hi');
  });

  it('round-trips the listing cache', async () => {
    const t = new Thread({ id: 'x', name: 'X' });
    t.addShellMessage({
      kind: 'list', messageId: 'm-1', lifecycleState: 'live',
      items: [{ id: 'c-1', label: 'Dishwasher' }],
    }, { opId: 'listOpen' });
    await s.saveThread(t);
    const [round] = await s.loadAll();
    expect(round.lastListingFor('listOpen').items).toEqual([
      { id: 'c-1', label: 'Dishwasher' },
    ]);
    expect(round.resolveFuzzy('listOpen', 'dishwasher')).toBe('c-1');
  });

  it('saveThread replaces (upsert)', async () => {
    const t1 = new Thread({ id: 'k', name: 'K1' });
    await s.saveThread(t1);
    const t2 = new Thread({ id: 'k', name: 'K2' });
    await s.saveThread(t2);
    const loaded = await s.loadAll();
    expect(loaded.length).toBe(1);
    expect(loaded[0].name).toBe('K2');
  });

  it('deleteThread removes by id', async () => {
    const t = new Thread({ id: 'd', name: 'D' });
    await s.saveThread(t);
    await s.deleteThread('d');
    expect(await s.loadAll()).toEqual([]);
  });

  it('deleteThread on unknown id is a no-op (no throw)', async () => {
    await expect(s.deleteThread('does-not-exist')).resolves.toBeUndefined();
  });

  it('clear() wipes everything', async () => {
    await s.saveThread(new Thread({ id: 'a', name: 'A' }));
    await s.saveThread(new Thread({ id: 'b', name: 'B' }));
    await s.clear();
    expect(await s.loadAll()).toEqual([]);
  });

  it("rejects saveThread without id", async () => {
    await expect(s.saveThread({})).rejects.toThrow(/id required/);
  });
});

describe('attachPersistence — ThreadStore integration', () => {
  let idb;
  beforeEach(async () => { idb = await freshStore(); });
  afterEach(async  () => { await idb.close(); });

  it("persists thread-created + thread-updated + thread-deleted", async () => {
    const store = new ThreadStore();
    const off   = attachPersistence({ threadStore: store, idb });

    store.createThread({ id: 'a', name: 'A' });
    // saves are async; give the microtask queue a couple of ticks
    await new Promise((r) => setTimeout(r, 30));
    let loaded = await idb.loadAll();
    expect(loaded.map((t) => t.name)).toEqual(['A']);

    store.updateThread('a', { name: 'Alpha' });
    await new Promise((r) => setTimeout(r, 30));
    loaded = await idb.loadAll();
    expect(loaded[0].name).toBe('Alpha');

    store.deleteThread('a');
    await new Promise((r) => setTimeout(r, 30));
    loaded = await idb.loadAll();
    expect(loaded).toEqual([]);

    off();
  });

  it("active-changed events are NOT persisted", async () => {
    const store = new ThreadStore();
    store.createThread({ id: 'a', name: 'A' });
    store.createThread({ id: 'b', name: 'B' });
    await new Promise((r) => setTimeout(r, 30));

    const off = attachPersistence({ threadStore: store, idb });
    const before = await idb.loadAll();   // empty (subscription is fresh)

    store.setActiveThread('b');
    await new Promise((r) => setTimeout(r, 30));
    const after = await idb.loadAll();
    expect(after.length).toBe(before.length);   // no writes on active-changed

    off();
  });

  it("unsubscribe stops further persistence", async () => {
    const store = new ThreadStore();
    const off   = attachPersistence({ threadStore: store, idb });
    off();
    store.createThread({ id: 'x', name: 'X' });
    await new Promise((r) => setTimeout(r, 30));
    expect(await idb.loadAll()).toEqual([]);
  });

  it("save errors are routed to onError (don't break)", async () => {
    const errs = [];
    const broken = {
      saveThread:   async () => { throw new Error('IDB exploded'); },
      deleteThread: async () => {},
    };
    const store = new ThreadStore();
    attachPersistence({
      threadStore: store,
      idb:         broken,
      onError:     (e) => errs.push(e.message),
    });
    store.createThread({ id: 'a', name: 'A' });
    await new Promise((r) => setTimeout(r, 10));
    expect(errs).toContain('IDB exploded');
  });
});

describe('IndexedDBStore — restart simulation (close → reopen)', () => {
  it("persists across an open/close/open cycle", async () => {
    const s1 = await freshStore();
    await s1.saveThread(new Thread({ id: 'p', name: 'Persisted' }));
    await s1.close();

    const s2 = new IndexedDBStore();
    const loaded = await s2.loadAll();
    expect(loaded.map((t) => t.name)).toEqual(['Persisted']);
    await s2.clear();
    await s2.close();
  });
});

describe('PodSyncStore (stub)', () => {
  it('every method throws "not implemented yet" except close()', async () => {
    const p = new PodSyncStore();
    await expect(p.loadAll()).rejects.toThrow(/not implemented yet/);
    await expect(p.saveThread(new Thread())).rejects.toThrow(/not implemented yet/);
    await expect(p.deleteThread('x')).rejects.toThrow(/not implemented yet/);
    await expect(p.clear()).rejects.toThrow(/not implemented yet/);
    await expect(p.close()).resolves.toBeUndefined();   // close is a no-op
  });
});
