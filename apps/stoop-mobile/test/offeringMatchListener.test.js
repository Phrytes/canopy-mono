/**
 * offeringMatchListener — pure-helper coverage for OfferingMatchInboxScreen.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyOrigin, appendSuggestion, dedupSuggestions,
} from '../src/lib/offeringMatchListener.js';

describe('classifyOrigin', () => {
  it('group when fromExtraAudience is falsy', () => {
    expect(classifyOrigin({ fromExtraAudience: false })).toBe('group');
    expect(classifyOrigin({})).toBe('group');
  });
  it('contact when fromExtraAudience is true with no originTag', () => {
    expect(classifyOrigin({ fromExtraAudience: true })).toBe('contact');
  });
  it('hop when payload.originTag === "hop"', () => {
    expect(classifyOrigin({ fromExtraAudience: true, payload: { originTag: 'hop' } }))
      .toBe('hop');
  });
  it('unknown for null', () => {
    expect(classifyOrigin(null)).toBe('unknown');
  });
});

describe('appendSuggestion', () => {
  it('prepends a fresh entry', () => {
    const r = appendSuggestion([{ x: 1 }], { x: 2 });
    expect(r[0]).toEqual({ x: 2 });
    expect(r[1]).toEqual({ x: 1 });
  });
  it('drops oldest past max', () => {
    const list = [{ x: 1 }, { x: 2 }];
    const r = appendSuggestion(list, { x: 3 }, 2);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ x: 3 });
    expect(r[1]).toEqual({ x: 1 });
  });
  it('no-ops on null entry', () => {
    expect(appendSuggestion([{ x: 1 }], null)).toEqual([{ x: 1 }]);
  });
  it('handles null list', () => {
    expect(appendSuggestion(null, { x: 1 })).toEqual([{ x: 1 }]);
  });
});

describe('dedupSuggestions', () => {
  it('keeps the first occurrence of each requestId', () => {
    const r = dedupSuggestions([
      { request: { requestId: 'a' }, ts: 1 },
      { request: { requestId: 'b' }, ts: 2 },
      { request: { requestId: 'a' }, ts: 3 },
    ]);
    expect(r).toHaveLength(2);
    expect(r[0].ts).toBe(1);
  });
  it('keeps entries without a requestId', () => {
    const r = dedupSuggestions([
      { request: {} },
      { request: {} },
    ]);
    expect(r).toHaveLength(2);
  });
  it('returns [] for non-array', () => {
    expect(dedupSuggestions(null)).toEqual([]);
  });
});
