/**
 * OidcSessionRN — React Native flavour of Folio's OidcSession.
 *
 * The desktop `OidcSession` (`apps/folio/src/auth/OidcSession.js`) drives
 * the full Inrupt browser-redirect dance via
 * `@inrupt/solid-client-authn-node`, persisting the refresh token to a
 * pluggable vault.  On mobile we replace BOTH halves:
 *
 *   1. The OIDC dance itself runs in `expo-auth-session` (see
 *      `folioAuth.js`).  That gives us a freshly-minted set of tokens
 *      ({ accessToken, refreshToken, idToken, expiresIn, ... }).
 *
 *   2. This class persists those tokens to `expo-secure-store` (iOS
 *      Keychain / Android Keystore — hardware-backed where available)
 *      and exposes the SAME interface PodClient + Folio's serviceFactory
 *      already consume from desktop:
 *
 *        - `isAuthenticated() → boolean`
 *        - `getAuthenticatedFetch() → fetch` (an authorization-bearer wrapper
 *          around the global RN fetch)
 *        - `webid` (string or null)
 *        - `logout()` (clears tokens)
 *        - `restoreFromVault({ onWarning? }) → Promise<boolean>`
 *
 * Why no Inrupt Node lib
 * ----------------------
 * `@inrupt/solid-client-authn-node` pulls in dozens of Node built-ins
 * (`http`, `https`, `crypto`, etc.) that don't exist on RN.  The mobile
 * flow runs the OIDC dance via expo-auth-session and only needs the
 * resulting access token + a fetch wrapper that injects it.  No DPoP /
 * JWT-binding for the v0 — bearer is sufficient against Inrupt's
 * storage.inrupt.com (same as web SDKs).  Future work can layer DPoP
 * via `@inrupt/solid-client-authn-browser` if needed.
 *
 * Storage keys (kept distinct from desktop's `oidc-*` so a single
 * device running both a CLI Folio + a mobile Folio doesn't clash):
 *
 *   `folio-oidc-access-token`
 *   `folio-oidc-refresh-token`
 *   `folio-oidc-id-token`
 *   `folio-oidc-expires-at`     (unix-ms)
 *   `folio-oidc-issuer`
 *   `folio-oidc-webid`
 *   `folio-oidc-client-id`      (dynamic-registration result, optional)
 */

export const SECURE_STORE_KEYS = Object.freeze({
  ACCESS_TOKEN:  'folio-oidc-access-token',
  REFRESH_TOKEN: 'folio-oidc-refresh-token',
  ID_TOKEN:      'folio-oidc-id-token',
  EXPIRES_AT:    'folio-oidc-expires-at',
  ISSUER:        'folio-oidc-issuer',
  WEBID:         'folio-oidc-webid',
  CLIENT_ID:     'folio-oidc-client-id',
});

/**
 * @typedef {object} TokenSet
 * @property {string}  accessToken
 * @property {string}  [refreshToken]
 * @property {string}  [idToken]
 * @property {number}  [expiresIn]   seconds from now
 * @property {number}  [expiresAt]   unix-ms (alternative to expiresIn)
 * @property {string}  [issuer]
 * @property {string}  [webid]
 * @property {string}  [clientId]
 */

/**
 * @typedef {object} SecureStore
 * @property {(key: string) => Promise<string|null>} getItemAsync
 * @property {(key: string, value: string) => Promise<void>} setItemAsync
 * @property {(key: string) => Promise<void>} deleteItemAsync
 */

export class OidcSessionRN {
  /** @type {SecureStore} */
  #store;

  /** @type {string|null} */ #accessToken  = null;
  /** @type {string|null} */ #refreshToken = null;
  /** @type {string|null} */ #idToken      = null;
  /** @type {number|null} */ #expiresAt    = null;
  /** @type {string|null} */ #issuer       = null;
  /** @type {string|null} */ #webid        = null;
  /** @type {string|null} */ #clientId     = null;

  /**
   * @param {object} args
   * @param {SecureStore} args.store  Typically the namespace import of
   *                                   `expo-secure-store`.  Must implement
   *                                   `getItemAsync` / `setItemAsync` /
   *                                   `deleteItemAsync`.
   */
  constructor({ store } = {}) {
    if (!store) throw new Error('OidcSessionRN: store required');
    if (typeof store.getItemAsync    !== 'function')
      throw new Error('OidcSessionRN: store.getItemAsync must be a function');
    if (typeof store.setItemAsync    !== 'function')
      throw new Error('OidcSessionRN: store.setItemAsync must be a function');
    if (typeof store.deleteItemAsync !== 'function')
      throw new Error('OidcSessionRN: store.deleteItemAsync must be a function');
    this.#store = store;
  }

  /**
   * Adopt a fresh token set (e.g. from `expo-auth-session.exchangeCodeAsync`)
   * and persist to secure storage.
   *
   * @param {TokenSet} tokens
   * @returns {Promise<void>}
   */
  async adoptTokens(tokens) {
    if (!tokens || typeof tokens !== 'object') {
      throw new Error('OidcSessionRN.adoptTokens: tokens object required');
    }
    if (typeof tokens.accessToken !== 'string' || tokens.accessToken.length === 0) {
      throw new Error('OidcSessionRN.adoptTokens: accessToken required');
    }
    this.#accessToken  = tokens.accessToken;
    this.#refreshToken = tokens.refreshToken ?? this.#refreshToken ?? null;
    this.#idToken      = tokens.idToken      ?? this.#idToken      ?? null;
    if (typeof tokens.expiresAt === 'number') {
      this.#expiresAt = tokens.expiresAt < 1e12 ? tokens.expiresAt * 1000 : tokens.expiresAt;
    } else if (typeof tokens.expiresIn === 'number') {
      this.#expiresAt = Date.now() + tokens.expiresIn * 1000;
    }
    if (typeof tokens.issuer   === 'string' && tokens.issuer.length   > 0) this.#issuer   = tokens.issuer;
    if (typeof tokens.webid    === 'string' && tokens.webid.length    > 0) this.#webid    = tokens.webid;
    if (typeof tokens.clientId === 'string' && tokens.clientId.length > 0) this.#clientId = tokens.clientId;

    await this.#persist();
  }

