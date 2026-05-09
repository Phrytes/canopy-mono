/**
 * Compose payload — exercises the dueAt parser used by ComposeScreen
 * to convert `YYYY-MM-DD` text input into the addTask skill's epoch-ms
 * `dueAt` field.
 *
 * Phase 41.4.9 (2026-05-09).
 *
 * Importing ComposeScreen.jsx directly would pull in React + the
 * navigator; the helper is exported for this kind of unit coverage.
 */

import { describe, it, expect } from 'vitest';
import { _parseDueAt } from '../../src/screens/ComposeScreen.jsx';

describe('ComposeScreen._parseDueAt', () => {
  it('parses YYYY-MM-DD into epoch-ms (UTC)', () => {
    const ms = _parseDueAt('2026-12-31');
    expect(typeof ms).toBe('number');
    const d = new Date(ms);
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(11);
    expect(d.getUTCDate()).toBe(31);
  });
  it('returns null for empty / non-matching input', () => {
    expect(_parseDueAt('')).toBeNull();
    expect(_parseDueAt('   ')).toBeNull();
    expect(_parseDueAt('not-a-date')).toBeNull();
    expect(_parseDueAt('2026/12/31')).toBeNull();
    expect(_parseDueAt(null)).toBeNull();
    expect(_parseDueAt(undefined)).toBeNull();
  });
});
