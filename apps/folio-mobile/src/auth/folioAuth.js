/**
 * folioAuth — `expo-auth-session` wrapper for Folio's mobile sign-in.
 *
 * Drives the Solid OIDC dance via Inrupt's hosted IdP using PKCE.  The
 * UX matches `coding-plans/track-H-folio-C1.md` §"Mobile auth flow":
 *
 *   1. User taps "Sign in" — `useFolioAuth()` returns a `signIn()` callable.
 *   2. `signIn()` calls `promptAsync()` which opens a Safari View
 *      Controller (iOS) / Chrome Custom Tab (Android) at Inrupt's
 *      authorize endpoint.
 *   3. Inrupt redirects to `folio://auth/callback?code=...` — the OS
 *      hands the URL back to the app via the custom URL scheme.
 *   4. We exchange the auth code for tokens at the discovered token
 *      endpoint and hand the result to the caller (the ServiceContext)
 *      which seeds an `OidcSessionRN`.
 *
 * Library boundaries
 * ------------------
 * - This module is the ONLY place that imports `expo-auth-session`.
 * - It exports a React hook (UI-level) AND a pure function
 *   (`completeSignIn`) that takes a fully-resolved auth response and
 *   returns the token set — testable without React.
 * - The Inrupt issuer URL is configurable; default is
 *   `https://login.inrupt.com` (the production IdP).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser  from 'expo-web-browser';

// Required on Android Chrome Custom Tabs to dismiss the browser sheet
// after the redirect lands; safe to call multiple times.  iOS no-ops.
WebBrowser.maybeCompleteAuthSession();

/**
 * Default Inrupt issuer.  Can be overridden via the hook's `issuer` arg
 * for staging / self-hosted deployments.
 */
export const DEFAULT_INRUPT_ISSUER = 'https://login.inrupt.com';

/**
 * Standard Solid OIDC scopes — `openid` for login, `webid` to resolve
 * the user's WebID into the id-token's `sub`, `offline_access` so we
 * receive a refresh token (without it Inrupt only returns an access
 * token).
 */
export const DEFAULT_SCOPES = ['openid', 'webid', 'offline_access'];

/**
 * Build a fresh OIDC discovery document from the issuer's well-known
 * endpoint.  Tests inject a stub via `_setDiscoveryFn`.
 */
let _discoveryFn = null;
export function _setDiscoveryFn(fn) { _discoveryFn = fn; }
async function discoverIssuer(issuer) {
  if (_discoveryFn) return _discoveryFn(issuer);
  return AuthSession.fetchDiscoveryAsync(issuer);
}

/**
 * Test seam — replace `exchangeCodeAsync` so unit tests don't hit the
 * network.  Pass `null` to restore the default.
 */
let _exchangeFn = null;
export function _setExchangeFn(fn) { _exchangeFn = fn; }
async function exchange(args) {
  if (_exchangeFn) return _exchangeFn(args);
  return AuthSession.exchangeCodeAsync(args.config, args.discovery);
}

/**
 * The hook drives the whole flow.  Returns a stable handle:
 *   { ready, signIn, signOut, lastError }
 *
 * The `signIn` callable returns the token set on success or throws on
 * failure.  Callers feed the result to `OidcSessionRN.adoptTokens()`.
 *
 * @param {object} args
 * @param {string} [args.issuer]        Default `https://login.inrupt.com`.
 * @param {string} [args.scheme]        URL scheme for the redirect URI.
 *                                       Default `folio` (matches `app.json`).
 * @param {string} [args.path]          Path component of the redirect URI.
 *                                       Default `auth/callback` (so the
 *                                       full URI is `folio://auth/callback`).
 * @param {string} [args.clientId]      Optional pre-registered client_id.
 *                                       When omitted, Inrupt accepts the
 *                                       redirect URI itself as the client
 *                                       identifier (Solid's "anonymous
 *                                       client" pattern).
 * @param {string[]} [args.scopes]      Default `['openid','webid','offline_access']`.
 * @param {(msg: string) => void} [args.onWarning]
 *
 * @returns {{
 *   ready: boolean,
 *   discovery: object|null,
 *   request: object|null,
 *   signIn: () => Promise<TokenSet>,
 *   lastError: Error|null,
 * }}
 */
