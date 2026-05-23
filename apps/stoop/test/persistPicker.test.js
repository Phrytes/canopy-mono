/**
 * persistPicker — adapter-selection tests.
 *
 * Verifies:
 *   - {path} picks FilePersist (Node)
 *   - {dbName} picks IndexedDBPersist (browser; via fake-indexeddb)
 *   - passing both is rejected (mutually exclusive intent)
 *   - passing neither returns null (caller wants in-memory)
 *   - saveDelayMs flows through to both adapters
 */
import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pickPersist } from '../src/lib/persistPicker.js';

function freshTmpFile() {
  return join(tmpdir(), `stoop-picker-${Date.now()}-${Math.random().toString(36).slice(2,6)}.json`);
}

describe('persistPicker', () => {
  it('returns null when neither path nor dbName is set', async () => {
    expect(await pickPersist({})).toBeNull();
    expect(await pickPersist()).toBeNull();
  });

  it('picks FilePersist when only {path} is set', async () => {
    const picked = await pickPersist({ path: freshTmpFile() });
    expect(picked.kind).toBe('file');
    expect(picked.persist.constructor.name).toBe('FilePersist');
  });

  it('picks IndexedDBPersist when only {dbName} is set', async () => {
    const picked = await pickPersist({ dbName: 'stoop-picker-test' });
    expect(picked.kind).toBe('idb');
    expect(picked.persist.constructor.name).toBe('IndexedDBPersist');
  });

  it('rejects passing both path AND dbName', async () => {
    await expect(pickPersist({ path: '/tmp/x.json', dbName: 'x' }))
      .rejects.toThrow(/EITHER .* OR/);
  });

  it('passes saveDelayMs through to FilePersist', async () => {
    // No public getter for the delay; smoke-check that construction
    // succeeds with the opt set.
    const picked = await pickPersist({ path: freshTmpFile(), saveDelayMs: 1234 });
    expect(picked.persist).toBeTruthy();
  });

  it('passes saveDelayMs + storeName through to IndexedDBPersist', async () => {
    const picked = await pickPersist({
      dbName: 'stoop-picker-test-2',
      storeName: 'custom-store',
      saveDelayMs: 500,
    });
    expect(picked.persist).toBeTruthy();
  });
});
