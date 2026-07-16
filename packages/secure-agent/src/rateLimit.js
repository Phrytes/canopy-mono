/**
 * @onderling/secure-agent — per-peer rate limiter (token bucket).
 *
 * Wires A+.8 from the v0.7 security roadmap.  Drops inbound envelopes
 * from peers that exceed their per-peer quota.
 *
 * # Algorithm
 *
 * Classic token bucket.  Each peer starts with `burst` tokens.
 * Every received envelope consumes one token.  Tokens refill at
 * `refillPerSec` per second up to `burst` cap.  When the bucket
 * is empty, further envelopes are dropped (return false from check).
 *
 * The same algorithm applies to a global "anything from any peer"
 * limit, configured via opts.global.
 *
 * # Limits
 *
 * - Per-peer protects against ONE noisy/malicious peer
 * - Global protects against MANY peers each individually under limit
 *   colluding to flood
 *
 * # Why opt-in?
 *
 * Defaults are tuned for chat-pace traffic.  Apps that legitimately
 * burst (file transfer, real-time game) must either disable or pass
 * tuned values.
 *
 * Layer: substrate.  Platform-neutral.
 */

export const RATE_LIMIT_DEFAULTS = Object.freeze({
  perPeer: { burst: 30, refillPerSec: 5 },
  global:  { burst: 200, refillPerSec: 50 },
});

/**
 * Build a RateLimiter.  Pass `false` for either bucket to disable that layer.
 *
 * @param {object} [opts]
 * @param {{burst:number, refillPerSec:number}|false} [opts.perPeer]
 * @param {{burst:number, refillPerSec:number}|false} [opts.global]
 * @param {() => number} [opts.now]   clock fn (tests)
 * @returns {RateLimiter}
 */
export function createRateLimiter(opts = {}) {
  return new RateLimiter(opts);
}

export class RateLimiter {
  #perPeer;
  #global;
  #now;
  #buckets = new Map();   // addr → { tokens, last }
  #globalBucket;          // { tokens, last } | null

  constructor({
    perPeer = RATE_LIMIT_DEFAULTS.perPeer,
    global  = RATE_LIMIT_DEFAULTS.global,
    now     = () => Date.now(),
  } = {}) {
    this.#perPeer = perPeer === false ? null : { ...perPeer };
    this.#global  = global  === false ? null : { ...global };
    this.#now     = now;
    if (this.#global) {
      this.#globalBucket = { tokens: this.#global.burst, last: this.#now() };
    }
  }

  /**
   * Try to consume 1 token for `peerAddr`.  Returns true when allowed,
   * false when rate-limited (caller should drop the envelope).
   *
   * @param {string} peerAddr
   * @returns {boolean}
   */
  check(peerAddr) {
    const t = this.#now();
    // Global bucket first — fails fast if total rate is exceeded.
    if (this.#global && this.#globalBucket) {
      this.#refill(this.#globalBucket, this.#global, t);
      if (this.#globalBucket.tokens < 1) return false;
    }
    let perPeerOK = true;
    if (this.#perPeer) {
      let b = this.#buckets.get(peerAddr);
      if (!b) {
        b = { tokens: this.#perPeer.burst, last: t };
        this.#buckets.set(peerAddr, b);
      }
      this.#refill(b, this.#perPeer, t);
      if (b.tokens < 1) {
        perPeerOK = false;
      } else {
        b.tokens -= 1;
      }
    }
    if (!perPeerOK) return false;
    if (this.#global && this.#globalBucket) this.#globalBucket.tokens -= 1;
    return true;
  }

  /** Diagnostic snapshot of the per-peer + global state. */
  snapshot() {
    const peers = {};
    for (const [addr, b] of this.#buckets) {
      peers[addr] = { tokens: Math.floor(b.tokens) };
    }
    return {
      peers,
      perPeerConfig: this.#perPeer,
      global: this.#global
        ? { tokens: Math.floor(this.#globalBucket?.tokens ?? 0), config: this.#global }
        : null,
    };
  }

  /** Forget a peer's bucket (e.g. on disconnect). */
  forget(peerAddr) { this.#buckets.delete(peerAddr); }

  #refill(bucket, cfg, now) {
    const dtSec = Math.max(0, (now - bucket.last) / 1000);
    const add   = dtSec * cfg.refillPerSec;
    bucket.tokens = Math.min(cfg.burst, bucket.tokens + add);
    bucket.last   = now;
  }
}
