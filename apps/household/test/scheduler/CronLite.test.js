/**
 * scheduler/CronLite — tests.
 *
 * The contract is "the next unix-ms whose local time in tz is HH:MM".
 * Tests cover:
 *   - obvious UTC behaviour
 *   - Europe/Amsterdam normal day (today vs. tomorrow)
 *   - America/Los_Angeles (far offset)
 *   - DST spring-forward (gap)  — must not crash; drift OK
 *   - DST fall-back (repeat)    — must pick something consistent
 *   - validation of atLocal and tz
 *   - formatLocal returns the canonical YYYY-MM-DD HH:MM
 *
 * No fake timers needed: every assertion is computed from explicit
 * `now` values so the suite is deterministic regardless of the host
 * machine's clock or timezone.
 */

import { describe, it, expect } from 'vitest';
import { nextFireMs, formatLocal } from '../../src/scheduler/CronLite.js';

// ───────────────────────────────────────────────────────────────────
// helpers
// ───────────────────────────────────────────────────────────────────

/** Round-trip a unix-ms back into local Y/M/D/h/m via formatLocal. */
function asLocal (ms, tz) {
  return formatLocal(ms, tz); // 'YYYY-MM-DD HH:MM'
}

// ───────────────────────────────────────────────────────────────────
// nextFireMs — UTC
// ───────────────────────────────────────────────────────────────────

describe('CronLite.nextFireMs — UTC', () => {
  it('returns "today at 20:00 UTC" when now is earlier the same day', () => {
    // 2026-04-30 12:00:00 UTC
    const now    = Date.UTC(2026, 3, 30, 12, 0, 0);
    const fire   = nextFireMs(now, 'UTC', '20:00');
    const expect20 = Date.UTC(2026, 3, 30, 20, 0, 0);
    expect(fire).toBe(expect20);
  });

  it('returns "tomorrow at 06:30 UTC" when now is past 06:30 UTC', () => {
    // 2026-04-30 09:00 UTC — past 06:30
    const now  = Date.UTC(2026, 3, 30, 9, 0, 0);
    const fire = nextFireMs(now, 'UTC', '06:30');
    const expectTomorrow = Date.UTC(2026, 4, 1, 6, 30, 0);
    expect(fire).toBe(expectTomorrow);
  });
});

// ───────────────────────────────────────────────────────────────────
// nextFireMs — Europe/Amsterdam
// ───────────────────────────────────────────────────────────────────

describe('CronLite.nextFireMs — Europe/Amsterdam', () => {
  const TZ = 'Europe/Amsterdam';

  it('today @ 20:00 Amsterdam when now is 12:00 Amsterdam local', () => {
    // 2026-04-30 12:00 Amsterdam = 10:00 UTC (CEST = UTC+2 in late April)
    const now  = Date.UTC(2026, 3, 30, 10, 0, 0);
    const fire = nextFireMs(now, TZ, '20:00');
    expect(asLocal(fire, TZ)).toBe('2026-04-30 20:00');
  });

  it('tomorrow @ 20:00 Amsterdam when now is 21:00 Amsterdam local', () => {
    // 2026-04-30 21:00 Amsterdam = 19:00 UTC
    const now  = Date.UTC(2026, 3, 30, 19, 0, 0);
    const fire = nextFireMs(now, TZ, '20:00');
    expect(asLocal(fire, TZ)).toBe('2026-05-01 20:00');
  });

  it('respects Amsterdam local-day boundary (00:30 local rolls properly)', () => {
    // 2026-04-30 00:30 Amsterdam = 2026-04-29 22:30 UTC.
    // Asking for "08:00 local" should give the same Amsterdam day
    // (2026-04-30), NOT yesterday.
    const now  = Date.UTC(2026, 3, 29, 22, 30, 0);
    const fire = nextFireMs(now, TZ, '08:00');
    expect(asLocal(fire, TZ)).toBe('2026-04-30 08:00');
  });
});

// ───────────────────────────────────────────────────────────────────
// nextFireMs — America/Los_Angeles
// ───────────────────────────────────────────────────────────────────

describe('CronLite.nextFireMs — America/Los_Angeles', () => {
  const TZ = 'America/Los_Angeles';

  it('today @ 20:00 LA when now is 10:00 LA local', () => {
    // 2026-06-15 10:00 LA = 17:00 UTC (PDT = UTC-7 in June)
    const now  = Date.UTC(2026, 5, 15, 17, 0, 0);
    const fire = nextFireMs(now, TZ, '20:00');
    expect(asLocal(fire, TZ)).toBe('2026-06-15 20:00');
  });

  it('tomorrow @ 07:00 LA when now is 09:00 LA local (past 07:00)', () => {
    // 2026-06-15 09:00 LA = 16:00 UTC
    const now  = Date.UTC(2026, 5, 15, 16, 0, 0);
    const fire = nextFireMs(now, TZ, '07:00');
    expect(asLocal(fire, TZ)).toBe('2026-06-16 07:00');
  });
});

