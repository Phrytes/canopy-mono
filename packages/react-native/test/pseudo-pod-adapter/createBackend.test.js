/**
 * createBackend — size-based routing + migration.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createBackend } from '../../src/pseudo-pod-adapter/createBackend.js';

function makeAsyncStorageMock() {
  const store = new Map();
  return {
    store,
    async getItem(k) { return store.has(k) ? store.get(k) : null; },
    async setItem(k, v) { store.set(k, v); },
    async removeItem(k) { store.delete(k); },
    async getAllKeys() { return [...store.keys()]; },
  };
}

function makeFileSystemMock() {
  const files = new Map();
  return {
    files,
    EncodingType: { UTF8: 'utf8' },
    async getInfoAsync(p) { return { exists: files.has(p) }; },
    async makeDirectoryAsync() {},
    async writeAsStringAsync(p, s) { files.set(p, s); },
    async readAsStringAsync(p) {
      if (!files.has(p)) throw new Error('ENOENT');
      return files.get(p);
    },
    async moveAsync({ from, to }) {
      if (!files.has(from)) throw new Error('ENOENT');
      files.set(to, files.get(from));
      files.delete(from);
    },
    async deleteAsync(p) { files.delete(p); },
    async readDirectoryAsync(dir) {
      const out = [];
      for (const p of files.keys()) {
        if (p.startsWith(dir) && !p.slice(dir.length).includes('/')) out.push(p.slice(dir.length));
      }
      return out;
    },
  };
}

function rig({ fsThresholdBytes = 100 } = {}) {
  const AsyncStorage = makeAsyncStorageMock();
  const FileSystem   = makeFileSystemMock();
  const b = createBackend({
    AsyncStorage, FileSystem,
    rootDir: '/doc/', scope: 'pp',
    fsThresholdBytes,
  });
  return { AsyncStorage, FileSystem, b };
}

describe('createBackend — size routing', () => {
  it('small payloads land in AsBackend', async () => {
    const { b, AsyncStorage, FileSystem } = rig({ fsThresholdBytes: 1024 });
    await b.put('small', 'hi');
    expect(AsyncStorage.store.size).toBe(1);
    expect(FileSystem.files.size).toBe(0);
    expect(b._locations.get('small')).toBe('as');
  });

  it('large payloads land in FsBackend', async () => {
    const { b, AsyncStorage, FileSystem } = rig({ fsThresholdBytes: 10 });
    await b.put('big', 'this is more than ten characters');
    expect(AsyncStorage.store.size).toBe(0);
    expect(FileSystem.files.size).toBe(1);
    expect(b._locations.get('big')).toBe('fs');
  });

  it('exact-threshold is FS', async () => {
    const { b, FileSystem } = rig({ fsThresholdBytes: 5 });
    await b.put('on-the-line', 'hello');   // length 5
    expect(FileSystem.files.size).toBe(1);
  });
});

describe('createBackend — get reads from the right backend', () => {
  it('reads small from AS', async () => {
    const { b } = rig({ fsThresholdBytes: 1024 });
    await b.put('a', 'hi');
    expect((await b.get('a'))?.bytes).toBe('hi');
  });

  it('reads large from FS', async () => {
    const { b } = rig({ fsThresholdBytes: 5 });
    await b.put('big', 'hello world');
    expect((await b.get('big'))?.bytes).toBe('hello world');
  });

  it('probes both backends when location unknown (after restart)', async () => {
    const { b, AsyncStorage, FileSystem } = rig({ fsThresholdBytes: 1024 });
    await b.put('a', 'hi');
    // Simulate restart: build a fresh composite over the same stores.
    const b2 = createBackend({
      AsyncStorage,
      FileSystem,
      rootDir: '/doc/',
      scope: 'pp',
      fsThresholdBytes: 1024,
    });
    const rec = await b2.get('a');
    expect(rec?.bytes).toBe('hi');
    expect(b2._locations.get('a')).toBe('as');
  });
});

describe('createBackend — migration on cross-threshold update', () => {
  it('small → large moves AS → FS and removes the AS copy', async () => {
    const { b, AsyncStorage, FileSystem } = rig({ fsThresholdBytes: 10 });
    await b.put('x', 'hi');
    expect(AsyncStorage.store.size).toBe(1);
    await b.put('x', 'a much larger string of content');
    expect(b._locations.get('x')).toBe('fs');
    expect(AsyncStorage.store.size).toBe(0);
    expect(FileSystem.files.size).toBe(1);
    expect((await b.get('x'))?.bytes).toBe('a much larger string of content');
  });

  it('large → small moves FS → AS and removes the FS copy', async () => {
    const { b, AsyncStorage, FileSystem } = rig({ fsThresholdBytes: 10 });
    await b.put('x', 'a much larger string of content');
    expect(FileSystem.files.size).toBe(1);
    await b.put('x', 'hi');
    expect(b._locations.get('x')).toBe('as');
    expect(FileSystem.files.size).toBe(0);
    expect(AsyncStorage.store.size).toBe(1);
    expect((await b.get('x'))?.bytes).toBe('hi');
  });

  it('subscribers see exactly one event on migration (the put)', async () => {
    const { b } = rig({ fsThresholdBytes: 10 });
    await b.put('x', 'hi');
    const events = [];
    b.subscribe('', (e) => events.push(e));
    await b.put('x', 'a much larger string of content');
    // We expect 1 'put' event; the cleanup-delete is suppressed.
    expect(events).toHaveLength(1);
    expect(events[0].op).toBe('put');
  });
});

describe('createBackend — dirty persistence (Phase 51.5)', () => {
  it('listDirty merges entries from both inner backends', async () => {
    const { b } = rig({ fsThresholdBytes: 10 });
    await b.put('small', 'hi');
    await b.put('big', 'a much larger payload of content');
    await b._markDirty('small');
    await b._markDirty('big');
    expect((await b.listDirty()).sort()).toEqual(['big', 'small']);
  });

  it('survives backend recreation', async () => {
    const AsyncStorage = makeAsyncStorageMock();
    const FileSystem  = makeFileSystemMock();
    const b1 = createBackend({
      AsyncStorage, FileSystem, rootDir: '/doc/', scope: 'pp',
      fsThresholdBytes: 10,
    });
    await b1.put('small', 'hi');
    await b1.put('big', 'a much larger payload of content');
    await b1._markDirty('small');
    await b1._markDirty('big');

    const b2 = createBackend({
      AsyncStorage, FileSystem, rootDir: '/doc/', scope: 'pp',
      fsThresholdBytes: 10,
    });
    expect((await b2.listDirty()).sort()).toEqual(['big', 'small']);
  });

  it('subscribeDirty fires for both inner backends', async () => {
    const { b } = rig({ fsThresholdBytes: 10 });
    const events = [];
    b.subscribeDirty(e => events.push(e));
    await b.put('s', 'hi');
    await b.put('big', 'a much larger payload of content');
    await b._markDirty('s');
    await b._markDirty('big');
    expect(events.map(e => `${e.op}:${e.key}`).sort()).toEqual(['dirty:big', 'dirty:s']);
  });
});

describe('createBackend — list + delete + subscribe', () => {
  it('list merges keys from both backends', async () => {
    const { b } = rig({ fsThresholdBytes: 10 });
    await b.put('a/small', 'x');
    await b.put('a/large', 'this is a much larger payload');
    const keys = await b.list('a/');
    expect(keys.sort()).toEqual(['a/large', 'a/small']);
  });

  it('delete clears across both backends', async () => {
    const { b, AsyncStorage, FileSystem } = rig({ fsThresholdBytes: 10 });
    await b.put('small', 'hi');
    await b.put('big', 'a much larger payload of content');
    await b.delete('small');
    await b.delete('big');
    expect(AsyncStorage.store.size).toBe(0);
    expect(FileSystem.files.size).toBe(0);
  });

  it('subscribers fire on writes via either backend', async () => {
    const { b } = rig({ fsThresholdBytes: 10 });
    const events = [];
    b.subscribe('', (e) => events.push(e.key));
    await b.put('a', 'x');
    await b.put('b', 'a much larger payload');
    expect(events).toEqual(['a', 'b']);
  });
});
