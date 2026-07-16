/**
 * OAuthVault — typed OAuth-token storage on top of any Vault adapter.
 *
 * Locked Q-F.1 (2026-04-29): multi-account support via
 *     oauth:<service>:<accountId>
 * key scheme.  Single-account users get a 'default' accountId fallback so
 * `getTokens('google')` works without specifying when only one account is
 * configured for that service.
 *
 * Locked Q-F.2 (2026-04-29):
 *   - Proactive: refresh when access token is within 60s of expiry.
 *   - Reactive: if a 401 surfaces despite the proactive path (clock skew,
 *     server-side revocation, refresh-token rotation mid-flight), call
 *     refresh + retry once.  Coalesce concurrent refreshes via an
 *     in-flight promise per (service, accountId).
 *
 * Mirrors the in-flight-refresh-promise + near-expiry-leeway pattern used
 * by SolidVault (`#refreshing`, `REFRESH_LEEWAY_MS`) so the codebase stays
 * consistent.
 *
 * @see Track-F coding-plan §F1
 */

const NAMESPACE         = 'oauth';
const DEFAULT_ACCOUNT   = 'default';
const REFRESH_BUFFER_MS = 60_000;   // 60s

/**
 * @typedef {object} TokenBundle
 * @property {string}   access      Access token (Bearer).
 * @property {string}   [refresh]   Refresh token (some flows omit it).
 * @property {number}   [expiresAt] Unix-ms expiry of the access token.
 * @property {string[]} [scopes]    OAuth scopes granted.
 * @property {string}   [idToken]   OIDC id-token, if present.
 */

/**
 * @typedef {(refreshToken: string, scopes?: string[]) => Promise<TokenBundle>} RefreshFn
 */

/**
 * Typed OAuth-token storage on top of any Vault adapter, keyed `oauth:<service>:<accountId>` with
 * a `'default'` accountId fallback for single-account use. `getTokens` proactively refreshes when
 * the access token is within 60s of expiry (via the per-service `RefreshFn` registered with
 * `registerRefreshFn`); concurrent refreshes for the same (service, accountId) share one
 * in-flight promise. `refreshTokens` forces a refresh for the reactive 401-fallback path.
 */
export class OAuthVault {
  /** @type {import('./Vault.js').Vault} */
  #vault;
  /** @type {Map<string, RefreshFn>} */
  #refreshFns = new Map();
  /** @type {Map<string, Promise<TokenBundle>>} */
  #inFlightRefresh = new Map();

  constructor({ vault } = {}) {
    if (!vault) throw new Error('OAuthVault: { vault } is required');
    this.#vault = vault;
  }

  // ── Refresh-fn registry ───────────────────────────────────────────────────

  /**
   * Register the refresh implementation for a service.  Apps call this once
   * at startup per service they intend to use.
   *
   * @param {string}    service
   * @param {RefreshFn} refreshFn
   */
  registerRefreshFn(service, refreshFn) {
    if (typeof refreshFn !== 'function') {
      throw new Error(`OAuthVault: refreshFn for "${service}" must be a function`);
    }
    this.#refreshFns.set(service, refreshFn);
  }

  // ── Storage ───────────────────────────────────────────────────────────────

  /**
   * Persist a token bundle for the given (service, accountId).  Pass
   * `accountId = null` (or omit) to use the `'default'` fallback.
   *
   * @param {string}      service
   * @param {string|null} accountId
   * @param {TokenBundle} bundle
   */
  async storeTokens(service, accountId, bundle) {
    const id = accountId ?? DEFAULT_ACCOUNT;
    if (!bundle?.access) throw new Error('OAuthVault.storeTokens: bundle.access is required');
    await this.#vault.set(this.#key(service, id), JSON.stringify({ ...bundle }));
  }

  /**
   * Retrieve tokens.  If near or past expiry AND a refresh fn is registered
   * AND a refresh token is available, attempts a proactive refresh before
   * returning.  Returns `null` if nothing stored.
   *
   * @param {string} service
   * @param {string} [accountId]
   * @returns {Promise<TokenBundle|null>}
   */
  async getTokens(service, accountId = DEFAULT_ACCOUNT) {
    const raw = await this.#vault.get(this.#key(service, accountId));
    if (!raw) return null;
    let bundle = JSON.parse(raw);
    if (this.#nearExpiry(bundle) && bundle.refresh && this.#refreshFns.has(service)) {
      bundle = await this.#doRefresh(service, accountId, bundle);
    }
    return bundle;
  }