export function useFolioAuth({
  issuer    = DEFAULT_INRUPT_ISSUER,
  scheme    = 'folio',
  path      = 'auth/callback',
  clientId  = null,
  scopes    = DEFAULT_SCOPES,
  onWarning,
} = {}) {
  const [discovery, setDiscovery] = useState(null);
  const [lastError, setLastError] = useState(null);

  const redirectUri = useMemo(
    () => AuthSession.makeRedirectUri({ scheme, path, native: `${scheme}://${path}` }),
    [scheme, path],
  );

  // Discover the issuer's authorize / token endpoints.  Cached for the
  // lifetime of the screen — Inrupt's discovery doc rarely changes.
  useEffect(() => {
    let cancelled = false;
    discoverIssuer(issuer)
      .then((d) => { if (!cancelled) setDiscovery(d); })
      .catch((err) => {
        if (!cancelled) {
          setLastError(err);
          onWarning?.(`useFolioAuth: discovery failed: ${err?.message ?? err}`);
        }
      });
    return () => { cancelled = true; };
  }, [issuer, onWarning]);

  // The auth request — useAuthRequest returns [request, response, promptAsync].
  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId:           clientId ?? redirectUri,
      scopes,
      redirectUri,
      responseType:       AuthSession.ResponseType.Code,
      usePKCE:            true,
      codeChallengeMethod: AuthSession.CodeChallengeMethod.S256,
    },
    discovery,
  );

  const signIn = useCallback(async () => {
    if (!discovery) {
      throw Object.assign(
        new Error('useFolioAuth: issuer discovery not yet complete'),
        { code: 'DISCOVERY_PENDING' },
      );
    }
    if (!request) {
      throw Object.assign(
        new Error('useFolioAuth: auth request not yet built'),
        { code: 'REQUEST_PENDING' },
      );
    }

    const result = await promptAsync({ showInRecents: false });
    return completeSignIn({
      result, request, discovery, redirectUri,
      clientId: clientId ?? redirectUri,
      issuer,
    });
  }, [discovery, request, promptAsync, redirectUri, clientId, issuer]);

  return {
    ready: !!(discovery && request),
    discovery,
    request,
    redirectUri,
    signIn,
    lastError,
  };
}

/**
 * Pure version of the post-prompt code-exchange path.  Exposed for
 * testing without React's hook plumbing.
 *
 * @param {object} args
 * @param {object} args.result        AuthSessionResult from promptAsync
 * @param {object} args.request       AuthRequest (carries the codeVerifier)
 * @param {object} args.discovery     OIDC discovery document
 * @param {string} args.redirectUri
 * @param {string} args.clientId
 * @param {string} args.issuer
 *
 * @returns {Promise<{
 *   accessToken:  string,
 *   refreshToken?: string,
 *   idToken?:     string,
 *   expiresIn?:   number,
 *   expiresAt?:   number,
 *   issuer:       string,
 *   webid?:       string,
 *   clientId:     string,
 * }>}
 */
export async function completeSignIn({ result, request, discovery, redirectUri, clientId, issuer }) {
  if (!result || typeof result !== 'object') {
    throw Object.assign(new Error('completeSignIn: result required'), { code: 'BAD_REQUEST' });
  }
  if (result.type !== 'success') {
    throw Object.assign(
      new Error(`completeSignIn: prompt did not succeed (${result.type})`),
      { code: 'AUTH_DISMISSED', resultType: result.type },
    );
  }
  if (!result.params?.code) {
    throw Object.assign(
      new Error('completeSignIn: redirect did not include an auth code'),
      { code: 'NO_AUTH_CODE' },
    );
  }
  if (!discovery?.tokenEndpoint) {
    throw Object.assign(
      new Error('completeSignIn: discovery.tokenEndpoint missing'),
      { code: 'NO_TOKEN_ENDPOINT' },
    );
  }

  const tokens = await exchange({
    config: {
      clientId,
      redirectUri,
      code:                  result.params.code,
      extraParams:           request?.codeVerifier
        ? { code_verifier: request.codeVerifier }
        : undefined,
    },
    discovery,
  });

  if (!tokens?.accessToken) {
    throw Object.assign(
      new Error('completeSignIn: token exchange did not return an accessToken'),
      { code: 'TOKEN_EXCHANGE_FAILED' },
    );
  }

  // Best-effort WebID extraction from the id-token (no signature
  // verification at v0 — Inrupt's discovery is HTTPS-only and the
  // token comes straight from the discovered token endpoint, so MITM
  // would already be in play).  Falls back to undefined; the
  // ServiceContext can still call PodClient at the configured pod root.
  const webid = extractWebIdFromIdToken(tokens.idToken);

  const out = {
    accessToken:  tokens.accessToken,
    refreshToken: tokens.refreshToken,
    idToken:      tokens.idToken,
    expiresIn:    tokens.expiresIn,
    expiresAt:    typeof tokens.expiresIn === 'number'
                    ? Date.now() + tokens.expiresIn * 1000
                    : undefined,
    issuer,
    clientId,
  };
  if (webid) out.webid = webid;
  return out;
}

/**
 * Decode the id-token's payload (no verification) and pluck `webid`,
 * falling back to `sub` if `webid` isn't present.  Used to seed the
 * ServiceContext with a WebID for the Status / Settings screens.
 *
 * @param {string|null|undefined} idToken
 * @returns {string|null}
 */
export function extractWebIdFromIdToken(idToken) {
  if (typeof idToken !== 'string' || idToken.length === 0) return null;
  const parts = idToken.split('.');
  if (parts.length < 2) return null;
  try {
    // base64url → base64 → utf8 JSON.  RN's `atob` is available globally.
    const padded = parts[1] + '='.repeat((4 - parts[1].length % 4) % 4);
    const b64    = padded.replace(/-/g, '+').replace(/_/g, '/');
    const json   = typeof atob === 'function'
      ? atob(b64)
      : Buffer.from(b64, 'base64').toString('utf8');
    const payload = JSON.parse(json);
    if (typeof payload.webid === 'string' && payload.webid.length > 0) return payload.webid;
    if (typeof payload.sub   === 'string' && payload.sub.length   > 0) return payload.sub;
  } catch {
    return null;
  }
  return null;
}
