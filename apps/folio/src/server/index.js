/**
 * Folio.B1.server — Express + WebSocket entry point.
 *
 * Binds to 127.0.0.1:8888 by default.  The web UI (B1.ui, separate agent)
 * consumes the REST contract documented at the top of `routes.js`.
 *
 * Usage:
 *
 *   import { createServer } from '@canopy-app/folio/server';
 *
 *   const { server, hub, listen, close } = createServer({ engine, vault });
 *   await listen(8888, '127.0.0.1');
 *   // …
 *   await close();
 *
 * The factory accepts injected `{ engine, vault, identity }` so tests can
 * supply mocks; the CLI's `serve` command wires real instances.
 */

import express from 'express';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createRouter }     from './routes.js';
import { WsHub }            from './wsHub.js';
import { createAuthRouter } from '../auth/authRoutes.js';
import { SyncErrorBuffer }  from './errorBuffer.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8888;

const STATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'static');

/**
 * @param {object} deps
 * @param {object} deps.engine     SyncEngine (or compatible mock)
 * @param {object} [deps.podClient] PodClient — used for /status's pod scan;
 *                                  optional in tests that set engine.__podClient.
 * @param {object} [deps.vault]    Vault* used by /share when no identity is provided
 * @param {object} [deps.identity] AgentIdentity (optional; lazily derived from vault)
 * @param {object} [deps.oidc]     OidcSession (optional; if provided, mounts /auth/* routes)
 * @param {string} [deps.oidcCallbackUrl] explicit callback URL forwarded to authRoutes;
 *                                        defaults to <inbound-host>/auth/callback.
 * @param {object} [deps.cfg]      Folio config (needs `podRoot`).  Forwarded to
 *                                 the auth router so v2.1's hot-swap can build
 *                                 a real PodClient at callback time.
 * @param {(cfg, oidc) => Promise<object>} [deps.buildPodClient] override for
 *                                 the v2.1 hot-swap; tests inject a fake.
 * @returns {{
 *   app: import('express').Express,
 *   server: import('http').Server,
 *   hub: WsHub,
 *   listen: (port?:number, host?:string) => Promise<{ port:number, host:string }>,
 *   close:  () => Promise<void>,
 * }}
 */
export function createServer({ engine, podClient, vault, identity, oidc, oidcCallbackUrl, errorBuffer, cfg, buildPodClient, runDiagnostics, diagnosticsDeps } = {}) {
  if (!engine) throw new Error('createServer: engine is required');

  const app    = express();
  const server = http.createServer(app);
  const hub    = new WsHub({ engine });

  // Folio v2.2 — in-memory error history fed by the engine.  Caller may
  // inject one (tests do this for control); otherwise we build + attach a
  // default-capacity buffer so /status always carries a `lastError` + `errors`.
  const errBuf = errorBuffer ?? new SyncErrorBuffer();
  if (!errorBuffer) {
    // We constructed it; we own its subscription.
    errBuf.attachEngine(engine);
  }

  // Stash the OIDC session on app.locals so route handlers + tests can
  // read or replace it without reaching into module state.
  if (oidc) app.locals.oidc = oidc;

  // Liveness probe — handy for the tray-bar app to know when the server is up.
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  // Single-page web UI (B1.ui).  Served from the bundled static dir.
  // Mounted BEFORE the API router so the SPA shell at `/` is found first;
  // any path that isn't a file falls through to the router (which handles
  // /status, /conflicts, /share, etc., and emits its own 404 for anything
  // unmatched — preserving the JSON-error shape REST tests expect).
  app.use(express.static(STATIC_DIR, {
    index:       'index.html',
    fallthrough: true,
    maxAge:      0,
    etag:        false,
  }));

  // Auth routes (Folio.B1.auth) — mounted before the main API router so the
  // /auth/* paths reach their handlers, and so the main router's 404
  // catch-all only sees genuinely-unknown paths.
  if (oidc) {
    app.use(createAuthRouter({
      oidc,
      callbackUrl: oidcCallbackUrl,
      // Folio v2.1 wiring: pass engine / cfg / hub / buildPodClient so the
      // /auth/callback handler can hot-swap the PodClient on success.
      engine,
      cfg,
      hub,
      buildPodClient,
    }));
  }

  app.use(createRouter({
    engine, podClient, vault, identity, hub,
    errorBuffer: errBuf,
    runDiagnostics, diagnosticsDeps,
  }));

  hub.attach(server);

  /**
   * @param {number} [port=8888]
   * @param {string} [host='127.0.0.1']  pass 0 for an ephemeral test port.
   */
  function listen(port = DEFAULT_PORT, host = DEFAULT_HOST) {
    return new Promise((resolve, reject) => {
      const onError = (err) => { server.removeListener('listening', onListening); reject(err); };
      const onListening = () => {
        server.removeListener('error', onError);
        const addr = server.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : port;
        const actualHost = typeof addr === 'object' && addr ? addr.address : host;
        resolve({ port: actualPort, host: actualHost });
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
  }

  async function close() {
    await hub.close();
    // Drop the engine subscription if we own the buffer.  Tests that injected
    // their own buffer keep it alive across createServer() lifecycles.
    if (!errorBuffer) {
      try { errBuf.close(); } catch { /* ignore */ }
    }
    await new Promise((resolve) => server.close(() => resolve()));
    // Best-effort engine teardown.  Don't throw — the caller may still want to
    // re-create another server immediately.
    if (engine.__watching) {
      try { await engine.stop(); } catch { /* ignore */ }
      engine.__watching = false;
    }
  }

  return { app, server, hub, errorBuffer: errBuf, listen, close };
}

export { WsHub } from './wsHub.js';
export { createRouter } from './routes.js';
export { createAuthRouter } from '../auth/authRoutes.js';
export { OidcSession } from '../auth/OidcSession.js';
export { SyncErrorBuffer, attachErrorBuffer } from './errorBuffer.js';
