/**
 * folio serve — boot the local web server (Express + WebSocket) on
 * 127.0.0.1:8888 and keep it running until SIGINT / SIGTERM.
 *
 * Wires:
 *   - engine   → real SyncEngine over the configured PodClient
 *   - vault    → VaultNodeFs at cfg.vaultPath (used by /share)
 *   - identity → not pre-derived; /share lazy-derives on demand
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

import { createServer }    from '../server/index.js';

export async function serveCmd(args) {
  const flags = parseFlags(args);
  const port  = flags.port ? Number(flags.port) : 8888;
  const host  = flags.host ?? '127.0.0.1';
  const watch = !!flags.watch;

  if (!Number.isFinite(port) || port < 0 || port > 65_535) {
    throw new Error('--port must be a number in [0, 65535]');
  }

  const cfg       = await requireConfig();
  const podClient = await buildPodClient(cfg);
  const engine    = new SyncEngine({
    podClient,
    localRoot:      cfg.localRoot,
    podRoot:        cfg.podRoot,
    pollIntervalMs: cfg.intervalMs ?? 60_000,
  });
  const vault = cfg.vaultPath ? new VaultNodeFs(cfg.vaultPath) : null;

  const { hub, listen, close } = createServer({ engine, podClient, vault });

  engine.on('error', (e) => {
    process.stderr.write(`folio serve: ${e.phase}: ${e.relPath ?? ''} ${e.err?.message ?? ''}\n`);
  });

  const { port: actualPort, host: actualHost } = await listen(port, host);
  process.stdout.write(
    `folio serve — listening on http://${actualHost}:${actualPort}  ` +
    `(WebSocket: ws://${actualHost}:${actualPort}/events)\n`,
  );

  if (watch) {
    engine.start();
    engine.__watching = true;
    hub.broadcast({ type: 'status', stats: engine.stats, watching: true });
    process.stdout.write(`folio serve — watcher started\n`);
  }

  let stopping = false;
  const stop = async (sig) => {
    if (stopping) return;
    stopping = true;
    process.stdout.write(`\nfolio serve: ${sig} received, stopping…\n`);
    try { await close(); }
    finally { process.exit(0); }
  };
  process.on('SIGINT',  () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  // Park.
  await new Promise(() => {});
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
