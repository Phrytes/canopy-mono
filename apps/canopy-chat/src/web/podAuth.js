/**
 * **Platform: web** — composes `@inrupt/solid-client-authn-browser`.
 *
 * canopy-chat — real Solid OIDC auth wrapper (J6 real binding).
 *
 * v0.7.P1 (2026-05-23): replaces the v0.6.2 mock externalFlow with
 * a real Inrupt redirect-based OIDC flow.
 *
 *   - `start({issuer, redirectUrl, clientName})` — triggers a full-
 *     page redirect to the chosen Solid OIDC issuer.  After the
 *     user authenticates, the issuer redirects back to redirectUrl.
 *   - `handleRedirect({restorePreviousSession?})` — runs on every
 *     page load; if the URL carries an Inrupt redirect (?code=...
 *     &state=...&iss=...), completes the OIDC exchange + restores
 *     the session.  Returns `{webid, isLoggedIn, fetch}` or null.
 *   - `getCurrentSession()` — pulls the live session (null when
 *     logged out).
 *   - `signOut()` — clears the session + persisted state.
 *
 * Session shape returned by the helpers:
 *   { webid: string, isLoggedIn: boolean, fetch: typeof fetch }
 *
 * The authenticated `fetch` is what unlocks real pod attach
 * (v0.7.P2 — pseudo-pod cache mode + @canopy/pod-client).
 *
 * Sister module: @canopy/oidc-session (Node) + @canopy/oidc-session-rn
 * (React Native).  No browser substrate yet; when a second browser
 * consumer appears, this wrapper gets extracted to
 * `@canopy/oidc-session-browser` per the rule-of-two precedent.
 *
 * Test seam: the `injectAuth(impl)` export lets tests substitute a
 * fake login() / getDefaultSession() / handleIncomingRedirect();
 * production code uses the real Inrupt module.
 */

import {
  login,
  handleIncomingRedirect,
  getDefaultSession,
  logout,
} from '@inrupt/solid-client-authn-browser';

// Curated default issuer list.  Mirrors @canopy/oidc-session/issuers.js
// (canonical source) but copied here because we can't import a Node-
// only substrate into the browser bundle.
export const KNOWN_ISSUERS = Object.freeze([
  { id: 'inrupt',          name: 'Inrupt PodSpaces',         url: 'https://login.inrupt.com'   },
  { id: 'solidcommunity',  name: 'SolidCommunity.net',       url: 'https://solidcommunity.net' },
  { id: 'solidweb',        name: 'SolidWeb.org',             url: 'https://solidweb.org'       },
]);

export const DEFAULT_ISSUER_ID = 'inrupt';

/** Resolve an issuer by short id, URL, or undefined → default. */
export function resolveIssuer(idOrUrl) {
  if (!idOrUrl) return KNOWN_ISSUERS.find((i) => i.id === DEFAULT_ISSUER_ID);
  const known = KNOWN_ISSUERS.find((i) => i.id === idOrUrl || i.url === idOrUrl);
  if (known) return known;
  // Custom URL — treat as a one-off.
  try {
    const url = new URL(idOrUrl);
    return { id: 'custom', name: url.host, url: url.origin };
  } catch {
    return null;
  }
}

let authImpl = { login, handleIncomingRedirect, getDefaultSession, logout };

/**
 * Test seam — swap the auth module functions for tests.  Production
 * code calls the helpers below which delegate to `authImpl`.
 */
export function _injectAuth(impl) {
  authImpl = { ...authImpl, ...impl };
}

/**
 * Start the OIDC redirect dance.  Returns a promise that NEVER
 * resolves on success — the browser navigates away.  Resolves with
 * an error if the redirect setup fails.
 *
 * @param {object} opts
 * @param {string}  opts.issuer       short id ('inrupt') / URL / custom
 * @param {string}  [opts.redirectUrl=window.location.href]
 * @param {string}  [opts.clientName='canopy-chat']
 */
export async function startSignIn({ issuer, redirectUrl, clientName } = {}) {
  const resolved = resolveIssuer(issuer);
  if (!resolved) throw new Error(`Unknown issuer "${issuer}"`);
  const redirect = redirectUrl
    ?? (typeof window !== 'undefined' ? window.location.href : undefined);
  if (!redirect) throw new Error('redirectUrl required (no window)');
  await authImpl.login({
    oidcIssuer:  resolved.url,
    redirectUrl: redirect,
    clientName:  clientName ?? 'canopy-chat',
  });
}

/**
 * Complete the OIDC round-trip on page load.  Returns the session
 * snapshot OR null if not signed in.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.restorePreviousSession=true]
 * @returns {Promise<{ webid: string, isLoggedIn: boolean, fetch: typeof fetch } | null>}
 */
export async function handleRedirect({ restorePreviousSession = true } = {}) {
  await authImpl.handleIncomingRedirect({ restorePreviousSession });
  return getCurrentSession();
}

/**
 * Synchronous read of the current session.
 *
 * @returns {{ webid: string, isLoggedIn: boolean, fetch: typeof fetch } | null}
 */
export function getCurrentSession() {
  const sess = authImpl.getDefaultSession();
  if (!sess?.info?.isLoggedIn) return null;
  return {
    webid:       sess.info.webId,
    isLoggedIn:  true,
    fetch:       sess.fetch.bind(sess),
  };
}

/**
 * Sign out — clears the session AND removes any persisted tokens.
 *
 * @param {object} [opts]
 * @param {string} [opts.postLogoutUrl=window.location.href]
 */
export async function signOut({ postLogoutUrl } = {}) {
  const sess = authImpl.getDefaultSession();
  if (sess?.info?.isLoggedIn) {
    // Inrupt's logout has two paths: 'app' (local-only) + 'idp' (full
    // round-trip).  Default: app-only so the user stays on the page.
    await authImpl.logout({ logoutType: 'app' });
  }
  if (postLogoutUrl && typeof window !== 'undefined') {
    window.location.href = postLogoutUrl;
  }
}
