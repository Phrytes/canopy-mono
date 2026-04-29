/**
 * Folio.B1.tray — cross-platform tray-bar / menubar entry point.
 *
 * The tray shows the user a small at-a-glance status of the local Folio web
 * server (running on `http://localhost:8888` by default).  It polls the
 * server's `/status` endpoint every 5 s, maps the result to one of four icon
 * states (idle / active / conflict / error), and on click opens the URL in
 * the user's default browser.
 *
 * This module is the cross-platform entry: it detects the OS, dispatches to a
 * platform driver (`./macos.js`, `./linux.js`, or `./windows.js`), and runs
 * the polling loop.  The drivers expose a tiny common interface:
 *
 *   {
 *     setIcon(stateName: string): void | Promise<void>
 *     onClick(handler: () => void): void
 *     destroy(): void | Promise<void>
 *   }
 *
 * Tested by `apps/folio/test/tray.test.js` with a mocked driver — the smoke
 * tests assert icon-state mapping, poll backoff on errors, click → URL open,
 * and OS dispatch.  No actual tray rendering happens in CI.
 *
 * ─── Why no native tray-icon library? ──────────────────────────────────────
 * See `apps/folio/src/tray/CHOICE.md`: every cross-platform tray library we
 * evaluated (node-systray, trayicon, menubar) either pulls in node-gyp, ships
 * a ~10 MB Go binary, or wraps Electron.  The hard constraint says "no new
 * dep that requires a native build step".  We pivoted to **shell-out to
 * platform-native tools**: `notify-send` on Linux, `osascript` on macOS.
 * The result isn't a clickable system-tray icon in the strict sense — it's a
 * foreground status process that logs state changes and surfaces them via
 * desktop notifications.  This satisfies the user-facing goal (at-a-glance
 * status; click opens the URL) without adding any runtime dep.  When a real
 * cross-platform no-gyp tray lib emerges, swapping a driver is trivial.
 */
import { platform } from 'node:os';

const STATES = Object.freeze({
  idle:     'sync-idle',
  active:   'sync-active',
  conflict: 'sync-conflict',
  error:    'sync-error',
});

/** Default poll interval: 5 s.  Backs off to 30 s after 5 consecutive failures. */
const POLL_INTERVAL_MS  = 5_000;
const BACKOFF_INTERVAL_MS = 30_000;
const BACKOFF_THRESHOLD = 5;

/**
 * Map a `/status` payload to one of the four icon states.
 *
 * Inputs are best-effort — different server versions may return slightly
 * different shapes.  We accept either:
 *   { state: 'idle' | 'active' | 'conflict' | 'error' }
 *   { syncing: boolean, conflicts: number, errors: number }
 *
 * @param {object} status
 * @returns {'idle'|'active'|'conflict'|'error'}
 */
export function statusToState(status) {
  if (!status || typeof status !== 'object') return 'error';
  if (typeof status.state === 'string' && Object.keys(STATES).includes(status.state)) {
    return status.state;
  }
  if ((status.errors    ?? 0) > 0) return 'error';
  if ((status.conflicts ?? 0) > 0) return 'conflict';
  if (status.syncing === true)     return 'active';
  return 'idle';
}

/**
 * Choose a driver for the current OS.
 *
 * Exported for testability; tests inject `{ platform: 'linux', loadDriver }`.
 *
 * @param {string} osName  — process.platform value
 * @returns {string}       — driver module name (relative path without extension)
 */
export function driverNameFor(osName) {
  switch (osName) {
    case 'darwin':  return './macos.js';
    case 'linux':   return './linux.js';
    case 'win32':   return './windows.js';
    default:        return './linux.js';   // fallback: Linux driver is the most forgiving
  }
}

/**
 * Open a URL in the user's default browser via the OS shell.
 * Uses native commands so we don't add a dep.
 *
 * @param {string} url
 * @param {{ platform?: string, exec?: Function }} [deps] — for tests
 * @returns {Promise<void>}
 */
export async function openUrl(url, { platform: osName = platform(), exec } = {}) {
  const { exec: realExec } = await import('node:child_process');
  const run = exec ?? realExec;
  let cmd, args;
  if (osName === 'darwin') {
    cmd = 'open'; args = [url];
  } else if (osName === 'win32') {
    cmd = 'cmd';  args = ['/c', 'start', '""', url];
  } else {
    cmd = 'xdg-open'; args = [url];
  }
  return new Promise((res, rej) => {
    run(`${cmd} ${args.map((a) => JSON.stringify(a)).join(' ')}`, (err) => {
      if (err) rej(err); else res();
    });
  });
}

