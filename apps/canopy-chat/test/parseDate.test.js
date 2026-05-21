/**
 * canopy-chat — date parser tests.  v0.3 sub-slice 3.4.
 */
import { describe, it, expect } from 'vitest';

import { parseRelativeDate } from '../src/forms/parseDate.js';
import { validateAndCoerce } from '../src/forms/buildFormSpec.js';

// Sun 2026-05-31 — chosen as a known weekday for deterministic tests.
const FIXED_NOW = () => new Date('2026-05-31T12:00:00Z');

describe('parseRelativeDate', () => {
  it('passes ISO-8601 date through', () => {
    expect(parseRelativeDate('2026-05-30')).toBe('2026-05-30');
  });

  it('accepts ISO datetime, returns date portion', () => {
    expect(parseRelativeDate('2026-05-30T14:00:00Z')).toBe('2026-05-30');
  });

  it("'today' returns today's UTC date", () => {
    expect(parseRelativeDate('today', { now: FIXED_NOW })).toBe('2026-05-31');
  });

  it("'tomorrow' / 'morgen' → next UTC day", () => {
    expect(parseRelativeDate('tomorrow', { now: FIXED_NOW })).toBe('2026-06-01');
    expect(parseRelativeDate('morgen',   { now: FIXED_NOW })).toBe('2026-06-01');
  });

  it("weekday names (en) → next occurrence", () => {
    // FIXED_NOW = Sunday 2026-05-31
    expect(parseRelativeDate('sunday',    { now: FIXED_NOW })).toBe('2026-05-31'); // today
    expect(parseRelativeDate('monday',    { now: FIXED_NOW })).toBe('2026-06-01');
    expect(parseRelativeDate('friday',    { now: FIXED_NOW })).toBe('2026-06-05');
    expect(parseRelativeDate('saturday',  { now: FIXED_NOW })).toBe('2026-06-06');
  });

  it("weekday names (nl)", () => {
    expect(parseRelativeDate('zondag',  { now: FIXED_NOW })).toBe('2026-05-31');
    expect(parseRelativeDate('vrijdag', { now: FIXED_NOW })).toBe('2026-06-05');
    expect(parseRelativeDate('maandag', { now: FIXED_NOW })).toBe('2026-06-01');
  });

  it('case-insensitive + whitespace-tolerant', () => {
    expect(parseRelativeDate('  FRIDAY  ', { now: FIXED_NOW })).toBe('2026-06-05');
    expect(parseRelativeDate('Today',      { now: FIXED_NOW })).toBe('2026-05-31');
  });

  it('returns null for unparseable inputs', () => {
    expect(parseRelativeDate('next month')).toBeNull();
    expect(parseRelativeDate('whenever')).toBeNull();
    expect(parseRelativeDate('not a date')).toBeNull();
    expect(parseRelativeDate('')).toBeNull();
    expect(parseRelativeDate(null)).toBeNull();
    expect(parseRelativeDate(undefined)).toBeNull();
    expect(parseRelativeDate(12345)).toBeNull();
  });

  it("invalid ISO-shape strings → null", () => {
    // Matches the regex but is not a real date.
    expect(parseRelativeDate('2026-13-99')).toBeNull();
  });
});

describe('validateAndCoerce — date kind (v0.3.2)', () => {
  const spec = (kind) => ({
    opId: 'x', appOrigin: 'a', threadId: null,
    fields: [{ name: 'when', kind, required: true }],
    missing: ['when'], strategy: 'sequential',
  });

  it("ISO date passes + coerces to ISO date string", () => {
    const r = validateAndCoerce(spec('date'), { when: '2026-05-30' });
    expect(r).toEqual({ ok: true, args: { when: '2026-05-30' } });
  });

  it("'tomorrow' parses (uses real Date.now); becomes some ISO", () => {
    const r = validateAndCoerce(spec('date'), { when: 'tomorrow' });
    expect(r.ok).toBe(true);
    expect(r.args.when).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("unparseable date → validation error", () => {
    const r = validateAndCoerce(spec('date'), { when: 'whenever' });
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toMatch(/not a valid date/);
  });
});

describe('validateAndCoerce — webid kind (v0.3.2)', () => {
  const spec = () => ({
    opId: 'x', appOrigin: 'a', threadId: null,
    fields: [{ name: 'who', kind: 'webid', required: true }],
    missing: ['who'], strategy: 'sequential',
  });

  it.each([
    'https://example.org/profile#me',
    'webid:anne',
    'did:key:zABC',
    'anne@example.org',
  ])('accepts %s', (v) => {
    expect(validateAndCoerce(spec(), { who: v }).ok).toBe(true);
  });

  it('rejects plain strings', () => {
    const r = validateAndCoerce(spec(), { who: 'just-a-name' });
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toMatch(/not a valid webid/);
  });
});
