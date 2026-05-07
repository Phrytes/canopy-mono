/**
 * compose — pure helpers for PostComposeScreen (validation, max-N
 * attachments, default kind).
 */

export const MAX_ATTACHMENTS = 4;
export const MIN_BODY_LEN    = 1;
export const MAX_BODY_LEN    = 2000;
export const VALID_KINDS     = Object.freeze(['vraag', 'aanbod']);

/**
 * Validate a compose-form draft.
 *
 * @param {object} draft
 * @param {string} draft.text
 * @param {string} draft.kind
 * @param {Array<object>} [draft.attachments]
 * @returns {{ ok: true } | { ok: false, reason: 'no_text'|'too_long'|'bad_kind'|'too_many_attachments' }}
 */
export function validateDraft(draft) {
  if (!draft || typeof draft !== 'object') return { ok: false, reason: 'no_text' };
  const text = (draft.text ?? '').trim();
  if (text.length < MIN_BODY_LEN) return { ok: false, reason: 'no_text' };
  if (text.length > MAX_BODY_LEN) return { ok: false, reason: 'too_long' };
  if (!VALID_KINDS.includes(draft.kind)) return { ok: false, reason: 'bad_kind' };
  const atts = Array.isArray(draft.attachments) ? draft.attachments : [];
  if (atts.length > MAX_ATTACHMENTS) return { ok: false, reason: 'too_many_attachments' };
  return { ok: true };
}

/**
 * Compute remaining-character allowance, clamped to >= 0.
 */
export function remainingChars(text) {
  const t = typeof text === 'string' ? text : '';
  return Math.max(0, MAX_BODY_LEN - t.length);
}

/**
 * Drop the first `n` attachments from a list (used by the "remove"
 * button on the thumb strip).  Returns a new array.
 */
export function removeAttachmentAt(arr, idx) {
  if (!Array.isArray(arr)) return [];
  if (idx < 0 || idx >= arr.length) return arr.slice();
  return arr.slice(0, idx).concat(arr.slice(idx + 1));
}

/**
 * Cap the attachment list at MAX_ATTACHMENTS, dropping from the end.
 */
export function capAttachments(arr) {
  if (!Array.isArray(arr)) return [];
  if (arr.length <= MAX_ATTACHMENTS) return arr.slice();
  return arr.slice(0, MAX_ATTACHMENTS);
}
