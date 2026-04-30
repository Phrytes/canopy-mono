/**
 * DailyDigest — fires once per day at the configured local time
 * (default '20:00' per Q-H2.7) for one household.
 *
 * Phase 4 / Stream 4b.  Self-contained: no extra deps, no required
 * imports from CronLite (Stream 4c).  The next-fire computation is
 * pluggable via the `nextFireMsFn` test seam — production code uses
 * an internal default backed by `Intl.DateTimeFormat`.
 *
 * Usage:
 *   const digest = new DailyDigest({
 *     tz:      'Europe/Amsterdam',
 *     atLocal: '20:00',
 *     onFire:  () => composeAndSendDigest(),
 *   });
 *   digest.start();   // arms the next fire
 *   ...
 *   digest.stop();    // cancels any pending fire
 *   await digest.fireNow();  // force-fire (Settings → "send now")
 *
 * Lifecycle:
 *   start() arms a single setTimeout; on fire, onFire is invoked
 *   (errors swallowed) and the next slot is armed via the same
 *   nextFireMsFn.  stop() cancels the pending timer.  Both are
 *   idempotent.  fireNow() invokes onFire immediately without
 *   touching the schedule (the pending timer keeps its arming).
 */

const DEFAULT_TZ        = 'UTC';
const DEFAULT_AT_LOCAL  = '20:00';
const MS_PER_DAY        = 24 * 60 * 60 * 1000;

export class DailyDigest {
  #tz;
  #atLocal;
  #onFire;
  #nextFireMsFn;
  #timer = null;

  /**
   * @param {object} args
   * @param {string}   [args.tz='UTC']            IANA timezone, e.g. 'Europe/Amsterdam'
   * @param {string}   [args.atLocal='20:00']     'HH:MM' in local time
   * @param {() => void|Promise<void>} args.onFire  called at each fire
   * @param {(now: number, tz: string, atLocal: string) => number} [args.nextFireMsFn]
   *   Test seam.  Defaults to an internal Intl.DateTimeFormat-backed
   *   implementation.  Returns a unix-ms instant.
   */
  constructor({ tz, atLocal, onFire, nextFireMsFn } = {}) {
    if (typeof onFire !== 'function') {
      throw new TypeError('DailyDigest: onFire callback is required');
    }
    this.#tz           = tz      || DEFAULT_TZ;
    this.#atLocal      = atLocal || DEFAULT_AT_LOCAL;
    this.#onFire       = onFire;
    this.#nextFireMsFn = nextFireMsFn || defaultNextFireMs;
  }

