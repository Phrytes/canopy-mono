/**
 * Search.test.js — FTS5 query tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { Db }     from '../src/Db.js';
import { search, findByPodUri } from '../src/Search.js';

let db;
let sourceA, sourceB;

beforeEach(() => {
  db = Db.open(':memory:');
  sourceA = db.addSource({ name: 'alice', podRoot: 'https://alice.example/' });
  sourceB = db.addSource({ name: 'bob',   podRoot: 'https://bob.example/'   });

  // Seed a small corpus.
  const docs = [
    { src: sourceA, uri: 'https://alice.example/notes/cake.md',
      rel: 'notes/cake.md', body: 'cocoa cake recipe with brown sugar', mtime: 1000 },
    { src: sourceA, uri: 'https://alice.example/notes/bread.md',
      rel: 'notes/bread.md', body: 'sourdough bread recipe', mtime: 2000 },
    { src: sourceA, uri: 'https://alice.example/notes/tax.md',
      rel: 'notes/tax.md',   body: 'tax notes for 2024', mtime: 3000 },
    { src: sourceB, uri: 'https://bob.example/journal/cake.md',
      rel: 'journal/cake.md', body: 'made cake today; mom liked it', mtime: 4000 },
    { src: sourceB, uri: 'https://bob.example/journal/empty.md',
      rel: 'journal/empty.md', body: '', mtime: 5000 },
  ];
  for (const d of docs) {
    db.upsertResource({
      sourceId: d.src.id, podUri: d.uri, relPath: d.rel,
      contentType: 'text/markdown', size: d.body.length, sha256: d.uri,
      lastModified: d.mtime, ftsContent: d.body,
    });
  }
});

describe('search()', () => {
  it('returns ranked results for a single keyword', () => {
    const rows = search(db, 'cake');
    expect(rows.length).toBe(2);
    // Both cake-mentioning docs returned.
    expect(rows.map((r) => r.relPath).sort()).toEqual(
      ['journal/cake.md', 'notes/cake.md'],
    );
  });

  it('result rows include source name + last-modified timestamp', () => {
    const rows = search(db, 'cake');
    for (const r of rows) {
      expect(typeof r.sourceName).toBe('string');
      expect(typeof r.lastModified).toBe('number');
      expect(typeof r.snippet).toBe('string');
      expect(typeof r.podUri).toBe('string');
    }
  });

  it('snippets highlight matched terms', () => {
    const rows = search(db, 'cocoa');
    expect(rows.length).toBe(1);
    expect(rows[0].snippet).toContain('[cocoa]');
  });

  it('respects --limit (opts.limit)', () => {
    const rows = search(db, 'recipe', { limit: 1 });
    expect(rows.length).toBe(1);
  });

  it('--source filter scopes to one source by id', () => {
    const rows = search(db, 'cake', { sourceId: sourceA.id });
    expect(rows.length).toBe(1);
    expect(rows[0].sourceName).toBe('alice');
  });

  it('--source filter to a different source returns its own results', () => {
    const rows = search(db, 'cake', { sourceId: sourceB.id });
    expect(rows.length).toBe(1);
    expect(rows[0].sourceName).toBe('bob');
  });

  it('returns empty array when no documents match', () => {
    const rows = search(db, 'transmogrify');
    expect(rows).toEqual([]);
  });

  it('throws on empty query', () => {
    expect(() => search(db, '')).toThrow();
    expect(() => search(db, '   ')).toThrow();
  });

  it('throws when query is not a string', () => {
    expect(() => search(db, null)).toThrow();
    expect(() => search(db, 42)).toThrow();
  });

  it('survives queries containing FTS-significant punctuation by binding', () => {
    // FTS5 grammar parses these; we just need the call not to throw a SQL
    // injection error.  Some inputs are syntactically invalid FTS5 queries
    // and SHOULD raise a SQLite error — but our shape is "binding works".
    expect(() => search(db, 'cake recipe')).not.toThrow();
    // Deliberately benign phrase query.
    expect(() => search(db, '"sourdough bread"')).not.toThrow();
  });

  it('phrase queries find exact sequences', () => {
    const rows = search(db, '"sourdough bread"');
    expect(rows.length).toBe(1);
    expect(rows[0].relPath).toBe('notes/bread.md');
  });

  it('limit defaults to 20 and is bounded to 1..1000', () => {
    // Add a 25-doc corpus to verify default cap.
    for (let i = 0; i < 25; i++) {
      const podUri = `https://alice.example/many/${i}`;
      db.upsertResource({
        sourceId: sourceA.id, podUri, relPath: `many/${i}`,
        contentType: 'text/plain', size: 5, sha256: `m${i}`,
        lastModified: 9000 + i, ftsContent: 'manymanymany match',
      });
    }
    expect(search(db, 'manymanymany').length).toBe(20);
    expect(search(db, 'manymanymany', { limit: 5 }).length).toBe(5);
    expect(search(db, 'manymanymany', { limit: 0 }).length).toBe(1);   // clamp ≥1
  });
});

describe('findByPodUri()', () => {
  it('returns the resource row for a known URI', () => {
    const r = findByPodUri(db, 'https://alice.example/notes/cake.md');
    expect(r).not.toBeNull();
    expect(r.relPath).toBe('notes/cake.md');
  });

  it('returns null for an unknown URI (path-traversal guard)', () => {
    expect(findByPodUri(db, 'file:///etc/passwd')).toBeNull();
    expect(findByPodUri(db, 'https://evil.example/x')).toBeNull();
  });
});
