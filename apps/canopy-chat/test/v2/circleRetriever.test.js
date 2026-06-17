import { describe, it, expect, vi } from 'vitest';
import { lexicalRank, makeLexicalRetriever } from '../../src/v2/circleRetriever.js';

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
