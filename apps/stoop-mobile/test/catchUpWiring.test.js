/**
 * catchUpWiring — unit tests for the lastSeenFrom persistence + the
 * wireCatchUp item-arrive listener (#247, 2026-05-24).
 *
 * Uses an in-memory mock AsyncStorage (same shape as VaultAsyncStorage's
 * test mock).  Zero RN runtime needed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LastSeenFromStore, wireCatchUp } from '../src/lib/catchUpWiring.js';

function makeMockAsyncStorage() {
  const store = new Map();
  return {
    _store: store,
    async getItem(k)    { return store.has(k) ? store.get(k) : null; },
    async setItem(k, v) { store.set(k, String(v)); },
    async removeItem(k) { store.delete(k); },
  };
}

describe('LastSeenFromStore — construction', () => {
  it('throws when asyncStorage missing required methods', () => {
    expect(() => new LastSeenFromStore({ asyncStorage: {} }))
      .toThrow(/asyncStorage/);
  });

  it('accepts an injected mock', () => {
    expect(() => new LastSeenFromStore({ asyncStorage: makeMockAsyncStorage() }))
      .not.toThrow();
  });
});

describe('LastSeenFromStore — get/set/bump round-trip', () => {
  let storage; let store;
  beforeEach(() => {
    storage = makeMockAsyncStorage();
    store   = new LastSeenFromStore({ asyncStorage: storage });
  });

  it('cold get returns 0 for unknown peer', async () => {
    expect(await store.get('peer-1')).toBe(0);
  });

  it('set + get round-trips through AsyncStorage', async () => {
    await store.set('peer-1', 12345);
    expect(await store.get('peer-1')).toBe(12345);

    // New instance reads the same store from disk.
    const store2 = new LastSeenFromStore({ asyncStorage: storage });
    expect(await store2.get('peer-1')).toBe(12345);
  });

  it('set is a no-op when the value is unchanged', async () => {
    await store.set('peer-1', 100);
    const writes1 = storage._store.get('stoop:catch-up:lastSeenFrom');
    await store.set('peer-1', 100);
    const writes2 = storage._store.get('stoop:catch-up:lastSeenFrom');
    expect(writes1).toBe(writes2);
  });

  it('bump only writes when the new value is higher (newer-wins)', async () => {
    await store.set('peer-1', 200);
    await store.bump('peer-1', 150);     // older — ignored
    expect(await store.get('peer-1')).toBe(200);
    await store.bump('peer-1', 300);     // newer — applied
    expect(await store.get('peer-1')).toBe(300);
  });

  it('entries returns a shallow clone', async () => {
    await store.set('peer-a', 1);
    await store.set('peer-b', 2);
    const out = await store.entries();
    expect(out).toEqual({ 'peer-a': 1, 'peer-b': 2 });
    // Mutating the returned object doesn't affect storage.
    out['peer-a'] = 999;
    expect(await store.get('peer-a')).toBe(1);
  });

  it('forget removes a peer + returns whether it existed', async () => {
    await store.set('peer-1', 42);
    expect(await store.forget('peer-1')).toBe(true);
    expect(await store.get('peer-1')).toBe(0);
    expect(await store.forget('peer-1')).toBe(false);  // already gone
  });

  it('survives corrupt JSON in storage (returns empty)', async () => {
    await storage.setItem('stoop:catch-up:lastSeenFrom', '{ not valid');
    const fresh = new LastSeenFromStore({ asyncStorage: storage });
    expect(await fresh.get('peer-1')).toBe(0);
    // And a set after recovery works.
    await fresh.set('peer-1', 7);
    expect(await fresh.get('peer-1')).toBe(7);
  });
});

describe('wireCatchUp — item-arrive listener bumps lastSeenFrom', () => {
  it('bumps the high-water mark on item-arrive', async () => {
    const storage = makeMockAsyncStorage();
    let listener = null;
    const bundle = {
      agent: {
        on(event, fn)  { if (event === 'item-arrive') listener = fn; },
        off(event, fn) { if (event === 'item-arrive' && listener === fn) listener = null; },
      },
    };
    const { lastSeenFrom, dispose } = wireCatchUp({ bundle, asyncStorage: storage });

    // Simulate an item arriving from peer-X.
    listener({ source: { fromAddr: 'peer-x' }, addedAt: 1234 });
    // Wait a microtask for the async bump to settle.
    await new Promise((r) => setImmediate(r));
    expect(await lastSeenFrom.get('peer-x')).toBe(1234);

    // Older item from same peer → no change (newer-wins).
    listener({ source: { fromAddr: 'peer-x' }, addedAt: 500 });
    await new Promise((r) => setImmediate(r));
    expect(await lastSeenFrom.get('peer-x')).toBe(1234);

    dispose();
  });

  it('falls back to source.fromPubKey when fromAddr absent', async () => {
    const storage = makeMockAsyncStorage();
    let listener = null;
    const bundle = { agent: { on(_, fn) { listener = fn; }, off() {} } };
    const { lastSeenFrom } = wireCatchUp({ bundle, asyncStorage: storage });
    listener({ source: { fromPubKey: 'pk-y' }, addedAt: 999 });
    await new Promise((r) => setImmediate(r));
    expect(await lastSeenFrom.get('pk-y')).toBe(999);
  });

  it('silently ignores items with no peer identity', async () => {
    const storage = makeMockAsyncStorage();
    let listener = null;
    const bundle = { agent: { on(_, fn) { listener = fn; }, off() {} } };
    const { lastSeenFrom } = wireCatchUp({ bundle, asyncStorage: storage });
    listener({ source: {}, addedAt: 999 });            // no fromAddr/fromPubKey
    listener({ addedAt: 999 });                         // no source at all
    await new Promise((r) => setImmediate(r));
    expect(await lastSeenFrom.entries()).toEqual({});
  });

  it('scheduleCatchUp soft-skips when bundle.nkn is missing (#248)', async () => {
    // No bundle.nkn → no outbound trigger.  scheduleCatchUp logs +
    // resolves so callers can fire it unconditionally.  This is the
    // dev-without-nkn-sdk path (soft dep).
    const storage = makeMockAsyncStorage();
    const bundle = { agent: { on() {}, off() {} } };
    const logger = { info: vi.fn(), warn: vi.fn() };
    const { scheduleCatchUp } = wireCatchUp({ bundle, asyncStorage: storage, logger });
    await scheduleCatchUp();
    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/no NKN transport/));
  });

  it('dispose detaches the item-arrive listener', async () => {
    const storage = makeMockAsyncStorage();
    let attached = false;
    const bundle = {
      agent: {
        on(event)  { if (event === 'item-arrive') attached = true; },
        off(event) { if (event === 'item-arrive') attached = false; },
      },
    };
    const { dispose } = wireCatchUp({ bundle, asyncStorage: storage });
    expect(attached).toBe(true);
    dispose();
    expect(attached).toBe(false);
  });
});
