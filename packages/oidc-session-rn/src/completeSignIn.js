/**
 * completeSignIn + helpers — pure-JS, no React / Expo deps.
 *
 * Split out of the original `oidcSignIn.js` 2026-05-08 so unit-test
 * environments that don't need the React hook don't have to parse
 * `expo-auth-session`'s TypeScript at vitest-transform time.
 *
 * The hook itself (`useOidcSignIn`) lives at `../hook.js` and is
 * exported from the `/hook` subpath of the package.
 */

export const DEFAULT_INRUPT_ISSUER = 'https://login.inrupt.com';

export const DEFAULT_SCOPES = ['openid', 'webid', 'offline_access'];

let _discoveryFn = null;
export function _setDiscoveryFn(fn) { _discoveryFn = fn; }
export function _resolveDiscoveryFn() { return _discoveryFn; }

let _exchangeFn = null;
export function _setExchangeFn(fn) { _exchangeFn = fn; }
export function _resolveExchangeFn() { return _exchangeFn; }

/**
 * Pure post-prompt code-exchange path.
 *
 * @param {object} args
 * @param {object} args.result        AuthSessionResult-shaped (`{type, params}`).
 * @param {object} [args.request]     Carries the codeVerifier when PKCE was used.
 * @param {object} args.discovery     OIDC discovery doc (`tokenEndpoint`).
 * @param {string} args.redirectUri
 * @param {string} args.clientId
 * @param {string} args.issuer
 * @param {(args: {config: object, discovery: object}) => Promise<object>} [args.exchange]
 *        Override for the AuthSession.exchangeCodeAsync call. Falls
 *        back to the test-seam set via `_setExchangeFn`. Apps that
 *        use the hook supply this from the substrate's `/hook`
 *        subpath.
 */
export async function completeSignIn({
  result, request, discovery, redirectUri, clientId, issuer, exchange,
}) {
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

  const exchangeFn = exchange ?? _exchangeFn;
  if (typeof exchangeFn !== 'function') {
    throw Object.assign(
      new Error('completeSignIn: no exchange function configured (use the /hook entry point or _setExchangeFn for tests)'),
      { code: 'NO_EXCHANGE_FN' },
    );
  }

  const tokens = await exchangeFn({
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
 * falling back to `sub` if `webid` isn't present.
 */
export function extractWebIdFromIdToken(idToken) {
  if (typeof idToken !== 'string' || idToken.length === 0) return null;
  const parts = idToken.split('.');
  if (parts.length < 2) return null;
  try {
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
