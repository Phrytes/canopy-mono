/**
 * MockClock — per-agent clock-skew helper (Q-Test.3 v1 scope).
 *
 * Each instance carries an offset that scenarios can apply.  The harness's
 * `Lab.injectClockSkew(agentName, offsetMs)` looks up the agent's MockClock
 * and sets the offset.
 *
 * NOTE — known v1 limitation:
 *
 *   The SDK currently reads the wall clock via raw `Date.now()` /
 *   `new Date()` in many places (SecurityLayer replay-window check,
 *   IdentitySync expiry checks, oracle gossip, capability-token expiry,
 *   etc.).  A truly per-agent clock injection would require either
 *
 *     (a) a code-base-wide refactor to inject a clock primitive through
 *         AgentConfig and into every module that timestamps an envelope
 *         or checks expiry, OR
 *
 *     (b) `vi.setSystemTime()` — but that overrides time GLOBALLY for
 *         the whole process, not per-agent, so cross-agent skew can't
 *         be modelled.
 *
 *   For T.1 we ship MockClock as a standalone primitive: scenarios that
 *   want clock-skew read time via `clock.now()` and pass it to the SDK
 *   surfaces that accept an explicit `now` argument (e.g. some token
 *   verification helpers do — see code).  Scenarios that need the SDK
 *   to *internally* honour a per-agent offset are a v2 task ("clock-
 *   injection in core") — that work threads an injectable clock through
 *   SecurityLayer + IdentitySync + TokenRegistry + GossipProtocol.
 *
 *   See `coding-plans/sdk-test-implementation.md` §T.1 §Notes for the
 *   gap log; see §T.6 / a future planned task for the SDK-side wiring.
 */
export class MockClock {
  #offsetMs = 0;

  /**
   * @param {number} [initialOffsetMs=0]
   */
  constructor(initialOffsetMs = 0) {
    this.#offsetMs = initialOffsetMs;
  }

  /** Set the offset applied to `now()`. */
  setOffset(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) {
      throw new Error('MockClock.setOffset: ms must be a finite number');
    }
    this.#offsetMs = ms;
  }

  /** Current offset in ms (signed: positive = future, negative = past). */
  get offset() {
    return this.#offsetMs;
  }

  /** `Date.now()` shifted by the current offset. */
  now() {
    return Date.now() + this.#offsetMs;
  }

  /** A `Date` instance pinned to `now()`. */
  date() {
    return new Date(this.now());
  }
}
