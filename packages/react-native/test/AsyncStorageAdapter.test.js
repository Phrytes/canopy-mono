/**
 * AsyncStorageAdapter tests — @react-native-async-storage/async-storage is mocked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock AsyncStorage ─────────────────────────────────────────────────────────

const store = new Map();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem:    vi.fn(async key => store.get(key) ?? null),
    setItem:    vi.fn(async (key, value) => { store.set(key, value); }),
    removeItem: vi.fn(async key => { store.delete(key); }),
    getAllKeys:  vi.fn(async () => [...store.keys()]),
  },
}));

import { AsyncStorageAdapter } from '../src/storage/AsyncStorageAdapter.js';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AsyncStorageAdapter', () => {
  let adapter;

  beforeEach(() => {
    store.clear();
    adapter = new AsyncStorageAdapter({ prefix: 'test:' });
  });

  it('get returns null for missing key', async () => {
    expect(await adapter.get('nope')).toBeNull();
  });

  it('set and get round-trip', async () => {
    await adapter.set('hello', 'world');
    expect(await adapter.get('hello')).toBe('world');
  });

  it('delete removes a key', async () => {
    await adapter.set('rm', 'bye');
    await adapter.delete('rm');
    expect(await adapter.get('rm')).toBeNull();
  });

  it('keys returns only keys under this prefix', async () => {
    await adapter.set('a', '1');
    await adapter.set('b', '2');
    // Also insert a key under a different prefix to ensure filtering.
    store.set('other:c', '3');

    const keys = await adapter.keys();
    expect(keys).toContain('a');
    expect(keys).toContain('b');
    expect(keys).not.toContain('c');
  });

  it('keys returns empty array when nothing stored', async () => {
    expect(await adapter.keys()).toEqual([]);
  });

  it('prefix is applied transparently', async () => {
    const a1 = new AsyncStorageAdapter({ prefix: 'ns1:' });
    const a2 = new AsyncStorageAdapter({ prefix: 'ns2:' });
    await a1.set('key', 'from-ns1');
    await a2.set('key', 'from-ns2');
    expect(await a1.get('key')).toBe('from-ns1');
    expect(await a2.get('key')).toBe('from-ns2');
  });

  it('default prefix is dwag:', async () => {
    const a = new AsyncStorageAdapter();
    await a.set('x', 'y');
    expect(store.has('dwag:x')).toBe(true);
  });
});
