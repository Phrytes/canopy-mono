/**
 * folio doctor — bring-up diagnostic.
 *
 * Walks every step of the Folio bring-up chain and reports PASS / FAIL /
 * WARN / SKIP per step.  When a step FAILs, dependent steps are SKIPped so
 * the user sees one clear failure, not a cascade.
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
import { promises as fs } from 'node:fs';
import { join }           from 'node:path';
import { randomBytes }    from 'node:crypto';

import { VaultNodeFs }    from '@canopy/core';

import {
  configDir,
  configPath,
  loadConfig,
} from './_config.js';
import { buildPodClient as defaultBuildPodClient } from './_podFactory.js';
import {
  OidcSession as DefaultOidcSession,
  OIDC_VAULT_KEYS,
} from '../auth/OidcSession.js';

import { PathMap }        from '../PathMap.js';
import { scanLocal }      from '../scanLocal.js';
import { scanPod }        from '../scanPod.js';

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

  record(id, status, label, detail = null, error = null) {
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

  pass(id, label, detail) { this.record(id, 'PASS', label, detail); }
  fail(id, label, detail, err) { this.record(id, 'FAIL', label, detail, err); }
  warn(id, label, detail, err) { this.record(id, 'WARN', label, detail, err); }
  skip(id, label, detail) { this.record(id, 'SKIP', label, detail); }

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
  const buildPodClient = deps.buildPodClient ?? defaultBuildPodClient;
  const OidcSession    = deps.OidcSession    ?? DefaultOidcSession;

  const report = new Report({ json: flags.json, verbose: flags.verbose });

  if (!report.json) {
    process.stdout.write(`${paint(ANSI.bold, 'folio doctor: running diagnostics...')}\n\n`);
  }

  const result = await runChecks(report, {
    buildPodClient,
    OidcSession,
  });

  finalize(report, result, flags);
  return result;
}

/* ── Steps ───────────────────────────────────────────────────────────────── */

