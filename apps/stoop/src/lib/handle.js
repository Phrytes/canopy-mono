/**
 * Handle validation — pure, no I/O.
 *
 * Stoop V1 (Phase 6) handle rules:
 *   - lowercase a–z, digits 0–9, `-` (hyphen) and `_` (underscore) only
 *   - 3 to 32 chars
 *   - no leading `@` (the UI prepends `@` when rendering)
 *   - no spaces
 *
 * Apps render handles as `@<handle>` in lists; the storage form is
 * unprefixed.  Strip a leading `@` before validating so users who type
 * `@anne-23` get a friendly normalisation rather than a hard error.
 */

const MIN_LEN = 3;
const MAX_LEN = 32;
const HANDLE_RE = /^[a-z0-9_-]+$/;

/**
 * @param {string} input  user-entered handle (raw)
 * @returns {{ ok: true, handle: string } | { ok: false, reason: string }}
 *   On success returns the normalised (lowercased, leading-`@`-stripped)
 *   handle. On failure returns a machine-readable reason code that apps
 *   can map to localised copy.
 */
export function validateHandle(input) {
  if (typeof input !== 'string') return { ok: false, reason: 'not-a-string' };
  // Friendly normalisation: strip leading `@`, lowercase.
  let h = input.trim();
  if (h.startsWith('@')) h = h.slice(1);
  h = h.toLowerCase();

  if (h.length < MIN_LEN) return { ok: false, reason: 'too-short' };
  if (h.length > MAX_LEN) return { ok: false, reason: 'too-long' };
  if (/\s/.test(h))       return { ok: false, reason: 'contains-whitespace' };
  if (!HANDLE_RE.test(h)) return { ok: false, reason: 'invalid-chars' };

  return { ok: true, handle: h };
}

/** Constants exported for UI form-validation hints + localisation. */
export const HANDLE_RULES = Object.freeze({
  minLen: MIN_LEN,
  maxLen: MAX_LEN,
  pattern: HANDLE_RE.source,
});
