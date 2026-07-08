import { describe, it, expect, afterEach } from 'vitest';
import { pickWebBackend } from '../src/web/persistentBackend.js';

// Objective L — pickWebBackend chooses a browser-persistent IndexedDB backend when
// available, else an in-memory fallback (SSR / test env). Node's default vitest env
// has no `indexedDB`, so the fallback path is the default here; the persistent path
// is exercised with fake-indexeddb.

const enc = (s) => new TextEncoder().encode(s);
const dec = (u) => new TextDecoder().decode(u);
const hadIdb = 'indexedDB' in globalThis;

afterEach(() => { if (!hadIdb) delete globalThis.indexedDB; });

describe('pickWebBackend (Objective L — persistent circle storage selection)', () => {
  it('falls back to an in-memory backend when indexedDB is absent (SSR / tests)', async () => {
    delete globalThis.indexedDB;
    const b = pickWebBackend('cc-test-mem');
    await b.put('k', enc('v'));
    const got = await b.get('k');
    expect(dec(got.bytes)).toBe('v');
  });

  it('uses a PERSISTENT IndexedDB backend when indexedDB is available — a fresh instance (reload) reads prior writes', async () => {
    const { IDBFactory } = await import('fake-indexeddb');
    globalThis.indexedDB = new IDBFactory();
    const dbName = 'cc-test-idb';

    const a = pickWebBackend(dbName);
    await a.put('circle-item', enc('persist-me'));
    await a.close?.();

    // A fresh backend over the SAME dbName + the same IndexedDB factory simulates a
    // page reload — it must read the prior write back (restart-survival).
    const b = pickWebBackend(dbName);
    const got = await b.get('circle-item');
    expect(got).not.toBeNull();
    expect(dec(got.bytes)).toBe('persist-me');
  });
});
