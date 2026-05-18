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
 *
 * ── Session-injection seam (Tasks V2 Slice 5 / mobile S5, 2026-05-18) ──
 *
 * The default OIDC session is the Node browser-redirect
 * `createSolidAuthNode` (web path — UNCHANGED). React Native cannot
 * use it (`@inrupt/solid-client-authn-browser` needs `window`), and
 * its RN equivalent (`@canopy/oidc-session-rn`) acquires tokens via a
 * hook-driven PKCE flow + `adoptTokens(tokens)` rather than
 * `start()`/`handleCallback()`. So an OPTIONAL `sessionFactory`
 * argument may be threaded through all four operations to inject the
 * device-specific session — mirrors the existing `dataSourceFactory`
 * seam in `completePodSignIn`. When omitted, behaviour is
 * byte-identical to before (lazy `createSolidAuthNode`).
 *
 * `completePodSignIn` additionally accepts an alternative `tokens`
 * input: when the caller already holds OIDC tokens (the RN hook
 * path), it adopts them onto the (injected) session instead of
 * running `handleCallback(callbackUrl)`. The shareable post-auth
 * orchestration — `derivePodRoot` → `SolidPodSource` →
 * `dataSource.attachInner` → status/sign-out — stays common to both
 * platforms. Web callers pass `callbackUrl` exactly as before.
 */

import { SolidPodSource } from '@canopy/core';
import { createSolidAuthNode } from '@canopy/oidc-session';
import { attachTasksBundle, detachTasksBundle } from './attachTasksBundle.js';

/** Lazily build a vault for OIDC token storage. */
function defaultVault() {
  const m = new Map();
  return {
    async get(k)    { return m.get(k); },
    async set(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
  };
}

/**
 * Ensure `crew.oidcSession` exists, building it via the default Node
 * factory unless an injected `sessionFactory` is supplied.
 *
 * @param {object} crew
 * @param {(opts: {vault: object, clientName: string}) => object} [sessionFactory]
 *   Optional. When provided, used INSTEAD of `createSolidAuthNode`
 *   to construct the per-crew session. The default (no factory) path
 *   is unchanged — same lazy `createSolidAuthNode({vault, clientName})`
 *   call the web app has always used.
 */
function ensureSession(crew, sessionFactory) {
  if (!crew.oidcSession) {
    const make = typeof sessionFactory === 'function'
      ? sessionFactory
      : createSolidAuthNode;
    crew.oidcSession = make({
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
export async function startPodSignIn({ crew, issuer, redirectUrl, sessionFactory }) {
  if (!crew?.dataSource || typeof crew.dataSource.attachInner !== 'function') {
    return { ok: false, error: 'crew missing CachingDataSource (was cache: false?)' };
  }
  if (!issuer)      return { ok: false, error: 'issuer required' };
  if (!redirectUrl) return { ok: false, error: 'redirectUrl required' };

  const oidc = ensureSession(crew, sessionFactory);
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
 *
 * Two mutually-exclusive auth-completion inputs:
 *   - `callbackUrl` (web / Node default): runs
 *     `oidc.handleCallback(callbackUrl)` on the existing session
 *     created by `startPodSignIn`. UNCHANGED behaviour.
 *   - `tokens` (RN path): the caller already ran the PKCE flow (the
 *     `@canopy/oidc-session-rn` hook) and holds tokens. We adopt
 *     them onto the (optionally injected) session. `startPodSignIn`
 *     need not have run first in this mode.
 *
 * @param {object}   args.crew
 * @param {string}   [args.callbackUrl]        web path
 * @param {object}   [args.tokens]             RN path (adoptTokens)
 * @param {Function} [args.dataSourceFactory]  existing seam (unchanged)
 * @param {Function} [args.sessionFactory]     session-injection seam
 */
export async function completePodSignIn({
  crew, callbackUrl, tokens, dataSourceFactory, sessionFactory,
}) {
  if (!crew?.dataSource || typeof crew.dataSource.attachInner !== 'function') {
    return { ok: false, error: 'crew missing CachingDataSource (was cache: false?)' };
  }

  let oidc;
  let info;
  if (tokens) {
    // RN path — adopt pre-acquired tokens onto the (injected)
    // session. ensureSession honours an injected sessionFactory; the
    // RN caller injects an `OidcSessionRN`-shaped session whose
    // `adoptTokens` persists the bearer token.
    oidc = ensureSession(crew, sessionFactory);
    if (typeof oidc.adoptTokens !== 'function') {
      return { ok: false, error: 'session does not support adoptTokens (tokens path needs an RN-style session)' };
    }
    try {
      await oidc.adoptTokens(tokens);
    } catch (err) {
      return { ok: false, error: err?.message ?? String(err) };
    }
    info = { webid: tokens.webid ?? oidc.webid ?? null };
  } else {
    // Web path — UNCHANGED. Requires a session started by
    // startPodSignIn, then handleCallback(callbackUrl).
    if (!crew?.oidcSession) {
      return { ok: false, error: 'no sign-in in progress; call startPodSignIn first' };
    }
    oidc = crew.oidcSession;
    try {
      info = await oidc.handleCallback(callbackUrl);
    } catch (err) {
      return { ok: false, error: err?.message ?? String(err) };
    }
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

  // M4: device-independent pod-attach activation — the SAME helper
  // tasks-mobile's ServiceContext.attachPod calls. Wires setAnchor +
  // _podCtx (classify/reverse) + cache.attachInner so routing/
  // provisioning behave identically on web and mobile (platform-parity
  // principle, mirror of stoop commit 11a269a).
  //
  // `crew` here is a `{dataSource: CachingDataSource, …}` shaped holder
  // — it maps to `bundle.cache` in the attachTasksBundle contract.
  // We adapt: pass `cache: crew.dataSource` as the bundle so the helper
  // calls `crew.dataSource.attachInner(inner)`.
  const bundleProxy = {
    cache:             crew.dataSource,
    _podCtx:           crew._podCtx     ?? null,
    podRouting:        crew.podRouting  ?? null,
    pseudoPod:         crew.pseudoPod   ?? null,
    substrateDeviceId: crew.substrateDeviceId ?? null,
    crewId:            crew.crewId      ?? null,
  };
  await attachTasksBundle({
    bundle: bundleProxy,
    source: inner,
    podRoot,
    webid:  info?.webid ?? oidc.webid ?? null,
    fetch:  fetchFn,
    crewId: crew.crewId ?? null,
  });

  return { ok: true, webid: info?.webid ?? oidc.webid ?? null, podRoot };
}

/** Detach inner + clear OIDC session. Local cache is preserved. */
export async function signOutOfPod({ crew }) {
  // M4: deactivate routing (_podCtx.active = false + revert anchor).
  detachTasksBundle({ bundle: { _podCtx: crew?._podCtx ?? null, podRouting: crew?.podRouting ?? null } });
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
