/**
 * Auth — interface bridging "who am I" to outgoing pod requests.
 * @abstract
 *
 * Implementations:
 *   - CapabilityAuth (A5b1) — token-based, for apps
 *   - SolidOidcAuth  (A5b1) — OIDC session, for the user's agent
 *
 * @see Design-v3/pod-client-api.md §Authentication
 *
 * Methods (sub-classes must implement):
 *
 *   getAuthHeaders(uri: string, method: string)
 *     → Promise<Record<string,string>>
 *     Returns headers to attach to outgoing pod requests.  Throws
 *     `AuthError` if the auth state is invalid (expired, etc).
 *
 *   identity()
 *     → string
 *     Returns a stable identity string for this auth context, used for
 *     logging and for keying conflict-detection state.
 *
 * Optional methods (default no-op):
 *
 *   refresh()  → Promise<void>   Refresh the underlying token / session.
 *   close()    → Promise<void>   Explicit teardown.
 */
export class Auth {
  /**
   * @param {string} _uri
   * @param {string} _method
   * @returns {Promise<Record<string,string>>}
   */
  // eslint-disable-next-line no-unused-vars
  async getAuthHeaders(_uri, _method) {
    throw new Error('Auth.getAuthHeaders() not implemented');
  }

  /** @returns {string} */
  identity() {
    throw new Error('Auth.identity() not implemented');
  }

  /** Optional — default no-op. */
  async refresh() {
    /* default no-op */
  }

  /** Optional — default no-op. */
  async close() {
    /* default no-op */
  }
}
