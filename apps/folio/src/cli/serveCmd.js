/**
 * folio serve — boot the local web server (Express + WebSocket) on
 * 127.0.0.1:8888 and keep it running until SIGINT / SIGTERM.
 *
 * Wires:
 *   - engine   → real SyncEngine over a PodClient (mock OR Solid OIDC)
 *   - vault    → VaultNodeFs at cfg.vaultPath (used by /share + /auth)
 *   - identity → not pre-derived; /share lazy-derives on demand
 *   - oidc     → an `OidcSession` that owns the user's Solid OIDC tokens.
 *                On boot, we call `restoreFromVault()` so the user does
 *                not have to re-sign-in across restarts.  If the
 *                refresh-token grant succeeds, the engine is rebuilt with
 *                a real PodClient.
 *
 * Flags:
 *   --port  <n>       (default 8888)
 *   --host  <ip>      (default 127.0.0.1; do NOT bind to 0.0.0.0)
 *   --watch           start the SyncEngine watcher immediately
 */
import { VaultNodeFs }     from '@canopy/core';

import { SyncEngine }      from '../SyncEngine.js';
import { requireConfig }   from './_config.js';
import { buildPodClient }  from './_podFactory.js';
import { OidcSession }     from '../auth/OidcSession.js';

import { createServer }      from '../server/index.js';
import { SyncErrorBuffer }   from '../server/errorBuffer.js';
import { startTray }         from '../tray/index.js';