  /**
   * Read previously-stored tokens back into memory.  No-op (returns
   * `false`) when nothing is stored or the access token has lapsed AND
   * no refresh token is present.
   *
   * @param {object} [opts]
   * @param {(msg: string) => void} [opts.onWarning]
   * @returns {Promise<boolean>}
   */
  async restoreFromVault({ onWarning } = {}) {
    try {
      this.#accessToken  = await this.#store.getItemAsync(SECURE_STORE_KEYS.ACCESS_TOKEN);
      this.#refreshToken = await this.#store.getItemAsync(SECURE_STORE_KEYS.REFRESH_TOKEN);
      this.#idToken      = await this.#store.getItemAsync(SECURE_STORE_KEYS.ID_TOKEN);
      const exp          = await this.#store.getItemAsync(SECURE_STORE_KEYS.EXPIRES_AT);
      this.#expiresAt    = exp ? Number(exp) : null;
      this.#issuer       = await this.#store.getItemAsync(SECURE_STORE_KEYS.ISSUER);
      this.#webid        = await this.#store.getItemAsync(SECURE_STORE_KEYS.WEBID);
      this.#clientId     = await this.#store.getItemAsync(SECURE_STORE_KEYS.CLIENT_ID);
    } catch (err) {
      onWarning?.(`OidcSessionRN.restoreFromVault: vault read failed: ${err?.message ?? err}`);
      return false;
    }
    if (!this.#accessToken && !this.#refreshToken) return false;
    return this.isAuthenticated();
  }

  /**
   * Snapshot of authentication state.  Cheap; safe to call every render.
   *
   * @returns {{ authenticated: boolean, webid?: string, expiresAt?: number, issuer?: string }}
   */
  getStatus() {
    const out = { authenticated: this.isAuthenticated() };
    if (this.#webid)     out.webid     = this.#webid;
    if (this.#expiresAt) out.expiresAt = this.#expiresAt;
    if (this.#issuer)    out.issuer    = this.#issuer;
    return out;
  }

  /**
   * Returns whether the access token is non-empty and not expired.  If
   * we have a refresh token but the access token has lapsed, we still
   * return `false` here — the caller is expected to refresh (a future
   * iteration) or re-prompt sign-in.  The v0 just signs in again.
   *
   * @returns {boolean}
   */
  isAuthenticated() {
    if (!this.#accessToken) return false;
    if (this.#expiresAt && Date.now() >= this.#expiresAt) return false;
    return true;
  }

  /** @returns {string|null} */ get webid()        { return this.#webid; }
  /** @returns {string|null} */ get issuer()       { return this.#issuer; }
  /** @returns {string|null} */ get clientId()     { return this.#clientId; }
  /** @returns {string|null} */ get accessToken()  { return this.#accessToken; }
  /** @returns {string|null} */ get refreshToken() { return this.#refreshToken; }
  /** @returns {number|null} */ get expiresAt()    { return this.#expiresAt; }

  /**
   * Returns a `fetch` wrapper that injects the bearer token.  Mirrors the
   * shape PodClient's `Auth` interface expects (no `vault.refresh()` —
   * v0 uses sign-in-again on lapse; future versions can layer refresh).
   *
   * @returns {typeof fetch}
   */
  getAuthenticatedFetch() {
    if (!this.isAuthenticated()) {
      const err = new Error('OidcSessionRN.getAuthenticatedFetch: not authenticated');
      err.code  = 'NOT_AUTHENTICATED';
      throw err;
    }
    const token = this.#accessToken;
    return async (input, init = {}) => {
      const headers = new Headers(init.headers ?? {});
      if (!headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      return globalThis.fetch(input, { ...init, headers });
    };
  }

  /**
   * Clears in-memory state and removes every secure-store entry.
   * Idempotent.
   */
  async logout() {
    this.#accessToken  = null;
    this.#refreshToken = null;
    this.#idToken      = null;
    this.#expiresAt    = null;
    this.#issuer       = null;
    this.#webid        = null;
    this.#clientId     = null;
    for (const k of Object.values(SECURE_STORE_KEYS)) {
      try { await this.#store.deleteItemAsync(k); } catch { /* swallow */ }
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  async #persist() {
    const writes = [];
    const set = (k, v) => writes.push(
      v == null
        ? this.#store.deleteItemAsync(k).catch(() => {})
        : this.#store.setItemAsync(k, String(v)).catch(() => {}),
    );
    set(SECURE_STORE_KEYS.ACCESS_TOKEN,  this.#accessToken);
    set(SECURE_STORE_KEYS.REFRESH_TOKEN, this.#refreshToken);
    set(SECURE_STORE_KEYS.ID_TOKEN,      this.#idToken);
    set(SECURE_STORE_KEYS.EXPIRES_AT,    this.#expiresAt);
    set(SECURE_STORE_KEYS.ISSUER,        this.#issuer);
    set(SECURE_STORE_KEYS.WEBID,         this.#webid);
    set(SECURE_STORE_KEYS.CLIENT_ID,     this.#clientId);
    await Promise.all(writes);
  }
}
