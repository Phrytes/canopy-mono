/**
 * OidcSession — Folio's wrapper around `@inrupt/solid-client-authn-node`'s
 * `Session`.  Owns the standard Solid OIDC browser-redirect flow:
 *
 *   1. `start({ issuer, redirectUrl })`     — kicks off OIDC; resolves with
 *                                             the provider's authorize URL
 *                                             so the server can return it
 *                                             to the browser.
 *   2. `handleCallback(callbackUrl)`         — exchanges the auth code for
 *                                             tokens; persists the refresh
 *                                             token to the vault under
 *                                             `oidc-refresh-token`.
 *   3. `getStatus()`                         — `{ authenticated, webid?,
 *                                             expiresAt?, issuer? }`.
 *   4. `logout()`                            — clears the in-memory session
 *                                             and removes the vault entry.
 *   5. `restoreFromVault()`                  — boot-time path: silently
 *                                             re-establishes the session
 *                                             from a stored refresh token,
 *                                             if one is present.
 *   6. `getAuthenticatedFetch()`             — exposes Inrupt's session
 *                                             `fetch` for `PodClient` /
 *                                             `SolidOidcAuth` consumption.
 *
 * Hard rules (per Folio.B1.auth task):
 *   - Use Inrupt only.  No bespoke OIDC primitives.
 *   - Refresh token in the vault; access token in memory only.
 *   - The Inrupt issuer's `client_id` is OIDC-dynamic-registration if not
 *     supplied; the user-facing API takes only `issuer` + `redirectUrl`.
 *
 * Tests inject a fake Session via `_setSessionFactory(factory)`; production
 * code lazy-loads `@inrupt/solid-client-authn-node`.
 */

const VAULT_KEY_REFRESH_TOKEN = 'oidc-refresh-token';
const VAULT_KEY_ISSUER        = 'oidc-issuer';
const VAULT_KEY_CLIENT_ID     = 'oidc-client-id';
const VAULT_KEY_CLIENT_SECRET = 'oidc-client-secret';

/* ──────────────────────────────────────────────────────────────────────────
 * Session factory — production loads Inrupt; tests inject a fake.
 * ──────────────────────────────────────────────────────────────────────── */

let _sessionFactory = null;

async function defaultSessionFactory() {
  const mod = await import('@inrupt/solid-client-authn-node');
  return new mod.Session();
}

/**
 * Test-only seam.  Pass `null` to restore the default.
 *
 * @param {(() => object|Promise<object>) | null} factory
 */
export function _setSessionFactory(factory) {
  _sessionFactory = factory;
}

async function newSession() {
  return (_sessionFactory ?? defaultSessionFactory)();
}

/* ──────────────────────────────────────────────────────────────────────── */

export class OidcSession {
  /** @type {object|null} */
  #session = null;
  /** @type {object|null} — vault for refresh-token persistence */
  #vault   = null;

  /** @type {string|null} */ #issuer       = null;
  /** @type {string|null} */ #redirectUrl  = null;
  /** @type {string|null} */ #clientId     = null;
  /** @type {string|null} */ #clientSecret = null;

  // Cached info (populated on login / callback / restoreFromVault).
  #webid       = null;  // string | null
  #expiresAt   = null;  // unix-ms or null

  constructor({ vault } = {}) {
    if (!vault) throw new Error('OidcSession: vault is required');
    if (typeof vault.get !== 'function' || typeof vault.set !== 'function' || typeof vault.delete !== 'function') {
      throw new Error('OidcSession: vault must implement get/set/delete');
    }
    this.#vault = vault;
  }

  /* ── Public surface ──────────────────────────────────────────────────── */

