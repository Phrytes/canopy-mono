/**
 * greedy planner (pure unit tests).
 */

import { describe, it, expect } from 'vitest';

import { suggestSchedule } from '../src/planner/greedy.js';

const MS_PER_HOUR = 3_600_000;
const ALWAYS_OPEN = [
  { day: 'mon', start: '00:00', end: '23:59' },
  { day: 'tue', start: '00:00', end: '23:59' },
  { day: 'wed', start: '00:00', end: '23:59' },
  { day: 'thu', start: '00:00', end: '23:59' },
  { day: 'fri', start: '00:00', end: '23:59' },
  { day: 'sat', start: '00:00', end: '23:59' },
  { day: 'sun', start: '00:00', end: '23:59' },
];

const NINE_TO_FIVE = [
  { day: 'mon', start: '09:00', end: '17:00' },
  { day: 'tue', start: '09:00', end: '17:00' },
  { day: 'wed', start: '09:00', end: '17:00' },
  { day: 'thu', start: '09:00', end: '17:00' },
  { day: 'fri', start: '09:00', end: '17:00' },
];

describe('V2.4 — suggestSchedule (pure)', () => {
  it('no tasks → no suggestions', () => {
    const r = suggestSchedule({ tasks: [], busySpans: [], workingHours: ALWAYS_OPEN });
    expect(r).toEqual([]);
  });

  it('single task with plenty of free time → fits', () => {
    const now = Date.now();
    const r = suggestSchedule({
      tasks: [{ taskId: 'a', dueAt: now + 7 * 24 * MS_PER_HOUR, estimateMinutes: 60 }],
      busySpans: [],
      workingHours: ALWAYS_OPEN,
      now,
    });
    expect(r).toHaveLength(1);
    expect(r[0].fits).toBe(true);
    expect(r[0].reason).toBe('fits before deadline');
  });

  it('overdue task → reason `overdue`', () => {
    const now = Date.now();
    const r = suggestSchedule({
      tasks: [{ taskId: 'a', dueAt: now - MS_PER_HOUR, estimateMinutes: 60 }],
      busySpans: [],
      workingHours: ALWAYS_OPEN,
      now,
    });
    expect(r[0].reason).toBe('overdue');
    expect(r[0].fits).toBe(false);
  });

  it('last-chance slot when slack < estimate', () => {
    // Use a Tuesday at 10:00 to avoid weekend mode bugs.
    const now = new Date('2026-05-12T10:00:00').getTime();
    const r = suggestSchedule({
      // 90-min task due 90 min from now → slack 0 ≤ estimate → last-chance
      tasks: [{ taskId: 'a', dueAt: now + 90 * 60_000, estimateMinutes: 90 }],
      busySpans: [],
      workingHours: NINE_TO_FIVE,
      now,
    });
    expect(r[0].fits).toBe(true);
    expect(r[0].reason).toBe('last-chance');
  });

  it('rare-skill task scheduled before common-skill task with same deadline', () => {
    const now = Date.now();
    const r = suggestSchedule({
      tasks: [
        { taskId: 'common', dueAt: now + 7 * 24 * MS_PER_HOUR, estimateMinutes: 60, requiredSkills: ['general'] },
        { taskId: 'rare',   dueAt: now + 7 * 24 * MS_PER_HOUR, estimateMinutes: 60, requiredSkills: ['welding'] },
        { taskId: 'common2',dueAt: now + 7 * 24 * MS_PER_HOUR, estimateMinutes: 60, requiredSkills: ['general'] },
      ],
      busySpans: [],
      workingHours: ALWAYS_OPEN,
      now,
    });
    expect(r[0].taskId).toBe('rare');
  });

  it('working hours respected — no slot at midnight when 9-5 only', () => {
    // Now = Tuesday 03:00 → next slot must be ≥ 09:00 same day.
    const now = new Date('2026-05-12T03:00:00').getTime();
    const r = suggestSchedule({
      tasks: [{ taskId: 'a', dueAt: now + 7 * 24 * MS_PER_HOUR, estimateMinutes: 60 }],
      busySpans: [],
      workingHours: NINE_TO_FIVE,
      now,
    });
    expect(r[0].fits).toBe(true);
    const slotHour = new Date(r[0].slotStart).getHours();
    expect(slotHour).toBeGreaterThanOrEqual(9);
    expect(slotHour).toBeLessThan(17);
  });

  it('busy span splits a candidate slot — planner skips around it', () => {
    const now = new Date('2026-05-12T09:00:00').getTime();
    const r = suggestSchedule({
      tasks: [{ taskId: 'a', dueAt: now + 24 * MS_PER_HOUR, estimateMinutes: 60 }],
      busySpans: [{ start: now, end: now + 2 * MS_PER_HOUR }],
      workingHours: NINE_TO_FIVE,
      now,
    });
    expect(r[0].fits).toBe(true);
    expect(r[0].slotStart).toBeGreaterThanOrEqual(now + 2 * MS_PER_HOUR);
  });

  it('lookahead exhausted → returns reason `no slot` (not fabricated)', () => {
    const now = new Date('2026-05-12T09:00:00').getTime();
    const r = suggestSchedule({
      tasks: [{ taskId: 'a', dueAt: now + 6 * MS_PER_HOUR, estimateMinutes: 60 }],
      // Block the entire day.
      busySpans: [{ start: now, end: now + 24 * MS_PER_HOUR }],
      workingHours: NINE_TO_FIVE,
      now,
      lookaheadDays: 1,
    });
    expect(r[0].fits).toBe(false);
    expect(r[0].reason).toBe('no slot');
  });
});
