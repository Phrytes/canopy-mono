/**
 * folio doctor — bring-up diagnostic.
 *
 * Walks every step of the Folio bring-up chain and reports PASS / FAIL /
 * WARN / SKIP per step.  When a step FAILs, dependent steps are SKIPped so
 * the user sees one clear failure, not a cascade.
 *
 * The 16-step engine itself lives in `../diagnostics.js` (Folio v2.3 — so
 * the web UI's Settings → Diagnostics panel can stream the same steps over
 * WebSocket without duplicating logic).  This file is the CLI's
 * pretty-printer + exit-code mapper; the step list, probe URI, and
 * sequencing rules live in `diagnostics.js`.
 *
 * Sequence (each prints one `[PASS]` / `[FAIL]` / `[WARN]` / `[SKIP]` line):
 *
 *   1. config exists                            (FAIL → exit 2)
 *   2. vault file exists
 *   3. vault contains a bootstrap mnemonic
 *   4. vault contains an OIDC refresh token     (mock-pod path: WARN, keeps going)
 *   5. local notes folder is readable
 *   6. marker file present
 *   7. sync state present
 *   8. sync state freshness                     (WARN if older than 7 days)
 *   9. OIDC session restored from vault         (mock-pod path: WARN, keeps going)
 *  10. pod root reachable (HEAD)
 *  11. pod root container exists (createContainer)
 *  12. test write to <podRoot>.folio-doctor-probe-<rand>
 *  13. test read of <podRoot>.folio-doctor-probe-<rand>
 *  14. test delete of <podRoot>.folio-doctor-probe-<rand>
 *  15. scanLocal returns the same files as fs.readdir
 *  16. scanPod returns the test write results (sanity)
 *
 * The probe URI is always cleaned up in `finally`, even on a mid-flow throw.
 *
 * Flags:
 *   --json       emit a single JSON object (no ANSI), suitable for tooling
 *   --verbose    add extra detail per step (raw HTTP statuses, error text)
 *
 * Exit codes:
 *   0   no FAIL (PASS / WARN / SKIP only)
 *   1   any FAIL
 *   2   no config (early exit; cannot run further checks)
 *
 * Color: ANSI escape codes, auto-disabled when stdout is not a TTY (so
 * --json + piped output stay clean).  No external color library.
 */
import { runDiagnostics, recommendFix as recommendFixFromSteps } from '../diagnostics.js';

/* ── ANSI helpers ────────────────────────────────────────────────────────── */

const ANSI = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  gray:   '\x1b[90m',
  bold:   '\x1b[1m',
};

function colorEnabled() {
  return process.stdout.isTTY === true && process.env.NO_COLOR !== '1';
}

function paint(color, text) {
  if (!colorEnabled()) return text;
  return `${color}${text}${ANSI.reset}`;
}

const STATUS_BADGE = {
  PASS: () => paint(ANSI.green,  '[PASS]'),
  FAIL: () => paint(ANSI.red,    '[FAIL]'),
  WARN: () => paint(ANSI.yellow, '[WARN]'),
  SKIP: () => paint(ANSI.gray,   '[SKIP]'),
};

/* ── Status accumulator ──────────────────────────────────────────────────── */

class Report {
  constructor({ json, verbose }) {
    this.steps = [];          // { id, status, label, detail?, error? }
    this.json    = !!json;
    this.verbose = !!verbose;
  }

  /** Reporter API consumed by `runDiagnostics`. */
  step(event) {
    const { id, status, label, detail = null, error = null } = event;
    this.steps.push({ id, status, label, detail, error });
    if (!this.json) {
      const badge = STATUS_BADGE[status]();
      const line  = `  ${badge}  ${label}`;
      process.stdout.write(`${line}\n`);
      if (detail && (status !== 'SKIP')) {
        for (const ln of String(detail).split('\n')) {
          process.stdout.write(`            ${paint(ANSI.gray, ln)}\n`);
        }
      }
      if (this.verbose && error) {
        const msg = error?.stack ?? error?.message ?? String(error);
        for (const ln of String(msg).split('\n')) {
          process.stdout.write(`            ${paint(ANSI.gray, ln)}\n`);
        }
      }
    }
  }

  counts() {
    const c = { PASS: 0, FAIL: 0, WARN: 0, SKIP: 0 };
    for (const s of this.steps) c[s.status]++;
    return c;
  }
}

/* ── Public API ──────────────────────────────────────────────────────────── */

/**
 * The CLI entry point.  Accepts a private `__deps` last-arg for tests:
 *
 *   await doctorCmd(['--json'], { __deps: { buildPodClient, OidcSession } })
 *
 * @param {string[]} args
 * @param {{ __deps?: object }} [opts]
 */
export async function doctorCmd(args = [], opts = {}) {
  const flags = parseFlags(args);
  const deps  = opts.__deps ?? {};

  const report = new Report({ json: flags.json, verbose: flags.verbose });

  if (!report.json) {
    process.stdout.write(`${paint(ANSI.bold, 'folio doctor: running diagnostics...')}\n\n`);
  }

  const result = await runDiagnostics(report, deps);

  finalize(report, result, flags);
  return result;
}

/* ── Finalize / output ───────────────────────────────────────────────────── */

function finalize(report, result, flags) {
  const counts = report.counts();
  const exitCode = result.abortReason === 'NO_CONFIG'
    ? 2
    : (counts.FAIL > 0 ? 1 : 0);

  if (flags.json) {
    const payload = {
      ok:       counts.FAIL === 0 && result.abortReason !== 'NO_CONFIG',
      exitCode,
      counts,
      abortReason: result.abortReason,
      steps: report.steps.map((s) => ({
        id:     s.id,
        status: s.status,
        label:  s.label,
        ...(s.detail ? { detail: s.detail } : {}),
        ...(s.error
          ? { error: { message: s.error.message ?? String(s.error), code: s.error.code ?? null } }
          : {}),
      })),
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write('\n');
    const summary =
      `OVERALL: ${counts.PASS} PASS / ${counts.WARN} WARN / ${counts.FAIL} FAIL`
      + (counts.SKIP > 0 ? ` / ${counts.SKIP} SKIP` : '');
    process.stdout.write(`${paint(ANSI.bold, summary)}\n`);
    if (result.abortReason === 'NO_CONFIG') {
      process.stdout.write(
        '         — run `folio init <local-path>` to create a config.\n',
      );
    } else if (counts.FAIL > 0) {
      const fix = recommendFixFromSteps(report.steps) ?? 'something went wrong (see above).';
      process.stdout.write(`         — ${fix}\n`);
    } else {
      process.stdout.write('         — your setup looks healthy.\n');
    }
  }

  process.exitCode = exitCode;
}

/* ── Utilities ───────────────────────────────────────────────────────────── */

function parseFlags(args) {
  return {
    json:    args.includes('--json'),
    verbose: args.includes('--verbose') || args.includes('-v'),
  };
}
