/**
 * fsRN.test.js — adapter against a mocked `expo-file-system` namespace.
 *
 * vitest never touches a real device.  We build an in-memory FileSystem
 * mock that mirrors enough of `expo-file-system` for the adapter to
 * exercise its full surface (read / write / mkdir / stat / readdir /
 * unlink / rmdir / rename).
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { createFsRN } from '../../src/adapters/fsRN.js';

/**
 * A minimal in-memory FileSystem that mimics enough of expo-file-system
 * for our adapter tests.  Stores everything in a Map<uri, entry> where
 * entry is either a file (`{ kind: 'file', bytes: Uint8Array, mtime: number }`)
 * or a directory (`{ kind: 'dir', mtime: number }`).
 */
function buildMockFileSystem() {
  /** @type {Map<string, any>} */
  const entries = new Map();
  entries.set('file:///', { kind: 'dir', mtime: 0 });

  const FileSystem = {
    EncodingType: { UTF8: 'utf8', Base64: 'base64' },

    async readAsStringAsync(uri, opts = {}) {
      const e = entries.get(uri);
      if (!e || e.kind !== 'file') {
        const err = new Error(`No such file: ${uri}`);
        throw err;
      }
      const buf = Buffer.from(e.bytes);
      if (opts.encoding === 'base64') return buf.toString('base64');
      return buf.toString('utf8');
    },

    async writeAsStringAsync(uri, content, opts = {}) {
      let bytes;
      if (opts.encoding === 'base64') {
        bytes = Uint8Array.from(Buffer.from(content, 'base64'));
      } else {
        bytes = Uint8Array.from(Buffer.from(String(content ?? ''), 'utf8'));
      }
      entries.set(uri, { kind: 'file', bytes, mtime: Date.now() / 1000 });
    },

    async deleteAsync(uri /*, opts */) {
      // Recursively remove children under `uri/`.
      const prefix = uri.endsWith('/') ? uri : `${uri}/`;
      for (const k of [...entries.keys()]) {
        if (k === uri || k.startsWith(prefix)) entries.delete(k);
      }
    },

    async makeDirectoryAsync(uri, opts = {}) {
      // Recursive mkdir: split on '/' and rebuild the path so every
      // ancestor is a `dir` entry.  We preserve the file://[host] prefix
      // (including the empty-host triple-slash form) by anchoring on the
      // first '/' AFTER 'file://'.
      const m = uri.match(/^(file:\/\/)([^/]*)(\/.*)$/);
      if (!m || !opts.intermediates) {
        entries.set(uri, { kind: 'dir', mtime: Date.now() / 1000 });
        return;
      }
      const [, scheme, host, path] = m;
      const parts = path.split('/').filter(Boolean);
      let cursor = `${scheme}${host}`;
      for (const p of parts) {
        cursor = `${cursor}/${p}`;
        if (!entries.has(cursor)) entries.set(cursor, { kind: 'dir', mtime: Date.now() / 1000 });
      }
    },

    async readDirectoryAsync(uri) {
      const prefix = uri.endsWith('/') ? uri : `${uri}/`;
      if (!entries.has(uri)) {
        const err = new Error(`No such file: ${uri}`);
        throw err;
      }
      const out = [];
      for (const k of entries.keys()) {
        if (!k.startsWith(prefix)) continue;
        const tail = k.slice(prefix.length);
        if (tail.length === 0) continue;
        if (tail.includes('/')) continue;
        out.push(tail);
      }
      return out.sort();
    },

    async getInfoAsync(uri /*, opts */) {
      const e = entries.get(uri);
      if (!e) return { exists: false };
      return {
        exists: true,
        isDirectory: e.kind === 'dir',
        size: e.kind === 'file' ? e.bytes.byteLength : 0,
        modificationTime: e.mtime,
      };
    },

    async moveAsync({ from, to }) {
      const e = entries.get(from);
      if (!e) {
        const err = new Error(`No such file: ${from}`);
        throw err;
      }
      entries.delete(from);
      entries.set(to, e);
    },
  };

  return { FileSystem, entries };
}

describe('createFsRN — surface', () => {
  it('rejects calls without a FileSystem namespace', () => {
    expect(() => createFsRN({})).toThrow(/FileSystem/);
  });
  it('builds an adapter when given a FileSystem namespace', () => {
    const { FileSystem } = buildMockFileSystem();
    const fs = createFsRN({ FileSystem });
    expect(typeof fs.readFile).toBe('function');
    expect(typeof fs.writeFile).toBe('function');
    expect(typeof fs.mkdir).toBe('function');
    expect(typeof fs.readdir).toBe('function');
    expect(typeof fs.stat).toBe('function');
    expect(typeof fs.unlink).toBe('function');
    expect(typeof fs.rename).toBe('function');
    expect(typeof fs.rmdir).toBe('function');
  });
});

