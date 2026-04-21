import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir }      from 'node:os';
import { join }        from 'node:path';

import { DataSource }             from '../src/storage/DataSource.js';
import { MemorySource }           from '../src/storage/MemorySource.js';
import { FileSystemSource }       from '../src/storage/FileSystemSource.js';
import { SolidPodSource }         from '../src/storage/SolidPodSource.js';
import { StorageManager }         from '../src/storage/StorageManager.js';
import { DataSourcePolicy,
         DataSourceAccessDeniedError } from '../src/permissions/DataSourcePolicy.js';

// ── DataSource base ───────────────────────────────────────────────────────────

describe('DataSource base', () => {
  it('throws not-implemented on all methods', async () => {
    const ds = new DataSource();
    await expect(ds.read('x')).rejects.toThrow('not implemented');
    await expect(ds.write('x', '')).rejects.toThrow('not implemented');
    await expect(ds.delete('x')).rejects.toThrow('not implemented');
    await expect(ds.list()).rejects.toThrow('not implemented');
    await expect(ds.query()).rejects.toThrow('not implemented');
  });
});

// ── MemorySource ──────────────────────────────────────────────────────────────

describe('MemorySource', () => {
  let mem;
  beforeEach(() => { mem = new MemorySource(); });

  it('read returns null for missing key', async () => {
    expect(await mem.read('missing')).toBeNull();
  });

  it('write and read round-trip', async () => {
    await mem.write('hello', 'world');
    expect(await mem.read('hello')).toBe('world');
  });

  it('delete removes entry', async () => {
    await mem.write('a', '1');
    await mem.delete('a');
    expect(await mem.read('a')).toBeNull();
  });

  it('list returns matching keys sorted', async () => {
    await mem.write('notes/b', '');
    await mem.write('notes/a', '');
    await mem.write('other/c', '');
    expect(await mem.list('notes/')).toEqual(['notes/a', 'notes/b']);
  });

  it('list with empty prefix returns all keys', async () => {
    await mem.write('x', '');
    await mem.write('y', '');
    const all = await mem.list();
    expect(all).toContain('x');
    expect(all).toContain('y');
  });

  it('query matches JSON objects by field', async () => {
    await mem.write('item/1', JSON.stringify({ type: 'note', title: 'A' }));
    await mem.write('item/2', JSON.stringify({ type: 'task', title: 'B' }));
    await mem.write('item/3', JSON.stringify({ type: 'note', title: 'C' }));

    const notes = await mem.query({ type: 'note' });
    expect(notes).toHaveLength(2);
    expect(notes.every(n => n.type === 'note')).toBe(true);
  });

  it('query skips non-JSON entries', async () => {
    await mem.write('raw', 'not json');
    const results = await mem.query({});
    expect(results.every(r => r.path !== 'raw')).toBe(true);
  });

  it('size reflects current entry count', async () => {
    expect(mem.size).toBe(0);
    await mem.write('a', '');
    expect(mem.size).toBe(1);
  });
});

// ── FileSystemSource ──────────────────────────────────────────────────────────

describe('FileSystemSource', () => {
  let tmpDir, fs;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'fss-test-'));
    fs = new FileSystemSource({ root: tmpDir });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('read returns null for missing file', async () => {
    expect(await fs.read('nope.txt')).toBeNull();
  });

  it('write and read round-trip', async () => {
    await fs.write('hello.txt', 'world');
    expect(await fs.read('hello.txt')).toBe('world');
  });

  it('write creates subdirectories', async () => {
    await fs.write('deep/nested/file.txt', 'data');
    expect(await fs.read('deep/nested/file.txt')).toBe('data');
  });

  it('delete removes file', async () => {
    await fs.write('del.txt', 'bye');
    await fs.delete('del.txt');
    expect(await fs.read('del.txt')).toBeNull();
  });

  it('delete is a no-op for missing file', async () => {
    await expect(fs.delete('ghost.txt')).resolves.toBeUndefined();
  });

  it('list returns files under prefix', async () => {
    await fs.write('a/1.txt', '');
    await fs.write('a/2.txt', '');
    await fs.write('b/3.txt', '');
    const listed = await fs.list('a/');
    expect(listed).toEqual(['a/1.txt', 'a/2.txt']);
  });

  it('list with empty prefix returns all files', async () => {
    await fs.write('x.txt', '');
    await fs.write('y.txt', '');
    const all = await fs.list();
    expect(all).toContain('x.txt');
    expect(all).toContain('y.txt');
  });

  it('throws on path traversal attempt', async () => {
    await expect(fs.read('../etc/passwd')).rejects.toThrow('Path traversal');
  });

  it('query matches JSON files by field', async () => {
    await fs.write('items/1.json', JSON.stringify({ type: 'a' }));
    await fs.write('items/2.json', JSON.stringify({ type: 'b' }));
    const results = await fs.query({ type: 'a' });
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('a');
  });
});

