/**
 * folio install-service — install a per-user OS service unit so Folio
 * auto-starts on login.  Per-user only (LaunchAgent / systemd --user /
 * unprivileged Task Scheduler).  No `sudo`, ever.
 *
 * Behaviour:
 *   - Refuses to install if no config exists (must run `folio init` first).
 *   - Resolves `process.execPath` (the node binary) and `cli.js` absolute
 *     path at install time.  The unit then references absolute paths only
 *     so it survives `PATH` changes in the user's shell.
 *   - If a unit already exists, prints "already installed" + status, exits 0.
 *   - After install, briefly polls status (max 5s) and prints the result.
 *
 * Exit codes:
 *   0  installed (or already installed) and reachable
 *   1  install failed (see error)
 *   2  no config — run `folio init` first
 */
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath }                    from 'node:url';
import { homedir }                          from 'node:os';

import { requireConfig }   from './_config.js';
import { platformService } from '../service/index.js';

/* CLI entry — accepts a private `__deps` last-arg for tests:
 *
 *   await installServiceCmd([], {
 *     __deps: { service, exec, sleep, now }
 *   })
 */
export async function installServiceCmd(args = [], opts = {}) {
  const deps    = opts.__deps ?? {};
  const service = deps.service ?? platformService();
  const exec    = deps.exec    ?? undefined;
  const sleep   = deps.sleep   ?? defaultSleep;
  const nowFn   = deps.now     ?? Date.now;

  let cfg;
  try {
    cfg = await requireConfig();
  } catch (err) {
    if (err.code === 'NO_CONFIG') {
      process.stderr.write(
        `folio install-service: no Folio config — run \`folio init <local-path>\` first.\n`,
      );
      process.exitCode = 2;
      return;
    }
    throw err;
  }

  const nodePath   = process.execPath;
  const cliPath    = deps.cliPath ?? resolveCliPath();
  const workingDir = cfg.localRoot && typeof cfg.localRoot === 'string'
    ? cfg.localRoot
    : homedir();

  process.stdout.write(`folio install-service:\n`);
  process.stdout.write(`  unit:        ${service.unitPath()}\n`);
  process.stdout.write(`  node:        ${nodePath}\n`);
  process.stdout.write(`  cli:         ${cliPath}\n`);
  process.stdout.write(`  working dir: ${workingDir}\n`);

  const result = await service.install({ nodePath, cliPath, workingDir, exec });

  if (result.alreadyInstalled) {
    process.stdout.write(`folio install-service: already installed — re-loaded with current config.\n`);
  } else {
    process.stdout.write(`folio install-service: installed.\n`);
  }

  // Brief poll: max 5s, 250ms cadence.  Stop on first "running".
  const deadline = nowFn() + 5_000;
  let last = null;
  while (nowFn() < deadline) {
    last = await service.status({ exec });
    if (last.state === 'running') break;
    await sleep(250);
  }

  if (last && last.state === 'running') {
    process.stdout.write(`folio install-service: status = running\n`);
  } else if (last) {
    process.stdout.write(
      `folio install-service: status = ${last.state} (it may take a moment to start).\n`,
    );
    if (last.detail) {
      process.stdout.write(`  detail: ${truncate(last.detail, 200)}\n`);
    }
  }
}

/* ── helpers ──────────────────────────────────────────────────────────── */

/**
 * Resolve the absolute path to `cli.js`.  We prefer `import.meta.url` of
 * the cli.js entry but this module lives in src/cli/ so we resolve up.
 */
function resolveCliPath() {
  // dirname(fileURLToPath(import.meta.url)) === .../apps/folio/src/cli
  // → cli.js is one level up.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolvePath(here, '..', 'cli.js');
}

function defaultSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function truncate(s, n) {
  if (typeof s !== 'string') return '';
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}