async function runChecks(report, { buildPodClient, OidcSession }) {
  // 1. Config.
  const cfgPath = configPath();
  let cfg;
  try {
    cfg = await loadConfig();
  } catch (err) {
    report.fail('config', `config exists at ${cfgPath}`, null, err);
    return { abortReason: 'NO_CONFIG', cfg: null };
  }
  if (!cfg) {
    report.fail('config', `config exists at ${cfgPath}`,
      'no config file at that path');
    return { abortReason: 'NO_CONFIG', cfg: null };
  }
  report.pass('config', `config exists at ${cfgPath}`);

  // 2. Vault file.
  const vaultPath = cfg.vaultPath ?? join(configDir(), 'vault.json');
  let vaultRaw = null;
  try {
    const text = await fs.readFile(vaultPath, 'utf8');
    vaultRaw = JSON.parse(text);
    report.pass('vault', `vault exists at ${vaultPath}`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      report.fail('vault', `vault exists at ${vaultPath}`,
        'no vault file — Folio cannot derive identity', err);
    } else {
      report.fail('vault', `vault exists at ${vaultPath}`,
        `vault unreadable: ${err.message}`, err);
    }
    // Without a vault, downstream checks are not meaningful.
    skipRemaining(report, [
      'vault-mnemonic', 'vault-refresh', 'local-folder', 'marker',
      'sync-state', 'sync-state-fresh', 'oidc-restored',
      'pod-head', 'pod-container', 'probe-write', 'probe-read', 'probe-delete',
      'scan-local', 'scan-pod',
    ]);
    return { abortReason: 'NO_VAULT', cfg };
  }

  // 3. Bootstrap mnemonic (24 words).
  let vault;
  try {
    vault = new VaultNodeFs(vaultPath);
    const mnemonic = await vault.get('bootstrap-mnemonic');
    if (typeof mnemonic === 'string' && mnemonic.trim().split(/\s+/).length === 24) {
      report.pass('vault-mnemonic', 'vault contains a bootstrap mnemonic (24 words)');
    } else if (typeof mnemonic === 'string' && mnemonic.length > 0) {
      report.warn('vault-mnemonic', 'vault contains a bootstrap mnemonic',
        `expected 24 words, got ${mnemonic.trim().split(/\s+/).length}`);
    } else {
      report.fail('vault-mnemonic', 'vault contains a bootstrap mnemonic (24 words)',
        'no `bootstrap-mnemonic` entry in the vault');
    }
  } catch (err) {
    report.fail('vault-mnemonic', 'vault contains a bootstrap mnemonic (24 words)',
      `vault read failed: ${err.message}`, err);
  }

  // 4. OIDC refresh token (WARN under the mock-pod path).
  const isMock = process.env.FOLIO_TEST_MOCK_POD === '1';
  let refreshTokenPresent = false;
  let issuer = null;
  try {
    const refresh = await vault.get(OIDC_VAULT_KEYS.REFRESH_TOKEN);
    issuer        = await vault.get(OIDC_VAULT_KEYS.ISSUER);
    refreshTokenPresent = typeof refresh === 'string' && refresh.length > 0;
    if (refreshTokenPresent) {
      report.pass('vault-refresh', 'vault contains an OIDC refresh token',
        issuer ? `issuer: ${issuer}` : null);
    } else if (isMock) {
      report.warn('vault-refresh', 'vault contains an OIDC refresh token',
        'no OIDC refresh token (mock-pod path: not required)');
    } else {
      report.fail('vault-refresh', 'vault contains an OIDC refresh token',
        'no OIDC refresh token — start `folio serve` and click Sign in');
    }
  } catch (err) {
    if (isMock) {
      report.warn('vault-refresh', 'vault contains an OIDC refresh token',
        `vault read failed (mock-pod path: continuing): ${err.message}`, err);
    } else {
      report.fail('vault-refresh', 'vault contains an OIDC refresh token',
        `vault read failed: ${err.message}`, err);
    }
  }

  // 5. Local notes folder.
  let localScanReady = false;
  try {
    const st = await fs.stat(cfg.localRoot);
    if (!st.isDirectory()) {
      report.fail('local-folder', `local notes folder is readable: ${cfg.localRoot}`,
        'path exists but is not a directory');
    } else {
      // readdir is the proof of "readable"; size summary just provides context.
      await fs.readdir(cfg.localRoot);
      const sizeInfo = await summarizeFolder(cfg.localRoot);
      report.pass('local-folder', `local notes folder is readable: ${cfg.localRoot}`,
        `files: ${sizeInfo.fileCount} (${formatBytes(sizeInfo.totalBytes)})`);
      localScanReady = true;
    }
  } catch (err) {
    report.fail('local-folder', `local notes folder is readable: ${cfg.localRoot}`,
      err.message, err);
  }

  // 6. Marker file.
  const markerPath = join(cfg.localRoot, '.canopy', '.folio-managed');
  try {
    await fs.access(markerPath);
    report.pass('marker', `marker file present at ${markerPath}`);
  } catch (err) {
    report.warn('marker', `marker file present at ${markerPath}`,
      'no `.folio-managed` marker — folder may not be a Folio root', err);
  }

  // 7. Sync state.
  const statePath = join(cfg.localRoot, '.canopy', 'notes-sync-state.json');
  let stateWrittenAt = null;
  let stateFileCount = 0;
  try {
    const text = await fs.readFile(statePath, 'utf8');
    const parsed = JSON.parse(text);
    stateFileCount = Object.keys(parsed?.files ?? {}).length;
    stateWrittenAt = parsed?.writtenAt ?? null;
    report.pass('sync-state', `sync state present (${stateFileCount} files tracked)`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      report.warn('sync-state', 'sync state present',
        'no sync state yet — run `folio sync` once to create it');
    } else {
      report.fail('sync-state', 'sync state present',
        `state file unreadable: ${err.message}`, err);
    }
  }

  // 8. Sync state freshness (WARN if older than 7 days).
  if (stateWrittenAt) {
    const ageMs   = Date.now() - stateWrittenAt;
    const ageDays = Math.floor(ageMs / (24 * 3600 * 1000));
    if (ageMs > 7 * 24 * 3600 * 1000) {
      report.warn('sync-state-fresh', `sync state's syncedAt is ${ageDays} days old`,
        'consider running `folio sync` to refresh');
    } else {
      report.pass('sync-state-fresh', 'sync state freshness',
        `last sync ${ageDays} day(s) ago`);
    }
  } else {
    report.skip('sync-state-fresh', 'sync state freshness');
  }

  // 9. OIDC session restore.
  let oidc = null;
  if (isMock) {
    report.warn('oidc-restored', 'OIDC session restored from vault',
      'mock-pod path: skipping real OIDC restore');
  } else if (!refreshTokenPresent) {
    report.skip('oidc-restored', 'OIDC session restored from vault');
  } else {
    try {
      oidc = new OidcSession({ vault });
      const restored = await oidc.restoreFromVault({
        onWarning: () => { /* swallow; reflected via the boolean return */ },
      });
      if (restored) {
        report.pass('oidc-restored', 'OIDC session restored from vault',
          oidc.webid ? `webid: ${oidc.webid}` : null);
      } else {
        report.fail('oidc-restored', 'OIDC session restored from vault',
          'refresh failed — your refresh token may have expired; sign in again via http://127.0.0.1:8888');
        oidc = null;
      }
    } catch (err) {
      report.fail('oidc-restored', 'OIDC session restored from vault',
        err.message, err);
      oidc = null;
    }
  }

  // 10–14. Pod-side checks.  Build a PodClient (mock or real); on failure,
  // SKIP the rest of the pod chain and the scan steps that depend on it.
  let podClient = null;
  try {
    podClient = await buildPodClient(cfg, { oidc });
  } catch (err) {
    report.fail('pod-head', `pod root reachable: ${cfg.podRoot}`,
      err.message, err);
    skipRemaining(report, [
      'pod-container', 'probe-write', 'probe-read', 'probe-delete',
      'scan-pod',
    ]);
    if (localScanReady) {
      await runScanLocalCheck(report, cfg);
    } else {
      report.skip('scan-local', 'scanLocal returns the same files as fs.readdir');
    }
    return { abortReason: null, cfg };
  }

  // Probe URI: leading-dot + random suffix to avoid clobbering user files.
  const probeName = `.folio-doctor-probe-${randomBytes(4).toString('hex')}`;
  const probeUri  = joinPodUri(cfg.podRoot, probeName);
  const probeBody = `folio-doctor probe at ${new Date().toISOString()}`;

  // We must always attempt cleanup, even if mid-flow checks throw.
  let probeWritten = false;
  try {
    // 10. HEAD-equivalent: list() on the root container is a cheap reachability
    //     check that doubles as an auth check.  PodClient doesn't expose a
    //     dedicated HEAD; list() suffices.
    try {
      await podClient.list(cfg.podRoot, { recursive: false });
      report.pass('pod-head', `pod root reachable: ${cfg.podRoot}`,
        'list() returned successfully');
    } catch (err) {
      report.fail('pod-head', `pod root reachable: ${cfg.podRoot}`,
        diagnosePodErr(err), err);
      skipRemaining(report, [
        'pod-container', 'probe-write', 'probe-read', 'probe-delete', 'scan-pod',
      ]);
      throw new ProbeAbort();
    }

    // 11. createContainer is idempotent — re-asserts the root exists.
    try {
      if (typeof podClient.createContainer === 'function') {
        await podClient.createContainer(cfg.podRoot);
      }
      report.pass('pod-container', 'pod root container exists (createContainer is idempotent)');
    } catch (err) {
      report.fail('pod-container', 'pod root container exists',
        'your pod server doesn\'t honor LDP createContainerAt', err);
      skipRemaining(report, [
        'probe-write', 'probe-read', 'probe-delete', 'scan-pod',
      ]);
      throw new ProbeAbort();
    }

    // 12. Probe write.
    try {
      await podClient.write(probeUri, probeBody, { contentType: 'text/plain' });
      probeWritten = true;
      report.pass('probe-write', `test write to ${probeUri}`);
    } catch (err) {
      report.fail('probe-write', `test write to ${probeUri}`, err.message, err);
      skipRemaining(report, ['probe-read', 'probe-delete', 'scan-pod']);
      throw new ProbeAbort();
    }

    // 13. Probe read.
    try {
      const r = await podClient.read(probeUri, { decode: 'string' });
      const got = typeof r?.content === 'string'
        ? r.content
        : new TextDecoder().decode(r?.content ?? new Uint8Array());
      if (got === probeBody) {
        report.pass('probe-read', `test read of ${probeUri} matches`);
      } else {
        report.fail('probe-read', `test read of ${probeUri}`,
          `content mismatch: expected ${probeBody.length} bytes`);
      }
    } catch (err) {
      report.fail('probe-read', `test read of ${probeUri}`, err.message, err);
      // Read failure shouldn't block scan-pod; that's a separate code path.
    }

    // 16. scanPod: confirms our probe shows up in a real pod scan.
    //     Done inside the try so it runs only when we have a probe to find.
    try {
      const pathMap = new PathMap({ localRoot: cfg.localRoot, podRoot: cfg.podRoot });
      const podEntries = await scanPod(podClient, cfg.podRoot, { pathMap });
      // The probe leading-dot means scanPod will skip it (shouldSync rejects
      // dotfiles).  So the sanity check is "scanPod didn't crash"; if there
      // are non-probe files we list a count.
      report.pass('scan-pod', 'scanPod returns results',
        `non-dotfile entries: ${podEntries.length}`);
    } catch (err) {
      report.fail('scan-pod', 'scanPod returns results', err.message, err);
    }
  } catch (err) {
    if (!(err instanceof ProbeAbort)) {
      // Unexpected throw — record as FAIL on whatever step would have been next.
      report.fail('probe-unexpected', 'probe sequence raised unexpectedly',
        err.message, err);
    }
  } finally {
    // 14. Probe delete — bullet-proof cleanup.
    if (probeWritten) {
      try {
        await podClient.delete(probeUri, { force: true });
        report.pass('probe-delete', `test delete of ${probeUri}`);
      } catch (err) {
        report.warn('probe-delete', `test delete of ${probeUri}`,
          `cleanup failed (probe is harmless): ${err.message}`, err);
      }
    } else if (!report.steps.find((s) => s.id === 'probe-delete')) {
      report.skip('probe-delete', 'test delete of probe');
    }
  }

  // 15. scanLocal vs fs.readdir.
  if (localScanReady) {
    await runScanLocalCheck(report, cfg);
  } else {
    report.skip('scan-local', 'scanLocal returns the same files as fs.readdir');
  }

  return { abortReason: null, cfg };
}

