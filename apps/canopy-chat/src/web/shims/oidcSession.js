/**
 * Browser shim for `@canopy/oidc-session`.
 *
 * The real package pulls in `@inrupt/solid-client-authn-node` + the
 * Node-only `openid-client`.  canopy-chat v0.1 ships pre-signed-in
 * (per OQ-1.A) and never touches the OIDC code path; a future
 * cleanup should split @canopy/oidc-session into a browser-compat
 * + Node-only entry point.
 *
 * Until then this shim provides stub named exports matching
 * @canopy/oidc-session's `index.js` so esbuild (Vite's dep
 * pre-bundler in dev mode) can resolve the `import { SolidVault }`
 * in @canopy/core's `src/index.js`.  Stubs throw at use-time so a
 * mistaken call surfaces visibly rather than failing silently.
 */

function notImplemented(name) {
  return () => {
    throw new Error(
      `${name} is not available in the browser bundle. ` +
      `OIDC handoff lands in canopy-chat v0.6 via J6 (see ` +
      `/DESIGN-canopy-chat.md § Phase v0.6).`,
    );
  };
}

export const SolidVault         = notImplemented('SolidVault');
export const _setSessionFactory = notImplemented('_setSessionFactory');
export const KNOWN_ISSUERS      = {};
export const DEFAULT_ISSUER_ID  = null;
export const DEFAULT_ISSUER     = null;
export const resolveIssuer      = notImplemented('resolveIssuer');
