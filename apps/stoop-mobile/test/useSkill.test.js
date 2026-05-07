/**
 * useSkill — pure-helper coverage for `_toParts`.
 *
 * The hook itself involves React rendering + ServiceContext, so
 * its behavioural test lives in `ServiceContext.test.js` once the
 * render harness is wired (Phase 40.10.6 — deferred).
 */

import { describe, it, expect } from 'vitest';
import { toParts } from '../src/lib/skillParts.js';

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
