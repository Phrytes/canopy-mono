/**
 * SP-5b V0b — `ListFilter.audience` equality match.
 *
 * Verifies the new filter on listOpen / listClosed:
 *   - filter.audience absent → existing behaviour (no audience filter)
 *   - filter.audience matches → returns only matching items
 *   - structured audiences match by deep-equality
 *   - bridge: items with only `visibility` are matchable by the
 *     legacy short-hand (via audienceFromItem)
 *   - V0b limitation: 'crew:X' and {kind:'circle-ref', id:'X'} are
 *     NOT considered equivalent (documented; deferred to V0c)
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { ItemStore } from '../src/index.js';
import { MemorySource } from '@canopy/core';

const ACTOR = 'webid:alice';

function buildStore() {
  return new ItemStore({
    dataSource:    new MemorySource(),
    rootContainer: 'mem://sp-5b-v0b/',
  });
}

describe('SP-5b V0b — listOpen with ListFilter.audience', () => {
  let store;

  beforeEach(() => store = buildStore());

  it('absent filter.audience returns all items (existing behaviour)', async () => {
    await store.addItems(
      [
        { type: 'task', text: 'one',   audience: 'crew:A' },
        { type: 'task', text: 'two',   audience: 'crew:B' },
        { type: 'task', text: 'three' },
      ],
      { actor: ACTOR },
    );
    const open = await store.listOpen();
    expect(open).toHaveLength(3);
  });

  it('filter.audience matches items with the same string short-hand', async () => {
    await store.addItems(
      [
        { type: 'task', text: 'a-1', audience: 'crew:A' },
        { type: 'task', text: 'a-2', audience: 'crew:A' },
        { type: 'task', text: 'b-1', audience: 'crew:B' },
      ],
      { actor: ACTOR },
    );
    const onlyA = await store.listOpen({ audience: 'crew:A' });
    expect(onlyA.map((i) => i.text).sort()).toEqual(['a-1', 'a-2']);
  });

  it('filter.audience matches items with deep-equal structured audience', async () => {
    const ref = { kind: 'circle-ref', id: 'crew-X' };
    await store.addItems(
      [
        { type: 'task', text: 'matches',   audience: ref },
        { type: 'task', text: 'noaudience' },
        { type: 'task', text: 'different', audience: { kind: 'circle-ref', id: 'crew-Y' } },
      ],
      { actor: ACTOR },
    );
    const matches = await store.listOpen({ audience: ref });
    expect(matches.map((i) => i.text)).toEqual(['matches']);
  });

  it('filter.audience matches items with `union` of same shape (key order independent)', async () => {
    const a = { kind: 'union', of: ['household', { kind: 'circle-ref', id: 'c1' }] };
    await store.addItems(
      [{ type: 'task', text: 'matches', audience: a }],
      { actor: ACTOR },
    );
    // Same shape, different key order in literal.
    const filter = { of: ['household', { id: 'c1', kind: 'circle-ref' }], kind: 'union' };
    const found = await store.listOpen({ audience: filter });
    expect(found.map((i) => i.text)).toEqual(['matches']);
  });

  it('legacy-visibility items are matched by their visibility short-hand', async () => {
    // Item has only `visibility`; via the audienceFromItem bridge, its
    // effective audience IS 'private'.  So filter.audience='private'
    // matches it.
    await store.addItems(
      [
        { type: 'task', text: 'legacy-private', visibility: 'private' },
        { type: 'task', text: 'legacy-default' },  // visibility absent
      ],
      { actor: ACTOR },
    );

    const priv = await store.listOpen({ audience: 'private' });
    expect(priv.map((i) => i.text)).toEqual(['legacy-private']);

    // Items without visibility default to 'household' via the bridge.
    const hh = await store.listOpen({ audience: 'household' });
    expect(hh.map((i) => i.text)).toEqual(['legacy-default']);
  });

  it('audience filter composes with other filters (type)', async () => {
    await store.addItems(
      [
        { type: 'task',  text: 't-a', audience: 'crew:A' },
        { type: 'task',  text: 't-b', audience: 'crew:B' },
        { type: 'offer', text: 'o-a', audience: 'crew:A' },
      ],
      { actor: ACTOR },
    );

    const taskACrew = await store.listOpen({ type: 'task', audience: 'crew:A' });
    expect(taskACrew.map((i) => i.text)).toEqual(['t-a']);
  });

  it('V0b limitation — string short-hand and structured form NOT considered equivalent', async () => {
    // Strict equality means 'crew:X' (string) and {kind:'circle-ref',id:'X'}
    // (object) don't match each other.  Deferred to V0c.
    await store.addItems(
      [
        { type: 'task', text: 'short-hand', audience: 'crew:X' },
        { type: 'task', text: 'structured', audience: { kind: 'circle-ref', id: 'X' } },
      ],
      { actor: ACTOR },
    );

    const sh = await store.listOpen({ audience: 'crew:X' });
    expect(sh.map((i) => i.text)).toEqual(['short-hand']);

    const str = await store.listOpen({ audience: { kind: 'circle-ref', id: 'X' } });
    expect(str.map((i) => i.text)).toEqual(['structured']);
  });
});

describe('SP-5b V0b — listClosed with ListFilter.audience', () => {
  let store;
  beforeEach(() => store = buildStore());

  it('also filters closed items by audience', async () => {
    const [a, _b] = await store.addItems(
      [
        { type: 'task', text: 'closed-a', audience: 'crew:A' },
        { type: 'task', text: 'closed-b', audience: 'crew:B' },
      ],
      { actor: ACTOR },
    );
    await store.markComplete([{ id: a.id }], { actor: ACTOR });

    const closedA = await store.listClosed({ audience: 'crew:A' });
    expect(closedA.map((i) => i.text)).toEqual(['closed-a']);

    const closedB = await store.listClosed({ audience: 'crew:B' });
    expect(closedB).toHaveLength(0);  // not yet completed
  });
});
