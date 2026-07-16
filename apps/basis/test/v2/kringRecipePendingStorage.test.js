/**
 * basis v2 — γ-next.recipe localStorage adapter tests.
 *
 * Verifies the wire-level keys (`cc.kringRecipePending.<id>`), JSON
 * round-trip, and the missing-key / clear semantics.  Uses a vi-mock
 * `storage` rather than jsdom so the test is fast + node-portable.
 */
import { describe, it, expect } from 'vitest';
import {
  localStorageKringRecipePendingIo,
  createKringRecipePendingStoreLocal,
} from '../../src/v2/kringRecipePendingStorage.js';

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _backing: m,
  };
}

describe('localStorageKringRecipePendingIo · γ-next.recipe', () => {
  it('writes to cc.kringRecipePending.<id> as JSON', async () => {
    const s = memStorage();
    const io = localStorageKringRecipePendingIo(s);
    await io.save('g1', { id: 'r1', name: 'Buurt', blocks: [] });
    expect(s._backing.get('cc.kringRecipePending.g1')).toBe(
      JSON.stringify({ id: 'r1', name: 'Buurt', blocks: [] }),
    );
  });

  it('reads back the same shape', async () => {
    const s = memStorage();
    const io = localStorageKringRecipePendingIo(s);
    await io.save('g2', { id: 'r2', blocks: [{ id: 'b', type: 'tasks' }] });
    expect(await io.load('g2')).toEqual({
      id: 'r2', blocks: [{ id: 'b', type: 'tasks' }],
    });
  });

  it('returns null when the key is missing', async () => {
    const io = localStorageKringRecipePendingIo(memStorage());
    expect(await io.load('nope')).toBeNull();
  });

  it('returns null when stored JSON is corrupt', async () => {
    const s = memStorage();
    s.setItem('cc.kringRecipePending.g3', 'not json');
    const io = localStorageKringRecipePendingIo(s);
    expect(await io.load('g3')).toBeNull();
  });

  it('remove deletes the slot', async () => {
    const s = memStorage();
    const io = localStorageKringRecipePendingIo(s);
    await io.save('g4', { id: 'r' });
    await io.remove('g4');
    expect(s._backing.has('cc.kringRecipePending.g4')).toBe(false);
    expect(await io.load('g4')).toBeNull();
  });

  it('factory createKringRecipePendingStoreLocal binds localStorage IO', async () => {
    const s = memStorage();
    const store = createKringRecipePendingStoreLocal(s);
    await store.set('g5', { id: 'r5' });
    expect(await store.get('g5')).toEqual({ id: 'r5' });
    await store.clear('g5');
    expect(await store.get('g5')).toBeNull();
  });
});
