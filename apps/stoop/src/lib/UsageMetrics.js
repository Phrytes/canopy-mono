/**
 * UsageMetrics — local, in-memory counter for the V1 push-UX
 * feedback loop (per `Project Files/Stoop/advice-2026-05-05.md` §
 * "Engineering practice — feedback loop").
 *
 * Records per-event counts and the timestamp of the most recent
 * occurrence.  No persistence — apps that want metrics across
 * restarts can snapshot to the pod on a foreground-poll cadence
 * (V1.5).
 *
 * Apps interact via three methods only:
 *   - `record(name)`        — increment a counter, stamp lastAt.
 *   - `snapshot()`          — read-only POJO of all counters.
 *   - `reset(name?)`        — drop one counter or all.
 *
 * This is intentionally trivial — the *value* is the discipline
 * of recording, not the sophistication of the counter.
 */

export class UsageMetrics {
  /** @type {Map<string, { count: number, lastAt: number }>} */
  #counters = new Map();
  #now;

  /**
   * @param {object} [opts]
   * @param {() => number} [opts.now=Date.now]
   */
  constructor({ now } = {}) {
    this.#now = now ?? (() => Date.now());
  }

  /** Increment the named counter. */
  record(name) {
    if (typeof name !== 'string' || !name) throw new TypeError('record: name required');
    const cur = this.#counters.get(name);
    if (!cur) this.#counters.set(name, { count: 1, lastAt: this.#now() });
    else      { cur.count += 1; cur.lastAt = this.#now(); }
  }

  /** Read-only POJO of all counters. */
  snapshot() {
    const out = {};
    for (const [k, v] of this.#counters) out[k] = { ...v };
    return out;
  }

  /** Drop one counter (when name is supplied) or all. */
  reset(name) {
    if (name === undefined) this.#counters.clear();
    else this.#counters.delete(name);
  }
}