describe('fsRN — read / write round-trip', () => {
  let fs, FileSystem;
  beforeEach(() => {
    const m = buildMockFileSystem();
    FileSystem = m.FileSystem;
    fs = createFsRN({ FileSystem });
  });

  it('writes + reads UTF-8 text content', async () => {
    await fs.mkdir('file:///doc/folio', { recursive: true });
    await fs.writeFile('file:///doc/folio/hello.md', '# Hello, world\n');
    const text = await fs.readFileText('file:///doc/folio/hello.md');
    expect(text).toBe('# Hello, world\n');
  });

  it('writes + reads binary content', async () => {
    await fs.mkdir('file:///doc/folio', { recursive: true });
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0xff]);
    await fs.writeFile('file:///doc/folio/blob.bin', bytes);
    const out = await fs.readFile('file:///doc/folio/blob.bin');
    expect(out).toBeInstanceOf(Uint8Array);
    expect([...out]).toEqual([0x00, 0x01, 0x02, 0xff]);
  });
});

describe('fsRN — ENOENT normalization', () => {
  let fs;
  beforeEach(() => {
    const { FileSystem } = buildMockFileSystem();
    fs = createFsRN({ FileSystem });
  });

  it('throws an error with .code === "ENOENT" on missing file', async () => {
    let caught;
    try {
      await fs.readFileText('file:///does-not-exist.md');
    } catch (err) { caught = err; }
    expect(caught).toBeDefined();
    expect(caught.code).toBe('ENOENT');
  });

  it('stat throws ENOENT for a missing path', async () => {
    let caught;
    try { await fs.stat('file:///nope'); } catch (err) { caught = err; }
    expect(caught.code).toBe('ENOENT');
  });

  it('unlink throws ENOENT for a missing file', async () => {
    let caught;
    try { await fs.unlink('file:///nope'); } catch (err) { caught = err; }
    expect(caught.code).toBe('ENOENT');
  });
});

describe('fsRN — readdir / stat / rename / rmdir', () => {
  let fs;
  beforeEach(() => {
    const { FileSystem } = buildMockFileSystem();
    fs = createFsRN({ FileSystem });
  });

  it('readdir returns child names in a directory', async () => {
    await fs.mkdir('file:///doc/folio', { recursive: true });
    await fs.writeFile('file:///doc/folio/a.md', 'A');
    await fs.writeFile('file:///doc/folio/b.md', 'B');
    const names = await fs.readdir('file:///doc/folio');
    expect(names.sort()).toEqual(['a.md', 'b.md']);
  });

  it('readdir({ withFileTypes: true }) returns DirEnt-shaped objects', async () => {
    await fs.mkdir('file:///doc/folio', { recursive: true });
    await fs.mkdir('file:///doc/folio/sub', { recursive: true });
    await fs.writeFile('file:///doc/folio/a.md', 'A');
    const items = await fs.readdir('file:///doc/folio', { withFileTypes: true });
    const sub  = items.find((x) => x.name === 'sub');
    const file = items.find((x) => x.name === 'a.md');
    expect(sub.isDirectory()).toBe(true);
    expect(sub.isFile()).toBe(false);
    expect(file.isFile()).toBe(true);
    expect(file.isDirectory()).toBe(false);
  });

  it('stat reports size and converts modificationTime sec → mtimeMs', async () => {
    await fs.mkdir('file:///doc/folio', { recursive: true });
    await fs.writeFile('file:///doc/folio/a.md', 'hello');
    const st = await fs.stat('file:///doc/folio/a.md');
    expect(st.size).toBe(5);
    expect(st.isFile()).toBe(true);
    expect(typeof st.mtimeMs).toBe('number');
    expect(st.mtimeMs).toBeGreaterThan(0);
  });

  it('rename moves a file (covers tmp-then-rename atomic pattern)', async () => {
    await fs.mkdir('file:///doc/folio', { recursive: true });
    await fs.writeFile('file:///doc/folio/a.md.tmp', 'pending');
    await fs.rename('file:///doc/folio/a.md.tmp', 'file:///doc/folio/a.md');
    expect(await fs.readFileText('file:///doc/folio/a.md')).toBe('pending');
    let caught;
    try { await fs.stat('file:///doc/folio/a.md.tmp'); }
    catch (err) { caught = err; }
    expect(caught.code).toBe('ENOENT');
  });

  it('rmdir removes an empty directory', async () => {
    await fs.mkdir('file:///doc/folio/empty', { recursive: true });
    await fs.rmdir('file:///doc/folio/empty');
    let caught;
    try { await fs.stat('file:///doc/folio/empty'); }
    catch (err) { caught = err; }
    expect(caught.code).toBe('ENOENT');
  });
});
