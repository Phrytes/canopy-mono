/**
 * podFactory — build an authenticated `PodClient` from an
 * `OidcSessionRN`.
 *
 * Mirrors `apps/folio/src/cli/_podFactory.js`'s desktop
 * `buildRealPodClient` (which uses `@inrupt/solid-client-authn-node`),
 * but uses `OidcSessionRN.getAuthenticatedFetch()` instead — the RN
 * runtime can't pull in the Inrupt Node lib.
 *
 * Lifted from `apps/folio-mobile/src/lib/serviceBuilder.js` 2026-05-08.
 *
 * The `OidcSessionRN` parameter is structurally typed: any object with
 * `{ getAuthenticatedFetch(), webid, logout() }` works.  Apps may pass
 * a session built by `@onderling/oidc-session-rn` (the canonical case)
 * or a hand-rolled compatible shape (e.g. test stubs).
 */

/**
 * Build a real `PodClient` from `OidcSessionRN`.
 *
 * @param {object} cfg
 * @param {string} cfg.podRoot
 * @param {object} oidc                       OidcSessionRN-compatible
 * @param {() => typeof fetch} oidc.getAuthenticatedFetch
 * @param {string|null} [oidc.webid]
 * @param {() => Promise<void>} [oidc.logout]
 * @returns {Promise<object>}                 PodClient instance
 */
export async function defaultPodFactory(cfg, oidc) {
  if (!cfg?.podRoot) throw new Error('defaultPodFactory: cfg.podRoot required');
  if (!oidc)         throw new Error('defaultPodFactory: oidc session required');
  if (typeof oidc.getAuthenticatedFetch !== 'function') {
    throw new Error('defaultPodFactory: oidc.getAuthenticatedFetch must be a function');
  }

  // Lazy-load the pod-client package so unit tests that mock this
  // factory entirely never need to resolve it.
  const { PodClient, SolidOidcAuth } = await import('@onderling/pod-client');

  const authVault = {
    getAuthenticatedFetch: () => oidc.getAuthenticatedFetch(),
    get webid() { return oidc.webid ?? null; },
    refresh: async () => { /* RN v0: refresh is OidcSessionRN's concern, not the auth vault */ },
    logout:  async () => { if (typeof oidc.logout === 'function') await oidc.logout(); },
  };
  const auth = new SolidOidcAuth({ vault: authVault });

  return new PodClient({ podRoot: cfg.podRoot, auth });
}
