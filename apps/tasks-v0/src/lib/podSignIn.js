/**
 * podSignIn — Tasks V2 substrate-adoption (2026-05-14).
 *
 * Mirror of Stoop's `apps/stoop/src/lib/podSignIn.js`. Glue between
 * `createSolidAuthNode` (browser-redirect Solid OIDC, via
 * `@canopy/oidc-session`) and the crew bundle's
 * `CachingDataSource`. Four operations:
 *
 *   - `startPodSignIn({ crew, issuer, redirectUrl })`
 *       → Kicks off OIDC. Returns the IdP authorize URL the browser
 *         should navigate to.
 *
 *   - `completePodSignIn({ crew, callbackUrl, dataSourceFactory? })`
 *       → After the IdP redirect lands on `redirectUrl`, completes
 *         the dance + builds a `SolidPodSource` (or whatever
 *         `dataSourceFactory` returns) + calls
 *         `crew.dataSource.attachInner(podSource)`. Returns
 *         `{ ok, webid, podRoot }`.
 *
 *   - `signOutOfPod({ crew })`
 *       → Clears OIDC session + detaches the inner DataSource (cache
 *         keeps local state so the user keeps working offline).
 *
 *   - `podSignInStatus({ crew })`
 *       → Read-only `{signedIn, webid, podAttached}`.
 *
 * The `oidcSession` instance lives on `crew.oidcSession` (lazily
 * created on first sign-in attempt; reused across attempts). Tasks
 * runs one crew per process today so per-crew session-state is fine;
 * when multi-crew runtime lands (TODO-GENERAL §"Tasks V2"), each
 * crew gets its own session slot.
 */

import { SolidPodSource } from '@canopy/core';
import { createSolidAuthNode } from '@canopy/oidc-session';

/** Lazily build a vault for OIDC token storage. */
function defaultVault() {
  const m = new Map();
  return {
    async get(k)    { return m.get(k); },
    async set(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
  };
}

function ensureSession(crew) {
  if (!crew.oidcSession) {
    crew.oidcSession = createSolidAuthNode({
      vault: crew.oidcVault ?? defaultVault(),
      clientName: 'Tasks',
    });
  }
  return crew.oidcSession;
}

/**
 * Phase 1 of sign-in. Returns `{ ok, redirectUrl }` where
 * `redirectUrl` is the IdP authorize URL the browser should
 * navigate to.
 */
export async function startPodSignIn({ crew, issuer, redirectUrl }) {
  if (!crew?.dataSource || typeof crew.dataSource.attachInner !== 'function') {
    return { ok: false, error: 'crew missing CachingDataSource (was cache: false?)' };
  }
  if (!issuer)      return { ok: false, error: 'issuer required' };
  if (!redirectUrl) return { ok: false, error: 'redirectUrl required' };

  const oidc = ensureSession(crew);
  try {
    const r = await oidc.start({ issuer, redirectUrl });
    return { ok: true, redirectUrl: r.redirectUrl };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/**
 * Phase 2 of sign-in. Completes the OIDC dance + attaches a
 * pod-backed DataSource to the crew's CachingDataSource.
 */
export async function completePodSignIn({ crew, callbackUrl, dataSourceFactory }) {
  if (!crew?.dataSource || typeof crew.dataSource.attachInner !== 'function') {
    return { ok: false, error: 'crew missing CachingDataSource (was cache: false?)' };
  }
  if (!crew?.oidcSession) {
    return { ok: false, error: 'no sign-in in progress; call startPodSignIn first' };
  }
  const oidc = crew.oidcSession;
  let info;
  try {
    info = await oidc.handleCallback(callbackUrl);
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
  if (!oidc.isAuthenticated()) {
    return { ok: false, error: 'callback succeeded but session not authenticated' };
  }

  const podRoot = await derivePodRoot(oidc, info?.webid);
  if (!podRoot) {
    return { ok: false, error: 'could not derive podRoot from WebID profile' };
  }
  const fetchFn = oidc.getAuthenticatedFetch();
  const inner = dataSourceFactory
    ? dataSourceFactory({ podUrl: podRoot, fetch: fetchFn })
    : new SolidPodSource({ podUrl: podRoot, fetch: fetchFn });
  await crew.dataSource.attachInner(inner);

  return { ok: true, webid: info?.webid ?? oidc.webid ?? null, podRoot };
}

/** Detach inner + clear OIDC session. Local cache is preserved. */
export async function signOutOfPod({ crew }) {
  if (crew?.dataSource?.attachInner) await crew.dataSource.attachInner(null);
  if (crew?.oidcSession?.logout) {
    try { await crew.oidcSession.logout(); } catch { /* best-effort */ }
  }
  crew.oidcSession = null;
  return { ok: true };
}

/** Read-only status. */
export function podSignInStatus({ crew }) {
  const oidc = crew?.oidcSession;
  if (!oidc) return { signedIn: false };
  return {
    signedIn:    oidc.isAuthenticated(),
    webid:       oidc.webid ?? null,
    podAttached: !!crew.dataSource?.hasInner,
  };
}

/**
 * Resolve the pod root from the WebID's profile. Tries the
 * `pim:storage` triple via the authenticated fetch; falls back to
 * the WebID's origin. Returns null if neither works.
 */
async function derivePodRoot(oidc, webid) {
  if (!webid) return null;
  try {
    const fetchFn = oidc.getAuthenticatedFetch();
    const res = await fetchFn(webid, {
      headers: { Accept: 'text/turtle, application/ld+json;q=0.9, */*;q=0.5' },
    });
    if (res.ok) {
      const body = await res.text();
      const m = body.match(/pim:storage\s*<([^>]+)>/) ?? body.match(/"http:\/\/www\.w3\.org\/ns\/pim\/space#storage"\s*:\s*\{?\s*"@id"\s*:\s*"([^"]+)"/);
      if (m?.[1]) return m[1];
    }
  } catch { /* fall through */ }
  try {
    const u = new URL(webid);
    return `${u.origin}/`;
  } catch {
    return null;
  }
}
