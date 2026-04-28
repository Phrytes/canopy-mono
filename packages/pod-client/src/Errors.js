/**
 * @canopy/pod-client — Errors taxonomy.
 *
 * Every error thrown by `PodClient` (and its convention helpers) extends
 * `PodClientError`, which itself extends `Error`.  The taxonomy below is
 * the public contract — see `Design-v3/pod-client-api.md` §Error model.
 *
 * `mapSourceCode(code, { uri, cause })` translates raw `.code` strings
 * thrown by `@canopy/core`'s storage layer (`SolidPodSource`,
 * `PodStorageConvention`, `reference-manifest`, external stores) into the
 * appropriate typed subclass.  Unknown codes fall back to the base
 * `PodClientError` with the raw code preserved.
 */

/**
 * Base class for every error thrown by `@canopy/pod-client`.
 *
 * @property {string}  code        — short machine-readable code (e.g. `'NOT_FOUND'`)
 * @property {string=} uri         — pod URI the error pertains to (when known)
 * @property {Error=}  cause       — underlying error (chain), if any
 * @property {boolean} retryable   — whether retrying the same op may succeed
 */
export class PodClientError extends Error {
  constructor(message, { code, uri, cause, retryable = false } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    if (uri) this.uri = uri;
    if (cause) this.cause = cause;
    this.retryable = retryable;
  }
}

/** Token invalid, expired, refresh failed. */
export class AuthError extends PodClientError {
  constructor(message, opts = {}) {
    super(message, { code: 'UNAUTHORIZED', ...opts });
  }
}

/** Token authentic but doesn't grant the requested operation. */
export class CapabilityError extends PodClientError {
  constructor(message, opts = {}) {
    super(message, { code: 'FORBIDDEN', ...opts });
  }
}

/** Resource doesn't exist. */
export class NotFoundError extends PodClientError {
  constructor(message, opts = {}) {
    super(message, { code: 'NOT_FOUND', ...opts });
  }
}

/** Write collision (HTTP 409 / 412), or append/patch retry budget exhausted. */
export class ConflictError extends PodClientError {
  constructor(message, opts = {}) {
    super(message, { code: 'CONFLICT', ...opts });
  }
}

/** Pod unreachable, timeout, DNS fail, 5xx, generic HTTP error.  Retryable by default. */
export class NetworkError extends PodClientError {
  constructor(message, opts = {}) {
    super(message, { code: 'NETWORK_ERROR', retryable: true, ...opts });
  }
}

/** Server-side policy denied (e.g. quota exceeded, rate-limited). */
export class PolicyError extends PodClientError {
  constructor(message, opts = {}) {
    super(message, { code: 'RATE_LIMITED', ...opts });
  }
}

/** Resource exists but parse failed (bad JSON, RDF parse error, etc.). */
export class MalformedResourceError extends PodClientError {
  constructor(message, opts = {}) {
    super(message, { code: 'MALFORMED_RESOURCE', ...opts });
  }
}

/** Encryption / decryption failed in the convention helpers. */
export class EncryptionError extends PodClientError {
  constructor(message, opts = {}) {
    super(message, { code: 'ENCRYPTION_FAILED', ...opts });
  }
}

/**
 * Reference-manifest parse failed, hash mismatch, external store unreachable,
 * external store not configured, etc.  Mirrors A3's convention codes.
 */
export class ConventionError extends PodClientError {
  constructor(message, opts = {}) {
    super(message, { code: 'CONVENTION_ERROR', ...opts });
  }
}

/* -------------------------------------------------------------------------- */

/**
 * Map a raw `.code` string (as thrown by `@canopy/core`'s storage layer)
 * to the appropriate `PodClientError` subclass.
 *
 * Returns a fully-constructed error instance — callers can `throw` it
 * directly.
 *
 * Unknown codes fall through to a base `PodClientError`, preserving the
 * raw code so callers retain forensic info.
 *
 * @param {string} code
 * @param {{ uri?: string, cause?: Error, message?: string }} [opts]
 * @returns {PodClientError}
 */
export function mapSourceCode(code, { uri, cause, message } = {}) {
  const msg = message || `pod operation failed: ${code}`;
  switch (code) {
    case 'NOT_FOUND':
      return new NotFoundError(msg, { uri, cause });
    case 'UNAUTHORIZED':
      return new AuthError(msg, { uri, cause });
    case 'FORBIDDEN':
      return new CapabilityError(msg, { uri, cause });
    case 'CONFLICT':
      // covers HTTP 409 + 412
      return new ConflictError(msg, { uri, cause });
    case 'RATE_LIMITED':
      return new PolicyError(msg, { uri, cause });
    case 'SERVER_ERROR':
    case 'HTTP_ERROR':
    case 'NETWORK_ERROR':
      return new NetworkError(msg, { uri, cause });
    case 'INVALID_ARGUMENT':
      return new PodClientError(msg, { code, uri, cause, retryable: false });
    // A3 convention codes
    case 'HASH_MISMATCH':
    case 'INVALID_MANIFEST':
    case 'EXTERNAL_STORE_NOT_CONFIGURED':
    case 'EXTERNAL_STORE_BAD_RESPONSE':
      return new ConventionError(msg, { code, uri, cause });
    default:
      // Preserve raw code on unrecognized inputs.
      return new PodClientError(msg, { code, uri, cause, retryable: false });
  }
}
