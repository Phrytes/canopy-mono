/**
 * Reference manifest — the JSON document we write to a Solid pod when
 * `writeWithConvention` decides the content is too big to inline.
 *
 * Wire shape (per `Design-v3/pod-client-api.md` §writeWithConvention):
 *
 *   {
 *     "$type": "external-reference",
 *     "uri":         "<external-store URI, e.g. s3://bucket/key>",
 *     "contentType": "<MIME type of the referenced blob>",
 *     "size":        <number of bytes>,
 *     "hash":        "sha256:<lowercase hex>"
 *   }
 *
 * Errors thrown by `parseReferenceManifest` are plain `Error` instances with
 * `.code = 'INVALID_MANIFEST'`.  Track A5 maps these onto `ConventionError`.
 */
import { createHash } from 'node:crypto';

/* ─────────────────────────────────────────────────────────────────────────── */

const MANIFEST_TYPE = 'external-reference';
const HASH_RE = /^sha256:[0-9a-f]{64}$/;

/**
 * Hash arbitrary content with SHA-256.  Output is lowercase hex prefixed with
 * `sha256:`, matching the on-wire format.
 *
 * @param {string|Uint8Array|Buffer|ArrayBuffer} content
 * @returns {string}
 */
export function hashContent(content) {
  const h = createHash('sha256');
  if (typeof content === 'string') {
    h.update(content, 'utf8');
  } else if (content instanceof Uint8Array) {
    h.update(content);
  } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(content)) {
    h.update(content);
  } else if (content instanceof ArrayBuffer) {
    h.update(new Uint8Array(content));
  } else {
    throw manifestError('hashContent: unsupported content type');
  }
  return `sha256:${h.digest('hex')}`;
}

/**
 * Serialize a manifest object to a canonical JSON string.
 *
 * Field order is fixed for determinism so two equivalent manifests produce
 * byte-identical strings (useful when the manifest itself is hashed by
 * upper layers).
 *
 * @param {object} obj
 * @returns {string}
 */
export function serializeReferenceManifest(obj) {
  const m = validate(obj);
  const ordered = {
    $type:       MANIFEST_TYPE,
    uri:         m.uri,
    contentType: m.contentType,
    size:        m.size,
    hash:        m.hash,
  };
  return JSON.stringify(ordered);
}

/**
 * Parse a string (or string-like content) into a manifest object.
 *
 * Returns `null` if the content is plainly NOT a manifest — i.e. valid JSON
 * but missing `$type === 'external-reference'`, or non-JSON entirely.
 * Throws `INVALID_MANIFEST` if the content claims to be an
 * `external-reference` but the shape is broken.
 *
 * Accepts `string`, `Uint8Array`, or `Buffer`.  Anything else returns `null`.
 *
 * @param {string|Uint8Array|Buffer} content
 * @returns {object|null}
 */
export function parseReferenceManifest(content) {
  const text = toText(content);
  if (text === null) return null;

  // Cheap pre-check: if it doesn't even mention the marker, skip JSON parse.
  if (!text.includes('"external-reference"')) {
    // Try a light JSON parse anyway so we don't miss whitespace/Unicode-escaped
    // markers — but if JSON itself fails or the type doesn't match, it's
    // simply "not a manifest".
    let probe;
    try { probe = JSON.parse(text); } catch { return null; }
    if (!probe || typeof probe !== 'object' || probe.$type !== MANIFEST_TYPE) return null;
    // Falls through to validation below if it does match.
    return validate(probe);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;   // non-JSON — not a manifest
  }
  if (!parsed || typeof parsed !== 'object' || parsed.$type !== MANIFEST_TYPE) {
    return null;
  }
  return validate(parsed);
}

/**
 * Quick predicate: does this content look like a reference manifest?
 *
 * Returns false for malformed manifests (use `parseReferenceManifest` to
 * surface those as errors).  Useful as a routing decision in
 * `readWithConvention`.
 *
 * @param {string|Uint8Array|Buffer} content
 * @returns {boolean}
 */
export function isReferenceManifest(content) {
  const text = toText(content);
  if (text === null) return false;
  if (!text.includes('"external-reference"')) return false;
  let parsed;
  try { parsed = JSON.parse(text); } catch { return false; }
  if (!parsed || typeof parsed !== 'object' || parsed.$type !== MANIFEST_TYPE) return false;
  // Don't throw here — caller asks "is it?", not "is it valid?".
  try {
    validate(parsed);
    return true;
  } catch {
    return false;
  }
}

/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * Validate a candidate manifest object.  Throws on failure with
 * `code = 'INVALID_MANIFEST'`.  Returns the same object on success (sliced to
 * just the documented fields) so callers can treat it as a normalized form.
 */
function validate(obj) {
  if (!obj || typeof obj !== 'object') {
    throw manifestError('reference manifest must be an object');
  }
  if (obj.$type !== MANIFEST_TYPE) {
    throw manifestError(`reference manifest: $type must be '${MANIFEST_TYPE}', got '${obj.$type}'`);
  }
  if (typeof obj.uri !== 'string' || obj.uri.length === 0) {
    throw manifestError('reference manifest: uri must be a non-empty string');
  }
  if (typeof obj.contentType !== 'string' || obj.contentType.length === 0) {
    throw manifestError('reference manifest: contentType must be a non-empty string');
  }
  if (typeof obj.size !== 'number' || !Number.isFinite(obj.size) || obj.size < 0) {
    throw manifestError('reference manifest: size must be a non-negative finite number');
  }
  if (typeof obj.hash !== 'string' || !HASH_RE.test(obj.hash)) {
    throw manifestError(`reference manifest: hash must match ${HASH_RE} (got '${obj.hash}')`);
  }
  return {
    $type:       MANIFEST_TYPE,
    uri:         obj.uri,
    contentType: obj.contentType,
    size:        obj.size,
    hash:        obj.hash,
  };
}

function manifestError(message) {
  const err = new Error(message);
  err.code = 'INVALID_MANIFEST';
  return err;
}

/**
 * Coerce input to a string.  Returns null if the input is something we can't
 * sensibly stringify here (e.g. an object — that's not a manifest payload,
 * that's a plain object the caller meant to pass as JSON).
 */
function toText(content) {
  if (typeof content === 'string') return content;
  if (content instanceof Uint8Array) {
    try { return new TextDecoder('utf-8', { fatal: false }).decode(content); }
    catch { return null; }
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(content)) {
    return content.toString('utf8');
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────────────────── */

export const REFERENCE_MANIFEST_TYPE = MANIFEST_TYPE;
export const REFERENCE_MANIFEST_HASH_PATTERN = HASH_RE;
