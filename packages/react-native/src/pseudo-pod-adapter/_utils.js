/**
 * Shared helpers for the RN pseudo-pod-adapter backends.
 *
 * - `encodeKey(key)` produces a path-safe filename for FS backends.
 * - `estimateBytes(value)` computes the rough wire size for the
 *   `createBackend` size-routing decision.
 * - `nextCounterEtag` is a backend-instance-scoped monotonic etag.
 * - `now()` is exported as an injectable clock for tests.
 *
 * Standardisation Phase 51.1 — see plan.
 */

/**
 * Convert any storage key to a single path-safe segment by URI-encoding
 * the slashes plus colons. The original key is recoverable from the
 * filename via `decodeURIComponent`.
 */
export function encodeKey(key) {
  if (typeof key !== 'string') throw new TypeError('encodeKey: key must be a string');
  return encodeURIComponent(key);
}

export function decodeKey(filename) {
  return decodeURIComponent(filename);
}

/**
 * Estimate the wire size of an arbitrary value. Used by createBackend
 * to pick FS vs AS routing per key. The estimate is intentionally
 * cheap — exact byte counts aren't needed.
 */
export function estimateBytes(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'string')                return value.length;        // ≈ bytes for ASCII
  if (value instanceof Uint8Array)              return value.byteLength;
  if (value instanceof ArrayBuffer)             return value.byteLength;
  if (typeof value === 'number' || typeof value === 'boolean') return 8;
  if (typeof value === 'object') {
    try { return JSON.stringify(value).length; } catch { return 0; }
  }
  return 0;
}

/** Make a backend-instance-scoped monotonic etag generator. */
export function makeEtagCounter(prefix = 'rn') {
  let n = 0;
  return () => `"${prefix}-${++n}"`;
}
