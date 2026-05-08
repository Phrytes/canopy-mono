/**
 * Phase 4 — local calendar reader tests.
 *
 * Covers:
 *   1. parseIcsToBusy — single one-shot event in range.
 *   2. parseIcsToBusy — RRULE expansion (weekly Tuesday → 4 occurrences in a 4-week window).
 *   3. parseIcsToBusy — all-day event (DTSTART;VALUE=DATE).
 *   4. parseIcsToBusy — VTIMEZONE projection (Europe/Amsterdam).
 *   5. parseIcsToBusy — range overlap edges (event starts before range, ends inside).
 *   6. parseIcsToBusy — malformed input returns []; empty input returns [].
 *   7. readMyCalendar — globs the container, parses each .ics, sorts by start.
 *   8. readMyCalendar — non-.ics files in the container are ignored.
 *   9. busyBadge formatting.
 *  10. End-to-end: load all 4 fixtures, query a range that hits each, verify counts.
 *
 * Fixture epochs (UTC) — for reference:
 *   recurring-weekly:  Tue 6 Jan 2026 14:00-15:00 UTC, weekly
 *   one-shot:          Fri 9 Jan 2026 18:00-21:00 UTC
 *   all-day:           Sat 10 Jan 2026 (full day, UTC)
 *   tz-amsterdam:      Thu 8 Jan 2026 10:00-11:00 Europe/Amsterdam (= 09:00-10:00 UTC)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildBundle } from '../src/storage/buildBundle.js';
import { parseIcsToBusy, readMyCalendar, busyBadge, DEFAULT_CALENDAR_CONTAINER } from '../src/calendar/iCalReader.js';
import { loadCalendarFixtures, FIXTURES_DIR } from './utils/podMockCalendar.js';

// Range covering the whole first two weeks of Jan 2026.
const RANGE_JAN_2026 = {
  start: Date.UTC(2026, 0,  1, 0, 0, 0),
  end:   Date.UTC(2026, 0, 14, 0, 0, 0),
};

const RANGE_FRIDAY_EVENING = {
  start: Date.UTC(2026, 0, 9, 17, 0, 0),
  end:   Date.UTC(2026, 0, 9, 23, 0, 0),
};

describe('Phase 4 — local calendar reader', () => {
  describe('parseIcsToBusy', () => {
    it('extracts a single one-shot event whose interval overlaps the range', () => {
      const ics = readFileSync(join(FIXTURES_DIR, 'one-shot.ics'), 'utf8');
      const busy = parseIcsToBusy(ics, RANGE_FRIDAY_EVENING);
      expect(busy).toHaveLength(1);
      expect(busy[0].start).toBe(Date.UTC(2026, 0, 9, 18, 0, 0));
      expect(busy[0].end).toBe(Date.UTC(2026, 0, 9, 21, 0, 0));
      expect(busy[0].summary).toMatch(/Friday/);
      expect(busy[0].allDay).toBe(false);
    });

    it('expands a weekly RRULE — 2 occurrences in the first two weeks of Jan 2026', () => {
      const ics = readFileSync(join(FIXTURES_DIR, 'recurring-weekly.ics'), 'utf8');
      const busy = parseIcsToBusy(ics, RANGE_JAN_2026);
      // First Tuesday in the range is Jan 6; second is Jan 13.
      expect(busy.length).toBe(2);
      expect(busy[0].start).toBe(Date.UTC(2026, 0,  6, 14, 0, 0));
      expect(busy[1].start).toBe(Date.UTC(2026, 0, 13, 14, 0, 0));
    });

    it('expands a weekly RRULE — many occurrences over 6 weeks', () => {
      const ics = readFileSync(join(FIXTURES_DIR, 'recurring-weekly.ics'), 'utf8');
      const busy = parseIcsToBusy(ics, {
        start: Date.UTC(2026, 0,  1),
        end:   Date.UTC(2026, 1, 12),
      });
      // Tuesdays: Jan 6, 13, 20, 27, Feb 3, 10 → 6.
      expect(busy.length).toBe(6);
    });

    it('handles all-day events (DTSTART;VALUE=DATE)', () => {
      const ics = readFileSync(join(FIXTURES_DIR, 'all-day.ics'), 'utf8');
      const busy = parseIcsToBusy(ics, RANGE_JAN_2026);
      expect(busy).toHaveLength(1);
      expect(busy[0].allDay).toBe(true);
      // The all-day event spans Jan 10 (DTSTART) to Jan 11 (DTEND), exclusive end.
      expect(busy[0].summary).toMatch(/vacation/i);
    });

    it('projects an Europe/Amsterdam-local event to the right UTC interval', () => {
      const ics = readFileSync(join(FIXTURES_DIR, 'tz-amsterdam.ics'), 'utf8');
      const busy = parseIcsToBusy(ics, RANGE_JAN_2026);
      expect(busy).toHaveLength(1);
      // 10:00 Amsterdam in January is CET (+01:00) → 09:00 UTC.
      expect(busy[0].start).toBe(Date.UTC(2026, 0, 8,  9, 0, 0));
      expect(busy[0].end).toBe(  Date.UTC(2026, 0, 8, 10, 0, 0));
    });

    it('counts an event whose interval straddles the range boundary as a hit', () => {
      const ics = readFileSync(join(FIXTURES_DIR, 'one-shot.ics'), 'utf8');
      // Range that starts AFTER the event begins but BEFORE it ends.
      const busy = parseIcsToBusy(ics, {
        start: Date.UTC(2026, 0, 9, 19, 30, 0),  // 19:30 UTC
        end:   Date.UTC(2026, 0, 9, 22, 0, 0),
      });
      expect(busy).toHaveLength(1);
    });

    it('returns [] for malformed iCal input', () => {
      expect(parseIcsToBusy('this is not iCal', RANGE_JAN_2026)).toEqual([]);
    });

    it('returns [] for empty input', () => {
      expect(parseIcsToBusy('', RANGE_JAN_2026)).toEqual([]);
      expect(parseIcsToBusy('   \n  ', RANGE_JAN_2026)).toEqual([]);
    });

    it('rejects calls without a valid range', () => {
      const ics = readFileSync(join(FIXTURES_DIR, 'one-shot.ics'), 'utf8');
      expect(() => parseIcsToBusy(ics, null)).toThrow(/range/);
      expect(() => parseIcsToBusy(ics, { start: 100, end: 50 })).toThrow(/range\.end/);
    });
  });

  describe('readMyCalendar', () => {
    let bundle;

    beforeEach(async () => {
      bundle = buildBundle();
      await loadCalendarFixtures({ dataSource: bundle.cache });
    });

    it('reads every .ics fixture from the container and returns a sorted busy list', async () => {
      const busy = await readMyCalendar({
        dataSource: bundle.cache,
        range: RANGE_JAN_2026,
      });
      // Recurring (Jan 6 + Jan 13) + one-shot (Jan 9) + all-day (Jan 10) + Amsterdam (Jan 8) = 5
      expect(busy.length).toBe(5);
      // Sorted by start, ascending.
      for (let i = 1; i < busy.length; i++) {
        expect(busy[i].start).toBeGreaterThanOrEqual(busy[i - 1].start);
      }
      // First event in the window: Tuesday Jan 6 14:00 UTC.
      expect(busy[0].start).toBe(Date.UTC(2026, 0, 6, 14, 0, 0));
      // Each entry carries the source path it came from.
      for (const e of busy) {
        expect(e.source).toMatch(/^mem:\/\/user\/calendar\/.+\.ics$/);
      }
    });

    it('ignores non-.ics files in the container', async () => {
      // Drop a junk file alongside the fixtures.
      await bundle.cache.write(`${DEFAULT_CALENDAR_CONTAINER}README.txt`, 'this is not an ics file');
      const busy = await readMyCalendar({
        dataSource: bundle.cache,
        range: RANGE_JAN_2026,
      });
      // Same 5 events as before; the .txt is filtered out.
      expect(busy.length).toBe(5);
    });

    it('returns [] when the container is empty', async () => {
      const empty = buildBundle();
      const busy = await readMyCalendar({
        dataSource: empty.cache,
        range: RANGE_JAN_2026,
      });
      expect(busy).toEqual([]);
    });

    it('rejects calls without dataSource or range', async () => {
      await expect(readMyCalendar({ dataSource: bundle.cache })).rejects.toThrow(/range/);
      await expect(readMyCalendar({ range: RANGE_JAN_2026 })).rejects.toThrow(/dataSource/);
    });
  });

  describe('busyBadge', () => {
    it('formats counts in plain English', () => {
      expect(busyBadge([])).toBe('free');
      expect(busyBadge([{ start: 0, end: 1 }])).toBe('1 conflict');
      expect(busyBadge([{}, {}, {}])).toBe('3 conflicts');
      expect(busyBadge(undefined)).toBe('free');
      expect(busyBadge(null)).toBe('free');
    });
  });
});
