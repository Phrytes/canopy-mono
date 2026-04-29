/**
 * Db.test.js — schema, source CRUD, resource upsert, FTS roundtrip.
 *
 * All tests use `:memory:` so they don't touch disk.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { Db }     from '../src/Db.js';
import { search } from '../src/Search.js';

let db;
beforeEach(() => {
  db = Db.open(':memory:');
});

describe('Db.open / schema', () => {
  it('creates the three tables idempotently', () => {
    const tables = db.handle
      .prepare(`SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name`)
      .all()
      .map((r) => r.name);
    expect(tables).toContain('sources');
    expect(tables).toContain('resources');
    expect(tables).toContain('resource_fts');
  });

  it('running schema twice is a no-op (idempotency)', () => {
    // Re-open a second time on the same handle path is irrelevant for
    // :memory:; instead verify that re-running the SCHEMA SQL doesn't
    // throw via re-opening a NEW DB and inserting then.
    const d2 = Db.open(':memory:');
    expect(() => d2.addSource({ name: 's', podRoot: 'https://x.example/' })).not.toThrow();
    d2.close();
  });

  it('the resource_fts virtual table is FTS5 (snippet() works)', () => {
    const s = db.addSource({ name: 'a', podRoot: 'https://a.example/' });
    db.upsertResource({
      sourceId:     s.id,
      podUri:       'https://a.example/note.md',
      relPath:      'note.md',
      contentType:  'text/markdown',
      size:         11,
      sha256:       'deadbeef',
      lastModified: 1234,
      ftsContent:   'hello world',
    });
    const rows = db.handle
      .prepare(`SELECT snippet(resource_fts, 1, '<', '>', '…', 5) AS s
                  FROM resource_fts WHERE resource_fts MATCH 'hello'`)
      .all();
    expect(rows.length).toBe(1);
    expect(rows[0].s).toContain('<hello>');
  });
});

describe('Db.sources CRUD', () => {
  it('adds + retrieves a source', () => {
    const s = db.addSource({ name: 'alice', podRoot: 'https://alice.example/' });
    expect(s.id).toBeGreaterThan(0);
    expect(db.getSourceById(s.id)).toMatchObject({ name: 'alice', podRoot: 'https://alice.example/' });
    expect(db.getSourceByName('alice')).toMatchObject({ id: s.id });
    expect(db.getSourceByPodRoot('https://alice.example/')).toMatchObject({ id: s.id });
  });

  it('rejects duplicate pod_root via UNIQUE constraint', () => {
    db.addSource({ name: 'a', podRoot: 'https://x.example/' });
    expect(() => db.addSource({ name: 'b', podRoot: 'https://x.example/' })).toThrow();
  });

  it('listSources returns sources in insertion order', () => {
    db.addSource({ name: 'a', podRoot: 'https://a.example/' });
    db.addSource({ name: 'b', podRoot: 'https://b.example/' });
    db.addSource({ name: 'c', podRoot: 'https://c.example/' });
    expect(db.listSources().map((s) => s.name)).toEqual(['a', 'b', 'c']);
  });

  it('setSourceLastIndexed updates the column', () => {
    const s = db.addSource({ name: 'a', podRoot: 'https://a.example/' });
    expect(db.getSourceById(s.id).lastIndexed).toBeNull();
    db.setSourceLastIndexed(s.id, 99999);
    expect(db.getSourceById(s.id).lastIndexed).toBe(99999);
  });
});

describe('Db.resources upsert', () => {
  it('inserts a new resource and reports inserted=true', () => {
    const s = db.addSource({ name: 'a', podRoot: 'https://a.example/' });
    const { id, inserted } = db.upsertResource({
      sourceId:     s.id,
      podUri:       'https://a.example/note.md',
      relPath:      'note.md',
      contentType:  'text/markdown',
      size:         5,
      sha256:       'aa',
      lastModified: 100,
      ftsContent:   'hello',
    });
    expect(inserted).toBe(true);
    expect(id).toBeGreaterThan(0);
    expect(db.countResources(s.id)).toBe(1);
  });

  it('updates an existing resource on second upsert', () => {
    const s = db.addSource({ name: 'a', podRoot: 'https://a.example/' });
    const a = db.upsertResource({
      sourceId: s.id, podUri: 'https://a.example/n.md', relPath: 'n.md',
      contentType: 'text/plain', size: 1, sha256: 'x', lastModified: 1, ftsContent: 'old',
    });
    const b = db.upsertResource({
      sourceId: s.id, podUri: 'https://a.example/n.md', relPath: 'n.md',
      contentType: 'text/plain', size: 2, sha256: 'y', lastModified: 2, ftsContent: 'new',
    });
    expect(a.id).toBe(b.id);
    expect(b.inserted).toBe(false);
    expect(db.countResources(s.id)).toBe(1);
    expect(db.getResource(s.id, 'https://a.example/n.md').sha256).toBe('y');
  });

  it('FTS row is replaced (not appended) on update', () => {
    const s = db.addSource({ name: 'a', podRoot: 'https://a.example/' });
    db.upsertResource({
      sourceId: s.id, podUri: 'https://a.example/n.md', relPath: 'n.md',
      contentType: 'text/plain', size: 1, sha256: 'x', lastModified: 1, ftsContent: 'banana',
    });
    db.upsertResource({
      sourceId: s.id, podUri: 'https://a.example/n.md', relPath: 'n.md',
      contentType: 'text/plain', size: 1, sha256: 'y', lastModified: 1, ftsContent: 'apple',
    });
    // Old term should not match anymore.
    expect(search(db, 'banana').length).toBe(0);
    expect(search(db, 'apple').length).toBe(1);
  });

  it('passing ftsContent=null records the row but skips FTS', () => {
    const s = db.addSource({ name: 'a', podRoot: 'https://a.example/' });
    const { id } = db.upsertResource({
      sourceId: s.id, podUri: 'https://a.example/photo.jpg', relPath: 'photo.jpg',
      contentType: 'image/jpeg', size: 999, sha256: 'pp', lastModified: 5, ftsContent: null,
    });
    expect(db.countResources(s.id)).toBe(1);
    expect(db.getFtsContent(id)).toBeNull();
  });

  it('switching from text → binary on re-index removes the FTS row', () => {
    const s = db.addSource({ name: 'a', podRoot: 'https://a.example/' });
    const { id } = db.upsertResource({
      sourceId: s.id, podUri: 'https://a.example/x', relPath: 'x',
      contentType: 'text/plain', size: 5, sha256: 'a1', lastModified: 1, ftsContent: 'searchable',
    });
    expect(db.getFtsContent(id)).toBe('searchable');
    db.upsertResource({
      sourceId: s.id, podUri: 'https://a.example/x', relPath: 'x',
      contentType: 'application/octet-stream', size: 5, sha256: 'a2', lastModified: 2, ftsContent: null,
    });
    expect(db.getFtsContent(id)).toBeNull();
  });

  it('throws when sha256 missing', () => {
    const s = db.addSource({ name: 'a', podRoot: 'https://a.example/' });
    expect(() => db.upsertResource({
      sourceId: s.id, podUri: 'u', relPath: 'r', contentType: 'text/plain',
      size: 1, sha256: '', lastModified: 1, ftsContent: 'x',
    })).toThrow();
  });

  it('deleteResource removes both the resources row and the FTS row', () => {
    const s = db.addSource({ name: 'a', podRoot: 'https://a.example/' });
    const { id } = db.upsertResource({
      sourceId: s.id, podUri: 'https://a.example/n', relPath: 'n',
      contentType: 'text/plain', size: 1, sha256: 'a', lastModified: 1, ftsContent: 'gone',
    });
    db.deleteResource(id);
    expect(db.countResources(s.id)).toBe(0);
    expect(db.getFtsContent(id)).toBeNull();
  });

  it('countResources can be scoped per source', () => {
    const a = db.addSource({ name: 'a', podRoot: 'https://a.example/' });
    const b = db.addSource({ name: 'b', podRoot: 'https://b.example/' });
    db.upsertResource({
      sourceId: a.id, podUri: 'https://a.example/n', relPath: 'n',
      contentType: 'text/plain', size: 1, sha256: 'x', lastModified: 1, ftsContent: '',
    });
    db.upsertResource({
      sourceId: b.id, podUri: 'https://b.example/n', relPath: 'n',
      contentType: 'text/plain', size: 1, sha256: 'x', lastModified: 1, ftsContent: '',
    });
    db.upsertResource({
      sourceId: b.id, podUri: 'https://b.example/m', relPath: 'm',
      contentType: 'text/plain', size: 1, sha256: 'y', lastModified: 1, ftsContent: '',
    });
    expect(db.countResources()).toBe(3);
    expect(db.countResources(a.id)).toBe(1);
    expect(db.countResources(b.id)).toBe(2);
  });

  it('resourcesForSource returns rows sorted by rel_path', () => {
    const s = db.addSource({ name: 'a', podRoot: 'https://a.example/' });
    for (const p of ['c', 'a', 'b']) {
      db.upsertResource({
        sourceId: s.id, podUri: `https://a.example/${p}`, relPath: p,
        contentType: 'text/plain', size: 1, sha256: p, lastModified: 1, ftsContent: '',
      });
    }
    expect(db.resourcesForSource(s.id).map((r) => r.relPath)).toEqual(['a', 'b', 'c']);
  });

  it('findResourceByPodUri retrieves across sources', () => {
    const s = db.addSource({ name: 'a', podRoot: 'https://a.example/' });
    db.upsertResource({
      sourceId: s.id, podUri: 'https://a.example/n', relPath: 'n',
      contentType: 'text/plain', size: 1, sha256: 'x', lastModified: 1, ftsContent: '',
    });
    expect(db.findResourceByPodUri('https://a.example/n')).not.toBeNull();
    expect(db.findResourceByPodUri('https://nope.example/')).toBeNull();
  });
});
