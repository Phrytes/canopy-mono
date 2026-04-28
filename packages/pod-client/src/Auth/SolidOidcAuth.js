/**
 * SolidOidcAuth — OIDC-session-based pod auth for the user's agent.
 *
 * Wraps a SolidVault that holds the agent's OIDC session.  Exposes the
 * vault's session-bound fetch so PodClient can construct a SolidPodSource
 * with authenticated requests.
 *
 * @see Design-v3/pod-client-api.md §SolidOidcAuth
 *
 * Note: `getAuthHeaders()` throws — Solid OIDC requires a session-bound
 * fetch (DPoP-style proofs change per request), not static headers.
 * PodClient uses `getAuthenticatedFetch()` instead.
 */
import { Auth }      from './Auth.js';
import { AuthError } from '../Errors.js';

export class SolidOidcAuth extends Auth {
  /** @type {object} — wrapped SolidVault instance */
  #vault;
  /** @type {boolean} */
  #closed = false;

  /**
   * @param {object} opts
   * @param {object} opts.vault
   *   A `SolidVault` instance (or anything implementing the same surface).
   *   Must expose `getAuthenticatedFetch()`.  May also expose `webid`,
   *   `refresh()`, and `logout()` — those are wired through when present.
   */
  constructor({ vault } = {}) {
    super();

    if (!vault) {
      throw new AuthError(
        'SolidOidcAuth: vault is required',
        { code: 'INVALID_AUTH_ARGS' },
      );
    }
    if (typeof vault.getAuthenticatedFetch !== 'function') {
      throw new AuthError(
        'SolidOidcAuth: vault must expose getAuthenticatedFetch()',
        { code: 'INVALID_AUTH_ARGS' },
      );
    }

    this.#vault = vault;
  }

  /**
   * Returns the session-bound fetch from the wrapped vault.  PodClient
   * uses this to construct a `SolidPodSource` with authenticated requests.
   *
   * Throws `AuthError` (`AUTH_CLOSED`) if the auth has been `close()`d.
   *
   * @returns {typeof fetch}
   */
  getAuthenticatedFetch() {
    if (this.#closed) {
      throw new AuthError(
        'SolidOidcAuth: closed',
        { code: 'AUTH_CLOSED' },
      );
    }
    return this.#vault.getAuthenticatedFetch();
  }

  /**
   * Solid OIDC requires session-bound (DPoP) fetches — static headers
   * aren't enough.  Callers should use `getAuthenticatedFetch()` instead.
   *
   * @param {string} _uri
   * @param {string} _method
   * @returns {Promise<Record<string,string>>}
   */
  // eslint-disable-next-line no-unused-vars
  async getAuthHeaders(_uri, _method) {
    throw new AuthError(
      'SolidOidcAuth.getAuthHeaders() is not supported. ' +
      'Use getAuthenticatedFetch() to obtain a session-bound fetch instead.',
      { code: 'AUTH_USE_AUTHENTICATED_FETCH' },
    );
  }

  /**
   * The WebID identifying the underlying OIDC session.  Stable for the
   * vault's lifetime.  Used for logging and conflict-detection state keying.
   *
   * `SolidVault` exposes its WebID via the `webid` getter (string).  We
   * also tolerate a few alternative shapes for non-`SolidVault` adapters
   * that conform to the same auth contract (e.g. tests using a stub).
   *
   * @returns {string}
   */
  identity() {
    if (this.#closed) {
      throw new AuthError(
        'SolidOidcAuth: closed',
        { code: 'AUTH_CLOSED' },
      );
    }
    if (typeof this.#vault.webid === 'string')           return this.#vault.webid;
    if (typeof this.#vault.getWebId === 'function')      return this.#vault.getWebId();
    if (typeof this.#vault.identity === 'function')      return this.#vault.identity();
    throw new AuthError(
      'SolidOidcAuth: vault does not expose a WebID',
      { code: 'INVALID_AUTH_ARGS' },
    );
  }

  /**
   * Refresh the underlying OIDC session.  No-op if the wrapped vault
   * doesn't expose `refresh()` (e.g. a stub or a different adapter).
   */
  async refresh() {
    if (this.#closed) return;
    if (typeof this.#vault.refresh === 'function') {
      await this.#vault.refresh();
    }
  }

  /**
   * Idempotent close — logs out the underlying vault.  After `close()`,
   * `getAuthenticatedFetch` and `identity` throw `AUTH_CLOSED`.
   *
   * Logout failures are swallowed: close is best-effort, and we don't
   * want a network blip during shutdown to leave state in limbo.
   */
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    if (typeof this.#vault.logout === 'function') {
      try { await this.#vault.logout(); } catch { /* swallow — close is best-effort */ }
    }
  }
}
