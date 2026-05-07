/**
 * useSkill — pure-helper coverage for `_toParts`.
 *
 * The hook itself involves React rendering + ServiceContext, so
 * its behavioural test lives in `ServiceContext.test.js` once the
 * render harness is wired (Phase 40.10.6 — deferred).
 */

import { describe, it, expect } from 'vitest';
import { toParts, unwrapParts } from '../src/lib/skillParts.js';

describe('skillParts.unwrapParts', () => {
  it('returns the first DataPart\'s data', () => {
    const parts = [
      { type: 'TextPart', text: 'hi' },
      { type: 'DataPart', data: { items: [1, 2, 3] } },
    ];
    expect(unwrapParts(parts)).toEqual({ items: [1, 2, 3] });
  });

  it('returns {} when no DataPart is present', () => {
    expect(unwrapParts([{ type: 'TextPart', text: 'hi' }])).toEqual({});
  });

  it('returns {} for empty / null input', () => {
    expect(unwrapParts([])).toEqual({});
    expect(unwrapParts(null)).toEqual({});
    expect(unwrapParts(undefined)).toEqual({});
  });

  it('passes through non-array inputs (forward-compat)', () => {
    const obj = { items: [] };
    expect(unwrapParts(obj)).toBe(obj);
  });
});

describe('skillParts.toParts', () => {
  it('wraps an object in a single DataPart', () => {
    expect(toParts({ kind: 'vraag' })).toEqual([
      { type: 'DataPart', data: { kind: 'vraag' } },
    ]);
  });

  it('passes arrays through verbatim', () => {
    const arr = [{ type: 'TextPart', text: 'hi' }, { type: 'DataPart', data: {} }];
    expect(toParts(arr)).toBe(arr);
  });

  it('returns [] for null / undefined', () => {
    expect(toParts(null)).toEqual([]);
    expect(toParts(undefined)).toEqual([]);
  });
});
