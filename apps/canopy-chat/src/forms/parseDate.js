/**
 * canopy-chat — relaxed date parser.
 *
 * Accepts:
 *   - ISO-8601 date strings:           '2026-05-30'
 *   - ISO-8601 datetime strings:       '2026-05-30T14:00:00Z'
 *   - the literal 'today'              → today's date (UTC)
 *   - the literal 'tomorrow'           → tomorrow (UTC)
 *   - weekday names (en + nl):         'friday' / 'vrijdag'
 *                                       → the next occurrence of that
 *                                         weekday (today counts if it
 *                                         is that weekday)
 *
 * Returns an ISO-8601 date string ('YYYY-MM-DD') OR null on parse
 * failure.  Caller (validateAndCoerce) treats null as a validation
 * error.
 *
 * Phase v0.3 sub-slice 3.4 per `/Project Files/canopy-chat/coding-plan.md`.
 */

const WEEKDAYS_EN = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];
const WEEKDAYS_NL = [
  'zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag',
];

/**
 * Parse a date-ish string into an ISO date.
 *
 * @param {string}        input
 * @param {object}        [opts]
 * @param {() => Date}    [opts.now=() => new Date()]   injectable clock for tests
 * @returns {string | null}                              'YYYY-MM-DD' or null
 */
export function parseRelativeDate(input, opts = {}) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const raw = trimmed.toLowerCase();
  const now = (typeof opts.now === 'function' ? opts.now() : new Date());

  // ISO date or datetime — pass through if it parses.  Use the
  // ORIGINAL trimmed string (case-sensitive: 'T' + 'Z' are
  // required by the Date constructor for ISO datetimes).
  if (/^\d{4}-\d{2}-\d{2}([Tt].*)?$/.test(trimmed)) {
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return toIsoDate(d);
  }

  if (raw === 'today')    return toIsoDate(now);
  if (raw === 'tomorrow' || raw === 'morgen') {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + 1);
    return toIsoDate(d);
  }

  // Weekday names — find the next occurrence (today counts).
  const enIdx = WEEKDAYS_EN.indexOf(raw);
  const nlIdx = WEEKDAYS_NL.indexOf(raw);
  const wkIdx = enIdx !== -1 ? enIdx : nlIdx;
  if (wkIdx !== -1) {
    const todayIdx = now.getUTCDay();
    const delta = (wkIdx - todayIdx + 7) % 7;
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + delta);
    return toIsoDate(d);
  }

  return null;
}

function toIsoDate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}
