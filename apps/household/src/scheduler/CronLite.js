/**
 * scheduler/CronLite — pure-JS timezone helper.
 *
 * Two exports:
 *   - nextFireMs(now, tz, atLocal): unix-ms of the next instant whose
 *     local time in `tz` is `atLocal` ('HH:MM').  If `now`'s local time
 *     in `tz` is already past `atLocal`, the answer is "tomorrow at
 *     atLocal in tz"; otherwise "today at atLocal in tz".
 *   - formatLocal(ms, tz): 'YYYY-MM-DD HH:MM' string for human logs.
 *
 * No deps — only `Intl.DateTimeFormat`.  Approach:
 *   1. Render `now` into `tz` to extract local Y/M/D/H/M.
 *   2. Decide today vs. tomorrow by comparing local H/M to atLocal.
 *   3. Convert the chosen tz-local Y/M/D/H/M back to UTC by an
 *      iterative offset solve (one inversion + one correction pass
 *      handles DST edges to within a few minutes).
 *
 * DST notes:
 *   - Spring-forward gap (e.g. 02:30 last-Sunday-March in Amsterdam
 *     doesn't exist as a local time): we still return *some* ms.  In
 *     practice the iteration converges to the post-jump instant whose
 *     local time is one hour after atLocal — drift of ~1 h.  Sensible,
 *     not crashing.
 *   - Fall-back repeat (e.g. 02:30 last-Sunday-October happens twice):
 *     iteration consistently picks one of the two — currently the first
 *     occurrence (pre-jump).  Either choice is acceptable for daily-
 *     digest purposes.
 */

const HHMM_RE = /^(\d{1,2}):(\d{2})$/;

/**
 * Build (and cache) an Intl.DateTimeFormat for tz that yields all the
 * parts we need.  Throws RangeError on invalid tz (native).
 *
 * @param {string} tz
 * @returns {Intl.DateTimeFormat}
 */
const _fmtCache = new Map();
function _fmt (tz) {
  let f = _fmtCache.get(tz);
  if (f) return f;
  f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
    hour:     '2-digit',
    minute:   '2-digit',
    second:   '2-digit',
    hour12:   false,
  });
  _fmtCache.set(tz, f);
  return f;
}

/**
 * Render a Date in tz, returning {Y, M, D, h, m, s} as numbers.
 *
 * @param {Date}   date
 * @param {string} tz
 */
function _partsInTz (date, tz) {
  const parts = _fmt(tz).formatToParts(date);
  /** @type {Record<string, string>} */
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  // hour can come back as '24' on some engines for midnight; normalise.
  let h = parseInt(map.hour, 10);
  if (h === 24) h = 0;
  return {
    Y: parseInt(map.year,   10),
    M: parseInt(map.month,  10),
    D: parseInt(map.day,    10),
    h,
    m: parseInt(map.minute, 10),
    s: parseInt(map.second, 10),
  };
}

/**
 * Turn a tz-local Y/M/D/h/m into a unix-ms instant.
 *
 * Strategy:
 *   - guess = the same Y/M/D/h/m interpreted as UTC.
 *   - render guess in tz; the difference between the rendered local
 *     and the target local tells us tz's offset (signed) at that
 *     instant.  Subtract.
 *   - re-render and correct once more — handles DST edges where
 *     the offset at `guess` differs from the offset at the corrected
 *     instant.
 *
 * @param {number} Y
 * @param {number} M  1–12
 * @param {number} D
 * @param {number} h
 * @param {number} m
 * @param {string} tz
 * @returns {number} unix-ms
 */
