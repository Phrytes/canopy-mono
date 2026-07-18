/**
 * cross-circle query (`ListFilter.audiences` + `audienceMatchesAny`).
 *
 * The @onderling/circles V0 deferral: `ListFilter` could not carry an
 * audience SET. adds `filter.audiences: Audience[]` — an item
 * matches when its effective audience satisfies ANY audience in the
 * set, so one query spans MULTIPLE circles (union).
 *
 * Coverage:
 *   - union across multiple circles (items from several circles in one list)
 *   - single-audience back-compat: `[a]` ≡ `audience: a`
 *   - empty set matches nothing; no-match returns nothing
 *   - `audiences` composes with `type` and with the single `audience` clause
 *   - membership rules (union item / set item) carry through per element
 *   - legacy `visibility`-only items match via the audienceFromItem bridge
 *   - the pure `audienceMatchesAny` predicate directly
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { ItemStore, audienceMatchesAny, audienceMatches } from '../src/index.js';
import { MemorySource } from '@onderling/core';

const ACTOR = 'webid:alice';

const refA = { kind: 'circle-ref', id: 'circle-A' };
const refB = { kind: 'circle-ref', id: 'circle-B' };
const refC = { kind: 'circle-ref', id: 'circle-C' };

function buildStore() {
  return new ItemStore({
    dataSource:    new MemorySource(),
    rootContainer: 'mem://sp-8/',
  });
}

describe('SP-8 — audienceMatchesAny (pure predicate)', () => {
  it('matches when the item satisfies ANY audience in the set', () => {
    expect(audienceMatchesAny(refA, [refA, refB])).toBe(true);
    expect(audienceMatchesAny(refB, [refA, refB])).toBe(true);
    expect(audienceMatchesAny(refC, [refA, refB])).toBe(false);
  });

  it('empty set matches NOTHING', () => {
    expect(audienceMatchesAny(refA, [])).toBe(false);
    expect(audienceMatchesAny('household', [])).toBe(false);
  });

  it('single-element set is exactly the single-audience path (back-compat)', () => {
    // For any item/audience pair, audienceMatchesAny(i, [a]) === audienceMatches(i, a).
    const cases = [
      [refA, refA],
      [refA, refB],
      ['household', 'household'],
      [{ kind: 'union', of: ['household', refA] }, refA],
      [{ kind: 'set', members: ['webid:a', 'webid:b'] }, 'webid:b'],
    ];
    for (const [item, aud] of cases) {
      expect(audienceMatchesAny(item, [aud])).toBe(audienceMatches(item, aud));
    }
  });

  it('per-element membership rules carry through (union / set item)', () => {
    const unionItem = { kind: 'union', of: ['household', refA] };
    expect(audienceMatchesAny(unionItem, [refB, refA])).toBe(true);   // via refA constituent
    expect(audienceMatchesAny(unionItem, [refB, refC])).toBe(false);

    const setItem = { kind: 'set', members: ['webid:a', 'webid:b'] };
    expect(audienceMatchesAny(setItem, ['webid:z', 'webid:b'])).toBe(true);
    expect(audienceMatchesAny(setItem, ['webid:z'])).toBe(false);
  });

  it('throws when filterAudiences is not an array', () => {
    expect(() => audienceMatchesAny(refA, refA)).toThrow(/must be an array/);
  });
});

describe('SP-8 — ItemStore.listOpen with ListFilter.audiences (cross-circle)', () => {
  let store;
  beforeEach(() => store = buildStore());

  it('returns the UNION of items across multiple circles', async () => {
    await store.addItems(
      [
        { type: 'task', text: 'a-1', audience: refA },
        { type: 'task', text: 'b-1', audience: refB },
        { type: 'c-only', /* wrong type on purpose is fine */ text: 'c-1', audience: refC },
      ],
      { actor: ACTOR },
    );

    const spanning = await store.listOpen({ audiences: [refA, refB] });
    expect(spanning.map((i) => i.text).sort()).toEqual(['a-1', 'b-1']);

    // Widening the set pulls in the third circle too.
    const all3 = await store.listOpen({ audiences: [refA, refB, refC] });
    expect(all3.map((i) => i.text).sort()).toEqual(['a-1', 'b-1', 'c-1']);
  });

  it('a one-element audiences set equals the single-audience path (back-compat)', async () => {
    await store.addItems(
      [
        { type: 'task', text: 'a-1', audience: refA },
        { type: 'task', text: 'b-1', audience: refB },
      ],
      { actor: ACTOR },
    );
    const viaSet    = await store.listOpen({ audiences: [refA] });
    const viaSingle = await store.listOpen({ audience: refA });
    expect(viaSet.map((i) => i.text)).toEqual(['a-1']);
    expect(viaSet.map((i) => i.text)).toEqual(viaSingle.map((i) => i.text));
  });

  it('empty audiences set returns nothing; no-match returns nothing', async () => {
    await store.addItems(
      [{ type: 'task', text: 'a-1', audience: refA }],
      { actor: ACTOR },
    );
    expect(await store.listOpen({ audiences: [] })).toHaveLength(0);
    expect(await store.listOpen({ audiences: [refC] })).toHaveLength(0);
  });

  it('composes with the type filter', async () => {
    await store.addItems(
      [
        { type: 'task',  text: 't-a', audience: refA },
        { type: 'task',  text: 't-b', audience: refB },
        { type: 'offer', text: 'o-a', audience: refA },
      ],
      { actor: ACTOR },
    );
    const tasks = await store.listOpen({ type: 'task', audiences: [refA, refB] });
    expect(tasks.map((i) => i.text).sort()).toEqual(['t-a', 't-b']);
  });

  it('union-item and set-item members are pulled in per constituent', async () => {
    await store.addItems(
      [
        { type: 'task', text: 'in-union', audience: { kind: 'union', of: ['household', refA] } },
        { type: 'task', text: 'in-set',   audience: { kind: 'set', members: ['webid:bob'] } },
        { type: 'task', text: 'unrelated', audience: refC },
      ],
      { actor: ACTOR },
    );
    // refA matches the union item; 'webid:bob' matches the set item.
    const found = await store.listOpen({ audiences: [refA, 'webid:bob'] });
    expect(found.map((i) => i.text).sort()).toEqual(['in-set', 'in-union']);
  });

  it('legacy visibility-only items match via the audienceFromItem bridge', async () => {
    await store.addItems(
      [
        { type: 'task', text: 'legacy-private', visibility: 'private' },
        { type: 'task', text: 'circle-a',       audience: refA },
      ],
      { actor: ACTOR },
    );
    const found = await store.listOpen({ audiences: ['private', refA] });
    expect(found.map((i) => i.text).sort()).toEqual(['circle-a', 'legacy-private']);
  });

  it('single `audience` clause is unchanged when `audiences` is absent', async () => {
    await store.addItems(
      [
        { type: 'task', text: 'a-1', audience: refA },
        { type: 'task', text: 'b-1', audience: refB },
      ],
      { actor: ACTOR },
    );
    const onlyA = await store.listOpen({ audience: refA });
    expect(onlyA.map((i) => i.text)).toEqual(['a-1']);
  });

  it('also filters closed items by the audience set', async () => {
    const [a] = await store.addItems(
      [
        { type: 'task', text: 'closed-a', audience: refA },
        { type: 'task', text: 'open-b',   audience: refB },
      ],
      { actor: ACTOR },
    );
    await store.markComplete([{ id: a.id }], { actor: ACTOR });
    const closed = await store.listClosed({ audiences: [refA, refB] });
    expect(closed.map((i) => i.text)).toEqual(['closed-a']);
  });
});
