// Pluggable, INJECTED auth strategies for HTTP-style connectors (Objective S, v0).
//
// Each strategy is a decorator `(req) => req` over the outgoing request descriptor
// (`{ method, url, headers, body }`) — it adds/edits headers and returns the descriptor. A
// connector applies its injected strategy right before `fetch`, so auth is orthogonal to routing
// and swappable per-source. Strategies may be async (see `oauthAuth`), so connectors `await` the
// result.
//
// v0 deliberately ships NO real OAuth flow — `oauthAuth` is a SEAM that takes an injected token
// provider (the flow that mints/refreshes tokens lives elsewhere; here we just attach the token).

import { ConnectorError, ConnectorErrorCode } from './errors.js';

/** Cross-env base64 (browser `btoa` or Node `Buffer`) for Basic auth. */
function base64(str) {
  if (typeof globalThis.btoa === 'function') {
    // `btoa` is byte-oriented; encode UTF-8 first so non-ASCII creds survive.
    if (typeof TextEncoder === 'function') {
      const bytes = new TextEncoder().encode(str);
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      return globalThis.btoa(bin);
    }
    return globalThis.btoa(str);
  }
  if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf-8').toString('base64');
  throw new ConnectorError(ConnectorErrorCode.BAD_REQUEST, 'basicAuth: no base64 implementation available');
}

/** Set a header on the descriptor without mutating the caller's object. */
function withHeader(req, name, value) {
  return { ...req, headers: { ...(req.headers || {}), [name]: value } };
}

/** A no-op strategy (public sources / auth handled upstream). */
export function noAuth() {
  return (req) => req;
}

/**
 * Bearer token — `Authorization: Bearer <token>`.
 * @param {string} token
 * @returns {import('./types.js').AuthStrategy}
 */
export function bearerAuth(token) {
  if (!token || typeof token !== 'string') {
    throw new ConnectorError(ConnectorErrorCode.BAD_REQUEST, 'bearerAuth: a token string is required');
  }
  return (req) => withHeader(req, 'authorization', `Bearer ${token}`);
}

/**
 * API key in an arbitrary header — e.g. `apiKeyAuth({ header: 'x-api-key', key })`.
 * @param {{ header: string, key: string }} args
 * @returns {import('./types.js').AuthStrategy}
 */
export function apiKeyAuth({ header, key } = {}) {
  if (!header || !key) {
    throw new ConnectorError(ConnectorErrorCode.BAD_REQUEST, 'apiKeyAuth: `header` and `key` are required');
  }
  return (req) => withHeader(req, header.toLowerCase(), key);
}

/**
 * HTTP Basic — `Authorization: Basic base64(user:pass)`.
 * @param {{ user: string, pass: string }} args
 * @returns {import('./types.js').AuthStrategy}
 */
export function basicAuth({ user, pass } = {}) {
  if (user == null || pass == null) {
    throw new ConnectorError(ConnectorErrorCode.BAD_REQUEST, 'basicAuth: `user` and `pass` are required');
  }
  return (req) => withHeader(req, 'authorization', `Basic ${base64(`${user}:${pass}`)}`);
}

/**
 * OAuth SEAM (v0). No real authorization-code / client-credentials flow here — instead an
 * injected `tokenProvider()` yields a (possibly refreshed) access token, and we attach it as a
 * Bearer. The whole point is that the flow that MINTS the token is injected, so this substrate
 * carries no OAuth machinery and stays self-contained. A later slice can implement a real
 * token-provider adapter (refresh, expiry, PKCE) that satisfies this same seam.
 *
 * @param {{ tokenProvider: () => (string | Promise<string>), scheme?: string }} args
 * @returns {import('./types.js').AuthStrategy}
 */
export function oauthAuth({ tokenProvider, scheme = 'Bearer' } = {}) {
  if (typeof tokenProvider !== 'function') {
    throw new ConnectorError(ConnectorErrorCode.BAD_REQUEST, 'oauthAuth: an injected `tokenProvider()` is required');
  }
  return async (req) => {
    const token = await tokenProvider();
    if (!token) throw new ConnectorError(ConnectorErrorCode.AUTH, 'oauthAuth: tokenProvider yielded no token');
    return withHeader(req, 'authorization', `${scheme} ${token}`);
  };
}