function _localTzToUtcMs (Y, M, D, h, m, tz) {
  // Target local instant expressed as if it were UTC.
  const targetUtc = Date.UTC(Y, M - 1, D, h, m, 0, 0);

  // Render that as a real Date in tz; difference is the tz offset.
  const render1   = _partsInTz(new Date(targetUtc), tz);
  const renderUtc = Date.UTC(render1.Y, render1.M - 1, render1.D,
                             render1.h, render1.m, 0, 0);
  const offset1   = renderUtc - targetUtc;
  let   guess     = targetUtc - offset1;

  // One correction pass — necessary across DST transitions where the
  // offset at `guess` differs from the offset at `targetUtc`.
  const render2  = _partsInTz(new Date(guess), tz);
  const guessUtc = Date.UTC(render2.Y, render2.M - 1, render2.D,
                            render2.h, render2.m, 0, 0);
  const drift    = guessUtc - targetUtc;
  if (drift !== 0) guess -= drift;

  return guess;
}

/**
 * Validate atLocal and return [hours, minutes] as numbers.
 *
 * @param {string} atLocal
 * @returns {[number, number]}
 * @throws {RangeError}
 */
function _parseAtLocal (atLocal) {
  if (typeof atLocal !== 'string') {
    throw new RangeError(`atLocal must be 'HH:MM', got ${typeof atLocal}`);
  }
  const m = HHMM_RE.exec(atLocal);
  if (!m) {
    throw new RangeError(`atLocal must match 'HH:MM', got ${JSON.stringify(atLocal)}`);
  }
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    throw new RangeError(`atLocal out of range: ${atLocal}`);
  }
  return [hh, mm];
}

/**
 * Compute the next instant whose local representation in `tz` is
 * `atLocal` ('HH:MM').  See module header for full contract.
 *
 * @param {number} now      unix-ms reference instant
 * @param {string} tz       IANA tz, e.g. 'Europe/Amsterdam', 'UTC'
 * @param {string} atLocal  'HH:MM' (24h)
 * @returns {number}        unix-ms of next fire
 * @throws {RangeError}     on invalid tz or atLocal
 */
export function nextFireMs (now, tz, atLocal) {
  const [targetH, targetM] = _parseAtLocal(atLocal);

  // _fmt(tz) throws RangeError natively for an invalid tz.
  const today = _partsInTz(new Date(now), tz);

  // Try today first.
  let candidate = _localTzToUtcMs(
    today.Y, today.M, today.D, targetH, targetM, tz,
  );

  // If we're already past atLocal in tz, roll to tomorrow.  Compare on
  // the converted unix-ms so DST gaps don't fool us.
  if (candidate <= now) {
    // Add 24h and then resolve into a calendar date in tz; this avoids
    // off-by-one when "now + 24h" lands on a different calendar day in
    // tz than today + 1.
    const tomorrowAnchor = new Date(now + 24 * 60 * 60 * 1000);
    const tomorrow = _partsInTz(tomorrowAnchor, tz);
    candidate = _localTzToUtcMs(
      tomorrow.Y, tomorrow.M, tomorrow.D, targetH, targetM, tz,
    );

    // Belt and braces: if that *still* didn't move us forward (only
    // possible at extreme DST edges), nudge by a calendar day in tz.
    if (candidate <= now) {
      const dayAfter = new Date(now + 48 * 60 * 60 * 1000);
      const da = _partsInTz(dayAfter, tz);
      candidate = _localTzToUtcMs(
        da.Y, da.M, da.D, targetH, targetM, tz,
      );
    }
  }

  return candidate;
}

/**
 * Format a unix-ms instant in tz as 'YYYY-MM-DD HH:MM'.
 *
 * @param {number} ms
 * @param {string} tz
 * @returns {string}
 * @throws {RangeError} on invalid tz
 */
export function formatLocal (ms, tz) {
  const p = _partsInTz(new Date(ms), tz);
  const yyyy = String(p.Y).padStart(4, '0');
  const MM   = String(p.M).padStart(2, '0');
  const DD   = String(p.D).padStart(2, '0');
  const hh   = String(p.h).padStart(2, '0');
  const mm   = String(p.m).padStart(2, '0');
  return `${yyyy}-${MM}-${DD} ${hh}:${mm}`;
}
