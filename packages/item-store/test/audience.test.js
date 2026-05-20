/**
 * SP-5b V0a — `item.audience` field + `audienceFromItem` bridge.
 *
 * Forward-additive verification: items can carry the new richer
 * `audience` field; items without it fall back to the legacy
 * `visibility` short-hand; items without either default to
 * 'household' (substrate default).
 *
 * Resolution (audience → member set) is NOT tested here — that
 * lives in `@canopy/circles`'s `resolveAudience` test.  This file
 * tests the STORAGE + BRIDGE only.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { ItemStore, audienceFromItem } from '../src/index.js';
import { MemorySource } from '@canopy/core';

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
    expect(audienceFromItem({ audience: 'crew:gardeners' })).toBe('crew:gardeners');
  });

  it('audience wins when both audience + visibility are set', () => {
    const item = { audience: 'crew:abc', visibility: 'private' };
    expect(audienceFromItem(item)).toBe('crew:abc');
  });

  it('structured audience passes through verbatim', () => {
    const set = { kind: 'set', members: ['a', 'b'] };
    expect(audienceFromItem({ audience: set })).toEqual(set);

    const ref = { kind: 'circle-ref', id: 'crew-1' };
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
      [{ type: 'task', text: 'paint the fence', audience: 'crew:gardeners' }],
      { actor: ACTOR },
    );
    expect(item.audience).toBe('crew:gardeners');

    // Read-back via listOpen confirms storage.
    const open = await store.listOpen();
    expect(open[0].audience).toBe('crew:gardeners');
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
      { kind: 'circle-ref', id:      'crew-1'    },
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
      [{ type: 'task', text: 'x', visibility: 'private', audience: 'crew:abc' }],
      { actor: ACTOR },
    );
    expect(item.visibility).toBe('private');
    expect(item.audience).toBe('crew:abc');
    expect(audienceFromItem(item)).toBe('crew:abc');
  });
});
