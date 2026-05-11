/**
 * Process-lifetime cache for `check()` results.
 *
 * `check()` runs a native `PackageManager.queryIntentServices` query
 * — cheap but not free. Apps call `check()` on every launch + on
 * every "should I prefer Hub or in-process?" decision; caching the
 * result for the lifetime of the process keeps the call cheap.
 *
 * `watch()` fires `invalidate()` automatically when the install
 * state changes mid-session.
 *
 * Standardisation Phase 51.6.4.
 */

/**
 * @returns {{
 *   getCached: () => object | null,
 *   setCached: (value: object) => void,
 *   invalidate: () => void,
 * }}
 */
export function createDiscoveryCache() {
  /** @type {object | null} */
  let cached = null;

  return {
    getCached() { return cached; },
    setCached(value) { cached = value; },
    invalidate()     { cached = null; },
  };
}