export async function serveCmd(args) {
  const flags = parseFlags(args);
  const port  = flags.port ? Number(flags.port) : 8888;
  const host  = flags.host ?? '127.0.0.1';
  const watch = !!flags.watch;
  // Folio v2.7 — `folio serve` auto-launches the menubar tray.  Pass
  // `--no-tray` to suppress (e.g. headless servers, CI).  We can also
  // suppress via FOLIO_NO_TRAY=1 for service-mode boots that already
  // own the tray.
  const noTray = !!flags['no-tray'] || process.env.FOLIO_NO_TRAY === '1';

  if (!Number.isFinite(port) || port < 0 || port > 65_535) {
    throw new Error('--port must be a number in [0, 65535]');
  }

  const cfg   = await requireConfig();
  const vault = cfg.vaultPath ? new VaultNodeFs(cfg.vaultPath) : null;

  // Owners and order:
  //   1. Wire the OidcSession + try to restore from the vault.
  //   2. Pick the right PodClient based on (env mock | OIDC | none).
  //   3. Build the SyncEngine on top.
  //   4. Hand all of it to createServer.
  let oidc = null;
  if (vault) {
    oidc = new OidcSession({ vault });
    const restored = await oidc.restoreFromVault({
      onWarning: (msg) => process.stderr.write(`folio serve: oidc restore: ${msg}\n`),
    });
    if (restored) {
      process.stdout.write(
        `folio serve — restored OIDC session for ${oidc.webid ?? '<unknown webid>'}\n`,
      );
    }
  }

  const podClient = await safeBuildPodClient(cfg, { oidc });
  const engine    = new SyncEngine({
    podClient: podClient ?? makeOfflinePodStub(cfg),
    localRoot:      cfg.localRoot,
    podRoot:        cfg.podRoot,
    pollIntervalMs: cfg.intervalMs ?? 60_000,
  });

  // Folio v2.2 — own the error ring buffer at the CLI level.  Capacity 50,
  // in-memory only (does NOT survive restart).  Attach to the engine BEFORE
  // we create the server so any startup error fired during the createServer
  // wiring still lands in the buffer.
  const errorBuffer = new SyncErrorBuffer({ capacity: 50 });
  errorBuffer.attachEngine(engine);

  const { app, hub, listen, close } = createServer({
    engine,
    podClient: podClient ?? undefined,
    vault,
    oidc: oidc ?? undefined,
    errorBuffer,
    // Folio v2.1: forward `cfg` so the auth router can build a real PodClient
    // on /auth/callback success and hot-swap it into the live engine.
    cfg,
  });

  engine.on('error', (e) => {
    process.stderr.write(`folio serve: ${e.phase}: ${e.relPath ?? ''} ${e.err?.message ?? ''}\n`);
  });

  const { port: actualPort, host: actualHost } = await listen(port, host);
  process.stdout.write(
    `folio serve — listening on http://${actualHost}:${actualPort}  ` +
    `(WebSocket: ws://${actualHost}:${actualPort}/events)\n`,
  );
  if (!podClient) {
    process.stdout.write(
      `folio serve — pod NOT authenticated; sign in via http://${actualHost}:${actualPort}/ to enable sync.\n`,
    );
  }

  if (watch) {
    engine.start();
    engine.__watching = true;
    hub.broadcast({ type: 'status', stats: engine.stats, watching: true });
    process.stdout.write(`folio serve — watcher started\n`);
  }

  // Folio v2.7 — auto-launch the menubar tray.  Best-effort: failures don't
  // block the server from running headless.  A SIGTERM / SIGINT (or POST
  // /shutdown) will tear the tray down alongside the server.
  let trayHandle = null;
  if (!noTray) {
    try {
      trayHandle = await startTray({
        statusUrl: `http://${actualHost}:${actualPort}/status`,
        openUrl:   `http://${actualHost}:${actualPort}`,
        localRoot: cfg.localRoot,
      });
      process.stdout.write(`folio serve — menubar tray started\n`);
    } catch (err) {
      process.stderr.write(`folio serve — menubar tray failed to start: ${err?.message ?? err}\n`);
    }
  }

  let stopping = false;
  const stop = async (sig) => {
    if (stopping) return;
    stopping = true;
    process.stdout.write(`\nfolio serve: ${sig} received, stopping…\n`);
    // Safety net: if graceful shutdown takes more than 4s, force-exit.
    // The fix in server/index.js (closeAllConnections) should make this
    // unreachable in practice, but a stuck plugin (tray, watcher) must
    // never be able to wedge the terminal.
    const hardExit = setTimeout(() => {
      process.stdout.write(`folio serve: shutdown hung past 4s — hard exit\n`);
      process.exit(1);
    }, 4000);
    hardExit.unref?.();
    try {
      if (trayHandle) {
        try { await trayHandle.stop(); } catch { /* ignore */ }
      }
      try { errorBuffer.close(); } catch { /* ignore */ }
      await close();
    } finally {
      clearTimeout(hardExit);
      process.exit(0);
    }
  };
  process.on('SIGINT',  () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  // Folio v2.7 — POST /shutdown calls back into this stop() so the route
  // layer can trigger graceful shutdown.  The route handler reads
  // `app.locals.folioShutdown` lazily so this assignment timing is fine.
  app.locals.folioShutdown = () => stop('POST /shutdown');

  // Park.
  await new Promise(() => {});
}

/**
 * Try to build a PodClient.  Swallows the unauthenticated error so the
 * server can still boot (and serve the sign-in flow).  Other errors propagate.
 */
async function safeBuildPodClient(cfg, deps) {
  try {
    return await buildPodClient(cfg, deps);
  } catch (err) {
    if (err?.message?.startsWith('pod authentication required')) {
      return null;
    }
    throw err;
  }
}

/**
 * A throwing stub for pre-auth boot.  Calls fail with a clear message; the
 * web UI's /auth/* routes are still served.  Once the user signs in (Folio
 * v2.1), the auth-callback route hot-swaps a real PodClient into the live
 * engine — no `folio serve` restart needed.
 */
function makeOfflinePodStub(cfg) {
  const err = () => Object.assign(
    new Error('Folio is not signed in to a Solid pod yet — sign in at the web UI, then restart `folio serve`.'),
    { code: 'NOT_AUTHENTICATED' },
  );
  return {
    podRoot:        cfg.podRoot,
    async read()         { throw err(); },
    async write()        { throw err(); },
    async list()         { throw err(); },
    async delete()       { throw err(); },
    async deleteLocal()  { throw err(); },
    async clearTombstone(){ throw err(); },
    on() {} , off() {} , emit() {},
  };
}

function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}
