import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PodSearch } from '../src/index.js';
import { chunkText } from '../src/chunking.js';

/**
 * Deterministic FAKE embedder (no live model).
 *
 * Maps known texts → fixed vectors so cosine/RRF order is assertable.
 * A 3-dim concept space: [vehicle, food, weather].  The query word "car"
 * maps to the vehicle axis so it semantically matches "automobile
 * repair" (a synonym lexical search misses).  Counts embed() calls and
 * total embedded texts so cache-hit / no-embed claims are checkable.
 */
function fakeEmbedder({ id = 'fake:v1', dim = 3, table, failOn } = {}) {
  const TABLE = table ?? {
    'automobile repair': [1, 0, 0],
    'car dealership':     [0.9, 0, 0.1],
    'lunch recipe':       [0, 1, 0],
    'sunny forecast':     [0, 0, 1],
    car:                  [1, 0, 0], // query: vehicle synonym
  };
  const emb = {
    id,
    dim,
    calls: 0,
    embeddedTexts: 0,
    async embed(texts) {
      emb.calls += 1;
      emb.embeddedTexts += texts.length;
      return texts.map((t) => {
        if (failOn && t === failOn) throw new Error('boom: provider down');
        return Float32Array.from(TABLE[t] ?? new Array(dim).fill(0));
      });
    },
  };
  return emb;
}

const SCHEMA = {
  fields: {
    id:    { primary: true },
    kind:  { facet: true },
    title: { fts: true, weight: 2, embed: true },
  },
};

const ITEMS = [
  { id: 'a', kind: 'vehicle', title: 'automobile repair' },
  { id: 'b', kind: 'food',    title: 'lunch recipe' },
  { id: 'c', kind: 'weather', title: 'sunny forecast' },
  { id: 'd', kind: 'vehicle', title: 'car dealership' },
];

let embedder;
let s;
beforeEach(async () => {
  embedder = fakeEmbedder();
  s = new PodSearch({ schema: SCHEMA, embedder });
  await s.indexBatch(ITEMS);
});

describe('backward-compat: lexical path unchanged with an embedder present', () => {
  it("mode defaults to 'lexical'", async () => {
    const r = await s.query({ text: 'car' });
    expect(r.items.map((i) => i.id)).toEqual(['d']); // only "car dealership" has the word
    expect(r.code).toBeUndefined();
  });

  it('explicit lexical equals default', async () => {
    const a = await s.query({ text: 'car' });
    const b = await s.query({ text: 'car', mode: 'lexical' });
    expect(b.items.map((i) => i.id)).toEqual(a.items.map((i) => i.id));
  });
});

describe('semantic mode', () => {
  it('returns items in cosine order (synonym match lexical misses)', async () => {
    const r = await s.query({ text: 'car', mode: 'semantic', minScore: 0.1 });
    // a = automobile (cos 1.0) ranks above d = car dealership (cos ~0.994);
    // food/weather are cos 0 → dropped by the floor.
    expect(r.items.map((i) => i.id)).toEqual(['a', 'd']);
  });

  it('embeds the query text exactly once per query', async () => {
    embedder.calls = 0;
    embedder.embeddedTexts = 0;
    await s.query({ text: 'car', mode: 'semantic' });
    expect(embedder.calls).toBe(1);
    expect(embedder.embeddedTexts).toBe(1);
  });

  it('minScore floor drops low-cosine hits', async () => {
    const loose = await s.query({ text: 'car', mode: 'semantic', minScore: 0.9 });
    expect(loose.items.map((i) => i.id)).toEqual(['a', 'd']);
    const tight = await s.query({ text: 'car', mode: 'semantic', minScore: 0.999 });
    expect(tight.items.map((i) => i.id)).toEqual(['a']);
  });

  it('filters apply BEFORE ranking (filter-then-rank)', async () => {
    const r = await s.query({ text: 'car', mode: 'semantic', minScore: 0.1, filters: { kind: 'vehicle' } });
    expect(r.items.map((i) => i.id).sort()).toEqual(['a', 'd']);
    const none = await s.query({ text: 'car', mode: 'semantic', minScore: 0.1, filters: { kind: 'food' } });
    expect(none.total).toBe(0); // only 'b' survives the filter, cosine 0 → below floor
  });
});

describe('hybrid mode (RRF k=60)', () => {
  it('fuses lexical + cosine and surfaces the synonym lexical alone misses', async () => {
    const lex = await s.query({ text: 'car', mode: 'lexical' });
    const hyb = await s.query({ text: 'car', mode: 'hybrid', minScore: 0.1 });
    // lexical alone finds only 'd'; hybrid deterministically fuses to [d, a].
    expect(lex.items.map((i) => i.id)).toEqual(['d']);
    expect(hyb.items.map((i) => i.id)).toEqual(['d', 'a']);
    // 'a' (automobile) is surfaced by hybrid but absent from lexical.
    expect(hyb.items.map((i) => i.id)).toContain('a');
    expect(lex.items.map((i) => i.id)).not.toContain('a');
  });
});

describe('similar(id) — uses the STORED vector, no embed call', () => {
  it('ranks by cosine to the item vector and does not invoke the embedder', async () => {
    embedder.calls = 0;
    const r = await s.similar('a', { limit: 10 });
    expect(embedder.calls).toBe(0); // no embed — the vector is already indexed
    expect(r.items.map((i) => i.id)[0]).toBe('d'); // closest to automobile
    expect(r.items.map((i) => i.id)).not.toContain('a'); // excludes self
  });

  it('empty result for an unknown / vector-less id', async () => {
    const r = await s.similar('nope');
    expect(r).toEqual({ items: [], total: 0, facets: {} });
  });
});