// ── SolidPodSource stub ───────────────────────────────────────────────────────

describe('SolidPodSource', () => {
  it('throws NOT_IMPLEMENTED on all methods', async () => {
    const s = new SolidPodSource({ podUrl: 'https://pod.example.org/', credential: 'tok' });
    await expect(s.read('x')).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
    await expect(s.write('x', '')).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });
});

// ── DataSourcePolicy ──────────────────────────────────────────────────────────

describe('DataSourcePolicy', () => {
  it('open policy (null config) allows everything', () => {
    const pol = new DataSourcePolicy(null);
    expect(() => pol.checkAccess({ sourceLabel: 'any', skillId: 'x' })).not.toThrow();
  });

  it('allows access for a listed skill', () => {
    const pol = new DataSourcePolicy({ notes: { allowedSkills: ['note-read'] } });
    expect(() => pol.checkAccess({ sourceLabel: 'notes', skillId: 'note-read' })).not.toThrow();
  });

  it('denies access for an unlisted skill', () => {
    const pol = new DataSourcePolicy({ notes: { allowedSkills: ['note-read'] } });
    expect(() => pol.checkAccess({ sourceLabel: 'notes', skillId: 'evil' }))
      .toThrow(DataSourceAccessDeniedError);
  });

  it('allows access when skillId is null (no caller context)', () => {
    const pol = new DataSourcePolicy({ notes: { allowedSkills: ['note-read'] } });
    expect(() => pol.checkAccess({ sourceLabel: 'notes', skillId: null })).not.toThrow();
  });

  it('allows unconfigured source labels', () => {
    const pol = new DataSourcePolicy({ notes: { allowedSkills: ['x'] } });
    expect(() => pol.checkAccess({ sourceLabel: 'other', skillId: 'anything' })).not.toThrow();
  });

  it('denies by agentId', () => {
    const pol = new DataSourcePolicy({ vault: { allowedAgents: ['pk-allowed'] } });
    expect(() => pol.checkAccess({ sourceLabel: 'vault', agentId: 'pk-other' }))
      .toThrow(DataSourceAccessDeniedError);
  });
});

// ── StorageManager ────────────────────────────────────────────────────────────

describe('StorageManager', () => {
  it('read/write/delete delegate to the named source', async () => {
    const src = new MemorySource();
    const sm  = new StorageManager({ sources: { mem: src } });

    await sm.write('mem', 'k', 'v');
    expect(await sm.read('mem', 'k')).toBe('v');
    await sm.delete('mem', 'k');
    expect(await sm.read('mem', 'k')).toBeNull();
  });

  it('list and query delegate correctly', async () => {
    const src = new MemorySource();
    const sm  = new StorageManager({ sources: { mem: src } });

    await sm.write('mem', 'a/1', '');
    await sm.write('mem', 'a/2', '');
    expect(await sm.list('mem', 'a/')).toEqual(['a/1', 'a/2']);
  });

  it('throws for unknown source label', async () => {
    const sm = new StorageManager({ sources: {} });
    await expect(sm.read('nope', 'x')).rejects.toThrow("unknown data source 'nope'");
  });

  it('enforces policy — denies disallowed skill', async () => {
    const src = new MemorySource();
    const pol = new DataSourcePolicy({ sec: { allowedSkills: ['admin'] } });
    const sm  = new StorageManager({ sources: { sec: src }, policy: pol });

    await expect(sm.read('sec', 'x', { skillId: 'intruder' }))
      .rejects.toThrow(DataSourceAccessDeniedError);
  });

  it('enforces policy — allows permitted skill', async () => {
    const src = new MemorySource();
    await src.write('x', 'secret');
    const pol = new DataSourcePolicy({ sec: { allowedSkills: ['admin'] } });
    const sm  = new StorageManager({ sources: { sec: src }, policy: pol });

    expect(await sm.read('sec', 'x', { skillId: 'admin' })).toBe('secret');
  });

  it('getSource returns the DataSource or null', () => {
    const src = new MemorySource();
    const sm  = new StorageManager({ sources: { mem: src } });
    expect(sm.getSource('mem')).toBe(src);
    expect(sm.getSource('other')).toBeNull();
  });

  it('addSource / removeSource work at runtime', async () => {
    const sm  = new StorageManager({ sources: {} });
    const src = new MemorySource();
    sm.addSource('dyn', src);
    await sm.write('dyn', 'k', '1');
    expect(await sm.read('dyn', 'k')).toBe('1');
    sm.removeSource('dyn');
    await expect(sm.read('dyn', 'k')).rejects.toThrow();
  });
});
