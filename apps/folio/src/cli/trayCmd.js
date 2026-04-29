/**
 * folio tray — start the persistent menubar / system-tray icon.
 *
 * v2.7 — backed by systray2 (prebuilt Go binary; see
 * `apps/folio/src/tray/CHOICE.md`).  The tray is a foreground process; the
 * systray2 helper-process keeps the UI alive.  Ctrl-C / SIGTERM tears
 * everything down cleanly.
 *
 *   folio tray                              # uses default URL http://127.0.0.1:8888
 *   folio tray --url http://127.0.0.1:9000  # custom server URL
 *   folio tray --interval 10000             # poll every 10 s instead of 5 s
 *   folio tray --backoff  60000             # back off to 60 s on errors
 *   folio tray --local-root /home/me/notes  # passed to the "Open notes folder" item
 *
 * Note: as of v2.7 the tray is auto-launched by `folio serve` (use
 * `folio serve --no-tray` to opt out).  This standalone command is still
 * useful for users running the server on a different machine.
 */
import { startTray } from '../tray/index.js';
import { loadConfig } from './_config.js';

export async function trayCmd(args) {
  const opts = parseArgs(args);

  // Best-effort: auto-discover localRoot from the user's saved config so the
  // "Open notes folder" menu item works without --local-root.  Tolerated to
  // fail (no config yet, etc).
  let localRoot = opts.localRoot;
  if (!localRoot) {
    try {
      const cfg = await loadConfig();
      localRoot = cfg?.localRoot ?? null;
    } catch { /* ignore — tray runs without "Open notes folder" wired */ }
  }

  const baseUrl   = trimTrailingSlash(opts.url ?? 'http://127.0.0.1:8888');
  const statusUrl = `${baseUrl}/status`;

  process.stdout.write(
    `folio tray — polling ${statusUrl} every ${opts.interval}ms  (Ctrl-C to stop)\n`,
  );

  const handle = await startTray({
    statusUrl,
    openUrl:           baseUrl,
    localRoot,
    pollIntervalMs:    opts.interval,
    backoffIntervalMs: opts.backoff,
  });

  let stopping = false;
  const stop = async (sig) => {
    if (stopping) return;
    stopping = true;
    process.stdout.write(`\nfolio tray: ${sig} received, stopping…\n`);
    try { await handle.stop(); }
    finally { process.exit(0); }
  };
  process.on('SIGINT',  () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  // Park until a signal arrives.
  await new Promise(() => {});
}

function parseArgs(rest) {
  const o = { url: null, interval: 5_000, backoff: 30_000, localRoot: null };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--url')             o.url       = rest[++i];
    else if (a === '--interval')   o.interval  = Number(rest[++i]);
    else if (a === '--backoff')    o.backoff   = Number(rest[++i]);
    else if (a === '--local-root') o.localRoot = rest[++i];
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
