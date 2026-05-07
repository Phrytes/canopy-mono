/**
 * L1i (pod-search) rule-of-two validation via Archive's FTS5 backend.
 *
 * Goal: prove (or disprove) that L1i's PodSearch public API is
 * expressive enough to wrap a real-world FTS5-backed Archive.  Per
 * `Project Files/Substrates/policies.md`'s rule of two:
 * substrate APIs are validated by ≥2 consumer specs; L1i's first
 * consumer was H7's design doc, this is the second consumer (Archive's
 * existing CLI lib in production).  Test outcomes documented at
 * the bottom of this file as findings for L1i V1.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Db } from '../src/Db.js';
import { PodSearchAdapter } from '../src/PodSearchAdapter.js';

const SOURCE_ID = 1;          // populated in beforeEach

let db;
let adapter;

beforeEach(() => {
  db = Db.open(':memory:');
  // One source so `defaultSourceId` lets indexBatch items skip sourceId.
  db.addSource({ name: 'gmail', podRoot: 'https://x.example/gmail' });
  adapter = new PodSearchAdapter({ db, defaultSourceId: SOURCE_ID });
});

describe('PodSearchAdapter — indexBatch + query (L1i API roundtrip)', () => {
  it('indexes items and finds them by FTS query', async () => {
    await adapter.indexBatch([
      {
        podUri:       'https://x.example/gmail/msg-1.md',
        relPath:      'gmail/msg-1.md',
        content:      'Subject: meet alice friday for lunch',
        contentType:  'text/markdown',
        sha256:       'sha-1',
      },
      {
        podUri:       'https://x.example/gmail/msg-2.md',
        relPath:      'gmail/msg-2.md',
        content:      'Subject: project update from bob',
        contentType:  'text/markdown',
        sha256:       'sha-2',
      },
    ]);
    const r = await adapter.query({ text: 'alice' });
    expect(r.total).toBe(1);
    expect(r.items[0].relPath).toBe('gmail/msg-1.md');
    expect(r.items[0].snippet).toMatch(/\[alice\]/);
  });

  it('returns the L1i shape: {items, total, facets}', async () => {
    await adapter.indexBatch([
      { podUri: 'a', relPath: 'a.md', content: 'apple banana',  contentType: 'text/markdown', sha256: 'sa' },
      { podUri: 'b', relPath: 'b.md', content: 'apple pear',    contentType: 'text/plain',    sha256: 'sb' },
    ]);
    const r = await adapter.query({ text: 'apple' });
    expect(r).toHaveProperty('items');
    expect(r).toHaveProperty('total');
    expect(r).toHaveProperty('facets');
    expect(r.facets).toHaveProperty('sourceName');
    expect(r.facets).toHaveProperty('contentType');
    expect(r.facets.contentType).toEqual({ 'text/markdown': 1, 'text/plain': 1 });
  });

  it('filters via {contentType: "text/markdown"} (client-side overlay)', async () => {
    await adapter.indexBatch([
      { podUri: 'a', relPath: 'a.md',  content: 'apple', contentType: 'text/markdown', sha256: 'sa' },
      { podUri: 'b', relPath: 'b.txt', content: 'apple', contentType: 'text/plain',    sha256: 'sb' },
    ]);
    const r = await adapter.query({ text: 'apple', filters: { contentType: 'text/markdown' } });
    expect(r.total).toBe(1);
    expect(r.items[0].relPath).toBe('a.md');
  });

  it('filters via multi-value {contentType: [...]}', async () => {
    await adapter.indexBatch([
      { podUri: 'a', relPath: 'a.md', content: 'fruit', contentType: 'text/markdown', sha256: 'sa' },
      { podUri: 'b', relPath: 'b.md', content: 'fruit', contentType: 'text/plain',    sha256: 'sb' },
      { podUri: 'c', relPath: 'c.md', content: 'fruit', contentType: 'application/json', sha256: 'sc' },
    ]);
    const r = await adapter.query({
      text: 'fruit',
      filters: { contentType: ['text/markdown', 'text/plain'] },
    });
    expect(r.total).toBe(2);
  });

  it('limit + offset paginate', async () => {
    await adapter.indexBatch(
      Array.from({ length: 10 }, (_, i) => ({
        podUri:      `u-${i}`,
        relPath:     `f-${i}.md`,
        content:     'fruit',
        contentType: 'text/markdown',
        sha256:      `s-${i}`,
      })),
    );
    const p1 = await adapter.query({ text: 'fruit', limit: 3, offset: 0 });
    const p2 = await adapter.query({ text: 'fruit', limit: 3, offset: 3 });
    expect(p1.items).toHaveLength(3);
    expect(p2.items).toHaveLength(3);
    // Different items between pages.
    const ids1 = p1.items.map((i) => i.podUri);
    const ids2 = p2.items.map((i) => i.podUri);
    expect(ids1.some((id) => ids2.includes(id))).toBe(false);
  });
});

describe('PodSearchAdapter — deleteById', () => {
  it('removes an indexed resource by its resourceId', async () => {
    await adapter.indexBatch([
      { podUri: 'a', relPath: 'a.md', content: 'apple', contentType: 'text/markdown', sha256: 'sa' },
    ]);
    const before = await adapter.query({ text: 'apple' });
    expect(before.total).toBe(1);
    const resourceId = before.items[0].resourceId;
    await adapter.deleteById(resourceId);
    const after = await adapter.query({ text: 'apple' });
    expect(after.total).toBe(0);
  });
});

describe('PodSearchAdapter — documented gaps (V1 substrate work)', () => {
  it('throws on filter-only queries (L1i allows; FTS5 backend cannot)', async () => {
    await adapter.indexBatch([
      { podUri: 'a', relPath: 'a.md', content: 'apple', contentType: 'text/markdown', sha256: 'sa' },
    ]);
    await expect(
      adapter.query({ filters: { contentType: 'text/markdown' } }),
    ).rejects.toThrow(/text required/);
  });

  it('throws on rank: "date-desc" (Archive search() ranks by FTS5 only)', async () => {
    await adapter.indexBatch([
      { podUri: 'a', relPath: 'a.md', content: 'apple', contentType: 'text/markdown', sha256: 'sa' },
    ]);
    await expect(
      adapter.query({ text: 'apple', rank: 'date-desc' }),
    ).rejects.toThrow(/unsupported/);
  });
});

/*
 * ─── Findings — L1i V1 substrate work surfaced by this validation ───
 *
 * (1) Filter-only queries.  L1i's `query({filters: ...})` (no text)
 *     works for the in-memory backend by enumerating items.  Archive's
 *     FTS5 backend doesn't have an enumeration query — `search()`
 *     requires a non-empty MATCH.  V1 work: extend the substrate's
 *     Backend interface with a `list(filters?)` method distinct from
 *     `query(text)`; in-memory backend implements list() trivially,
 *     FTS5 backend can implement it via plain `SELECT FROM resources`
 *     (no FTS5 join).
 *
 * (2) Date-sort.  L1i's `rank: 'date-desc'/'date-asc'` works for the
 *     in-memory backend via the schema's `sortable` field.  Archive's
 *     `search()` orders by FTS5 `rank` only.  V1 work: substrate
 *     should expose ordering as a backend capability — backends that
 *     can't sort by date throw or implement client-side fallback.
 *     (Archive has `last_modified` indexed; the SQL just doesn't ORDER BY it.)
 *
 * (3) Schema-driven indexing vs fixed schema.  L1i's API is schema-
 *     driven (`new PodSearch({schema})`).  Archive's tables are fixed.
 *     The adapter ignores the schema arg.  V1 work: substrate should
 *     distinguish schema-driven backends (in-memory) from fixed-schema
 *     backends (Archive-style) — either accept a "schema-as-config" or
 *     "schema-as-shape-of-existing-tables" mode.
 *
 * (4) Snippet support.  L1i's API doesn't surface a snippet field;
 *     Archive's results carry `snippet` as a free-form string.  The
 *     adapter passes it through; consumers that want snippets read
 *     `item.snippet`.  V1 work: standardise snippet support on
 *     L1i's Result shape (it's a useful feature for any FTS-style
 *     search).
 *
 * (5) Multi-source.  Archive's data model has a sourceId foreign key;
 *     the substrate is single-corpus.  Adapter exposes `sourceName`
 *     as a facet + filter.  Acceptable; not a substrate gap.
 *
 * (6) Reindex semantics.  L1i's `reindex()` is "wipe and rebuild";
 *     Archive's FTS5 doesn't support that without re-fetching from
 *     the pod (Archive's `reindex` CLI command does fetch).  V1 work:
 *     substrate should specify `reindex` as a backend capability;
 *     incremental backends document a no-op semantic.
 *
 * Summary: the adapter is functional but documents 5–6 substrate API
 * gaps.  L1i V1 should address (1) and (4) at minimum since they're
 * most user-visible.  The other gaps are edge-case but worth noting.
 */