/* ── Helper steps ────────────────────────────────────────────────────────── */

async function runScanLocalCheck(report, cfg) {
  try {
    const pathMap = new PathMap({ localRoot: cfg.localRoot, podRoot: cfg.podRoot });
    const scanned = await scanLocal(cfg.localRoot, { pathMap });
    const scannedRel = new Set(scanned.map((f) => f.relPath));

    // Collect "what fs.readdir would see" for the same filter rules.
    const direct = new Set();
    await collectVisibleFiles(cfg.localRoot, '', pathMap, direct);

    const missing = [...direct].filter((p) => !scannedRel.has(p));
    const extra   = [...scannedRel].filter((p) => !direct.has(p));
    if (missing.length === 0 && extra.length === 0) {
      report.pass('scan-local', 'scanLocal returns the same files as fs.readdir',
        `${scanned.length} file(s) in agreement`);
    } else {
      report.fail('scan-local', 'scanLocal returns the same files as fs.readdir',
        `missing: ${missing.length}, extra: ${extra.length}`);
    }
  } catch (err) {
    report.fail('scan-local', 'scanLocal returns the same files as fs.readdir',
      err.message, err);
  }
}

/**
 * Recursively collect files that pass the same shouldSync / shouldSkipDir
 * filter as scanLocal.  Used to cross-check scanLocal's output.
 */
