/**
 * canopy-chat — Vite config for the v0.1.4 static web demo.
 *
 * Build pipeline (sub-slice 1.12): outputs to `dist/` for deploy to
 * any static host (or the user's pod once that flow exists in v0.6).
 *
 * Dev server: `pnpm --filter @canopy-app/canopy-chat dev` boots Vite
 * on port 5173 with hot reload.
 */

import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const empty       = fileURLToPath(new URL('./src/web/shims/empty.js',       import.meta.url));
const oidcSession = fileURLToPath(new URL('./src/web/shims/oidcSession.js', import.meta.url));

export default defineConfig({
  root: 'web',
  // Allow imports from outside `web/` (the src/ + locales/ trees).
  server: { fs: { allow: ['..'] } },
  // OQ-1.C resolution: @canopy/core transports use runtime detection
  // (`typeof WebSocket !== 'undefined'` etc.) and fall back to Node-
  // only packages via `await import('ws' | 'mqtt' | …)`.  In the
  // browser those fallback branches NEVER execute, but Rollup still
  // walks the dynamic-import targets at bundle time and fails if it
  // can't resolve them.  Aliasing to an empty module makes the build
  // clean without changing runtime behaviour.  The transports we
  // actually USE in the browser (RelayTransport via globalThis.WebSocket,
  // InternalTransport, NknTransport via its browser SDK if loaded) all
  // take a different branch and don't hit these shims.
  resolve: {
    alias: {
      'ws':              empty,
      'mqtt':            empty,
      // v0.7.P3b 2026-05-23 — 'nkn-sdk' kept shimmed.  The real lib
      // arrives via the CDN <script> tag in index.html (window.nkn).
      // Vite's dynamic-import resolution still needs SOMETHING to
      // resolve the bare 'nkn-sdk' specifier; the empty shim does
      // exactly that (the dynamic-import path in NknTransport never
      // executes when window.nkn is supplied as opts.nknLib).
      'nkn-sdk':         empty,
      'js-yaml':         empty,
      'node-datachannel': empty,
      // Node-builtin polyfills via empty module — these are reached
      // only through the Node-only A2A + PodExporter paths.
      'node:fs/promises': empty,
      'node:path':        empty,
      'node:crypto':      empty,
      'http':             empty,
      // 'node:events' has a real browser polyfill (`events`); some
      // substrates (SolidVault, WebIdCache) statically import it.
      // We don't EXECUTE those code paths in v0.1, but they're in the
      // import graph so they need to resolve.
      'node:events': 'events',
      // OIDC chain — @canopy/core re-exports SolidVault from
      // @canopy/oidc-session, which pulls in Inrupt's Node-only auth
      // package + openid-client (which uses node:crypto, node:http,
      // node:util, ...).  canopy-chat v0.1 ships PRE-SIGNED-IN per
      // OQ-1.A; OIDC handoff lands in v0.6 via J6.  Until then we stub
      // the whole OIDC tree.  A future cleanup should split
      // @canopy/oidc-session into browser-compat + Node-only entry
      // points (existing @canopy/oidc-session-rn shows the pattern).
      //
      // The OIDC shim provides NAMED exports matching the real
      // package's index.js (SolidVault, KNOWN_ISSUERS, …) because
      // esbuild (Vite's dep pre-bundler in dev mode) is stricter
      // than rollup about named-export resolution.  The other
      // entries point at the bare empty module because their
      // imports happen via dynamic-import (never executed).
      '@canopy/oidc-session':                 oidcSession,
      '@inrupt/solid-client-authn-node':      empty,
      // v0.7.P1 — DON'T shim '@inrupt/solid-client-authn-core'.  We
      // now compose '@inrupt/solid-client-authn-browser' for real
      // OIDC; the browser package depends on the core package's
      // type/util exports (e.g. determineSigningAlg).  Stubbing it
      // breaks the build with 'X is not exported by empty.js'.  The
      // Node auth package stays shimmed (separate name).
      'openid-client':                        empty,
      // VaultNodeFs is Node-only by design — VaultMemory is what we
      // use in v0.1.  Stubbing keeps the @canopy/vault index re-export
      // happy.
      // (No alias needed — VaultNodeFs guards its `fs` import at use-
      // time, but the static `node:fs` import would still trip Rollup.
      // Vite's externalized-for-browser warning above is fine because
      // VaultNodeFs's code path is never invoked in browsers.)
    },
  },
  build:  {
    outDir:      '../dist',
    emptyOutDir: true,
    target:      'es2022',
    rollupOptions: {
      input: 'web/index.html',
    },
  },
});
