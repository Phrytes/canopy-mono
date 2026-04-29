/**
 * windows.js — Windows Task Scheduler "service" via `schtasks`.
 *
 * **Best-effort.**  Windows is not part of CI; this code is intentionally
 * thin and side-effect-driven.  The unit is a Scheduled Task that triggers
 * on user logon and runs the Folio CLI in unprivileged mode (`/RL LIMITED`).
 *
 * Limitations (documented):
 *   - No respawn-on-crash semantics (Task Scheduler runs the task on logon
 *     and exits when the process exits; there is no equivalent of
 *     systemd's `Restart=on-failure`).  The user can re-run `folio install-
 *     service` to restart the daemon.
 *   - Logs are not redirected by Task Scheduler.  Folio writes to its own
 *     log path (`%LOCALAPPDATA%/folio/folio.log`) once stdout/err redirection
 *     is added; for now the task swallows stdout.
 *   - No hidden window flag — the user may see a console window flash on
 *     logon.  Accepted: Windows is a non-blocking distribution path.
 *
 * Task name: "Folio".  XML lives at the default location managed by Task
 * Scheduler; we never read it directly — we only call `schtasks /Query` for
 * status and check the exit code.
 */
import { promises as fs } from 'node:fs';
import { homedir }        from 'node:os';
import { dirname, join }  from 'node:path';

import { execAsync } from './_util.js';

export const id = 'Folio';
export const TASK_NAME = 'Folio';

/**
 * Path to a sentinel file we drop alongside the task when installed.  Lets
 * us model "is the unit installed" via plain fs instead of parsing
 * schtasks output.  Lives under %LOCALAPPDATA%/folio.
 */
export function unitPath() {
  const base = process.env.LOCALAPPDATA
    ?? join(homedir(), 'AppData', 'Local');
  return join(base, 'folio', `${TASK_NAME}.installed`);
}

export function logPath() {
  const base = process.env.LOCALAPPDATA
    ?? join(homedir(), 'AppData', 'Local');
  return join(base, 'folio', 'folio.log');
}

/**
 * The schtasks command is the human-readable artefact for Windows.  Build
 * it from the args so tests can assert on exact shape without spawning
 * `schtasks`.
 */
export function buildUnit({ nodePath, cliPath, workingDir: _workingDir, logPath: _lp }) {
  // schtasks /TR is a single quoted string → "<node> <cli> serve --watch".
  // We use double quotes around the whole TR string and escape inner
  // double-quotes per schtasks's awkward rules ("\"...\"").
  const trArg = `\\"${nodePath}\\" \\"${cliPath}\\" serve --watch`;
  return [
    'schtasks',
    '/Create',
    '/TN', `"${TASK_NAME}"`,
    '/TR', `"${trArg}"`,
    '/SC', 'ONLOGON',
    '/RL', 'LIMITED',
    '/F',                          // force-overwrite if exists (idempotent)
  ].join(' ');
}

/**
 * Idempotent install via `schtasks /Create /F`.
 */
export async function install({ nodePath, cliPath, workingDir, exec = execAsync }) {
  const path = unitPath();
  const log  = logPath();
  const exists = await fileExists(path);

  await fs.mkdir(dirname(path), { recursive: true });
  await fs.mkdir(dirname(log),  { recursive: true });

  const cmd = buildUnit({ nodePath, cliPath, workingDir, logPath: log });
  await exec(cmd);
  // Run-once now so the user doesn't have to log out / in to verify.
  try { await exec(`schtasks /Run /TN "${TASK_NAME}"`); } catch { /* best-effort */ }

  await fs.writeFile(path, JSON.stringify({
    nodePath, cliPath, workingDir,
    installedAt: new Date().toISOString(),
  }, null, 2), 'utf8');

  return { alreadyInstalled: exists, unitPath: path, logPath: log };
}

/**
 * Idempotent uninstall.
 */
export async function uninstall({ exec = execAsync } = {}) {
  const path = unitPath();
  try { await exec(`schtasks /Delete /TN "${TASK_NAME}" /F`); } catch { /* ignore */ }
  try { await fs.unlink(path); } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return { unitPath: path };
}

/**
 * Status.  `schtasks /Query /TN <name> /FO LIST` returns the task's
 * "Status" line — "Running" / "Ready" / etc.
 */
export async function status({ exec = execAsync } = {}) {
  const path = unitPath();
  const installed = await fileExists(path);
  if (!installed) {
    return { state: 'not-installed', detail: `no task sentinel at ${path}`, lastLogLines: [] };
  }
  let detail = '';
  let running = false;
  try {
    const r = await exec(`schtasks /Query /TN "${TASK_NAME}" /FO LIST`);
    detail = String(r?.stdout ?? '').trim();
    running = /^\s*Status:\s*Running/m.test(detail);
  } catch (err) {
    detail = (err?.stdout ?? err?.stderr ?? err?.message ?? '').toString().trim();
    running = false;
  }
  return {
    state:        running ? 'running' : 'stopped',
    detail,
    lastLogLines: await tailLog(logPath()),
  };
}

/* ── helpers ──────────────────────────────────────────────────────────── */

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function tailLog(path, maxLines = 20) {
  try {
    const text = await fs.readFile(path, 'utf8');
    return text.split('\n').filter(Boolean).slice(-maxLines);
  } catch { return []; }
}
