/**
 * E5 (mobile) — recordCanExpand predicate.
 *
 * Decides whether a record/mini-page bubble shows the "⤢ Open in full"
 * affordance.  Mirrors the web semantic (expand wired only for
 * record/mini-page panels); kept RN-free so it is unit-testable here.
 */
import { describe, it, expect } from 'vitest';

import { recordCanExpand } from '../src/core/recordExpand.js';

describe('recordCanExpand', () => {
  it('is true for a record with fields', () => {
    expect(recordCanExpand({ kind: 'record', fields: [{ name: 'a', value: 1 }] })).toBe(true);
  });

  it('is true for a mini-page with fields', () => {
    expect(recordCanExpand({ kind: 'mini-page', fields: [{ name: 'a', value: 1 }] })).toBe(true);
  });

  it('is false for a record with no fields', () => {
    expect(recordCanExpand({ kind: 'record', fields: [] })).toBe(false);
    expect(recordCanExpand({ kind: 'record' })).toBe(false);
  });

  it('is false for other reply kinds', () => {
    expect(recordCanExpand({ kind: 'text', text: 'hi' })).toBe(false);
    expect(recordCanExpand({ kind: 'list', items: [{}] })).toBe(false);
    expect(recordCanExpand({ kind: 'brief', sections: [{}] })).toBe(false);
  });

  it('is false for nullish / non-object input', () => {
    expect(recordCanExpand(null)).toBe(false);
    expect(recordCanExpand(undefined)).toBe(false);
    expect(recordCanExpand('record')).toBe(false);
  });
});
