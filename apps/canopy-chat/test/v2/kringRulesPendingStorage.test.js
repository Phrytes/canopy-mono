/**
 * canopy-chat v2 — γ-next.rules localStorage adapter tests.
 *
 * Verifies the wire-level keys (`cc.kringRulesPending.<id>`), JSON
 * round-trip, and the missing-key / clear semantics.  Uses a vi-mock
 * `storage` rather than jsdom so the test is fast + node-portable.
 */
import { describe, it, expect } from 'vitest';
import {
  localStorageKringRulesPendingIo,
  createKringRulesPendingStoreLocal,
} from '../../src/v2/kringRulesPendingStorage.js';

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _backing: m,
  };
}

describe('localStorageKringRulesPendingIo · γ-next.rules', () => {
  it('writes to cc.kringRulesPending.<id> as JSON', async () => {
    const s = memStorage();
    const io = localStorageKringRulesPendingIo(s);
    await io.save('g1', { purpose: 'Buurt', agreements: 'be kind' });
    expect(s._backing.get('cc.kringRulesPending.g1')).toBe(
      JSON.stringify({ purpose: 'Buurt', agreements: 'be kind' }),
    );
  });

  it('reads back the same shape', async () => {
    const s = memStorage();
    const io = localStorageKringRulesPendingIo(s);
    await io.save('g2', { purpose: 'r2', admins: 'two' });
    expect(await io.load('g2')).toEqual({
      purpose: 'r2', admins: 'two',
    });
  });

  it('returns null when the key is missing', async () => {
    const io = localStorageKringRulesPendingIo(memStorage());
    expect(await io.load('nope')).toBeNull();
  });

  it('returns null when stored JSON is corrupt', async () => {
    const s = memStorage();
    s.setItem('cc.kringRulesPending.g3', 'not json');
    const io = localStorageKringRulesPendingIo(s);
    expect(await io.load('g3')).toBeNull();
  });

  it('remove deletes the slot', async () => {
    const s = memStorage();
    const io = localStorageKringRulesPendingIo(s);
    await io.save('g4', { purpose: 'r' });
    await io.remove('g4');
    expect(s._backing.has('cc.kringRulesPending.g4')).toBe(false);
    expect(await io.load('g4')).toBeNull();
  });

  it('factory createKringRulesPendingStoreLocal binds localStorage IO', async () => {
    const s = memStorage();
    const store = createKringRulesPendingStoreLocal(s);
    await store.set('g5', { purpose: 'r5' });
    expect(await store.get('g5')).toEqual({ purpose: 'r5' });
    await store.clear('g5');
    expect(await store.get('g5')).toBeNull();
  });
});
