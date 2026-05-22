/**
 * @canopy/calendar-emission — substrate barrel.
 *
 * Lifted from `apps/tasks-v0/src/calendar/` on 2026-05-23 per the
 * v0.3.4 substrate-reuse gate (rule-of-two: tasks-v0 + @canopy-app/
 * calendar both compose iCal emission + reading).  Pre-existing
 * tasks-v0 tests are the de-facto contract; nothing changes for
 * tasks-v0 except the import path.
 *
 * Layer: substrate.  Platform: neutral (uses `ical.js` lib; no
 * `node:` imports).
 *
 * Three sub-modules:
 *   - emitter.js          — buildIcsFor / buildCancellationIcs /
 *                            diffRemoved.  Builds VCALENDAR + VEVENT
 *                            strings from item shapes.
 *   - iCalReader.js       — parseIcsToBusy / readMyCalendar /
 *                            busyBadge.  Reads `.ics` from pod-
 *                            mirrored container; projects to busy
 *                            intervals; expands RRULE.
 *   - wireCalendarEmission.js — debounce + per-member emission;
 *                                drives writes to <pod>/<emission-path>.
 */

export {
  buildIcsFor, buildIcsForEvents, buildCancellationIcs, diffRemoved,
} from './emitter.js';

export {
  parseIcsToBusy, readMyCalendar, busyBadge,
  DEFAULT_CALENDAR_CONTAINER,
} from './iCalReader.js';

export {
  wireCalendarEmission, defaultEmissionPath,
} from './wireCalendarEmission.js';
