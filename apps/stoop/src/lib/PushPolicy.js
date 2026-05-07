/**
 * PushPolicy — wraps a notifier-style send call with Stoop's V1
 * push policy:
 *
 *   - **humanInTheLoop only**: machine-skill matches don't trigger push.
 *   - **≤ N per day per recipient**: default 3.  Beyond cap, requests
 *     are silently suppressed (UI can choose to surface a digest later).
 *   - **Quiet hours**: optional [startHourLocal, endHourLocal) window
 *     during which all sends are suppressed.
 *
 * **Substrate candidate (rule of two — first consumer):** when a
 * second app needs the same conservative-push shape, lift this into
 * `@canopy/notifier` as a `PushPolicyChannel` wrapper, or into a
 * sibling `@canopy/push-policy`.  Tracked in
 * `Project Files/Substrates/substrate-candidates.md`.
 *
 * The class does not depend on `notifier` — callers pass a `send`
 * function (typically `notifier.scheduleOnce` or a direct
 * `pushChannel.sendReply`).  This keeps the wrapper unit-testable
 * with a vanilla mock.
 */

const DEFAULT_MAX_PER_DAY = 3;

export class PushPolicy {
  #send;
  #maxPerDay;
  #quietHours;     // [startHourLocal, endHourLocal) or null
  #now;
  /** Map<recipient, { day: 'YYYY-MM-DD', count: number }> */
  #counters = new Map();

  /**
   * @param {object} args
   * @param {(args: {recipient: string, payload: object}) => Promise<any>} args.send
   * @param {number} [args.maxPerDay=3]
   * @param {[number, number] | null} [args.quietHours=null]   e.g. [22, 7] = 22:00–07:00
   * @param {() => number} [args.now=Date.now]
   */
  constructor({ send, maxPerDay = DEFAULT_MAX_PER_DAY, quietHours = null, now } = {}) {
    if (typeof send !== 'function') throw new TypeError('PushPolicy: send (function) required');
    this.#send       = send;
    this.#maxPerDay  = maxPerDay;
    this.#quietHours = Array.isArray(quietHours) ? quietHours : null;
    this.#now        = now ?? (() => Date.now());
  }

  /**
   * Attempt to push.  Returns `{ sent: bool, reason?: string }`.
   *
   * Reasons (when sent=false):
   *   - 'not-human-in-the-loop'  — payload.humanInTheLoop is falsy
   *   - 'over-cap'               — recipient already at maxPerDay
   *   - 'quiet-hours'            — current hour inside the configured window
   *
   * Successful send: `sent: true`.  Counter is incremented.
   *
   * @param {object} args
   * @param {string} args.recipient
   * @param {{humanInTheLoop?: boolean, [k: string]: any}} args.payload
   */
  async tryPush({ recipient, payload }) {
    if (!payload?.humanInTheLoop) return { sent: false, reason: 'not-human-in-the-loop' };

    if (this.#inQuietHours()) return { sent: false, reason: 'quiet-hours' };

    const today = this.#dayKey();
    const rec   = this.#counters.get(recipient);
    if (rec && rec.day === today && rec.count >= this.#maxPerDay) {
      return { sent: false, reason: 'over-cap' };
    }

    await this.#send({ recipient, payload });

    if (!rec || rec.day !== today) {
      this.#counters.set(recipient, { day: today, count: 1 });
    } else {
      rec.count += 1;
    }
    return { sent: true };
  }

  /** Diagnostic snapshot of per-recipient counters. */
  countersSnapshot() {
    const out = {};
    for (const [k, v] of this.#counters) out[k] = { ...v };
    return out;
  }

  // ── Internals ────────────────────────────────────────────────────────────

  #dayKey() {
    return new Date(this.#now()).toISOString().slice(0, 10);
  }

  #inQuietHours() {
    if (!this.#quietHours) return false;
    const [start, end] = this.#quietHours;
    const h = new Date(this.#now()).getHours();
    if (start === end) return false;
    if (start < end)   return h >= start && h < end;
    // window crosses midnight (e.g. 22..7)
    return h >= start || h < end;
  }
}
