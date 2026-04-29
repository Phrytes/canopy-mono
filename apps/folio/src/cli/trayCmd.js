/**
 * folio tray — start the tray-bar / menubar status indicator.
 *
 * Foreground process; SIGINT / SIGTERM stop cleanly.
 *
 *   folio tray                              # uses default URL http://localhost:8888
 *   folio tray --url http://localhost:9000  # custom server URL
 *   folio tray --interval 10000             # poll every 10 s instead of 5 s
 *
 * Decision: `folio tray` is a SEPARATE command, not auto-launched by
 * `folio serve`.  Reasoning is in `apps/folio/src/tray/CHOICE.md`:
 *   1. `folio serve` is owned by another agent (B1.server) — separate
 *      command avoids merge conflicts.
 *   2. Users may want headless serving (server on a different machine,
 *      `folio watch` instead of the web app, etc.) — tray is opt-in.
 */
import { startTray } from '../tray/index.js';

export async function trayCmd(args) {
  const opts = parseArgs(args);
  const statusUrl = opts.url ? `${trimTrailingSlash(opts.url)}/status` : 'http://localhost:8888/status';

  console.log(`folio tray — polling ${statusUrl} every ${opts.interval}ms  (Ctrl-C to stop)`);

  const handle = await startTray({
    statusUrl,
    pollIntervalMs:    opts.interval,
    backoffIntervalMs: opts.backoff,
  });

  let stopping = false;
  const stop = async (sig) => {
    if (stopping) return;
    stopping = true;
    console.log(`\nfolio tray: ${sig} received, stopping…`);
    try { await handle.stop(); }
    finally { process.exit(0); }
  };
  process.on('SIGINT',  () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  // Park until a signal arrives.
  await new Promise(() => {});
}

function parseArgs(rest) {
  const o = { url: null, interval: 5_000, backoff: 30_000 };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--url')           o.url      = rest[++i];
    else if (a === '--interval') o.interval = Number(rest[++i]);
    else if (a === '--backoff')  o.backoff  = Number(rest[++i]);
    else throw new Error(`unknown flag: ${a}`);
  }
  if (!Number.isFinite(o.interval) || o.interval < 100) {
    throw new Error('--interval must be a number >= 100');
  }
  if (!Number.isFinite(o.backoff) || o.backoff < o.interval) {
    throw new Error('--backoff must be a number >= --interval');
  }
  return o;
}

function trimTrailingSlash(s) { return s.endsWith('/') ? s.slice(0, -1) : s; }