  /**
   * Force a refresh now.  Useful for the 401-fallback path.
   * Throws if no refresh fn registered or no refresh token.
   *
   * @param {string} service
   * @param {string} [accountId]
   * @returns {Promise<TokenBundle>}
   */
  async refreshTokens(service, accountId = DEFAULT_ACCOUNT) {
    const raw = await this.#vault.get(this.#key(service, accountId));
    if (!raw) {
      throw Object.assign(
        new Error(`OAuthVault: no tokens stored for ${service}:${accountId}`),
        { code: 'OAUTH_NO_TOKENS' },
      );
    }
    const bundle = JSON.parse(raw);
    if (!bundle.refresh) {
      throw Object.assign(
        new Error(`OAuthVault: no refresh token for ${service}:${accountId}`),
        { code: 'OAUTH_NO_REFRESH_TOKEN' },
      );
    }
    return this.#doRefresh(service, accountId, bundle);
  }

  /**
   * Remove a token bundle.
   * @param {string} service
   * @param {string} [accountId]
   */
  async revokeTokens(service, accountId = DEFAULT_ACCOUNT) {
    await this.#vault.delete(this.#key(service, accountId));
  }

  /**
   * List known accountIds for the service.
   *
   * @param {string} service
   * @returns {Promise<string[]>}
   */
  async listAccounts(service) {
    const prefix = this.#key(service, '');
    const allKeys = await this.#vault.list();
    return allKeys
      .filter(k => k.startsWith(prefix))
      .map(k => k.slice(prefix.length));
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  #key(service, accountId) {
    return `${NAMESPACE}:${service}:${accountId}`;
  }

  #nearExpiry(bundle) {
    if (typeof bundle.expiresAt !== 'number') return false;
    return Date.now() + REFRESH_BUFFER_MS >= bundle.expiresAt;
  }

  /** Coalesces concurrent refresh attempts via an in-flight promise. */
  async #doRefresh(service, accountId, currentBundle) {
    const flightKey = `${service}:${accountId}`;
    const existing  = this.#inFlightRefresh.get(flightKey);
    if (existing) return existing;

    const refreshFn = this.#refreshFns.get(service);
    if (!refreshFn) {
      throw Object.assign(
        new Error(`OAuthVault: no refreshFn registered for "${service}"`),
        { code: 'OAUTH_NO_REFRESH_FN' },
      );
    }

    const promise = (async () => {
      try {
        const fresh = await refreshFn(currentBundle.refresh, currentBundle.scopes);
        // Some providers rotate the refresh token; if the response omits
        // `refresh`, keep the previous one.
        const merged = {
          ...currentBundle,
          ...fresh,
          refresh: fresh.refresh ?? currentBundle.refresh,
        };
        await this.#vault.set(this.#key(service, accountId), JSON.stringify(merged));
        return merged;
      } finally {
        this.#inFlightRefresh.delete(flightKey);
      }
    })();
    this.#inFlightRefresh.set(flightKey, promise);
    return promise;
  }
}

/**
 * Wrap an arbitrary `fetch` so a 401 triggers a single refresh + retry
 * via OAuthVault, transparently.  This is the "reactive safety net"
 * half of Q-F.2.
 *
 * @param {OAuthVault} oauthVault
 * @param {string}     service
 * @param {string}     [accountId]
 * @param {{ fetch?: typeof fetch }} [opts] - optional fetch override (tests).
 * @returns {(input: RequestInfo|string, init?: RequestInit) => Promise<Response>}
 */
export function makeAuthorizedFetch(oauthVault, service, accountId, opts = {}) {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('makeAuthorizedFetch: no fetch implementation available');
  }
  return async function authorizedFetch(input, init = {}) {
    const tokens = await oauthVault.getTokens(service, accountId);
    if (!tokens) {
      throw Object.assign(
        new Error('makeAuthorizedFetch: no tokens stored'),
        { code: 'OAUTH_NO_TOKENS' },
      );
    }

    const attach = (t) => ({
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${t.access}` },
    });

    let res = await fetchImpl(input, attach(tokens));
    if (res.status === 401 && tokens.refresh) {
      // Reactive refresh path — proactive missed (clock skew, etc.).
      const refreshed = await oauthVault.refreshTokens(service, accountId);
      res = await fetchImpl(input, attach(refreshed));
    }
    return res;
  };
}
