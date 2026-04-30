/**
 * serviceBuilder — bridges the C2 ServiceContext to the C1 RN
 * serviceFactory + a real PodClient.
 *
 * Two responsibilities:
 *
 *   1. `defaultPodFactory(cfg, oidc)` — build an authenticated
 *      `PodClient` from `OidcSessionRN`.  Mirrors the desktop
 *      `apps/folio/src/cli/_podFactory.js` `buildRealPodClient` shim
 *      but uses `OidcSessionRN.getAuthenticatedFetch()` instead of the
 *      Inrupt Node session.
 *
 *   2. `buildEngineForRN({ podClient, ... })` — thin pass-through to
 *      `@canopy-app/folio/rn/serviceFactory.createSyncEngine`.  Kept
 *      as its own export so tests can stub C1 without re-implementing
 *      the entire ServiceContext.
 *
 * Why we don't import directly from `@inrupt/solid-client-authn-node`
 * --------------------------------------------------------------------
 * That lib is Node-only.  See `OidcSessionRN.js` header for the
 * rationale — we run the OIDC dance via expo-auth-session and inject
 * a bearer-token fetch manually.
 */

/**
 * Build a real `PodClient` from `OidcSessionRN`.
 *
 * @param {{ podRoot: string }} cfg
 * @param {import('../auth/OidcSessionRN.js').OidcSessionRN} oidc
 * @returns {Promise<object>}  PodClient instance
 */
export async function defaultPodFactory(cfg, oidc) {
  if (!cfg?.podRoot) throw new Error('defaultPodFactory: cfg.podRoot required');
  if (!oidc)         throw new Error('defaultPodFactory: oidc session required');

  // Lazy-load the pod-client package so unit tests that mock this
  // factory entirely never need to resolve it.
  const { PodClient, SolidOidcAuth } = await import('@canopy/pod-client');

  const authVault = {
    getAuthenticatedFetch: () => oidc.getAuthenticatedFetch(),
    get webid() { return oidc.webid; },
    refresh: async () => { /* v0: no token refresh on mobile */ },
    logout:  async () => { await oidc.logout(); },
  };
  const auth = new SolidOidcAuth({ vault: authVault });

  return new PodClient({ podRoot: cfg.podRoot, auth });
}

/**
 * Pass-through to the C1 RN serviceFactory.  Exported as a separate
 * function so tests can mock it via `vi.mock(.../serviceBuilder)` without
 * having to mock a deep import.
 *
 * @param {object} args   Forwarded to `createSyncEngine` verbatim.
 * @returns {Promise<object>} SyncEngine instance
 */
export async function buildEngineForRN(args) {
  const mod = await import('@canopy-app/folio/rn/serviceFactory');
  return mod.createSyncEngine(args);
}