  /**
   * Begin the OIDC dance.  Returns the issuer's authorize URL — the caller
   * (HTTP route) should send it to the browser as a 302 / JSON `redirectUrl`.
   *
   * @param {object} opts
   * @param {string} opts.issuer        — OIDC issuer URL (e.g. `https://solidcommunity.net`)
   * @param {string} opts.redirectUrl   — Folio's local callback URL (e.g. `http://127.0.0.1:8888/auth/callback`)
   * @returns {Promise<{ redirectUrl: string }>}
   */
  async start({ issuer, redirectUrl }) {
    if (typeof issuer !== 'string' || issuer.length === 0) {
      throw Object.assign(new Error('OidcSession.start: issuer is required'), { code: 'BAD_REQUEST' });
    }
    if (typeof redirectUrl !== 'string' || redirectUrl.length === 0) {
      throw Object.assign(new Error('OidcSession.start: redirectUrl is required'), { code: 'BAD_REQUEST' });
    }

    // A login attempt is one-shot per Session.  Replace any prior session.
    const session = await newSession();
    this.#session     = session;
    this.#issuer      = issuer;
    this.#redirectUrl = redirectUrl;

    // Capture the authorize URL via Inrupt's `handleRedirect` callback.  In
    // Node, Inrupt does NOT auto-redirect (no browser); it calls our handler
    // with the URL it would otherwise navigate to.  We capture it and return.
    let captured = null;

    await session.login({
      oidcIssuer:    issuer,
      redirectUrl,
      clientName:    'Folio',
      handleRedirect: (url) => { captured = url; },
    });

    if (typeof captured !== 'string' || captured.length === 0) {
      throw Object.assign(
        new Error('OidcSession.start: Inrupt did not produce an authorize URL'),
        { code: 'OIDC_LOGIN_FAILED' },
      );
    }
    return { redirectUrl: captured };
  }

  /**
   * Complete the OIDC dance from the provider's redirect back to
   * `/auth/callback`.  `callbackUrl` MUST be the full URL (with `code` +
   * `state` query params) as seen by the server.
   *
   * On success, persists the refresh token to the vault.
   *
   * @param {string} callbackUrl
   * @returns {Promise<{ webid?: string, issuer: string, expiresAt?: number }>}
   */
  async handleCallback(callbackUrl) {
    if (!this.#session) {
      throw Object.assign(
        new Error('OidcSession.handleCallback: no login in progress; call start() first'),
        { code: 'NO_LOGIN_IN_PROGRESS' },
      );
    }
    if (typeof callbackUrl !== 'string' || callbackUrl.length === 0) {
      throw Object.assign(new Error('OidcSession.handleCallback: callbackUrl is required'), { code: 'BAD_REQUEST' });
    }

    // Wire the newTokens listener BEFORE handleIncomingRedirect so the first
    // token set fires through it.  We mirror the refresh token to the vault.
    this.#wireTokenListeners();

    try {
      await this.#session.handleIncomingRedirect(callbackUrl);
    } catch (err) {
      throw Object.assign(
        new Error(`OidcSession.handleCallback: ${err?.message ?? String(err)}`),
        { code: 'OIDC_CALLBACK_FAILED', cause: err },
      );
    }

    if (!this.#session.info?.isLoggedIn) {
      throw Object.assign(
        new Error('OidcSession.handleCallback: provider rejected the code'),
        { code: 'OIDC_NOT_AUTHENTICATED' },
      );
    }

    await this.#captureSessionState();

    return {
      webid:     this.#webid ?? undefined,
      issuer:    this.#issuer,
      expiresAt: this.#expiresAt ?? undefined,
    };
  }

