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
 *
 * As of Plan B sub-task B.3 (2026-05-02), the TZ-aware "next fire"
 * math is consumed from @onderling/notifier (L1f).  The substrate
 * gained TZ-aware cadence specifically because household demanded
 * it — first rule-of-two pull on L1f.  This file's `nextFireMsFn`
 * test seam still works (tests can inject deterministic times); the
 * production default uses the substrate helper.
 */

import { nextDailyFireInTz } from '@onderling/notifier';

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
 * Wraps @onderling/notifier's `nextDailyFireInTz` (substrate-level
 * helper, ported from this file's earlier Intl-based implementation).
 * Substrate gained TZ-aware cadence for L1f V0.1 specifically because
 * household demanded it — first rule-of-two pull on L1f.
 *
 * Re-exported here so existing test imports
 * (`from '.../DailyDigest.js'`) keep working.
 *
 * @param {number} nowMs
 * @param {string} tz
 * @param {string} atLocal  'HH:MM'
 * @returns {number}        unix-ms instant of the next fire
 */
export function defaultNextFireMs(nowMs, tz, atLocal) {
  return nextDailyFireInTz(nowMs, tz, atLocal);
}
