/**
 * availabilityGrid — pure-fn coverage for the grid helpers.
 *
 * Phase 41.9 (2026-05-09).
 */

import { describe, it, expect } from 'vitest';
import {
  STATE_CYCLE, nextState, buildGrid, isoWeekOf, DAYS, HALVES,
} from '../../src/lib/availabilityGrid.js';

describe('availabilityGrid — STATE_CYCLE', () => {
  it('cycles in the documented order', () => {
    expect(STATE_CYCLE).toEqual(['unknown', 'open', 'tight', 'unavailable']);
    expect(nextState('unknown')).toBe('open');
    expect(nextState('open')).toBe('tight');
    expect(nextState('tight')).toBe('unavailable');
    expect(nextState('unavailable')).toBe('unknown');
  });
  it('treats garbage as unknown', () => {
    expect(nextState('garbage')).toBe('unknown');
    expect(nextState(null)).toBe('unknown');
  });
});

describe('availabilityGrid — buildGrid', () => {
  it('returns one row per day with am/pm fields', () => {
    const grid = buildGrid({
      mon: { am: 'open' },
      wed: { am: 'tight', pm: 'unavailable' },
    });
    expect(grid).toHaveLength(7);
    expect(grid[0]).toEqual({ day: 'mon', am: 'open',    pm: 'unknown' });
    expect(grid[2]).toEqual({ day: 'wed', am: 'tight',   pm: 'unavailable' });
    expect(grid[6]).toEqual({ day: 'sun', am: 'unknown', pm: 'unknown' });
  });
  it('day order matches DAYS', () => {
    const grid = buildGrid({});
    expect(grid.map((r) => r.day)).toEqual(DAYS);
  });
});

describe('availabilityGrid — isoWeekOf', () => {
  it('returns YYYY-Www format', () => {
    const w = isoWeekOf(new Date(2026, 0, 1)); // 1 Jan 2026
    expect(/^\d{4}-W\d{2}$/.test(w)).toBe(true);
  });
});

describe('availabilityGrid — DAYS / HALVES', () => {
  it('exports stable orderings', () => {
    expect(DAYS).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    expect(HALVES).toEqual(['am', 'pm']);
  });
});