  /**
   * Snapshot of authentication state.  Cheap; safe to call from /auth/status.
   *
   * @returns {{ authenticated: boolean, webid?: string, expiresAt?: number, issuer?: string }}
   */
  getStatus() {
    const authed = this.isAuthenticated();
    const out = { authenticated: authed };
    if (this.#webid)     out.webid     = this.#webid;
    if (this.#expiresAt) out.expiresAt = this.#expiresAt;
    if (this.#issuer)    out.issuer    = this.#issuer;
    return out;
  }

  /**
   * `true` if the session is logged in and the access token isn't expired.
   * @returns {boolean}
   */
  isAuthenticated() {
    if (!this.#session) return false;
    if (!this.#session.info?.isLoggedIn) return false;
    if (this.#expiresAt && Date.now() >= this.#expiresAt) return false;
    return true;
  }

  /**
   * Returns the session-bound `fetch`.  PodClient + SolidOidcAuth use this.
   *
   * @returns {typeof fetch}
   */
  getAuthenticatedFetch() {
    if (!this.isAuthenticated()) {
      throw Object.assign(
        new Error('OidcSession.getAuthenticatedFetch: not authenticated'),
        { code: 'NOT_AUTHENTICATED' },
      );
    }
    return this.#session.fetch.bind(this.#session);
  }

  /** WebID of the authenticated session, or `null`. */
  get webid() { return this.#webid; }

  /**
   * Logout — clears the in-memory session and removes the vault refresh
   * token.  Idempotent.
   */
  async logout() {
    const session = this.#session;
    this.#session    = null;
    this.#webid      = null;
    this.#expiresAt  = null;

    if (session && typeof session.logout === 'function') {
      try { await session.logout({ logoutType: 'app' }); } catch { /* ignore */ }
    }

    // Best-effort vault cleanup.  Don't propagate errors from the vault — the
    // user has already asked us to log out, surfacing IO failures here is
    // worse than silently succeeding.
    try { await this.#vault.delete(VAULT_KEY_REFRESH_TOKEN); } catch { /* ignore */ }
    try { await this.#vault.delete(VAULT_KEY_ISSUER);        } catch { /* ignore */ }
    try { await this.#vault.delete(VAULT_KEY_CLIENT_ID);     } catch { /* ignore */ }
    try { await this.#vault.delete(VAULT_KEY_CLIENT_SECRET); } catch { /* ignore */ }
  }

  /**
   * Boot-time restore.  If the vault holds a refresh token, silently
   * re-establishes a Session via the OIDC refresh-token grant.  No-op if no
   * token is stored, or if the refresh fails (e.g. revoked).
   *
   * Errors are caught and logged via the optional `onWarning` callback;
   * boot must not fail because the user signed out at the IdP.
   *
   * @param {object} [opts]
   * @param {(msg: string) => void} [opts.onWarning]
   * @returns {Promise<boolean>} — true if restored, false otherwise.
   */
  async restoreFromVault({ onWarning } = {}) {
    let refreshToken = null;
    let issuer       = null;
    let clientId     = null;
    let clientSecret = null;
    try {
      refreshToken = await this.#vault.get(VAULT_KEY_REFRESH_TOKEN);
      issuer       = await this.#vault.get(VAULT_KEY_ISSUER);
      clientId     = await this.#vault.get(VAULT_KEY_CLIENT_ID);
      clientSecret = await this.#vault.get(VAULT_KEY_CLIENT_SECRET);
    } catch (err) {
      onWarning?.(`OidcSession.restoreFromVault: vault read failed: ${err?.message ?? err}`);
      return false;
    }

    if (!refreshToken || !issuer) return false;

    let session;
    try {
      session = await newSession();
    } catch (err) {
      onWarning?.(`OidcSession.restoreFromVault: session-factory failed: ${err?.message ?? err}`);
      return false;
    }
    this.#session     = session;
    this.#issuer      = issuer;
    this.#clientId    = clientId ?? null;
    this.#clientSecret = clientSecret ?? null;

    this.#wireTokenListeners();

    try {
      const loginOpts = {
        oidcIssuer:    issuer,
        refreshToken,
        // Inrupt requires a redirect handler even for refresh-token flow; it
        // shouldn't actually fire, but if it does we no-op.
        handleRedirect: () => {},
      };
      if (clientId)     loginOpts.clientId     = clientId;
      if (clientSecret) loginOpts.clientSecret = clientSecret;
      await session.login(loginOpts);
    } catch (err) {
      this.#session     = null;
      this.#issuer      = null;
      this.#clientId    = null;
      this.#clientSecret = null;
      onWarning?.(`OidcSession.restoreFromVault: refresh failed: ${err?.message ?? err}`);
      return false;
    }

    if (!session.info?.isLoggedIn) {
      this.#session = null;
      onWarning?.('OidcSession.restoreFromVault: refresh did not produce a logged-in session');
      return false;
    }

    await this.#captureSessionState();
    return true;
  }

  /* ── Internals ───────────────────────────────────────────────────────── */

  #wireTokenListeners() {
    if (!this.#session) return;
    const events = this.#session.events;
    if (!events || typeof events.on !== 'function') return;

    events.on('newTokens', (tokenSet) => {
      this.#absorbTokenSet(tokenSet).catch(() => { /* swallow */ });
    });
    events.on('newRefreshToken', (newToken) => {
      if (typeof newToken !== 'string' || newToken.length === 0) return;
      this.#vault.set(VAULT_KEY_REFRESH_TOKEN, newToken).catch(() => {});
    });
  }

  async #absorbTokenSet(tokenSet) {
    if (!tokenSet || typeof tokenSet !== 'object') return;
    if (typeof tokenSet.refreshToken === 'string' && tokenSet.refreshToken.length > 0) {
      try { await this.#vault.set(VAULT_KEY_REFRESH_TOKEN, tokenSet.refreshToken); } catch { /* ignore */ }
    }
    if (typeof tokenSet.expiresAt === 'number') {
      // Inrupt uses seconds-since-epoch in some shapes; normalize to ms.
      this.#expiresAt = tokenSet.expiresAt < 1e12
        ? tokenSet.expiresAt * 1000
        : tokenSet.expiresAt;
    }
  }

  async #captureSessionState() {
    if (!this.#session) return;

    if (typeof this.#session.info?.webId === 'string' && this.#session.info.webId.length > 0) {
      this.#webid = this.#session.info.webId;
    }
    if (typeof this.#session.info?.expirationDate === 'number') {
      const ed = this.#session.info.expirationDate;
      this.#expiresAt = ed < 1e12 ? ed * 1000 : ed;
    }

    // Persist issuer + client identifiers (if any).  These let
    // restoreFromVault() rebuild the session without prompting.
    if (this.#issuer) {
      try { await this.#vault.set(VAULT_KEY_ISSUER, this.#issuer); } catch { /* ignore */ }
    }
    // The session may have a clientAppId / clientId after dynamic registration.
    const dynamicClientId = this.#session.info?.clientAppId ?? this.#session.info?.clientId;
    if (typeof dynamicClientId === 'string' && dynamicClientId.length > 0) {
      this.#clientId = dynamicClientId;
      try { await this.#vault.set(VAULT_KEY_CLIENT_ID, dynamicClientId); } catch { /* ignore */ }
    }

    // Some Inrupt sessions surface a `refreshToken` directly on `info` after
    // login (and not via the newTokens event on first login).  Mirror it.
    const tokFromInfo = this.#session.info?.refreshToken
      ?? this.#session.refreshToken
      ?? null;
    if (typeof tokFromInfo === 'string' && tokFromInfo.length > 0) {
      try { await this.#vault.set(VAULT_KEY_REFRESH_TOKEN, tokFromInfo); } catch { /* ignore */ }
    }
  }
}

export const OIDC_VAULT_KEYS = Object.freeze({
  REFRESH_TOKEN: VAULT_KEY_REFRESH_TOKEN,
  ISSUER:        VAULT_KEY_ISSUER,
  CLIENT_ID:     VAULT_KEY_CLIENT_ID,
  CLIENT_SECRET: VAULT_KEY_CLIENT_SECRET,
});
