/**
 * feedFilter — pure-helper coverage for FeedScreen's filter logic.
 */

import { describe, it, expect } from 'vitest';
import { matchesFilter, filterFeed } from '../src/lib/feedFilter.js';
import { cellFor }                   from '../src/lib/geo.js';

// Phase 52.7.2 canonical-types cut-over (2026-05-14): board items now
// carry a canonical `type` ('request'/'offer'/…); the human-facing
// vraag/aanbod split is the narrowing `kind`. Fixtures keep both so the
// type-whitelist gate and the `kinds` filter are exercised together.
const ITEMS = [
  { id: '1', type: 'request', kind: 'vraag',  skills: ['plumbing'],  cell: cellFor({ lat: 53.20, lng: 6.60 }) },
  { id: '2', type: 'offer',   kind: 'aanbod', skills: ['gardening'], cell: cellFor({ lat: 53.21, lng: 6.61 }) },
  { id: '3', type: 'request', kind: 'vraag',  skills: ['plumbing', 'electric'], cell: cellFor({ lat: 53.50, lng: 7.00 }) },
];

describe('matchesFilter', () => {
  it('no filter accepts everything', () => {
    for (const it of ITEMS) expect(matchesFilter(it, {})).toBe(true);
  });

  // Bring-up regression 2026-05-08: chat-messages, group-rules,
  // membership-codes, etc. were leaking into the Feed because
  // listOpen() returns every uncompleted item regardless of type.
  it('drops non-Feed types (chat-message, group-rules, membership-code, …)', () => {
    expect(matchesFilter({ id: 'c1', type: 'chat-message',         text: 'hi' }, {})).toBe(false);
    expect(matchesFilter({ id: 'g1', type: 'group-rules',          text: 'rules' }, {})).toBe(false);
    expect(matchesFilter({ id: 'm1', type: 'membership-code',      text: 'code' }, {})).toBe(false);
    expect(matchesFilter({ id: 'r1', type: 'membership-redemption',text: 'red' }, {})).toBe(false);
    expect(matchesFilter({ id: 'a1', type: 'rules-accept',         text: 'ack' }, {})).toBe(false);
  });

  // Phase 52.7.2 clean break: the board whitelist is the canonical
  // @canopy/item-types set. Pre-migration types (ask/lend/vraag/aanbod)
  // are deliberately no longer board-visible — see feedFilter.js header.
  it('keeps the canonical post types — offer / request / claim / announcement / report', () => {
    for (const t of ['offer', 'request', 'claim', 'announcement', 'report']) {
      expect(matchesFilter({ id: 'x', type: t, text: 'p' }, {})).toBe(true);
    }
  });

  it('kinds filter', () => {
    expect(matchesFilter(ITEMS[0], { kinds: new Set(['vraag']) })).toBe(true);
    expect(matchesFilter(ITEMS[1], { kinds: new Set(['vraag']) })).toBe(false);
  });

  it('skills filter (any match)', () => {
    expect(matchesFilter(ITEMS[0], { skills: new Set(['plumbing']) })).toBe(true);
    expect(matchesFilter(ITEMS[1], { skills: new Set(['plumbing']) })).toBe(false);
    expect(matchesFilter(ITEMS[2], { skills: new Set(['electric']) })).toBe(true);
  });

  it('distance filter requires viewerCell', () => {
    expect(matchesFilter(ITEMS[0], { maxDistKm: 5 })).toBe(false);
  });

  it('distance filter accepts close items', () => {
    const viewerCell = cellFor({ lat: 53.20, lng: 6.60 });
    expect(matchesFilter(ITEMS[0], { maxDistKm: 5, viewerCell })).toBe(true);
    expect(matchesFilter(ITEMS[2], { maxDistKm: 5, viewerCell })).toBe(false);
  });

  it('null item → false', () => {
    expect(matchesFilter(null, {})).toBe(false);
  });
});

describe('filterFeed', () => {
  it('filters and preserves order', () => {
    const r = filterFeed(ITEMS, { kinds: new Set(['vraag']) });
    expect(r.map((i) => i.id)).toEqual(['1', '3']);
  });

  it('returns [] for non-array input', () => {
    expect(filterFeed(null, {})).toEqual([]);
  });
});
