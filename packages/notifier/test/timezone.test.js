import { describe, it, expect } from 'vitest';
import { nextDailyFireInTz } from '../src/timezone.js';

describe('nextDailyFireInTz', () => {
  it('schedules today\'s 20:00 in Europe/Amsterdam when called at 14:00 local', () => {
    // 2026-05-02 12:00 UTC = 14:00 Europe/Amsterdam (CEST, UTC+2)
    const nowMs = Date.UTC(2026, 4, 2, 12, 0);   // 12:00 UTC
    const next  = nextDailyFireInTz(nowMs, 'Europe/Amsterdam', '20:00');
    // Expected: 2026-05-02 20:00 Amsterdam = 18:00 UTC
    const expected = Date.UTC(2026, 4, 2, 18, 0);
    expect(next).toBe(expected);
  });

  it('schedules tomorrow\'s 08:00 when called after that time today', () => {
    // 2026-05-02 09:00 UTC = 11:00 Amsterdam
    const nowMs = Date.UTC(2026, 4, 2, 9, 0);
    const next  = nextDailyFireInTz(nowMs, 'Europe/Amsterdam', '08:00');
    // Tomorrow 08:00 Amsterdam = 06:00 UTC
    const expected = Date.UTC(2026, 4, 3, 6, 0);
    expect(next).toBe(expected);
  });

  it('handles UTC tz directly', () => {
    const nowMs = Date.UTC(2026, 4, 2, 9, 0);
    const next  = nextDailyFireInTz(nowMs, 'UTC', '20:00');
    expect(next).toBe(Date.UTC(2026, 4, 2, 20, 0));
  });

  it('handles New York tz', () => {
    // 2026-05-02 16:00 UTC = 12:00 EDT (UTC-4)
    const nowMs = Date.UTC(2026, 4, 2, 16, 0);
    const next  = nextDailyFireInTz(nowMs, 'America/New_York', '09:00');
    // Tomorrow 09:00 NY = 13:00 UTC
    const expected = Date.UTC(2026, 4, 3, 13, 0);
    expect(next).toBe(expected);
  });

  it('rejects malformed timeLocal', () => {
    const now = Date.UTC(2026, 4, 2, 0, 0);
    expect(() => nextDailyFireInTz(now, 'UTC', 'invalid')).toThrow(/bad timeLocal/);
    expect(() => nextDailyFireInTz(now, 'UTC', '25:00')).toThrow(/out-of-range/);
  });
});
