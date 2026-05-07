/**
 * OidcSession — Stoop V1.5 Phase 20 (2026-05-06).
 *
 * Wrapper around `@inrupt/solid-client-authn-node`'s `Session` for the
 * browser-redirect Solid OIDC flow.  Lifted from `apps/folio/src/auth/`
 * with minor edits — Folio + Stoop = 2 consumers, so when a third app
 * needs this, promote into `@canopy/oidc-session` (or merge with
 * `@canopy/pod-client`'s `SolidOidcAuth`).
 *
 * Flow:
 *
 *   1. `start({ issuer, redirectUrl })` — kicks off OIDC; resolves with
 *      the provider's authorize URL so the caller (skill handler) can
 *      hand it back to the browser to navigate to.
 *   2. `handleCallback(callbackUrl)` — exchanges the auth code for
 *      tokens; persists the refresh token to the vault under
 *      `oidc-refresh-token`.
 *   3. `getStatus()` → `{ authenticated, webid?, expiresAt?, issuer? }`
 *   4. `logout()` — clears the in-memory session + vault entries.
 *   5. `restoreFromVault()` — boot-time silent refresh via stored
 *      refresh token.
 *   6. `getAuthenticatedFetch()` — Inrupt's session-bound `fetch`.
 *
 * Hard rules:
 *   - Use Inrupt only.  No bespoke OIDC primitives.
 *   - Refresh token in the vault; access token in memory only.
 *   - Tests inject a fake Session via `_setSessionFactory(factory)`.
 *
 * **Substrate candidate (rule of two — second consumer):** lift this
 * + Folio's copy into `@canopy/oidc-session` once a third consumer
 * appears.  Tracked in
 * `Project Files/Substrates/substrate-candidates.md`.
 */

const VAULT_KEY_REFRESH_TOKEN = 'oidc-refresh-token';
const VAULT_KEY_ISSUER        = 'oidc-issuer';
const VAULT_KEY_CLIENT_ID     = 'oidc-client-id';
const VAULT_KEY_CLIENT_SECRET = 'oidc-client-secret';

let _sessionFactory = null;

async function defaultSessionFactory() {
  const mod = await import('@inrupt/solid-client-authn-node');
  return new mod.Session();
}

/** Test-only seam.  Pass `null` to restore the default. */
export function _setSessionFactory(factory) {
  _sessionFactory = factory;
}

async function newSession() {
  return (_sessionFactory ?? defaultSessionFactory)();
}

export class OidcSession {
  #session = null;
  #vault   = null;

  #issuer       = null;
  #redirectUrl  = null;
  #clientId     = null;
  #clientSecret = null;

  #webid       = null;
  #expiresAt   = null;

  constructor({ vault } = {}) {
    if (!vault) throw new Error('OidcSession: vault is required');
    if (typeof vault.get !== 'function' || typeof vault.set !== 'function' || typeof vault.delete !== 'function') {
      throw new Error('OidcSession: vault must implement get/set/delete');
    }
    this.#vault = vault;
  }

  /**
   * Begin the OIDC dance.  Returns the issuer's authorize URL.
   *
   * @returns {Promise<{ redirectUrl: string }>}
   */
  async start({ issuer, redirectUrl }) {
    if (typeof issuer !== 'string' || !issuer) {
      throw Object.assign(new Error('OidcSession.start: issuer is required'), { code: 'BAD_REQUEST' });
    }
    if (typeof redirectUrl !== 'string' || !redirectUrl) {
      throw Object.assign(new Error('OidcSession.start: redirectUrl is required'), { code: 'BAD_REQUEST' });
    }

    const session = await newSession();
    this.#session     = session;
    this.#issuer      = issuer;
    this.#redirectUrl = redirectUrl;

    let captured = null;
    await session.login({
      oidcIssuer:    issuer,
      redirectUrl,
      clientName:    'Stoop',
      handleRedirect: (url) => { captured = url; },
    });

    if (typeof captured !== 'string' || !captured) {
      throw Object.assign(
        new Error('OidcSession.start: Inrupt did not produce an authorize URL'),
        { code: 'OIDC_LOGIN_FAILED' },
      );
    }
    return { redirectUrl: captured };
  }

