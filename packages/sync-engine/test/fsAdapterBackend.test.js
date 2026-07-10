import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { createFsAdapterBackend } from '../src/fsAdapterBackend.js';

/**
 * A Map-backed fake of the engine's fs adapter (readFileText/writeFile/rename/
 * unlink/mkdir/readdir) — proves the backend rides ANY conforming adapter, which
 * is the whole point (Node fsNode + RN expo-file-system both implement it, so
 * the version store works on both from one code path — no node:fs).
 */
function fakeFs() {
  const files = new Map();
  return {
    _files: files,
    async mkdir() {},
    async writeFile(path, data) { files.set(path, data); },
    async readFileText(path) {
      if (!files.has(path)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return files.get(path);
    },
    async rename(a, b) { files.set(b, files.get(a)); files.delete(a); },
    async unlink(path) {
      if (!files.has(path)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      files.delete(path);
    },
    async readdir(dir) {
      const p = dir.endsWith('/') ? dir : dir + '/';
      return [...files.keys()].filter((k) => k.startsWith(p)).map((k) => k.slice(p.length));
    },
  };
}

const hashHex = async (s) => createHash('sha256').update(String(s)).digest('hex');
const mk = (fs = fakeFs()) => ({ fs, backend: createFsAdapterBackend({ fs, hashHex, dir: 'store' }) });

describe('createFsAdapterBackend', () => {
  it('round-trips string + binary values, preserving etag/_v', async () => {
    const { backend } = mk();
    await backend.put('k/text', 'a note');
    const t = await backend.get('k/text');
    expect(t.bytes).toBe('a note');
    expect(typeof t.etag).toBe('string');
    expect(t._v).toBe(1);

    // Binary (Uint8Array) round-trips via base64 tagging.
    const bytes = new Uint8Array([0, 1, 254, 255]);
    await backend.put('k/bin', { ts: 5, content: bytes });
    const b = await backend.get('k/bin');
    expect(b.bytes.ts).toBe(5);
    expect(b.bytes.content).toEqual(bytes);
  });

  it('put increments _v; a pinned _v is preserved', async () => {
    const { backend } = mk();
    expect((await backend.put('k', 'v1'))._v).toBe(1);
    expect((await backend.put('k', 'v2'))._v).toBe(2);
    expect((await backend.put('k', 'v3', undefined, 9))._v).toBe(9);
  });

  it('list returns keys with the prefix, sorted; get on a missing key is null', async () => {
    const { backend } = mk();
    await backend.put('versions/a/2', 'x');
    await backend.put('versions/a/1', 'x');
    await backend.put('versions/b/1', 'x');
    await backend.put('other/z', 'x');
    expect(await backend.list('versions/a/')).toEqual(['versions/a/1', 'versions/a/2']);
    expect(await backend.list('versions/')).toHaveLength(3);
    expect(await backend.get('nope')).toBeNull();
  });

  it('delete removes the record; deleting a missing key is a no-op', async () => {
    const { backend } = mk();
    await backend.put('k', 'x');
    await backend.delete('k');
    expect(await backend.get('k')).toBeNull();
    await expect(backend.delete('k')).resolves.toBeUndefined();
  });

  it('a corrupt record reads as a miss (never throws into the substrate)', async () => {
    const { fs, backend } = mk();
    await backend.put('k', 'x');
    // Corrupt the on-disk JSON.
    const file = [...fs._files.keys()].find((p) => p.endsWith('.json') && !p.endsWith('.tmp'));
    fs._files.set(file, '{ not json');
    expect(await backend.get('k')).toBeNull();
    expect(await backend.list('')).toEqual([]); // corrupt record skipped, not thrown
  });

  it('validates its required deps', () => {
    expect(() => createFsAdapterBackend({ hashHex, dir: 'd' })).toThrow(/fs adapter/);
    expect(() => createFsAdapterBackend({ fs: fakeFs(), dir: 'd' })).toThrow(/hashHex/);
    expect(() => createFsAdapterBackend({ fs: fakeFs(), hashHex })).toThrow(/dir/);
  });
});
