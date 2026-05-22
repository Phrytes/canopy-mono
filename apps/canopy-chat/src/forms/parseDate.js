/**
 * canopy-chat — relaxed date parser (Slack-style).
 *
 * Per OQ-3.A user resolution (2026-05-23): mimic Slack's flexibility.
 *
 * Backed by `chrono-node` — battle-tested natural-language date
 * parser handling: 'next tuesday 3pm', 'in 2 hours', 'tomorrow
 * morning', '5/30 4:30pm', 'feb 15', etc.
 *
 * canopy-chat keeps a small fast-path for ISO + the handful of
 * keywords that already had test coverage (today / tomorrow /
 * morgen / weekday names in EN + NL) so behaviour stays predictable
 * when chrono's heuristics drift across versions.
 *
 * Returns an ISO-8601 date string ('YYYY-MM-DD') OR null on parse
 * failure.  Caller (validateAndCoerce) treats null as a validation
 * error.
 *
 * Phase v0.3 sub-slice 3.4 (original) → v0.6 OQ-3.A catch-up 2026-05-23.
 */

import * as chrono from 'chrono-node';

const WEEKDAYS_EN = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];
const WEEKDAYS_NL = [
  'zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag',
];

/**
 * Parse a date-ish string into an ISO date.  Slack-style: accepts
 * a wide range of inputs via chrono-node, with a fast-path for the
 * canonical cases the canopy-chat tests already pin.
 *
 * @param {string}        input
 * @param {object}        [opts]
 * @param {() => Date}    [opts.now=() => new Date()]   injectable clock
 * @returns {string | null}                              'YYYY-MM-DD' or null
 */
export function parseRelativeDate(input, opts = {}) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const raw = trimmed.toLowerCase();
  const now = (typeof opts.now === 'function' ? opts.now() : new Date());

  // Fast path 1: ISO date / datetime — pass through deterministically.
  if (/^\d{4}-\d{2}-\d{2}([Tt].*)?$/.test(trimmed)) {
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return toIsoDate(d);
  }

  // Fast path 2: pinned keywords.  chrono handles 'today' / 'tomorrow'
  // but we keep the explicit paths so EN+NL parity is locked in
  // tests and doesn't depend on chrono locale support.
  if (raw === 'today') return toIsoDate(now);
  if (raw === 'tomorrow' || raw === 'morgen') {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + 1);
    return toIsoDate(d);
  }

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

  // Slack-style fallback: feed it to chrono.  forwardDate biases
  // ambiguous dates ('feb 15') toward the future.
  try {
    const parsed = chrono.parseDate(trimmed, now, { forwardDate: true });
    if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
      return toIsoDate(parsed);
    }
  } catch {
    // chrono throws on some pathological inputs; treat as null.
  }

  return null;
}

function toIsoDate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}