// ───────────────────────────────────────────────────────────────────
// DST edges — Europe/Amsterdam
// ───────────────────────────────────────────────────────────────────

describe('CronLite.nextFireMs — DST spring-forward (Europe/Amsterdam)', () => {
  const TZ = 'Europe/Amsterdam';

  it('does not crash when atLocal lands in the spring-forward gap', () => {
    // In 2026 DST starts on Sunday 29 March: at 02:00 local clocks
    // jump to 03:00.  So 02:30 local doesn't exist that day.
    // Use "now" = a couple of hours before the gap (00:30 local).
    // 00:30 Amsterdam on 2026-03-29 = 23:30 UTC on 2026-03-28 (CET = UTC+1).
    const now  = Date.UTC(2026, 2, 28, 23, 30, 0);
    expect(() => nextFireMs(now, TZ, '02:30')).not.toThrow();
    const fire = nextFireMs(now, TZ, '02:30');
    expect(typeof fire).toBe('number');
    expect(Number.isFinite(fire)).toBe(true);
    // Must be in the future relative to now; drift up to ~1 h is OK.
    expect(fire).toBeGreaterThan(now);
    expect(fire - now).toBeLessThan(6 * 60 * 60 * 1000); // within 6 h
  });
});

describe('CronLite.nextFireMs — DST fall-back (Europe/Amsterdam)', () => {
  const TZ = 'Europe/Amsterdam';

  it('picks one consistent instant when 02:30 local happens twice', () => {
    // In 2026 DST ends on Sunday 25 October: at 03:00 local clocks
    // fall to 02:00, so 02:30 local happens twice.
    // "now" = 00:30 local that day = 22:30 UTC on 2026-10-24
    // (CEST = UTC+2 just before the change).
    const now  = Date.UTC(2026, 9, 24, 22, 30, 0);
    const fire = nextFireMs(now, TZ, '02:30');
    expect(typeof fire).toBe('number');
    expect(fire).toBeGreaterThan(now);
    // The local rendering should be 02:30 on 2026-10-25.  Either of
    // the two occurrences is acceptable; we just verify it round-trips.
    expect(asLocal(fire, TZ)).toBe('2026-10-25 02:30');

    // Determinism: calling twice with the same inputs gives the same
    // answer.
    const fire2 = nextFireMs(now, TZ, '02:30');
    expect(fire2).toBe(fire);
  });
});

// ───────────────────────────────────────────────────────────────────
// validation
// ───────────────────────────────────────────────────────────────────

describe('CronLite.nextFireMs — validation', () => {
  it('throws RangeError on invalid atLocal (out-of-range)', () => {
    expect(() => nextFireMs(Date.now(), 'UTC', '25:99'))
      .toThrow(RangeError);
  });

  it('throws RangeError on malformed atLocal', () => {
    expect(() => nextFireMs(Date.now(), 'UTC', 'noon'))
      .toThrow(RangeError);
  });

  it('throws RangeError on invalid tz', () => {
    expect(() => nextFireMs(Date.now(), 'Mars/Olympus', '08:00'))
      .toThrow(RangeError);
  });
});

// ───────────────────────────────────────────────────────────────────
// formatLocal
// ───────────────────────────────────────────────────────────────────

describe('CronLite.formatLocal', () => {
  it("produces 'YYYY-MM-DD HH:MM' in UTC", () => {
    const ms = Date.UTC(2026, 3, 30, 14, 5, 0);
    expect(formatLocal(ms, 'UTC')).toBe('2026-04-30 14:05');
  });

  it('renders the corresponding Amsterdam time', () => {
    // 2026-04-30 14:05 UTC = 16:05 Amsterdam (CEST = UTC+2).
    const ms = Date.UTC(2026, 3, 30, 14, 5, 0);
    expect(formatLocal(ms, 'Europe/Amsterdam')).toBe('2026-04-30 16:05');
  });

  it('renders the corresponding Los_Angeles time', () => {
    // 2026-04-30 14:05 UTC = 07:05 LA (PDT = UTC-7).
    const ms = Date.UTC(2026, 3, 30, 14, 5, 0);
    expect(formatLocal(ms, 'America/Los_Angeles')).toBe('2026-04-30 07:05');
  });
});

// ───────────────────────────────────────────────────────────────────
// round-trip sanity
// ───────────────────────────────────────────────────────────────────

describe('CronLite — round-trip sanity', () => {
  it('formatLocal(nextFireMs(...), tz) yields the requested HH:MM', () => {
    const tz   = 'Europe/Amsterdam';
    const now  = Date.UTC(2026, 3, 30, 10, 0, 0); // 12:00 Amsterdam
    const fire = nextFireMs(now, tz, '20:00');
    expect(formatLocal(fire, tz).slice(-5)).toBe('20:00');
  });
});