async function collectVisibleFiles(absDir, relDir, pathMap, out) {
  let dirents;
  try {
    dirents = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of dirents) {
    const childRel = relDir === '' ? ent.name : `${relDir}/${ent.name}`;
    if (ent.isDirectory()) {
      if (pathMap.shouldSkipDir(childRel)) continue;
      await collectVisibleFiles(join(absDir, ent.name), childRel, pathMap, out);
      continue;
    }
    if (!ent.isFile()) continue;
    if (!pathMap.shouldSync(childRel)) continue;
    out.add(childRel);
  }
}

async function summarizeFolder(absDir) {
  let fileCount = 0;
  let totalBytes = 0;
  await walk(absDir);
  return { fileCount, totalBytes };

  async function walk(dir) {
    let dirents;
    try { dirents = await fs.readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const ent of dirents) {
      if (ent.name.startsWith('.')) continue;
      const child = join(dir, ent.name);
      if (ent.isDirectory()) await walk(child);
      else if (ent.isFile()) {
        try {
          const st = await fs.stat(child);
          fileCount++;
          totalBytes += st.size;
        } catch { /* ignore */ }
      }
    }
  }
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
      process.stdout.write(
        `         — ${recommendFix(report)}\n`,
      );
    } else {
      process.stdout.write('         — your setup looks healthy.\n');
    }
  }

  process.exitCode = exitCode;
}

