/**
 * SP-5b V0a — `item.audience` field + `audienceFromItem` bridge.
 *
 * Forward-additive verification: items can carry the new richer
 * `audience` field; items without it fall back to the legacy
 * `visibility` short-hand; items without either default to
 * 'household' (substrate default).
 *
 * Resolution (audience → member set) is NOT tested here — that
 * lives in `@onderling/circles`'s `resolveAudience` test.  This file
 * tests the STORAGE + BRIDGE only.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { ItemStore, audienceFromItem, audienceMatches } from '../src/index.js';
import { MemorySource } from '@onderling/core';

const ACTOR = 'webid:alice';

function buildStore() {
  return new ItemStore({
    dataSource:    new MemorySource(),
    rootContainer: 'mem://sp-5b/',
  });
}

describe('SP-5b V0a — audienceFromItem bridge', () => {
  it('null item → household default', () => {
    expect(audienceFromItem(null)).toBe('household');
    expect(audienceFromItem(undefined)).toBe('household');
  });

  it('item with neither audience nor visibility → household default', () => {
    expect(audienceFromItem({ id: 'x', type: 'task' })).toBe('household');
  });

  it('item with only visibility → returns visibility', () => {
    expect(audienceFromItem({ visibility: 'private' })).toBe('private');
    expect(audienceFromItem({ visibility: 'household' })).toBe('household');
    expect(audienceFromItem({ visibility: 'role:admin' })).toBe('role:admin');
  });

  it('item with audience set → returns audience (overrides visibility)', () => {
    expect(audienceFromItem({ audience: 'public' })).toBe('public');
    expect(audienceFromItem({ audience: 'circle:gardeners' })).toBe('circle:gardeners');
  });

  it('audience wins when both audience + visibility are set', () => {
    const item = { audience: 'circle:abc', visibility: 'private' };
    expect(audienceFromItem(item)).toBe('circle:abc');
  });

  it('structured audience passes through verbatim', () => {
    const set = { kind: 'set', members: ['a', 'b'] };
    expect(audienceFromItem({ audience: set })).toEqual(set);

    const ref = { kind: 'circle-ref', id: 'circle-1' };
    expect(audienceFromItem({ audience: ref })).toEqual(ref);

    const union = { kind: 'union', of: ['household', { kind: 'circle-ref', id: 'c1' }] };
    expect(audienceFromItem({ audience: union })).toEqual(union);
  });
});

describe('SP-5b V0a — ItemStore stores audience verbatim', () => {
  let store;

  beforeEach(() => {
    store = buildStore();
  });

  it('addItems persists item.audience when supplied', async () => {
    const [item] = await store.addItems(
      [{ type: 'task', text: 'paint the fence', audience: 'circle:gardeners' }],
      { actor: ACTOR },
    );
    expect(item.audience).toBe('circle:gardeners');

    // Read-back via listOpen confirms storage.
    const open = await store.listOpen();
    expect(open[0].audience).toBe('circle:gardeners');
  });

  it('addItems omits audience field when not supplied (forward-additive)', async () => {
    const [item] = await store.addItems(
      [{ type: 'task', text: 'walk the dog' }],
      { actor: ACTOR },
    );
    expect(item).not.toHaveProperty('audience');
  });

  it('addItems stores structured audience (set / circle-ref / union)', async () => {
    const audiences = [
      { kind: 'set',        members: ['x', 'y'] },
      { kind: 'circle-ref', id:      'circle-1'    },
      { kind: 'union',      of:      ['household', { kind: 'circle-ref', id: 'c1' }] },
      { kind: 'public' },
    ];

    for (const a of audiences) {
      const [item] = await store.addItems(
        [{ type: 'task', text: 'x', audience: a }],
        { actor: ACTOR },
      );
      expect(item.audience).toEqual(a);
    }
  });

  it('legacy visibility-only items still validate + listOpen (no audience field on them)', async () => {
    const [item] = await store.addItems(
      [{ type: 'task', text: 'legacy item', visibility: 'private' }],
      { actor: ACTOR },
    );
    expect(item.visibility).toBe('private');
    expect(item).not.toHaveProperty('audience');

    // Bridge helper resolves the effective audience.
    expect(audienceFromItem(item)).toBe('private');
  });

  it('items with BOTH audience + visibility — both stored; audience wins via the bridge', async () => {
    const [item] = await store.addItems(
      [{ type: 'task', text: 'x', visibility: 'private', audience: 'circle:abc' }],
      { actor: ACTOR },
    );
    expect(item.visibility).toBe('private');
    expect(item.audience).toBe('circle:abc');
    expect(audienceFromItem(item)).toBe('circle:abc');
  });
});

describe('SP-5b — audienceMatches predicate', () => {
  it('exact match on plain string short-hands', () => {
    expect(audienceMatches('circle:A', 'circle:A')).toBe(true);
    expect(audienceMatches('circle:A', 'circle:B')).toBe(false);
    expect(audienceMatches('household', 'household')).toBe(true);
  });

  it('exact match on structured audiences (key-order independent)', () => {
    expect(audienceMatches(
      { kind: 'circle-ref', id: 'X' },
      { id: 'X', kind: 'circle-ref' },
    )).toBe(true);
    expect(audienceMatches(
      { kind: 'circle-ref', id: 'X' },
      { kind: 'circle-ref', id: 'Y' },
    )).toBe(false);
  });

  it('union membership — filter satisfies any constituent', () => {
    const item = { kind: 'union', of: ['household', { kind: 'circle-ref', id: 'c1' }] };
    expect(audienceMatches(item, 'household')).toBe(true);
    expect(audienceMatches(item, { kind: 'circle-ref', id: 'c1' })).toBe(true);
    // A constituent NOT in the union does not match.
    expect(audienceMatches(item, { kind: 'circle-ref', id: 'c2' })).toBe(false);
    // The whole union still matches itself (exact).
    expect(audienceMatches(item, item)).toBe(true);
  });

  it('union membership recurses into nested unions', () => {
    const nested = {
      kind: 'union',
      of: ['private', { kind: 'union', of: [{ kind: 'circle-ref', id: 'deep' }] }],
    };
    expect(audienceMatches(nested, { kind: 'circle-ref', id: 'deep' })).toBe(true);
  });

  it('set membership — a plain webid in members matches', () => {
    const item = { kind: 'set', members: ['webid:a', 'webid:b'] };
    expect(audienceMatches(item, 'webid:a')).toBe(true);
    expect(audienceMatches(item, 'webid:b')).toBe(true);
    expect(audienceMatches(item, 'webid:c')).toBe(false);
    // The whole set still matches itself (exact).
    expect(audienceMatches(item, item)).toBe(true);
  });

  it('circle-ref membership only via exact or inside a union', () => {
    // A bare circle-ref item matches only the identical ref…
    expect(audienceMatches({ kind: 'circle-ref', id: 'X' }, { kind: 'circle-ref', id: 'X' })).toBe(true);
    // …and the short-hand 'circle:X' is NOT normalised to it.
    expect(audienceMatches({ kind: 'circle-ref', id: 'X' }, 'circle:X')).toBe(false);
  });

  it('public matches only the public filter (not treated as covering everything)', () => {
    expect(audienceMatches({ kind: 'public' }, { kind: 'public' })).toBe(true);
    expect(audienceMatches({ kind: 'public' }, 'household')).toBe(false);
    expect(audienceMatches({ kind: 'public' }, { kind: 'circle-ref', id: 'X' })).toBe(false);
  });
});
