/**
 * saved cross-circle views.
 *
 * A saved cross-circle view = a `view` item whose `audience` is a SET
 * of audiences (typically circle-refs, stored as a `union`).  Coverage:
 *   - savedViewAudiences: union → constituents; single → one-element;
 *     missing → []; `circle:` short-hand normalised to circle-ref;
 *     `crew:` is gone (only `circle:` is a ref short-hand).
 *   - makeSavedView: builds a `view` partial; single audience collapses;
 *     multi becomes a `union`; filter passthrough; input validation.
 *   - resolveSavedView: unions items across multiple circles; empty set
 *     short-circuits without touching the store; builds the right
 *     ListFilter (type + audiences + merged view.filter); closed path.
 *
 * The `itemStore` here is a minimal in-package fake — @onderling/circles
 * deliberately does NOT depend on @onderling/item-store (the consumer
 * wires whichever store they use).  The fake applies the `audiences`
 * filter with a tiny deep-equal matcher, enough to demonstrate the
 * union across circles.  The real `audienceMatchesAny` semantics are
 * covered in @onderling/item-store's crossCircleQuery.test.js.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  savedViewAudiences,
  makeSavedView,
  resolveSavedView,
} from '../src/savedView.js';

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Fake store: applies `type` + `audiences` (deep-equal) filtering. */
function makeFakeItemStore(seed = []) {
  const items = seed.map((it, i) => ({ id: `id-${i}`, ...it }));
  const calls = [];
  const apply = (filter, pool) => {
    calls.push(filter);
    let out = pool;
    if (filter?.type) out = out.filter((it) => it.type === filter.type);
    if (filter?.audiences) {
      out = out.filter((it) => filter.audiences.some((fa) => eq(it.audience, fa)));
    }
    return out;
  };
  return {
    calls,
    listOpen:   async (filter) => apply(filter, items.filter((it) => !it.closed)),
    listClosed: async (filter) => apply(filter, items.filter((it) => it.closed)),
  };
}

const refA = { kind: 'circle-ref', id: 'A' };
const refB = { kind: 'circle-ref', id: 'B' };
const refC = { kind: 'circle-ref', id: 'C' };

describe('savedViewAudiences', () => {
  it('a union view → its constituents (normalised)', () => {
    const view = { audience: { kind: 'union', of: [refA, refB] } };
    expect(savedViewAudiences(view)).toEqual([refA, refB]);
  });

  it('a single-audience view → one-element set', () => {
    expect(savedViewAudiences({ audience: refA })).toEqual([refA]);
  });

  it('missing / null audience → empty set', () => {
    expect(savedViewAudiences({})).toEqual([]);
    expect(savedViewAudiences({ audience: null })).toEqual([]);
    expect(savedViewAudiences(undefined)).toEqual([]);
  });

  it("normalises the `circle:` short-hand to a circle-ref", () => {
    expect(savedViewAudiences({ audience: 'circle:A' })).toEqual([refA]);
    expect(savedViewAudiences({ audience: { kind: 'union', of: ['circle:A', 'circle:B'] } }))
      .toEqual([refA, refB]);
  });

  it("rejects the gone `crew:` short-hand (only `circle:` is a ref)", () => {
    expect(() => savedViewAudiences({ audience: 'crew:A' }))
      .toThrow(/unknown audience short-hand/);
  });
});

describe('makeSavedView', () => {
  it('builds a `view` item partial (multi-audience → union)', () => {
    const v = makeSavedView({ title: 'Both circles', itemType: 'task', audiences: [refA, refB] });
    expect(v.type).toBe('view');
    expect(v.title).toBe('Both circles');
    expect(v.text).toBe('Both circles');            // substrate-compat
    expect(v.itemType).toBe('task');
    expect(v.audience).toEqual({ kind: 'union', of: [refA, refB] });
  });

  it('a single audience collapses to that audience (no union wrapper)', () => {
    const v = makeSavedView({ title: 'Just A', itemType: 'task', audiences: ['circle:A'] });
    expect(v.audience).toEqual(refA);
  });

  it('passes an extra filter through', () => {
    const v = makeSavedView({
      title: 'Open tasks', itemType: 'task', audiences: [refA], filter: { assignee: null },
    });
    expect(v.filter).toEqual({ assignee: null });
  });

  it('round-trips: makeSavedView → savedViewAudiences recovers the set', () => {
    const v = makeSavedView({ title: 'V', itemType: 'task', audiences: ['circle:A', 'circle:B'] });
    expect(savedViewAudiences(v)).toEqual([refA, refB]);
  });

  it('validates title and itemType', () => {
    expect(() => makeSavedView({ title: '', itemType: 'task' })).toThrow(/title/);
    expect(() => makeSavedView({ title: 'V', itemType: '' })).toThrow(/itemType/);
  });
});

describe('resolveSavedView', () => {
  let store;
  beforeEach(() => {
    store = makeFakeItemStore([
      { type: 'task', text: 'a-1', audience: refA },
      { type: 'task', text: 'a-2', audience: refA },
      { type: 'task', text: 'b-1', audience: refB },
      { type: 'task', text: 'c-1', audience: refC },
      { type: 'offer', text: 'o-a', audience: refA },
      { type: 'task', text: 'a-closed', audience: refA, closed: true },
    ]);
  });

  it('resolves to the UNION of items across the view’s circles', async () => {
    const view = makeSavedView({ title: 'A+B tasks', itemType: 'task', audiences: [refA, refB] });
    const items = await resolveSavedView(view, store);
    expect(items.map((i) => i.text).sort()).toEqual(['a-1', 'a-2', 'b-1']);
    // c-1 (circle C) and o-a (wrong type) excluded.
  });

  it('builds the ListFilter: type from itemType, audiences from the set, view.filter merged', async () => {
    const view = makeSavedView({
      title: 'A tasks', itemType: 'task', audiences: [refA], filter: { assignee: null },
    });
    await resolveSavedView(view, store);
    expect(store.calls[0]).toEqual({ assignee: null, audiences: [refA], type: 'task' });
  });

  it('an empty audience set resolves to [] WITHOUT touching the store', async () => {
    const items = await resolveSavedView({ itemType: 'task' /* no audience */ }, store);
    expect(items).toEqual([]);
    expect(store.calls).toHaveLength(0);
  });

  it('resolves closed items with { closed: true }', async () => {
    const view = makeSavedView({ title: 'A closed', itemType: 'task', audiences: [refA] });
    const items = await resolveSavedView(view, store, { closed: true });
    expect(items.map((i) => i.text)).toEqual(['a-closed']);
  });

  it('normalisation unifies `circle:` short-hand views with structured items', async () => {
    // Items are stored structured (refA/refB); the view uses `circle:`
    // short-hands.  Because @onderling/circles normalises, they unify.
    const view = makeSavedView({ title: 'shorthand', itemType: 'task', audiences: ['circle:A', 'circle:B'] });
    const items = await resolveSavedView(view, store);
    expect(items.map((i) => i.text).sort()).toEqual(['a-1', 'a-2', 'b-1']);
  });

  it('throws when the itemStore lacks listOpen', async () => {
    await expect(resolveSavedView({ audience: refA }, {})).rejects.toThrow(/listOpen/);
  });
});
