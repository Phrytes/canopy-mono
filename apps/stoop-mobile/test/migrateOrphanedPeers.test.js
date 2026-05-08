/**
 * Single-agent refactor (2026-05-08) — orphaned PeerGraph key cleanup.
 */

import { describe, it, expect } from 'vitest';
import { migrateOrphanedPeers } from '../src/lib/migrateOrphanedPeers.js';

function makeStore() {
  const m = new Map();
  return {
    async getItem(k)    { return m.get(k) ?? null; },
    async setItem(k, v) { m.set(k, v); },
    async removeItem(k) { m.delete(k); },
    async getAllKeys()  { return [...m.keys()]; },
    _raw: m,
  };
}

describe('migrateOrphanedPeers', () => {
  it('deletes stale `stoop:peers:<groupId>:…` entries', async () => {
    const storage = makeStore();
    storage._raw.set('stoop:peers:oosterpoort:peer:abc', JSON.stringify({}));
    storage._raw.set('stoop:peers:oosterpoort:peer:def', JSON.stringify({}));
    storage._raw.set('stoop:peers:_bootstrap:peer:ghi', JSON.stringify({}));

    const r = await migrateOrphanedPeers({ storage });
    expect(r.ranNow).toBe(true);
    expect(r.removed).toBe(3);

    const keys = await storage.getAllKeys();
    for (const k of keys) {
      expect(k.startsWith('stoop:peers:')).toBe(false);
    }
  });

  it('keeps the new shared prefix `stoop:peers:peer:…` (no group segment)', async () => {
    const storage = makeStore();
    storage._raw.set('stoop:peers:peer:abc',                JSON.stringify({}));
    storage._raw.set('stoop:peers:peer:def',                JSON.stringify({}));
    storage._raw.set('stoop:peers:oosterpoort:peer:ghi', JSON.stringify({}));

    const r = await migrateOrphanedPeers({ storage });
    expect(r.ranNow).toBe(true);
    expect(r.removed).toBe(1);

    const remaining = await storage.getAllKeys();
    expect(remaining).toContain('stoop:peers:peer:abc');
    expect(remaining).toContain('stoop:peers:peer:def');
    expect(remaining).not.toContain('stoop:peers:oosterpoort:peer:ghi');
  });

  it('is idempotent — second run is a no-op', async () => {
    const storage = makeStore();
    storage._raw.set('stoop:peers:oosterpoort:peer:abc', JSON.stringify({}));

    const r1 = await migrateOrphanedPeers({ storage });
    expect(r1.ranNow).toBe(true);
    expect(r1.removed).toBe(1);

    // Re-add a stale key to prove the migration won't re-run.
    storage._raw.set('stoop:peers:oosterpoort:peer:zzz', JSON.stringify({}));
    const r2 = await migrateOrphanedPeers({ storage });
    expect(r2.ranNow).toBe(false);
    expect(r2.removed).toBe(0);
    expect(await storage.getItem('stoop:peers:oosterpoort:peer:zzz')).not.toBeNull();
  });

  it('leaves unrelated keys alone', async () => {
    const storage = makeStore();
    storage._raw.set('stoop:relay-url',                  'ws://x:1');
    storage._raw.set('stoop:groups',                      '[]');
    storage._raw.set('stoop:active-group',                'oosterpoort');
    storage._raw.set('stoop:peers:oosterpoort:peer:abc', JSON.stringify({}));

    await migrateOrphanedPeers({ storage });

    expect(await storage.getItem('stoop:relay-url')).toBe('ws://x:1');
    expect(await storage.getItem('stoop:groups')).toBe('[]');
    expect(await storage.getItem('stoop:active-group')).toBe('oosterpoort');
  });
});
