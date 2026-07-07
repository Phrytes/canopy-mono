/**
 * iCalReader — Tasks V1 local calendar conflict view.
 *
 * **Local matching only.** No `getFreeBusy` skill, no network
 * exchange. The user reads their own pod-mirrored (or local) `.ics`
 * files and the claim flow shows them THEIR conflicts on a proposed
 * deadline. Other circle members' calendars never cross the wire.
 *
 * Calendar data flow (recap from
 * `Project Files/Tasks App/advice-2026-05-07.md` § Input 1):
 *
 *   external calendar (Google / Outlook / iCloud / CalDAV)
 *     │  apps/import-bridge-v0  — OAuth + listener / poll
 *     ▼
 *   <user-pod>/calendar/<source>.ics       ← THIS reader's input
 *     │  pure local read; expand RRULE; project to busy intervals
 *     ▼
 *   apps/tasks-v0 claim-flow UI            ← THIS reader's output
 *
 * The reader composes any `core.DataSource` so:
 *   - Pod-attached: the bundle's CachingDataSource forwards reads
 *     through to `<user-pod>/calendar/...`.
 *   - Local-only mode: the same cache reads pre-seeded `*.ics` files
 *     (CLI users drop them in; tests load fixtures via the pod-mock
 *     loader at `test/utils/podMockCalendar.js`).
 *
 * Library: `ical.js` (RFC 5545 / VTIMEZONE / RRULE expansion).
 * Hand-rolling iCal is a known regret — `ical.js` is well-tested
 * upstream.
 */

import ICAL from 'ical.js';

const DEFAULT_CALENDAR_CONTAINER = 'mem://user/calendar/';

/**
 * Parse a single `.ics` blob and project all VEVENTs to busy
 * intervals that overlap a given range.
 *
 * Range overlap rule (inclusive both ends):
 *   event.start <= range.end   AND   event.end >= range.start
 *
 * For recurring events, the iterator walks occurrences until the
 * first one starting past `range.end`. Each occurrence becomes its
 * own busy interval — apps render them as separate conflicts.
 *
 * Pure function — no I/O. Apps that want to project a *list* of
 * `.ics` blobs use `readMyCalendar` below.
 *
 * @param {string} icsString
 * @param {{start: number, end: number}} range  — epoch-ms inclusive
 * @returns {Array<{start: number, end: number, summary: string|null, allDay: boolean}>}
 */
export function parseIcsToBusy(icsString, range) {
  if (typeof icsString !== 'string' || !icsString.trim()) return [];
  if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end)) {
    throw new TypeError('parseIcsToBusy: range {start, end} required');
  }
  if (range.end < range.start) {
    throw new RangeError('parseIcsToBusy: range.end must be >= range.start');
  }

  let jcal;
  try {
    jcal = ICAL.parse(icsString);
  } catch {
    return [];   // malformed .ics — silently skip
  }

  const vcalendar = new ICAL.Component(jcal);
  const vevents   = vcalendar.getAllSubcomponents('vevent');

  const out = [];

  for (const vevent of vevents) {
    let event;
    try {
      event = new ICAL.Event(vevent);
    } catch {
      continue;
    }

    const allDay = !!event.startDate?.isDate;
    const summary = event.summary ?? null;

    if (event.isRecurring()) {
      _walkRecurrences(event, range, allDay, summary, out);
    } else {
      const span = _spanFromEvent(event, allDay);
      if (span && _overlapsRange(span, range)) {
        out.push({ ...span, summary, allDay });
      }
    }
  }

  return out;
}

/**
 * Read every `.ics` file under a DataSource container and project
 * to busy intervals overlapping the range. Sort ascending by start.
 *
 * The DataSource interface needs `list(prefix)` + `read(path)`. The
 * Tasks `localStoreBundle.cache` (`@canopy/local-store`'s
 * `CachingDataSource`) supports both.
 *
 * @param {object} args
 * @param {object} args.dataSource
 * @param {{start: number, end: number}} args.range
 * @param {string} [args.container]   — defaults to `mem://user/calendar/`
 * @returns {Promise<Array<{start, end, summary, allDay, source}>>}
 */
export async function readMyCalendar({
  dataSource,
  range,
  container = DEFAULT_CALENDAR_CONTAINER,
}) {
  if (!dataSource?.read) {
    throw new TypeError('readMyCalendar: dataSource with .read() required');
  }
  if (typeof dataSource.list !== 'function') {
    throw new TypeError('readMyCalendar: dataSource with .list() required');
  }
  if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end)) {
    throw new TypeError('readMyCalendar: range {start, end} required');
  }

  const keys = await dataSource.list(container);
  const icsKeys = (keys ?? []).filter((k) => typeof k === 'string' && k.endsWith('.ics'));

  const all = [];
  for (const key of icsKeys) {
    let raw;
    try {
      raw = await dataSource.read(key);
    } catch {
      continue;
    }
    if (raw == null) continue;
    const text = typeof raw === 'string' ? raw : (raw?.toString?.() ?? '');
    if (!text) continue;

    const events = parseIcsToBusy(text, range);
    for (const e of events) {
      all.push({ ...e, source: key });
    }
  }

  return all.sort((a, b) => a.start - b.start);
}

/**
 * Convenience: format a list of busy intervals as a one-line UI
 * badge ("Anna: 2 conflicts" — no event titles, just count). Pure
 * function; the UI may format differently.
 */
export function busyBadge(busy) {
  const n = Array.isArray(busy) ? busy.length : 0;
  if (n === 0) return 'free';
  if (n === 1) return '1 conflict';
  return `${n} conflicts`;
}

// ── Internals ──────────────────────────────────────────────────────────────

function _spanFromEvent(event, allDay) {
  const start = event.startDate?.toUnixTime?.();
  if (!Number.isFinite(start)) return null;
  let endTime = event.endDate?.toUnixTime?.();
  if (!Number.isFinite(endTime)) {
    // No DTEND — fall back to start + duration, or zero-length.
    const durSeconds = event.duration?.toSeconds?.() ?? 0;
    endTime = start + durSeconds;
  }
  return {
    start: start * 1000,
    end:   endTime * 1000,
  };
}

function _overlapsRange({ start, end }, range) {
  return start <= range.end && end >= range.start;
}

function _walkRecurrences(event, range, allDay, summary, out) {
  const iter = event.iterator();
  const durationSeconds = event.duration?.toSeconds?.() ?? 0;
  // Hard ceiling on iterations to defend against pathological RRULEs
  // (apps shouldn't ship VCALENDARs with unbounded weekly-forever rules
  // for a 5-year range, but ical.js will happily yield them).
  const HARD_LIMIT = 5000;
  let n = 0;
  while (n < HARD_LIMIT) {
    n++;
    const next = iter.next();
    if (!next) break;
    const startMs = next.toUnixTime() * 1000;
    if (startMs > range.end) break;
    const endMs = startMs + durationSeconds * 1000;
    if (endMs >= range.start) {
      out.push({ start: startMs, end: endMs, summary, allDay });
    }
  }
}

export { DEFAULT_CALENDAR_CONTAINER };
