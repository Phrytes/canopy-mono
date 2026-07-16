/**
 * P6.M5 — holiday extension shortcuts + auto-reply tests.
 */
import { describe, it, expect } from 'vitest';
import {
  extendHolidayDays, setHolidayUntil, buildHolidayAutoReply,
} from '../../src/v2/holidayShortcuts.js';

const FIXED_NOW = () => new Date('2026-06-01T12:00:00Z');

describe('extendHolidayDays', () => {
  it('adds N days to the existing until date', () => {
    const before = { holiday: { active: true, until: '2026-06-05' } };
    const after = extendHolidayDays(before, 7, FIXED_NOW);
    expect(after.holiday).toEqual({ active: true, until: '2026-06-12' });
  });

  it('activates + extends from today when holiday is off', () => {
    const before = { holiday: { active: false, until: null } };
    const after = extendHolidayDays(before, 14, FIXED_NOW);
    expect(after.holiday.active).toBe(true);
    expect(after.holiday.until).toBe('2026-06-15');
  });

  it('negative days clamps to today (no shrinking below today)', () => {
    const before = { holiday: { active: true, until: '2026-06-05' } };
    const after = extendHolidayDays(before, -100, FIXED_NOW);
    expect(after.holiday.until).toBe('2026-06-01');
  });

  it('zero days is a no-op-ish (returns a normalised copy with same until)', () => {
    const before = { holiday: { active: true, until: '2026-06-05' } };
    const after = extendHolidayDays(before, 0, FIXED_NOW);
    expect(after.holiday.until).toBe('2026-06-05');
  });

  it('non-finite days returns the input as-is (normalised)', () => {
    const before = { holiday: { active: true, until: '2026-06-05' } };
    expect(extendHolidayDays(before, NaN,       FIXED_NOW).holiday.until).toBe('2026-06-05');
    expect(extendHolidayDays(before, Infinity,  FIXED_NOW).holiday.until).toBe('2026-06-05');
    expect(extendHolidayDays(before, 'seven',   FIXED_NOW).holiday.until).toBe('2026-06-05');
  });

  it('preserves other availability fields untouched', () => {
    const before = {
      holiday: { active: true, until: '2026-06-05' },
      quietHours: { enabled: true, from: '22:00', to: '07:30', weekends: false },
    };
    const after = extendHolidayDays(before, 3, FIXED_NOW);
    expect(after.quietHours).toEqual(before.quietHours);
  });
});

describe('setHolidayUntil', () => {
  it('sets an absolute ISO date + flips active=true', () => {
    const a = setHolidayUntil({}, '2026-12-31');
    expect(a.holiday).toEqual({ active: true, until: '2026-12-31' });
  });

  it('null clears the end date but keeps the existing active flag', () => {
    const a = setHolidayUntil({ holiday: { active: true, until: '2026-06-05' } }, null);
    expect(a.holiday).toEqual({ active: true, until: null });
  });

  it('rejects malformed strings (returns unchanged)', () => {
    const before = { holiday: { active: true, until: '2026-06-05' } };
    expect(setHolidayUntil(before, '06/05').holiday.until).toBe('2026-06-05');
    expect(setHolidayUntil(before, '').holiday.until).toBe('2026-06-05');
    expect(setHolidayUntil(before, 42).holiday.until).toBe('2026-06-05');
  });
});

describe('buildHolidayAutoReply', () => {
  const t = (key, vars = {}) => {
    if (key === 'circle.holiday.autoReply')        return `${vars.name} is away until ${vars.until}.`;
    if (key === 'circle.holiday.autoReplyAnon')    return `This person is away until ${vars.until}.`;
    if (key === 'circle.holiday.autoReplyNoEnd')   return `${vars.name} is away.`;
    if (key === 'circle.holiday.autoReplyAnonNoEnd') return `This person is away.`;
    return key;
  };

  it('returns inactive when holiday is off', () => {
    const out = buildHolidayAutoReply({
      availability: { holiday: { active: false, until: null } }, name: 'Bob', t,
    });
    expect(out).toEqual({ active: false, text: null });
  });

  it('uses the named form when both name + until are present', () => {
    const out = buildHolidayAutoReply({
      availability: { holiday: { active: true, until: '2026-06-09' } }, name: 'Bob', t,
    });
    expect(out).toEqual({ active: true, text: 'Bob is away until 2026-06-09.' });
  });

  it('uses the anon form when name is absent', () => {
    const out = buildHolidayAutoReply({
      availability: { holiday: { active: true, until: '2026-06-09' } }, t,
    });
    expect(out.text).toBe('This person is away until 2026-06-09.');
  });

  it('uses the no-end variants when until is null', () => {
    const out1 = buildHolidayAutoReply({
      availability: { holiday: { active: true, until: null } }, name: 'Bob', t,
    });
    expect(out1.text).toBe('Bob is away.');
    const out2 = buildHolidayAutoReply({
      availability: { holiday: { active: true, until: null } }, t,
    });
    expect(out2.text).toBe('This person is away.');
  });

  it('falls back to key identity without a translator', () => {
    const out = buildHolidayAutoReply({
      availability: { holiday: { active: true, until: '2026-06-09' } }, name: 'Bob',
    });
    expect(out.text).toBe('circle.holiday.autoReply');
  });

  it('treats blank / non-string name as anon', () => {
    const out = buildHolidayAutoReply({
      availability: { holiday: { active: true, until: '2026-06-09' } }, name: '   ', t,
    });
    expect(out.text).toBe('This person is away until 2026-06-09.');
  });
});
