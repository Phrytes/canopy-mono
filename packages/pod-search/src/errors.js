/**
 * Coded errors for the vector layer.
 *
 * Per `conventions/localisation.md` the substrate raises **codes**, not
 * user-facing strings; the UI maps a code → a localised message.
 */

/** @typedef {'E_SEMANTIC_UNAVAILABLE'|'E_INDEX_MODEL_MISMATCH'|'E_EMBED_PROVIDER'} PodSearchErrorCode */

/**
 * @param {PodSearchErrorCode} code
 * @param {string} [message]
 * @returns {Error & { code: string }}
 */
export function codedError(code, message) {
  const err = new Error(message ?? code);
  err.code = code;
  return err;
}
