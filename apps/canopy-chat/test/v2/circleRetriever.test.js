import { describe, it, expect, vi } from 'vitest';
import {
  lexicalRank, makeLexicalRetriever,
  cosineSim, makeSemanticRetriever, makeCircleRetriever,
  makePodSearchRetriever, circleItemFromRow, CIRCLE_ITEM_SCHEMA,
} from '../../src/v2/circleRetriever.js';
import { mockEmbeddingsProvider } from '@canopy/llm-client';
import { createMemoryBackend } from '@canopy/pseudo-pod/memory';

// Normalized circle items (the shape loadCircleItems returns: {id,label,kind,...}).
const ITEMS = [
  { id: 't1', kind: 'task', label: 'Return the borrowed ladder to Karel' },
  { id: 't2', kind: 'task', label: 'Buy milk and bread' },
  { id: 'p1', kind: 'post', label: 'Anyone have a ladder I can borrow this weekend?' },
  { id: 'e1', kind: 'calendar-event', label: 'Street BBQ on Saturday' },
];

describe('lexicalRank', () => {
  it('ranks items by query-token overlap and tags them by kind', () => {
    const out = lexicalRank(ITEMS, 'is that ladder thing still open?');
    expect(out.length).toBeGreaterThan(0);
    // Both ladder items surface; the milk/bbq items don't.
    expect(out.map((c) => c.id)).toContain('t1');
    expect(out.map((c) => c.id)).toContain('p1');
    expect(out.map((c) => c.id)).not.toContain('t2');
    // Context entry shape interpret.contextLine reads: "<kind>: <label>".
    expect(out[0].text).toMatch(/^(task|post): /);
  });

  it('drops zero-overlap items entirely (better no context than wrong context)', () => {
    expect(lexicalRank(ITEMS, 'quantum entanglement')).toEqual([]);
  });

  it('ignores stop-words so glue words do not match everything', () => {
    // "the", "is", "on" are stop-words → no spurious matches on the BBQ/milk rows.
    expect(lexicalRank(ITEMS, 'the is on')).toEqual([]);
  });

  it('caps results at limit, score-desc with recent (input-order) tie-break', () => {
    const many = [
      { id: 'a', label: 'ladder ladder' },   // overlap 1 (distinct tokens), earlier
      { id: 'b', label: 'ladder borrow' },   // overlap 2
      { id: 'c', label: 'borrow ladder' },   // overlap 2, later than b
    ];
    const out = lexicalRank(many, 'borrow a ladder', { limit: 2 });
    expect(out.map((c) => c.id)).toEqual(['b', 'c']); // both score 2, b before c; 'a' (score 1) dropped
  });

  it('is tolerant of plain-string items and missing labels', () => {
    expect(lexicalRank(['just a ladder', { id: 'x' }], 'ladder')).toEqual([{ text: 'just a ladder' }]);
  });

  it('returns [] for an empty query or non-array items', () => {
    expect(lexicalRank(ITEMS, '   ')).toEqual([]);
    expect(lexicalRank(null, 'ladder')).toEqual([]);
  });
});

describe('makeLexicalRetriever', () => {
  it('loads items via the injected adapter and ranks them', async () => {
    const loadItems = vi.fn(async () => ITEMS);
    const retrieve = makeLexicalRetriever({ loadItems, limit: 3 });
    const ctx = { circleId: 'c1' };
    const out = await retrieve('ladder to borrow', ctx);
    expect(loadItems).toHaveBeenCalledWith(ctx);        // ctx threads through (circleId etc.)
    expect(out.map((c) => c.id)).toEqual(expect.arrayContaining(['t1', 'p1']));
  });

  it('is best-effort: a throwing/empty loader yields no context (LLM still runs)', async () => {
    const boom = makeLexicalRetriever({ loadItems: async () => { throw new Error('offline'); } });
    expect(await boom('ladder')).toEqual([]);
    const none = makeLexicalRetriever({ loadItems: null });
    expect(await none('ladder')).toEqual([]);
  });
});