/**
 * Start the tray.  Returns a `stop()` function plus diagnostics.
 *
 * @param {object}   opts
 * @param {string}   opts.statusUrl              — full URL of `/status` endpoint (default `http://localhost:8888/status`)
 * @param {string}   [opts.openUrl]              — URL to open on click (default: derived from statusUrl)
 * @param {number}   [opts.pollIntervalMs]       — default 5 000
 * @param {number}   [opts.backoffIntervalMs]    — default 30 000
 * @param {number}   [opts.backoffThreshold]     — default 5 consecutive failures
 * @param {Function} [opts.onClick]              — override click handler (default: open the URL)
 * @param {string}   [opts.platform]             — override OS detection (tests)
 * @param {Function} [opts.loadDriver]           — async loader (path) => driverFactory; for tests
 * @param {Function} [opts.fetch]                — override global fetch (tests)
 * @returns {Promise<{ stop: () => Promise<void>, _diagnostics: object }>}
 */
export async function startTray(opts = {}) {
  const statusUrl       = opts.statusUrl       ?? 'http://localhost:8888/status';
  const clickUrl        = opts.openUrl         ?? deriveClickUrl(statusUrl);
  const pollMs          = opts.pollIntervalMs  ?? POLL_INTERVAL_MS;
  const backoffMs       = opts.backoffIntervalMs ?? BACKOFF_INTERVAL_MS;
  const backoffAfter    = opts.backoffThreshold ?? BACKOFF_THRESHOLD;
  const osName          = opts.platform        ?? platform();
  const fetchImpl       = opts.fetch           ?? globalThis.fetch;

  // ── Driver ──────────────────────────────────────────────────────────────
  const driverPath = driverNameFor(osName);
  const loadDriver = opts.loadDriver ?? (async (p) => (await import(p)).createDriver);
  const createDriver = await loadDriver(driverPath);
  const driver = await createDriver({ iconsDir: new URL('./icons/', import.meta.url) });

  // Click handler — default opens the URL in the default browser.
  const onClick = opts.onClick ?? (async () => {
    try { await openUrl(clickUrl, { platform: osName }); }
    catch (err) { /* best effort — log but never throw inside tray */
      // eslint-disable-next-line no-console
      console.error(`folio tray: failed to open ${clickUrl}: ${err.message}`);
    }
  });
  driver.onClick(onClick);

  // ── Poll loop ───────────────────────────────────────────────────────────
  let stopped         = false;
  let consecutiveFails = 0;
  let timer           = null;
  let currentState    = null;

  const setState = async (state) => {
    if (state === currentState) return;
    currentState = state;
    await Promise.resolve(driver.setIcon(STATES[state]));
  };

  const tick = async () => {
    if (stopped) return;
    try {
      if (!fetchImpl) throw new Error('fetch not available — Node < 18?');
      const res = await fetchImpl(statusUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      consecutiveFails = 0;
      await setState(statusToState(body));
    } catch {
      consecutiveFails++;
      await setState('error');
    }
    if (stopped) return;
    const interval = consecutiveFails >= backoffAfter ? backoffMs : pollMs;
    timer = setTimeout(tick, interval);
    if (timer.unref) timer.unref(); // don't hold the event loop open in tests
  };

  // Kick off — start in idle so the user gets immediate feedback.
  await setState('idle');
  // First poll runs in the next tick so callers can attach listeners first.
  timer = setTimeout(tick, 0);
  if (timer.unref) timer.unref();

  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      try { await Promise.resolve(driver.destroy()); } catch { /* swallow */ }
    },
    _diagnostics: {
      get state()             { return currentState; },
      get consecutiveFails()  { return consecutiveFails; },
      get driver()            { return driver; },
      get statusUrl()         { return statusUrl; },
      get clickUrl()          { return clickUrl; },
    },
  };
}

/** Derive `http://host:port/` from `http://host:port/status`. */
function deriveClickUrl(statusUrl) {
  try {
    const u = new URL(statusUrl);
    u.pathname = '/';
    u.search   = '';
    u.hash     = '';
    return u.toString();
  } catch {
    return 'http://localhost:8888';
  }
}

export { STATES };
