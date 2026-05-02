/**
 * Storage convention — small/structured = direct; big = reference.
 *
 * Per H6/H7 pass-3 binding: anything ≤ smallThresholdBytes (default
 * 1 MB) goes inline; anything bigger lives at an external URI with a
 * reference manifest in the pod.
 */

export const DEFAULT_SMALL_THRESHOLD_BYTES = 1_000_000;

/**
 * @param {object} args
 * @param {number} [args.size]      bytes of the content; if omitted,
 *                                  we measure from `content`.
 * @param {string|Uint8Array|Buffer} [args.content]   for byte-length
 *                                  measurement when `size` is absent.
 * @param {number} [args.smallThresholdBytes]
 * @returns {'direct'|'reference'}
 */
export function classifyStorage({
  size,
  content,
  smallThresholdBytes = DEFAULT_SMALL_THRESHOLD_BYTES,
} = {}) {
  let resolvedSize = size;
  if (resolvedSize === undefined && content !== undefined) {
    if (typeof content === 'string') resolvedSize = Buffer.byteLength(content, 'utf8');
    else if (content instanceof Uint8Array) resolvedSize = content.byteLength;
    else if (Buffer.isBuffer?.(content)) resolvedSize = content.byteLength;
    else resolvedSize = 0;
  }
  return (resolvedSize ?? 0) <= smallThresholdBytes ? 'direct' : 'reference';
}

/**
 * Build a reference manifest record (for big content stored at an
 * external URI).
 *
 * @param {object} args
 * @param {string} args.uri
 * @param {number} args.size
 * @param {string} [args.contentType]
 * @param {string} [args.hash]      sha256 hex
 * @param {string} [args.aclHint]   pod-relative ACL pointer if applicable
 * @returns {object}
 */
export function buildReferenceManifest({ uri, size, contentType, hash, aclHint }) {
  if (typeof uri !== 'string' || !uri) {
    throw new TypeError('buildReferenceManifest: uri required');
  }
  return {
    kind: 'reference',
    uri,
    size,
    ...(contentType ? { contentType } : {}),
    ...(hash        ? { hash }        : {}),
    ...(aclHint     ? { aclHint }     : {}),
  };
}
