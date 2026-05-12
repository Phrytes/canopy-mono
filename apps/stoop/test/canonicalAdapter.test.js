/**
 * canonicalAdapter — Stoop legacy → canonical translator.
 *
 * Phase 52.7.2 adoption (2026-05-12).
 */

import { describe, it, expect } from 'vitest';
import {
  toCanonicalShape,
  validateStoopItem,
  STOOP_TYPE_MAPPING,
} from '../src/lib/canonicalAdapter.js';

const COMMON = {
  id:        'item-abc',
  addedAt:   1715419200000,
  addedBy:   'agent://anne',
  text:      'paint the fence',
};

describe('toCanonicalShape — Stoop type → canonical type+kind', () => {
  it('maps legacy "lend" → offer + kind=lend', () => {
    const out = toCanonicalShape({ ...COMMON, type: 'lend' });
    expect(out).toMatchObject({ type: 'offer', kind: 'lend' });
  });

  it('maps legacy "offer" → offer + kind=give (Aanbod default)', () => {
    const out = toCanonicalShape({ ...COMMON, type: 'offer' });
    expect(out).toMatchObject({ type: 'offer', kind: 'give' });
  });

  it('maps legacy "ask" → request + kind=borrow (Vragen default)', () => {
    const out = toCanonicalShape({ ...COMMON, type: 'ask' });
    expect(out).toMatchObject({ type: 'request', kind: 'borrow' });
  });

  it('maps legacy "request" → request + kind=other (under-specified)', () => {
    const out = toCanonicalShape({ ...COMMON, type: 'request' });
    expect(out).toMatchObject({ type: 'request', kind: 'other' });
  });

  it('returns null for bespoke Stoop types (skip validation)', () => {
    expect(toCanonicalShape({ ...COMMON, type: 'report' })).toBe(null);
    expect(toCanonicalShape({ ...COMMON, type: 'membership-code' })).toBe(null);
    expect(toCanonicalShape({ ...COMMON, type: 'group-rules' })).toBe(null);
  });

  it('honours an explicit kind already on the item (UI override)', () => {
    const out = toCanonicalShape({ ...COMMON, type: 'ask', kind: 'share' });
    expect(out).toMatchObject({ type: 'request', kind: 'share' });
  });

  it('returns null for bad input', () => {
    expect(toCanonicalShape(null)).toBe(null);
    expect(toCanonicalShape({})).toBe(null);
    expect(toCanonicalShape({ type: 42 })).toBe(null);
  });

  it('preserves the rest of the item (id, addedAt, addedBy, text, source)', () => {
    const out = toCanonicalShape({
      ...COMMON,
      type:    'lend',
      source:  { groupId: 'buurt-abc' },
      dueAt:   1234,
    });
    expect(out).toMatchObject({
      id:      'item-abc',
      addedAt: 1715419200000,
      addedBy: 'agent://anne',
      text:    'paint the fence',
      source:  { groupId: 'buurt-abc' },
      dueAt:   1234,
    });
  });
});

describe('validateStoopItem — warn-only validation pipeline', () => {
  it('returns {ok: true} for a well-shaped Stoop offer ("Aanbod")', () => {
    const v = validateStoopItem({
      ...COMMON,
      type: 'offer',
      // text → body adapter in @canopy/item-types fills body for us.
    });
    expect(v.ok).toBe(true);
  });

  it('returns {ok: true} for a well-shaped Stoop lend ("Te leen")', () => {
    const v = validateStoopItem({ ...COMMON, type: 'lend' });
    expect(v.ok).toBe(true);
  });

  it('returns {ok: true} for a well-shaped Stoop ask ("Vragen")', () => {
    const v = validateStoopItem({ ...COMMON, type: 'ask' });
    expect(v.ok).toBe(true);
  });

  it('returns {skipped: true} for bespoke types', () => {
    expect(validateStoopItem({ ...COMMON, type: 'report' })).toEqual({ skipped: true });
    expect(validateStoopItem({ ...COMMON, type: 'membership-code' })).toEqual({ skipped: true });
  });

  it('returns {skipped: true} for malformed input (never throws)', () => {
    expect(validateStoopItem(null)).toEqual({ skipped: true });
    expect(validateStoopItem({})).toEqual({ skipped: true });
    expect(validateStoopItem(undefined)).toEqual({ skipped: true });
  });

  it('returns {ok: false} when a translatable type fails the canonical schema', () => {
    // Missing `addedBy` → no `createdBy` after adapter → fails base required.
    const v = validateStoopItem({
      id:      'x',
      type:    'lend',
      text:    'ladder',
      addedAt: 1715419200000,
      // addedBy missing
    });
    expect(v.ok).toBe(false);
    expect(Array.isArray(v.errors)).toBe(true);
  });
});

describe('STOOP_TYPE_MAPPING — coverage', () => {
  it('covers the four legacy UI types', () => {
    expect(Object.keys(STOOP_TYPE_MAPPING).sort())
      .toEqual(['ask', 'lend', 'offer', 'request']);
  });

  it('every mapping targets a canonical type', () => {
    for (const v of Object.values(STOOP_TYPE_MAPPING)) {
      expect(['offer', 'request', 'claim']).toContain(v.type);
    }
  });

  it('every mapping has a sensible defaultKind from the canonical enum', () => {
    const OFFER_KINDS   = ['lend', 'share', 'give', 'sell', 'help', 'other'];
    const REQUEST_KINDS = ['borrow', 'share', 'receive', 'buy', 'help', 'other'];
    for (const v of Object.values(STOOP_TYPE_MAPPING)) {
      const allowed = v.type === 'offer' ? OFFER_KINDS : REQUEST_KINDS;
      expect(allowed).toContain(v.defaultKind);
    }
  });
});
