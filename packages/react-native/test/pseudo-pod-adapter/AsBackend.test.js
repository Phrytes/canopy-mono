/**
 * AsBackend — StorageBackend on top of a mocked AsyncStorage.
 *
 * Tests use a plain-Map mock supplied at construction time.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createAsBackend } from '../../src/pseudo-pod-adapter/AsBackend.js';

function makeAsyncStorageMock() {
  const store = new Map();
  return {
    store,
    async getItem(key) { return store.has(key) ? store.get(key) : null; },
    async setItem(key, value) { store.set(key, value); },
    async removeItem(key) { store.delete(key); },
    async getAllKeys() { return [...store.keys()]; },
  };
}

describe('createAsBackend — construction', () => {
  it('rejects missing AsyncStorage', () => {
    expect(() => createAsBackend({})).toThrow(/AsyncStorage/);
  });
});

describe('AsBackend — get/put round-trip', () => {
  let AsyncStorage; let b;
  beforeEach(() => {
    AsyncStorage = makeAsyncStorageMock();
    b = createAsBackend({ AsyncStorage, scope: 'pp' });
  });

  it('returns null for missing keys', async () => {
    expect(await b.get('nope')).toBe(null);
  });

  it('round-trips an object payload + auto etag', async () => {
    const { etag, _v } = await b.put('a', { x: 1 });
    expect(typeof etag).toBe('string');
    expect(_v).toBe(1);
    expect((await b.get('a'))?.bytes).toEqual({ x: 1 });
    expect((await b.get('a'))?.etag).toBe(etag);
    expect((await b.get('a'))?._v).toBe(1);
  });

  it('preserves caller etag', async () => {
    const { etag } = await b.put('a', 'hi', '"v3"');
    expect(etag).toBe('"v3"');
    expect((await b.get('a'))?.etag).toBe('"v3"');
  });

  it('scopes keys via the `pp:` prefix', async () => {
    await b.put('hello', 1);
    const raw = await AsyncStorage.getItem('pp:hello');
    expect(raw).not.toBe(null);
  });
});

describe('AsBackend — delete', () => {
  it('removes the entry', async () => {
    const AsyncStorage = makeAsyncStorageMock();
    const b = createAsBackend({ AsyncStorage });
    await b.put('a', 1);
    await b.delete('a');
    expect(await b.get('a')).toBe(null);
  });
});

describe('AsBackend — list', () => {
  it('returns keys with prefix, scope-stripped, sorted', async () => {
    const AsyncStorage = makeAsyncStorageMock();
    const b = createAsBackend({ AsyncStorage, scope: 'pp' });
    await b.put('notes/a', 1);
    await b.put('notes/c', 1);
    await b.put('notes/b', 1);
    await b.put('other/x', 1);
    expect(await b.list('notes/')).toEqual(['notes/a', 'notes/b', 'notes/c']);
    expect(await b.list('other/')).toEqual(['other/x']);
  });

  it('ignores keys without the scope prefix', async () => {
    const AsyncStorage = makeAsyncStorageMock();
    // Pre-seed something outside our scope.
    await AsyncStorage.setItem('foreign-app:k', '1');
    const b = createAsBackend({ AsyncStorage, scope: 'pp' });
    expect(await b.list('')).toEqual([]);
  });
});

describe('AsBackend — subscribe', () => {
  it('fires per-prefix on writes', async () => {
    const AsyncStorage = makeAsyncStorageMock();
    const b = createAsBackend({ AsyncStorage });
    const events = [];
    b.subscribe('notes/', (e) => events.push(e));
    await b.put('notes/a', 1);
    await b.put('other/x', 1);
    await b.put('notes/b', 1);
    expect(events.map(e => e.key)).toEqual(['notes/a', 'notes/b']);
    expect(events.every(e => e.op === 'put')).toBe(true);
  });

  it('fires on delete + unsubscribe stops events', async () => {
    const AsyncStorage = makeAsyncStorageMock();
    const b = createAsBackend({ AsyncStorage });
    const events = [];
    const unsub = b.subscribe('', (e) => events.push(e.op));
    await b.put('a', 1);
    await b.delete('a');
    unsub();
    await b.put('b', 1);
    expect(events).toEqual(['put', 'delete']);
  });
});

describe('AsBackend — dirty surface', () => {
  it('markDirty / markClean fire subscribers + list reflects state', async () => {
    const AsyncStorage = makeAsyncStorageMock();
    const b = createAsBackend({ AsyncStorage });
    const seen = [];
    b.subscribeDirty(e => seen.push(e));
    await b._markDirty('a');
    await b._markDirty('a');   // idempotent
    expect(await b.listDirty()).toEqual(['a']);
    expect(seen).toEqual([{ op: 'dirty', key: 'a' }]);
    await b._markClean('a');
    expect(await b.listDirty()).toEqual([]);
  });

  it('delete clears the dirty flag too', async () => {
    const AsyncStorage = makeAsyncStorageMock();
    const b = createAsBackend({ AsyncStorage });
    await b.put('a', 1);
    await b._markDirty('a');
    await b.delete('a');
    expect(await b.listDirty()).toEqual([]);
  });

  it('dirty entries persist across backend recreation (Phase 51.5)', async () => {
    const AsyncStorage = makeAsyncStorageMock();
    const b1 = createAsBackend({ AsyncStorage, scope: 'pp' });
    await b1.put('x', 1);
    await b1._markDirty('x');
    expect(await b1.listDirty()).toEqual(['x']);

    // "Restart" — fresh backend over the same storage.
    const b2 = createAsBackend({ AsyncStorage, scope: 'pp' });
    expect(await b2.listDirty()).toEqual(['x']);
  });

  it('dirty entries hide from list()', async () => {
    const AsyncStorage = makeAsyncStorageMock();
    const b = createAsBackend({ AsyncStorage, scope: 'pp' });
    await b.put('x', 1);
    await b._markDirty('x');
    // The __dirty__ marker must NOT appear in list().
    expect(await b.list('')).toEqual(['x']);
  });
});