  async handleCallback(callbackUrl) {
    if (!this.#session) {
      throw Object.assign(
        new Error('OidcSession.handleCallback: no login in progress; call start() first'),
        { code: 'NO_LOGIN_IN_PROGRESS' },
      );
    }
    if (typeof callbackUrl !== 'string' || !callbackUrl) {
      throw Object.assign(new Error('OidcSession.handleCallback: callbackUrl is required'), { code: 'BAD_REQUEST' });
    }

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

  getStatus() {
    const authed = this.isAuthenticated();
    const out = { authenticated: authed };
    if (this.#webid)     out.webid     = this.#webid;
    if (this.#expiresAt) out.expiresAt = this.#expiresAt;
    if (this.#issuer)    out.issuer    = this.#issuer;
    return out;
  }

  isAuthenticated() {
    if (!this.#session) return false;
    if (!this.#session.info?.isLoggedIn) return false;
    if (this.#expiresAt && Date.now() >= this.#expiresAt) return false;
    return true;
  }

  getAuthenticatedFetch() {
    if (!this.isAuthenticated()) {
      throw Object.assign(
        new Error('OidcSession.getAuthenticatedFetch: not authenticated'),
        { code: 'NOT_AUTHENTICATED' },
      );
    }
    return this.#session.fetch.bind(this.#session);
  }

  get webid() { return this.#webid; }

  async logout() {
    const session = this.#session;
    this.#session    = null;
    this.#webid      = null;
    this.#expiresAt  = null;

    if (session?.logout) {
      try { await session.logout({ logoutType: 'app' }); } catch { /* ignore */ }
    }
    try { await this.#vault.delete(VAULT_KEY_REFRESH_TOKEN); } catch { /* ignore */ }
    try { await this.#vault.delete(VAULT_KEY_ISSUER);        } catch { /* ignore */ }
    try { await this.#vault.delete(VAULT_KEY_CLIENT_ID);     } catch { /* ignore */ }
    try { await this.#vault.delete(VAULT_KEY_CLIENT_SECRET); } catch { /* ignore */ }
  }

  async restoreFromVault({ onWarning } = {}) {
    let refreshToken, issuer, clientId, clientSecret;
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
        handleRedirect: () => {},
      };
      if (clientId)     loginOpts.clientId     = clientId;
      if (clientSecret) loginOpts.clientSecret = clientSecret;
      await session.login(loginOpts);
    } catch (err) {
      this.#session = null;
      onWarning?.(`OidcSession.restoreFromVault: refresh failed: ${err?.message ?? err}`);
      return false;
    }

    if (!session.info?.isLoggedIn) {
      this.#session = null;
      return false;
    }
    await this.#captureSessionState();
    return true;
  }

  #wireTokenListeners() {
    const events = this.#session?.events;
    if (!events?.on) return;
    events.on('newTokens', (tokenSet) => {
      this.#absorbTokenSet(tokenSet).catch(() => {});
    });
    events.on('newRefreshToken', (newToken) => {
      if (typeof newToken === 'string' && newToken) {
        this.#vault.set(VAULT_KEY_REFRESH_TOKEN, newToken).catch(() => {});
      }
    });
  }

  async #absorbTokenSet(tokenSet) {
    if (!tokenSet || typeof tokenSet !== 'object') return;
    if (typeof tokenSet.refreshToken === 'string' && tokenSet.refreshToken) {
      try { await this.#vault.set(VAULT_KEY_REFRESH_TOKEN, tokenSet.refreshToken); } catch { /* ignore */ }
    }
    if (typeof tokenSet.expiresAt === 'number') {
      this.#expiresAt = tokenSet.expiresAt < 1e12 ? tokenSet.expiresAt * 1000 : tokenSet.expiresAt;
    }
  }

  async #captureSessionState() {
    if (!this.#session) return;
    if (typeof this.#session.info?.webId === 'string' && this.#session.info.webId) {
      this.#webid = this.#session.info.webId;
    }
    if (typeof this.#session.info?.expirationDate === 'number') {
      const ed = this.#session.info.expirationDate;
      this.#expiresAt = ed < 1e12 ? ed * 1000 : ed;
    }
    if (this.#issuer) {
      try { await this.#vault.set(VAULT_KEY_ISSUER, this.#issuer); } catch { /* ignore */ }
    }
    const dynId = this.#session.info?.clientAppId ?? this.#session.info?.clientId;
    if (typeof dynId === 'string' && dynId) {
      this.#clientId = dynId;
      try { await this.#vault.set(VAULT_KEY_CLIENT_ID, dynId); } catch { /* ignore */ }
    }
    const tok = this.#session.info?.refreshToken ?? this.#session.refreshToken ?? null;
    if (typeof tok === 'string' && tok) {
      try { await this.#vault.set(VAULT_KEY_REFRESH_TOKEN, tok); } catch { /* ignore */ }
    }
  }
}
