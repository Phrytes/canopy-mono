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

import { createRouter } from './routes.js';
import { WsHub }        from './wsHub.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8888;

/**
 * @param {object} deps
 * @param {object} deps.engine     SyncEngine (or compatible mock)
 * @param {object} [deps.podClient] PodClient — used for /status's pod scan;
 *                                  optional in tests that set engine.__podClient.
 * @param {object} [deps.vault]    Vault* used by /share when no identity is provided
 * @param {object} [deps.identity] AgentIdentity (optional; lazily derived from vault)
 * @returns {{
 *   app: import('express').Express,
 *   server: import('http').Server,
 *   hub: WsHub,
 *   listen: (port?:number, host?:string) => Promise<{ port:number, host:string }>,
 *   close:  () => Promise<void>,
 * }}
 */
export function createServer({ engine, podClient, vault, identity } = {}) {
  if (!engine) throw new Error('createServer: engine is required');

  const app    = express();
  const server = http.createServer(app);
  const hub    = new WsHub({ engine });

  // Liveness probe — handy for the tray-bar app to know when the server is up.
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  app.use(createRouter({ engine, podClient, vault, identity, hub }));

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
    await new Promise((resolve) => server.close(() => resolve()));
    // Best-effort engine teardown.  Don't throw — the caller may still want to
    // re-create another server immediately.
    if (engine.__watching) {
      try { await engine.stop(); } catch { /* ignore */ }
      engine.__watching = false;
    }
  }

  return { app, server, hub, listen, close };
}

export { WsHub } from './wsHub.js';
export { createRouter } from './routes.js';
