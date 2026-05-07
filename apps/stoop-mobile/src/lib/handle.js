/**
 * handle — pure helpers for Stoop user-handle validation.
 *
 * Stoop's handle rule (from `apps/stoop/src/lib/handle.js`):
 *   - Lowercase ASCII letters, digits, hyphen, underscore.
 *   - 3 to 32 characters.
 *   - Must not start or end with a separator.
 *
 * Mobile re-implements the validator client-side so the
 * ProfileMineScreen can flag a bad handle before the SDK round-trip.
 * The SDK is the authoritative gate; this is the friendly gate.
 */

const MIN_LEN = 3;
const MAX_LEN = 32;

const HANDLE_RE = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;

/**
 * @param {string} h
 * @returns {{ ok: true } | { ok: false, reason: 'empty'|'too_short'|'too_long'|'bad_chars' }}
 */
export function validateHandle(h) {
  if (typeof h !== 'string' || h.length === 0) return { ok: false, reason: 'empty' };
  if (h.length < MIN_LEN) return { ok: false, reason: 'too_short' };
  if (h.length > MAX_LEN) return { ok: false, reason: 'too_long' };
  if (!HANDLE_RE.test(h))  return { ok: false, reason: 'bad_chars' };
  return { ok: true };
}

/**
 * Make a string handle-shaped (lowercase, drop disallowed chars).
 * Used as a "tidy" pass before validating; doesn't pad or truncate
 * to the length range.
 */
export function normaliseHandle(h) {
  if (typeof h !== 'string') return '';
  return h.toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

export const HANDLE_LIMITS = Object.freeze({ minLen: MIN_LEN, maxLen: MAX_LEN });