describe('cosineSim', () => {
  it('1 for identical, 0 for orthogonal/degenerate', () => {
    expect(cosineSim([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSim([1, 0], [0, 0])).toBe(0);
    expect(cosineSim([1], [1, 2])).toBe(0);     // length mismatch
  });
});

describe('makeSemanticRetriever (tier-2)', () => {
  // deterministic, token-aware embedder (shared tokens → higher cosine)
  const { embed } = mockEmbeddingsProvider({ dims: 64 });
  const loadItems = async () => ITEMS;

  it('ranks by embedding cosine (semantic), tagging entries by kind', async () => {
    const retrieve = makeSemanticRetriever({ embed, loadItems, limit: 3 });
    const out = await retrieve('anyone still need that ladder?');
    expect(out.map((c) => c.id)).toEqual(expect.arrayContaining(['t1', 'p1'])); // ladder items rank
    expect(out.map((c) => c.id)).not.toContain('e1');                           // bbq doesn't
    expect(out[0].text).toMatch(/^(task|post): /);
  });

  it('falls back to LEXICAL when the embedder throws (enclave down → graceful)', async () => {
    const boom = async () => { throw new Error('enclave unreachable'); };
    const retrieve = makeSemanticRetriever({ embed: boom, loadItems });
    const out = await retrieve('borrow a ladder');
    expect(out.map((c) => c.id)).toContain('t1');   // still got results, via lexicalRank
  });

  it('falls back to lexical when no embedder is supplied', async () => {
    const retrieve = makeSemanticRetriever({ loadItems });   // no embed
    expect((await retrieve('ladder')).map((c) => c.id)).toContain('t1');
  });

  it('best-effort: a throwing loader → []', async () => {
    const retrieve = makeSemanticRetriever({ embed, loadItems: async () => { throw new Error('x'); } });
    expect(await retrieve('ladder')).toEqual([]);
  });
});

describe('makeCircleRetriever — auto-tiers', () => {
  const loadItems = async () => ITEMS;
  it('uses semantic when an embedder is configured', async () => {
    const { embed } = mockEmbeddingsProvider({ dims: 64 });
    const out = await makeCircleRetriever({ embed, loadItems })('ladder to borrow');
    expect(out.map((c) => c.id)).toEqual(expect.arrayContaining(['t1', 'p1']));
  });
  it('uses lexical when no embedder is configured', async () => {
    const out = await makeCircleRetriever({ loadItems })('quantum entanglement');
    expect(out).toEqual([]);   // lexical: zero overlap → nothing
  });
});

/* ─── PodSearch-backed hybrid retriever (L RAG-wiring) ───────────────────────
 *
 * Everything runs against a deterministic MOCK embedder + an in-memory pseudo-pod
 * store — no live model, no real pod. The mock maps keywords onto a 3-axis
 * concept space [vehicle, food, weather] so "car" lands on the vehicle axis and
 * matches "automobile" — a synonym a pure-lexical query never finds.
 */
function conceptEmbedder({ id = 'mock:concept', dim = 3 } = {}) {
  const vecFor = (t) => {
    const s = String(t).toLowerCase();
    if (/\b(car|automobile|dealership|vehicle)\b/.test(s)) return [1, 0, 0.05]; // vehicle
    if (/\b(soup|lunch|recipe|food)\b/.test(s))            return [0, 1, 0];    // food
    if (/\b(sunny|weather|forecast|rain)\b/.test(s))       return [0, 0, 1];    // weather
    return new Array(dim).fill(0);
  };
  const emb = {
    id, dim, calls: 0,
    async embed(texts) { emb.calls += 1; return texts.map((t) => Float32Array.from(vecFor(t))); },
  };
  return emb;
}

// Circle items in the {id,label,kind,…} shape loadCircleItems returns. Only the
// dealership item literally contains "car"; the automobile item is the synonym a
// lexical "car" query misses but a hybrid one recovers.
const RAG_ITEMS = [
  { id: 't1', kind: 'task', label: 'fix my automobile before the winter' },
  { id: 'p1', kind: 'post', label: 'car dealership visit on Friday' },
  { id: 't2', kind: 'task', label: 'buy soup for lunch' },
  { id: 'e1', kind: 'calendar-event', label: 'sunny weather forecast' },
];

describe('makePodSearchRetriever — persistent hybrid index', () => {
  const loadItems = async () => RAG_ITEMS;

  it('HYBRID surfaces a synonym match a pure-lexical query misses', async () => {
    const retrieve = makePodSearchRetriever({ embedder: conceptEmbedder(), loadItems, minScore: 0.1 });
    const out = await retrieve('car', { circleId: 'c1' });
    const ids = out.map((c) => c.id);
    expect(ids).toContain('p1');   // literal "car" (lexical would find this)
    expect(ids).toContain('t1');   // "automobile" — the semantic-only recall
    expect(ids).not.toContain('t2'); // food: dropped (cosine 0 < minScore)
    expect(ids).not.toContain('e1'); // weather: dropped
  });

  it('output shape is unchanged: {id,type,text} with "<kind>: <label>"', async () => {
    const retrieve = makePodSearchRetriever({ embedder: conceptEmbedder(), loadItems, minScore: 0.1 });
    const out = await retrieve('car', { circleId: 'c1' });
    const p1 = out.find((c) => c.id === 'p1');
    expect(p1).toEqual({ id: 'p1', type: 'post', text: 'post: car dealership visit on Friday' });
  });

  it('embeds ONCE — a repeat query does not re-embed unchanged items', async () => {
    const embedder = conceptEmbedder();
    const retrieve = makePodSearchRetriever({ embedder, loadItems, minScore: 0.1 });
    await retrieve('car', { circleId: 'c1' });
    const afterFirst = embedder.calls;
    await retrieve('soup', { circleId: 'c1' });   // same corpus, new query
    // The 4 item embeds are cached (content-hash); only the new query embed fires.
    expect(embedder.calls).toBe(afterFirst + 1);
  });

  it('NO embedder / llmTool:off ⇒ lexical-only hybrid, ZERO embed calls', async () => {
    const embedder = conceptEmbedder();
    // Simulate the policy gate: off ⇒ the resolver hands back null (no embedder).
    const retrieve = makePodSearchRetriever({ embedder: () => null, loadItems });
    const out = await retrieve('car', { circleId: 'c1' });
    expect(out.map((c) => c.id)).toEqual(['p1']);   // only the literal "car" note
    expect(embedder.calls).toBe(0);                 // never invoked
  });

  it('a policy resolver re-checks per turn (off → lexical, no embed)', async () => {
    const embedder = conceptEmbedder();
    let mode = 'off';
    const retrieve = makePodSearchRetriever({
      embedder: () => (mode === 'on' ? embedder : null), loadItems, minScore: 0.1,
    });
    // off: lexical-only, no embed.
    expect((await retrieve('car', { circleId: 'c1' })).map((c) => c.id)).toEqual(['p1']);
    expect(embedder.calls).toBe(0);
    // policy flips on: the circle's index rebuilds with the embedder → synonym recall.
    mode = 'on';
    expect((await retrieve('car', { circleId: 'c1' })).map((c) => c.id)).toContain('t1');
    expect(embedder.calls).toBeGreaterThan(0);
  });

  it('persists vectors ONLY under private/state/search-index/ (never sharing/)', async () => {
    const store = createMemoryBackend();
    const retrieve = makePodSearchRetriever({
      embedder: conceptEmbedder(), loadItems, vectorStore: store, scope: 'circle-rag', minScore: 0.1,
    });
    await retrieve('car', { circleId: 'c1' });
    const keys = await store.list('');
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(k.startsWith('private/state/search-index/circle-rag/c1/')).toBe(true);
      expect(k.includes('sharing/')).toBe(false);
    }
  });

  it('scopes per circle — one circle\'s items never bleed into another', async () => {
    const store = createMemoryBackend();
    const retrieve = makePodSearchRetriever({ embedder: conceptEmbedder(), loadItems, vectorStore: store, minScore: 0.1 });
    await retrieve('car', { circleId: 'c1' });
    await retrieve('car', { circleId: 'c2' });
    const keys = await store.list('');
    expect(keys.some((k) => k.includes('/circle-rag/c1/'))).toBe(true);
    expect(keys.some((k) => k.includes('/circle-rag/c2/'))).toBe(true);
  });

  it('best-effort: a throwing loader yields no context', async () => {
    const retrieve = makePodSearchRetriever({ embedder: conceptEmbedder(), loadItems: async () => { throw new Error('x'); } });
    expect(await retrieve('car', { circleId: 'c1' })).toEqual([]);
  });
});

describe('circleItemFromRow — schema projection', () => {
  it('projects a normalized circle item, preserving the original id in oid', () => {
    expect(circleItemFromRow({ id: 't1', kind: 'task', label: 'return the ladder' }))
      .toEqual({ id: 't1', text: 'return the ladder', oid: 't1', kind: 'task' });
  });
  it('synthesises an id for an id-less item but keeps oid null', () => {
    const row = circleItemFromRow({ label: 'no id here' }, 3);
    expect(row.oid).toBe(null);
    expect(row.id).toBe('t:no id here');
    expect(row.text).toBe('no id here');
  });
  it('the schema marks one primary + an embeddable text field', () => {
    expect(CIRCLE_ITEM_SCHEMA.fields.id.primary).toBe(true);
    expect(CIRCLE_ITEM_SCHEMA.fields.text.embed).toBe(true);
  });
});
