/**
 * canopy-chat v2 — γ-next.policy localStorage adapter tests.
 *
 * Verifies the wire-level keys (`cc.kringPolicyPending.<id>`), JSON
 * round-trip, and the missing-key / clear semantics.  Uses a vi-mock
 * `storage` rather than jsdom so the test is fast + node-portable.
 */
import { describe, it, expect } from 'vitest';
import {
  localStorageKringPolicyPendingIo,
  createKringPolicyPendingStoreLocal,
} from '../../src/v2/kringPolicyPendingStorage.js';

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _backing: m,
  };
}

describe('localStorageKringPolicyPendingIo · γ-next.policy', () => {
  it('writes to cc.kringPolicyPending.<id> as JSON', async () => {
    const s = memStorage();
    const io = localStorageKringPolicyPendingIo(s);
    await io.save('g1', { view: 'screen', features: { chat: true } });
    expect(s._backing.get('cc.kringPolicyPending.g1')).toBe(
      JSON.stringify({ view: 'screen', features: { chat: true } }),
    );
  });

  it('reads back the same shape (incl. nested features)', async () => {
    const s = memStorage();
    const io = localStorageKringPolicyPendingIo(s);
    await io.save('g2', { view: 'chat', features: { chat: false, houseRules: true } });
    expect(await io.load('g2')).toEqual({
      view: 'chat', features: { chat: false, houseRules: true },
    });
  });

  it('returns null when the key is missing', async () => {
    const io = localStorageKringPolicyPendingIo(memStorage());
    expect(await io.load('nope')).toBeNull();
  });

  it('returns null when stored JSON is corrupt', async () => {
    const s = memStorage();
    s.setItem('cc.kringPolicyPending.g3', 'not json');
    const io = localStorageKringPolicyPendingIo(s);
    expect(await io.load('g3')).toBeNull();
  });

  it('remove deletes the slot', async () => {
    const s = memStorage();
    const io = localStorageKringPolicyPendingIo(s);
    await io.save('g4', { view: 'screen' });
    await io.remove('g4');
    expect(s._backing.has('cc.kringPolicyPending.g4')).toBe(false);
    expect(await io.load('g4')).toBeNull();
  });

  it('factory createKringPolicyPendingStoreLocal binds localStorage IO', async () => {
    const s = memStorage();
    const store = createKringPolicyPendingStoreLocal(s);
    await store.set('g5', { view: 'cross-stream' });
    expect(await store.get('g5')).toEqual({ view: 'cross-stream' });
    await store.clear('g5');
    expect(await store.get('g5')).toBeNull();
  });
});
