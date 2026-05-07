/**
 * groupRegistry — verify the AsyncStorage-backed list + active marker.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  listGroups, addGroup, removeGroup,
  getActiveGroupId, setActiveGroupId, _internal,
} from '../src/lib/groupRegistry.js';

function makeStorage() {
  const store = new Map();
  return {
    getItem:    async (k) => store.get(k) ?? null,
    setItem:    async (k, v) => { store.set(k, v); },
    removeItem: async (k) => { store.delete(k); },
    _store:     store,
  };
}

describe('groupRegistry', () => {
  let storage;
  beforeEach(() => { storage = makeStorage(); });

  it('listGroups returns [] when nothing stored', async () => {
    expect(await listGroups({ storage })).toEqual([]);
  });

  it('addGroup persists + returns the new list', async () => {
    const r = await addGroup({
      entry: { groupId: 'g1', displayName: 'Oosterpoort', role: 'member' },
      storage,
    });
    expect(r).toHaveLength(1);
    expect(r[0].groupId).toBe('g1');
    expect(r[0].joinedAt).toBeTypeOf('number');
    expect(await listGroups({ storage })).toEqual(r);
  });

  it('addGroup is idempotent on groupId — replaces existing entry', async () => {
    await addGroup({ entry: { groupId: 'g1', role: 'member' }, storage });
    const r = await addGroup({ entry: { groupId: 'g1', role: 'admin' }, storage });
    expect(r).toHaveLength(1);
    expect(r[0].role).toBe('admin');
  });

  it('addGroup throws on missing groupId', async () => {
    await expect(addGroup({ entry: {}, storage })).rejects.toThrow(/invalid entry/);
    await expect(addGroup({ entry: null, storage })).rejects.toThrow(/invalid entry/);
  });

  it('removeGroup drops the entry + clears active when matching', async () => {
    await addGroup({ entry: { groupId: 'g1' }, storage });
    await addGroup({ entry: { groupId: 'g2' }, storage });
    await setActiveGroupId({ groupId: 'g2', storage });

    await removeGroup({ groupId: 'g2', storage });
    expect((await listGroups({ storage })).map((g) => g.groupId)).toEqual(['g1']);
    expect(await getActiveGroupId({ storage })).toBeNull();
  });

  it('removeGroup keeps the active marker when removing a different group', async () => {
    await addGroup({ entry: { groupId: 'g1' }, storage });
    await addGroup({ entry: { groupId: 'g2' }, storage });
    await setActiveGroupId({ groupId: 'g1', storage });

    await removeGroup({ groupId: 'g2', storage });
    expect(await getActiveGroupId({ storage })).toBe('g1');
  });

  it('setActiveGroupId(null) clears the marker', async () => {
    await setActiveGroupId({ groupId: 'g1', storage });
    expect(await getActiveGroupId({ storage })).toBe('g1');
    await setActiveGroupId({ groupId: null, storage });
    expect(await getActiveGroupId({ storage })).toBeNull();
  });

  it('returns [] when stored JSON is corrupt', async () => {
    storage._store.set(_internal.KEY_LIST, '{not-json');
    expect(await listGroups({ storage })).toEqual([]);
  });

  it('filters non-entry junk from the list', async () => {
    storage._store.set(_internal.KEY_LIST, JSON.stringify([
      { groupId: 'g1' },
      { not: 'a-group' },
      null,
      { groupId: '' },
      { groupId: 'g2', role: 'member' },
    ]));
    const r = await listGroups({ storage });
    expect(r.map((g) => g.groupId)).toEqual(['g1', 'g2']);
  });
});