function recommendFix(report) {
  // Surface the first FAIL's id and map to a fix hint.
  const firstFail = report.steps.find((s) => s.status === 'FAIL');
  if (!firstFail) return 'something went wrong (see above).';
  switch (firstFail.id) {
    case 'config':
      return 'run `folio init <local-path>`.';
    case 'vault':
    case 'vault-mnemonic':
      return 'run `folio init <local-path>` to (re)create the vault.';
    case 'vault-refresh':
    case 'oidc-restored':
      return 'start `folio serve` and click Sign in (or refresh expired) at http://127.0.0.1:8888';
    case 'pod-head':
      return 'pod unreachable; if 401 sign in again, if 403 your WebID lacks write access.';
    case 'pod-container':
      return 'your pod server doesn\'t honor LDP createContainerAt; check pod compatibility.';
    case 'probe-write':
    case 'probe-read':
      return 'pod write/read probe failed; verify ACL grants for your WebID.';
    default:
      return `see [FAIL] ${firstFail.id} above.`;
  }
}

/* ── Utilities ───────────────────────────────────────────────────────────── */

class ProbeAbort extends Error {
  constructor() { super('probe-abort'); this.name = 'ProbeAbort'; }
}

function skipRemaining(report, ids) {
  for (const id of ids) {
    if (!report.steps.find((s) => s.id === id)) {
      report.skip(id, labelFor(id));
    }
  }
}

function labelFor(id) {
  switch (id) {
    case 'vault-mnemonic':    return 'vault contains a bootstrap mnemonic';
    case 'vault-refresh':     return 'vault contains an OIDC refresh token';
    case 'local-folder':      return 'local notes folder is readable';
    case 'marker':            return 'marker file present';
    case 'sync-state':        return 'sync state present';
    case 'sync-state-fresh':  return 'sync state freshness';
    case 'oidc-restored':     return 'OIDC session restored from vault';
    case 'pod-head':          return 'pod root reachable';
    case 'pod-container':     return 'pod root container exists';
    case 'probe-write':       return 'test write to probe URI';
    case 'probe-read':        return 'test read of probe URI';
    case 'probe-delete':      return 'test delete of probe URI';
    case 'scan-local':        return 'scanLocal returns the same files as fs.readdir';
    case 'scan-pod':          return 'scanPod returns results';
    default:                  return id;
  }
}

function joinPodUri(podRoot, name) {
  const root = String(podRoot).endsWith('/') ? podRoot : `${podRoot}/`;
  // Preserve leading dots in `name`.  No path-traversal: `name` is generated
  // here, never user-supplied.
  return `${root}${name}`;
}

function diagnosePodErr(err) {
  const msg  = err?.message ?? String(err);
  const code = err?.code;
  const status = err?.status ?? err?.httpStatus;
  if (status === 401 || /401/.test(msg)) {
    return 'HTTP 401 — your refresh token may have expired; sign in again via http://127.0.0.1:8888';
  }
  if (status === 403 || /403/.test(msg)) {
    return 'HTTP 403 — your WebID may not have write access to that pod root';
  }
  if (status === 404 || code === 'NOT_FOUND') {
    return 'HTTP 404 — pod root container does not exist';
  }
  return msg;
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return '? bytes';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function parseFlags(args) {
  return {
    json:    args.includes('--json'),
    verbose: args.includes('--verbose') || args.includes('-v'),
  };
}