describe('semanticReady', () => {
  it('false without an embedder', () => {
    const lexOnly = new PodSearch({ schema: SCHEMA });
    expect(lexOnly.semanticReady).toBe(false);
  });

  it('false when the index is cold, true once warm', async () => {
    const cold = new PodSearch({ schema: SCHEMA, embedder: fakeEmbedder() });
    expect(cold.semanticReady).toBe(false);
    await cold.indexBatch(ITEMS);
    expect(cold.semanticReady).toBe(true);
  });
});

describe('content-hash cache: unchanged chunk never re-embeds', () => {
  it('re-indexing the same items makes zero new embed calls', async () => {
    embedder.calls = 0;
    embedder.embeddedTexts = 0;
    await s.indexBatch(ITEMS);
    expect(embedder.embeddedTexts).toBe(0); // all cache hits
    expect(embedder.calls).toBe(0);
  });

  it('only new/changed items are embedded', async () => {
    embedder.embeddedTexts = 0;
    await s.indexBatch([{ id: 'e', kind: 'vehicle', title: 'automobile repair' }]); // same text as 'a' → cache hit
    expect(embedder.embeddedTexts).toBe(0);
    await s.indexBatch([{ id: 'f', kind: 'food', title: 'lunch recipe' }]); // same text as 'b' → cache hit
    expect(embedder.embeddedTexts).toBe(0);
  });
});

describe('graceful degradation', () => {
  it("mode:'semantic' without an embedder returns E_SEMANTIC_UNAVAILABLE", async () => {
    const lexOnly = new PodSearch({ schema: SCHEMA });
    await lexOnly.indexBatch(ITEMS);
    const r = await lexOnly.query({ text: 'car', mode: 'semantic' });
    expect(r.code).toBe('E_SEMANTIC_UNAVAILABLE');
    expect(r.items).toEqual([]);
  });

  it("mode:'hybrid' without an embedder silently equals lexical", async () => {
    const lexOnly = new PodSearch({ schema: SCHEMA });
    await lexOnly.indexBatch(ITEMS);
    const hyb = await lexOnly.query({ text: 'car', mode: 'hybrid' });
    const lex = await lexOnly.query({ text: 'car', mode: 'lexical' });
    expect(hyb.items.map((i) => i.id)).toEqual(lex.items.map((i) => i.id));
    expect(hyb.code).toBeUndefined();
  });

  it('embedder failure mid-query falls back to lexical + audit event', async () => {
    const audit = vi.fn();
    const failing = fakeEmbedder({ failOn: 'boom' });
    const fs = new PodSearch({ schema: SCHEMA, embedder: failing, audit });
    await fs.indexBatch(ITEMS); // indexing does not touch 'boom'
    const r = await fs.query({ text: 'boom', mode: 'semantic' });
    expect(r.code).toBeUndefined(); // fell back to lexical, not an error result
    expect(r.items).toEqual([]);    // 'boom' matches nothing lexically
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ code: 'E_EMBED_PROVIDER' }));
  });
});

describe('dimension-agnostic', () => {
  it('works with a 768-ish (here 4-dim) model, not baked to 384', async () => {
    const table = {
      alpha: [1, 0, 0, 0],
      beta:  [0, 1, 0, 0],
      near:  [0.95, 0.05, 0, 0],
    };
    const e4 = fakeEmbedder({ id: 'fake:d4', dim: 4, table });
    const s4 = new PodSearch({ schema: SCHEMA, embedder: e4 });
    await s4.indexBatch([
      { id: 'x', kind: 'k', title: 'alpha' },
      { id: 'y', kind: 'k', title: 'beta' },
    ]);
    const r = await s4.query({ text: 'near', mode: 'semantic', minScore: 0.1 });
    expect(r.items.map((i) => i.id)).toEqual(['x']); // nearest to alpha
  });

  it('declared-dim mismatch raises E_INDEX_MODEL_MISMATCH', async () => {
    // Embedder declares dim 3 but the table gives a length-4 vector.
    const bad = fakeEmbedder({ dim: 3, table: { alpha: [1, 0, 0, 0] } });
    const sb = new PodSearch({ schema: SCHEMA, embedder: bad });
    await expect(sb.indexBatch([{ id: 'x', kind: 'k', title: 'alpha' }]))
      .rejects.toMatchObject({ code: 'E_INDEX_MODEL_MISMATCH' });
  });
});

describe('index management clears the vector side', () => {
  it('deleteById removes vectors (similar no longer finds it)', async () => {
    await s.deleteById('d');
    const r = await s.similar('a', { limit: 10 });
    expect(r.items.map((i) => i.id)).not.toContain('d');
  });

  it('reindex wipes vectors and cache (index goes cold)', async () => {
    await s.reindex();
    expect(s.semanticReady).toBe(false);
    // After a wipe, the same text must be embedded again (cache cleared).
    embedder.embeddedTexts = 0;
    await s.indexBatch(ITEMS);
    expect(embedder.embeddedTexts).toBe(4);
  });
});

describe('chunking (chunkingV1)', () => {
  it('short text is a single chunk; empty text is no chunks', () => {
    expect(chunkText('a short note')).toEqual(['a short note']);
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   ')).toEqual([]);
  });

  it('long text splits into multiple deterministic chunks', () => {
    const para = 'x'.repeat(500);
    const long = [para, para, para, para].join('\n\n'); // 2000+ chars
    const c1 = chunkText(long);
    const c2 = chunkText(long);
    expect(c1.length).toBeGreaterThan(1);
    expect(c1).toEqual(c2); // deterministic
  });
});