  /** Arm the next fire.  Idempotent — second call without stop is a no-op. */
  start() {
    if (this.#timer !== null) return;
    this.#armNext();
  }

  /** Cancel any pending fire.  Idempotent. */
  stop() {
    if (this.#timer === null) return;
    clearTimeout(this.#timer);
    this.#timer = null;
  }

  /**
   * Force-fire, regardless of the schedule.  Used at
   * Settings → "send digest now" (Phase 5) and useful in tests.
   * Returns a promise resolving once `onFire` has settled (or thrown,
   * which is swallowed and reported via the resolved promise).
   */
  async fireNow() {
    try {
      await this.#onFire();
    } catch {
      // Swallow per spec — caller's onFire handles its own errors.
    }
  }

  // ── internals ────────────────────────────────────────────────────

  #armNext() {
    const now    = Date.now();
    let nextMs;
    try {
      nextMs = this.#nextFireMsFn(now, this.#tz, this.#atLocal);
    } catch {
      // If the next-fire calculation explodes (bad tz, malformed
      // atLocal, etc.) we fall back to "24 h from now" so the
      // scheduler keeps ticking instead of dying silently.
      nextMs = now + MS_PER_DAY;
    }
    let delay = nextMs - now;
    if (!Number.isFinite(delay) || delay < 0) {
      // Defensive: never schedule a 0-ms or negative timer (would
      // hot-loop).  Push to "tomorrow same time".
      delay = MS_PER_DAY;
    }
    this.#timer = setTimeout(() => this.#fire(), delay);
    if (typeof this.#timer?.unref === 'function') this.#timer.unref();
  }

  async #fire() {
    this.#timer = null;
    try {
      await this.#onFire();
    } catch {
      // Swallow per spec — one bad fire shouldn't kill the
      // scheduler.  Re-arm regardless.
    }
    // Re-arm only if we weren't stopped during onFire.
    if (this.#timer === null) this.#armNext();
  }
}

// ─────────────────────────────────────────────────────────────────
// Default next-fire calculator
// ─────────────────────────────────────────────────────────────────

/**
 * Compute the next instant whose local time in `tz` is `atLocal`.
 *
 * Approach (no extra deps):
 *   1. Use Intl.DateTimeFormat with the target timezone to read
 *      `now`'s wall-clock components in tz (year/month/day/hour/min).
 *   2. Decide whether the next fire is today or tomorrow.
 *   3. Convert the target wall-clock back to a UTC instant by
 *      computing the tz offset for the candidate instant via the
 *      same Intl formatter (one-shot inversion — accurate to the
 *      nearest minute, drifts only across DST boundaries by at
 *      most ~1 h, which is fine for v0 per Q-H2.7).
 *
 * Precision: target "fire" lands within ±1 minute of the configured
 * local time on normal days.  On DST transition days the realized
 * fire may be off by up to one hour — acceptable for a daily digest.
 *
 * @param {number} nowMs
 * @param {string} tz
 * @param {string} atLocal  'HH:MM'
 * @returns {number}        unix-ms instant of the next fire
 */
export function defaultNextFireMs(nowMs, tz, atLocal) {
  const [hh, mm] = parseHHMM(atLocal);
  const nowParts = wallClockInTz(nowMs, tz);

  // Build a "today at HH:MM in tz" candidate.  Start from the same
  // calendar day as `now` in the target tz.
  let target = utcInstantForWallClock({
    year:   nowParts.year,
    month:  nowParts.month,
    day:    nowParts.day,
    hour:   hh,
    minute: mm,
    tz,
  });

  // If that candidate is at or before now, push to tomorrow.
  if (target <= nowMs) {
    const tomorrow = addDaysUtc(nowParts, 1);
    target = utcInstantForWallClock({
      year:   tomorrow.year,
      month:  tomorrow.month,
      day:    tomorrow.day,
      hour:   hh,
      minute: mm,
      tz,
    });
  }

  return target;
}

function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if (!m) throw new Error(`DailyDigest: bad atLocal: ${s}`);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    throw new Error(`DailyDigest: out-of-range atLocal: ${s}`);
  }
  return [hh, mm];
}

/**
 * Read the wall-clock parts (Y/M/D/h/m/s) of `instantMs` as seen in
 * the named IANA timezone.
 */
function wallClockInTz(instantMs, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year:    'numeric',
    month:   '2-digit',
    day:     '2-digit',
    hour:    '2-digit',
    minute:  '2-digit',
    second:  '2-digit',
    hour12:  false,
  });
  const parts = fmt.formatToParts(new Date(instantMs));
  const out = {};
  for (const p of parts) {
    if (p.type === 'year')   out.year   = Number(p.value);
    if (p.type === 'month')  out.month  = Number(p.value);
    if (p.type === 'day')    out.day    = Number(p.value);
    if (p.type === 'hour')   out.hour   = Number(p.value);
    if (p.type === 'minute') out.minute = Number(p.value);
    if (p.type === 'second') out.second = Number(p.value);
  }
  // Some ICU builds emit "24" for midnight under hour12:false.
  if (out.hour === 24) out.hour = 0;
  return out;
}

/**
 * Given a desired wall-clock {year,month,day,hour,minute} in `tz`,
 * return the UTC instant in ms.
 *
 * Strategy: take the wall-clock as if it were UTC, then ask
 * "what does the tz call that UTC instant?"  The diff between the
 * two is the offset; subtract it.  One iteration is enough for our
 * precision target (drift only at DST transitions).
 */
function utcInstantForWallClock({ year, month, day, hour, minute, tz }) {
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const wall       = wallClockInTz(naiveUtcMs, tz);
  // wall is what `tz` calls `naiveUtcMs`.  We wanted `tz` to call it
  // {year, month, day, hour, minute}.  The delta between the two
  // (in UTC ms) is the tz offset that we need to undo.
  const wallAsUtcMs = Date.UTC(
    wall.year, wall.month - 1, wall.day,
    wall.hour, wall.minute, wall.second || 0, 0,
  );
  const offsetMs = wallAsUtcMs - naiveUtcMs;
  return naiveUtcMs - offsetMs;
}

function addDaysUtc({ year, month, day }, n) {
  const ms = Date.UTC(year, month - 1, day) + n * MS_PER_DAY;
  const d  = new Date(ms);
  return {
    year:  d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day:   d.getUTCDate(),
  };
}
