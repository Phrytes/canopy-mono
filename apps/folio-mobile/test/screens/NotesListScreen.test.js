/**
 * NotesListScreen.test.js — `listLocalFiles` walker + `FileRow` formatters.
 */

import { describe, it, expect, vi } from 'vitest';

import { listLocalFiles, defaultFilter } from '../../src/lib/notesList.js';
import { formatMtime, formatBytes }      from '../../src/lib/format.js';

/** Build an in-memory FsAdapter mirroring the surface listLocalFiles touches. */
function buildMockFs(tree) {
  // tree is `Map<absDir, Array<{ name, isDir, mtime, size }>>`.
  return {
    async readdir(dir, opts) {
      const entries = tree.get(dir);
      if (!entries) {
        const err = new Error(`No such file: ${dir}`);
        err.code = 'ENOENT';
        throw err;
      }
      if (opts?.withFileTypes) {
        return entries.map((e) => ({
          name: e.name,
          isDirectory: () => e.isDir,
          isFile:      () => !e.isDir,
        }));
      }
      return entries.map((e) => e.name);
    },
    async stat(absPath) {
      // Find the entry by walking parent.
      const slash = absPath.lastIndexOf('/');
      const dir   = absPath.slice(0, slash);
      const name  = absPath.slice(slash + 1);
      const entries = tree.get(dir);
      if (!entries) {
        const err = new Error(`No such file: ${absPath}`); err.code = 'ENOENT'; throw err;
      }
      const e = entries.find((x) => x.name === name);
      if (!e) {
        const err = new Error(`No such file: ${absPath}`); err.code = 'ENOENT'; throw err;
      }
      return {
        size:     e.size ?? 0,
        mtimeMs:  e.mtime ?? 0,
        isFile:      () => !e.isDir,
        isDirectory: () => !!e.isDir,
      };
    },
  };
}

describe('listLocalFiles', () => {
  it('throws when fs is missing', async () => {
    await expect(listLocalFiles({ localRoot: '/x' })).rejects.toThrow(/fs/);
  });
  it('throws when localRoot is missing', async () => {
    await expect(listLocalFiles({ fs: {} })).rejects.toThrow(/localRoot/);
  });

  it('returns [] when the root does not exist', async () => {
    const fs = buildMockFs(new Map());
    const out = await listLocalFiles({ fs, localRoot: '/missing' });
    expect(out).toEqual([]);
  });

  it('returns flat files in mtime DESC order', async () => {
    const tree = new Map();
    tree.set('/root', [
      { name: 'older.md',  isDir: false, mtime: 1_000, size: 10 },
      { name: 'newer.md',  isDir: false, mtime: 2_000, size: 20 },
    ]);
    const fs = buildMockFs(tree);
    const out = await listLocalFiles({ fs, localRoot: '/root' });
    expect(out).toHaveLength(2);
    expect(out[0].relPath).toBe('newer.md');
    expect(out[1].relPath).toBe('older.md');
    expect(out[0].size).toBe(20);
    expect(out[0].absPath).toBe('/root/newer.md');
  });

  it('walks subdirectories', async () => {
    const tree = new Map();
    tree.set('/root', [
      { name: 'sub', isDir: true,  mtime: 1, size: 0 },
      { name: 'top.md', isDir: false, mtime: 2, size: 5 },
    ]);
    tree.set('/root/sub', [
      { name: 'inner.md', isDir: false, mtime: 3, size: 8 },
    ]);
    const fs = buildMockFs(tree);
    const out = await listLocalFiles({ fs, localRoot: '/root' });
    expect(out.map((f) => f.relPath).sort()).toEqual(['sub/inner.md', 'top.md']);
  });

  it('skips dotted segments by default', async () => {
    const tree = new Map();
    tree.set('/root', [
      { name: '.folio',  isDir: true,  mtime: 1, size: 0 },
      { name: 'a.md',    isDir: false, mtime: 2, size: 5 },
    ]);
    tree.set('/root/.folio', [
      { name: 'state.json', isDir: false, mtime: 3, size: 100 },
    ]);
    const fs = buildMockFs(tree);
    const out = await listLocalFiles({ fs, localRoot: '/root' });
    expect(out).toHaveLength(1);
    expect(out[0].relPath).toBe('a.md');
  });

  it('honours a custom filter', async () => {
    const tree = new Map();
    tree.set('/root', [
      { name: 'keep.md', isDir: false, mtime: 1, size: 5 },
      { name: 'drop.txt', isDir: false, mtime: 2, size: 5 },
    ]);
    const fs = buildMockFs(tree);
    const out = await listLocalFiles({
      fs, localRoot: '/root',
      filter: (rel) => rel.endsWith('.md'),
    });
    expect(out.map((f) => f.relPath)).toEqual(['keep.md']);
  });
});

describe('defaultFilter', () => {
  it('excludes any segment starting with .', () => {
    expect(defaultFilter('.folio/state.json')).toBe(false);
    expect(defaultFilter('notes/.draft/x.md')).toBe(false);
  });
  it('includes ordinary paths', () => {
    expect(defaultFilter('notes/recipe/pizza.md')).toBe(true);
    expect(defaultFilter('a.md')).toBe(true);
  });
});

describe('FileRow formatters', () => {
  it('formatMtime — em dash for null/zero', () => {
    expect(formatMtime(null)).toBe('—');
    expect(formatMtime(0)).toBe('—');
  });
  it('formatMtime — recent', () => {
    expect(formatMtime(Date.now() - 30_000)).toBe('just now');
    expect(formatMtime(Date.now() - 5 * 60_000)).toMatch(/5 min ago/);
    expect(formatMtime(Date.now() - 2 * 3_600_000)).toMatch(/2 h ago/);
    expect(formatMtime(Date.now() - 3 * 86_400_000)).toMatch(/3 d ago/);
  });
  it('formatBytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2_048)).toMatch(/KB$/);
    expect(formatBytes(2 * 1_048_576)).toMatch(/MB$/);
  });
  it('formatBytes — handles invalid', () => {
    expect(formatBytes(null)).toBe('');
    expect(formatBytes(-1)).toBe('');
  });
});
