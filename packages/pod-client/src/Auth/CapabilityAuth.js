/**
 * CapabilityAuth — token-based pod auth for apps.
 *
 * Wraps a signed `PodCapabilityToken` (issued by a user's agent) and
 * presents it as a bearer credential to outgoing pod requests.
 *
 * @see Design-v3/pod-client-api.md §CapabilityAuth
 *
 * Usage:
 *   const auth = new CapabilityAuth({ token, mode: 'pod-direct' });
 *   const client = new PodClient({ podRoot, auth });
 *
 * The constructor verifies the token's signature + expiry on
 * construction; an invalid or expired token throws synchronously.
 *
 * v1 supports only `mode: 'pod-direct'` — the holder talks straight to
 * the pod with the token in the `Authorization` header.  `'agent-proxy'`
 * (where the holder hands the request off to the issuing agent for
 * proxying) is reserved for a future revision.
 */
import { PodCapabilityToken } from '@canopy/core';

import { Auth }      from './Auth.js';
import { AuthError } from '../Errors.js';

const SUPPORTED_MODES = new Set(['pod-direct']);

export class CapabilityAuth extends Auth {
  /** @type {PodCapabilityToken|null} */
  #token = null;
  /** @type {string|null} — serialized JSON form, used for the Bearer header */
  #serialized = null;
  /** @type {string} */
  #mode;

  /**
   * @param {object} opts
   * @param {string|object|PodCapabilityToken} opts.token
   *   A signed `PodCapabilityToken` — either a `PodCapabilityToken` instance,
   *   a plain JSON object, or a JSON string.
   * @param {'pod-direct'} opts.mode
   *   Auth mode.  v1 supports only `'pod-direct'`.  Anything else
   *   (e.g. `'agent-proxy'`) throws an `AuthError` with code
   *   `AUTH_MODE_NOT_SUPPORTED`.
   */
  constructor({ token, mode } = {}) {
    super();

    if (!SUPPORTED_MODES.has(mode)) {
      throw new AuthError(
        `CapabilityAuth: mode '${String(mode)}' is not supported in v1; ` +
        `supported modes: ${[...SUPPORTED_MODES].join(', ')}`,
        { code: 'AUTH_MODE_NOT_SUPPORTED' },
      );
    }

    if (token == null) {
      throw new AuthError('CapabilityAuth: token is required', { code: 'INVALID_TOKEN' });
    }

    // Parse → PodCapabilityToken instance.
    let parsed;
    try {
      parsed = token instanceof PodCapabilityToken
        ? token
        : PodCapabilityToken.fromJSON(token);
    } catch (cause) {
      throw new AuthError(
        'CapabilityAuth: failed to parse token JSON',
        { code: 'INVALID_TOKEN', cause },
      );
    }

    if (!(parsed instanceof PodCapabilityToken)) {
      throw new AuthError(
        'CapabilityAuth: parsed token is not a PodCapabilityToken instance',
        { code: 'INVALID_TOKEN' },
      );
    }

    // Expiry check first so we report TOKEN_EXPIRED rather than
    // INVALID_TOKEN for a token that's well-formed but stale (verify()
    // returns false for both cases — disambiguate up front).
    if (typeof parsed.expiresAt === 'number' && Date.now() >= parsed.expiresAt) {
      throw new AuthError(
        'CapabilityAuth: token has expired',
        { code: 'TOKEN_EXPIRED' },
      );
    }

    if (!PodCapabilityToken.verify(parsed)) {
      throw new AuthError(
        'CapabilityAuth: token signature verification failed',
        { code: 'INVALID_TOKEN' },
      );
    }

    this.#token      = parsed;
    this.#serialized = parsed.toString();
    this.#mode       = mode;
  }

  /** Auth mode this instance was constructed with. */
  get mode() { return this.#mode; }

  /**
   * Returns headers for outgoing pod requests.  Just `{ Authorization:
   * 'Bearer <serialized-token>' }` in v1 — constraint headers (rate-limit,
   * audit, …) may be added later if/when the convention requires them.
   *
   * Throws `AuthError` (`INVALID_TOKEN`) if the auth has been `close()`d.
   *
   * @param {string} _uri
   * @param {string} _method
   * @returns {Promise<Record<string,string>>}
   */
  // eslint-disable-next-line no-unused-vars
  async getAuthHeaders(_uri, _method) {
    if (!this.#serialized) {
      throw new AuthError(
        'CapabilityAuth: token has been cleared (close() was called)',
        { code: 'INVALID_TOKEN' },
      );
    }
    return { Authorization: `Bearer ${this.#serialized}` };
  }

  /**
   * The token's `subject` — the recipient pubkey this token grants to.
   * Stable for the lifetime of the token; used by `PodClient` for logging
   * and conflict-detection state keying.
   *
   * @returns {string}
   */
  identity() {
    if (!this.#token) {
      throw new AuthError(
        'CapabilityAuth: token has been cleared (close() was called)',
        { code: 'INVALID_TOKEN' },
      );
    }
    return this.#token.subject;
  }

  /**
   * Capability tokens don't refresh — they expire and must be re-issued
   * by the issuing agent.  Throwing here would surprise callers that
   * blindly call `refresh()`, so we resolve to a no-op (parent class
   * default) instead.
   */
  // refresh() inherited from Auth (no-op).

  /**
   * Clear in-memory token references.  Idempotent — safe to call multiple
   * times.  After `close()`, `getAuthHeaders` and `identity` throw.
   */
  async close() {
    this.#token      = null;
    this.#serialized = null;
  }
}
