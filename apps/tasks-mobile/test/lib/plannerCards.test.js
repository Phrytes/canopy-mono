/**
 * PlannerCards — unit coverage for the slot-formatter helper.
 *
 * Phase 41.5.6 (2026-05-09).
 *
 * The component itself renders JSX + bindings to skill hooks; the
 * end-to-end behaviour is validated on real device. This file
 * covers the pure-fn helper that formats a {start, end} pair into
 * the user-facing label.
 */

import { describe, it, expect } from 'vitest';
import { _formatSlot } from '../../src/components/PlannerCards.jsx';

const t = (key, fallback) => {
  if (key === 'mobile.planner.slot_label') return '{date} {start}–{end}';
  return fallback ?? key;
};

describe('_formatSlot', () => {
  it('formats the date + start–end window', () => {
    const start = new Date(2026, 11, 31, 9, 30).getTime();
    const end   = new Date(2026, 11, 31, 11, 0).getTime();
    expect(_formatSlot(start, end, t)).toBe('31/12 09:30–11:00');
  });
  it('returns — for missing inputs', () => {
    expect(_formatSlot(null, null, t)).toBe('—');
    expect(_formatSlot(123, 'not-a-number', t)).toBe('—');
  });
});
