/**
 * Crews dashboard — busyTotal helper.
 *
 * Phase 41.7.3 (2026-05-09).
 */

import { describe, it, expect } from 'vitest';
import { busyTotal } from '../../src/screens/CrewsDashboardScreen.jsx';

describe('busyTotal', () => {
  it('sums the four counters', () => {
    expect(busyTotal({ open: 3, overdue: 1, awaitingApproval: 2, mine: 4 })).toBe(10);
  });
  it('treats missing fields as zero', () => {
    expect(busyTotal({ open: 1 })).toBe(1);
    expect(busyTotal({})).toBe(0);
  });
  it('returns 0 for non-object input', () => {
    expect(busyTotal(null)).toBe(0);
    expect(busyTotal(undefined)).toBe(0);
    expect(busyTotal('not-an-object')).toBe(0);
  });
});
