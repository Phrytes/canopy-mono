/**
 * Reachability cache — cheap per-write "is the pod reachable right
 * now?" verdict for the graceful-degradation gate.
 *
 * The cache trusts the most-recent signal within `ttlMs`. Signals
 * come from two sources:
 *   - `pod-client` calls `markPodReachable(uri)` / `markPodUnreachable(uri)`
 *     on success / failure.
 *   - Transport-level connectivity events (optional, future).
 *
 * Default verdict when unknown: **reachable**. We err on the side
 * of trying — a failed write transparently falls back to the
 * replication-ring queue (the universal baseline). The opposite
 * (assume-unreachable) would gratuitously block writes on the
 * happy path.
 *
 * Standardisation Phase 52.3 — see plan §52.3.5.
 */

/**
 * @param {object} [opts]
 * @param {number} [opts.ttlMs=30_000]  — staleness window for cached signals.
 * @param {() => number} [opts.now]     — injectable clock for tests.
 */
export function createReachabilityCache({ ttlMs = 30_000, now = () => Date.now() } = {}) {
  /** @type {Map<string, {lastSuccess: number, lastFailure: number}>} */
  const cache = new Map();

  function _getOrInit(target) {
    let entry = cache.get(target);
    if (!entry) {
      entry = { lastSuccess: 0, lastFailure: 0 };
      cache.set(target, entry);
    }
    return entry;
  }

  function _key(target) {
    if (typeof target !== 'string' || target.length === 0) return null;
    // pseudo-pod:// URIs are always locally reachable; we still
    // record a key so introspection works.
    return target;
  }

  function isReachable(target) {
    const key = _key(target);
    if (key === null) return false;
    if (key.startsWith('pseudo-pod://')) return true;
    const entry = cache.get(key);
    if (!entry) return true;   // unknown → default trust
    const t = now();
    const freshSuccess = entry.lastSuccess > 0 && t - entry.lastSuccess <= ttlMs;
    const freshFailure = entry.lastFailure > 0 && t - entry.lastFailure <= ttlMs;
    if (freshFailure && !freshSuccess)  return false;
    if (freshSuccess) return true;
    // both stale → re-trust (assume things might have come back).
    return true;
  }

  function markReachable(target) {
    const key = _key(target);
    if (key === null) return;
    _getOrInit(key).lastSuccess = now();
  }

  function markUnreachable(target) {
    const key = _key(target);
    if (key === null) return;
    _getOrInit(key).lastFailure = now();
  }

  function clear(target) {
    if (target === undefined) cache.clear();
    else cache.delete(target);
  }

  function snapshot() {
    const out = {};
    for (const [k, v] of cache) out[k] = { ...v };
    return out;
  }

  return {
    isReachable,
    markReachable,
    markUnreachable,
    clear,
    snapshot,
    get ttlMs() { return ttlMs; },
  };
}
