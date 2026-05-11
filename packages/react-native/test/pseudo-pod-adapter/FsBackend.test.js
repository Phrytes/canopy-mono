/**
 * FsBackend — StorageBackend on top of a mocked expo-file-system.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createFsBackend } from '../../src/pseudo-pod-adapter/FsBackend.js';

function makeFileSystemMock() {
  const files = new Map();
  const dirs  = new Set();
  return {
    files,
    dirs,
    EncodingType: { UTF8: 'utf8' },

    async getInfoAsync(path)   { return { exists: files.has(path) }; },
    async makeDirectoryAsync(uri, { intermediates } = {}) {
      void intermediates;
      dirs.add(uri);
    },
    async writeAsStringAsync(uri, str) { files.set(uri, str); },
    async readAsStringAsync(uri) {
      if (!files.has(uri)) throw new Error('ENOENT');
      return files.get(uri);
    },
    async moveAsync({ from, to }) {
      if (!files.has(from)) throw new Error('ENOENT');
      files.set(to, files.get(from));
      files.delete(from);
    },
    async deleteAsync(uri /*, { idempotent } */) { files.delete(uri); },
    async readDirectoryAsync(dir) {
      const out = [];
      for (const path of files.keys()) {
        if (!path.startsWith(dir)) continue;
        const rest = path.slice(dir.length);
        if (rest.includes('/')) continue;   // no nested entries
        out.push(rest);
      }
      return out;
    },
  };
}

describe('createFsBackend — construction', () => {
  it('rejects missing FileSystem', () => {
    expect(() => createFsBackend({ rootDir: '/d/' })).toThrow(/FileSystem/);
  });

  it('rejects missing rootDir', () => {
    expect(() => createFsBackend({ FileSystem: {} })).toThrow(/FileSystem/);
  });
});

describe('FsBackend — get/put round-trip', () => {
  let FileSystem; let b;
  beforeEach(() => {
    FileSystem = makeFileSystemMock();
    b = createFsBackend({ FileSystem, rootDir: '/doc/', scope: 'pp' });
  });

  it('returns null for missing keys', async () => {
    expect(await b.get('nope')).toBe(null);
  });

  it('round-trips a JSON-shaped payload + assigns etag', async () => {
    const etag = await b.put('tasks/a', { text: 'paint' });
    expect(typeof etag).toBe('string');
    const rec = await b.get('tasks/a');
    expect(rec?.bytes).toEqual({ text: 'paint' });
    expect(rec?.etag).toBe(etag);
  });

  it('preserves caller etag', async () => {
    const etag = await b.put('a', 'hi', '"v9"');
    expect(etag).toBe('"v9"');
    expect((await b.get('a'))?.etag).toBe('"v9"');
  });

  it('places files under the scope directory', async () => {
    await b.put('a', 1);
    const paths = [...FileSystem.files.keys()];
    expect(paths.some(p => p.startsWith('/doc/pp/'))).toBe(true);
    expect(FileSystem.dirs.has('/doc/pp/')).toBe(true);
  });

  it('atomic write via .tmp + moveAsync', async () => {
    await b.put('a', 'hello');
    // After moveAsync the .tmp file is gone.
    const paths = [...FileSystem.files.keys()];
    expect(paths.some(p => p.endsWith('.tmp'))).toBe(false);
  });

  it('encodes slashes path-safely', async () => {
    await b.put('tasks/abc/x', 1);
    const paths = [...FileSystem.files.keys()];
    expect(paths[0]).toContain('tasks');
    expect(paths[0]).not.toMatch(/tasks\/abc\/x$/);   // encoded
  });
});

describe('FsBackend — delete + list', () => {
  it('delete removes the file', async () => {
    const FileSystem = makeFileSystemMock();
    const b = createFsBackend({ FileSystem, rootDir: '/d/' });
    await b.put('a', 1);
    await b.delete('a');
    expect(await b.get('a')).toBe(null);
  });

  it('list returns keys with the prefix (decoded)', async () => {
    const FileSystem = makeFileSystemMock();
    const b = createFsBackend({ FileSystem, rootDir: '/d/' });
    await b.put('notes/a', 1);
    await b.put('notes/b', 1);
    await b.put('other/x', 1);
    expect(await b.list('notes/')).toEqual(['notes/a', 'notes/b']);
  });
});

describe('FsBackend — subscribe', () => {
  it('fires on local writes', async () => {
    const FileSystem = makeFileSystemMock();
    const b = createFsBackend({ FileSystem, rootDir: '/d/' });
    const events = [];
    b.subscribe('x/', (e) => events.push(e));
    await b.put('x/1', 1);
    await b.put('y/2', 1);
    expect(events.map(e => e.key)).toEqual(['x/1']);
  });
});
