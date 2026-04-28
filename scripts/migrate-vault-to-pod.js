#!/usr/bin/env node
/**
 * One-shot CLI: migrate a local-only vault to a Solid pod.
 *
 * Track B / B5 — see `coding-plans/track-B-identity-sync.md` §B5.
 *
 * Usage:
 *   node scripts/migrate-vault-to-pod.js \
 *     --webid https://alice.example/profile/card#me \
 *     --vault-path ./vault.json \
 *     --pod-root https://alice.example/ \
 *     --mnemonic-file ./mnemonic.txt \
 *     [--label "the author's laptop"] \
 *     [--platform-hint linux] \
 *     [--dry-run] [--force]
 *
 * Caveats — this CLI is a thin convenience layer around
 * `migrateVaultToPod`.  It assumes:
 *   • the vault is a `VaultNodeFs`-backed JSON file at `--vault-path`,
 *   • the pod is reachable via Solid OIDC with credentials already
 *     stashed in the same vault (run a prior `solid-login` flow),
 *   • the BIP-39 mnemonic is on disk at `--mnemonic-file`.  Whitespace
 *     is trimmed.  Treat this file as secret material — chmod 0600.
 *
 * If the AgentIdentity API doesn't yet expose the exact loader used here
 * (we fall back to `AgentIdentity.restore` and surface its error), adjust
 * to whatever the actual API is.  The CLI is intentionally thin.
 */
import { argv, exit, stderr, stdout } from 'node:process';
import { readFile }                   from 'node:fs/promises';

import {
  migrateVaultToPod,
  VaultNodeFs,
  AgentIdentity,
} from '../packages/core/src/index.js';

// pod-client is in a sibling package; import lazily so a missing dep
// (e.g. fresh checkout that hasn't installed pod-client) yields a clear
// error rather than a top-level import failure.
async function loadPodClient() {
  try {
    return await import('../packages/pod-client/src/index.js');
  } catch (err) {
    stderr.write(
      'migrate-vault-to-pod: failed to load @canopy/pod-client.  '
      + 'Make sure dependencies are installed (`npm install` at the repo root).\n'
    );
    throw err;
  }
}

function parseArgs(argv) {
  const args = {};
  let i = 2;
  while (i < argv.length) {
    const tok = argv[i];
    if (!tok.startsWith('--')) { i++; continue; }
    const name = tok.slice(2);
    // Boolean flags.
    if (name === 'dry-run' || name === 'force') {
      args[name] = true;
      i++;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[name] = true;
      i++;
    } else {
      args[name] = next;
      i += 2;
    }
  }
  return args;
}

function usage() {
  stderr.write([
    'Usage:',
    '  node scripts/migrate-vault-to-pod.js \\',
    '    --webid https://alice.example/profile/card#me \\',
    '    --vault-path ./vault.json \\',
    '    --pod-root https://alice.example/ \\',
    '    --mnemonic-file ./mnemonic.txt \\',
    '    [--label "the author\'s laptop"] [--platform-hint linux] \\',
    '    [--dry-run] [--force]',
    '',
  ].join('\n'));
}

async function main() {
  const a = parseArgs(argv);
  const required = ['webid', 'vault-path', 'pod-root', 'mnemonic-file'];
  const missing = required.filter((k) => !a[k] || typeof a[k] !== 'string');
  if (missing.length > 0) {
    stderr.write(`migrate-vault-to-pod: missing required arg(s): ${missing.join(', ')}\n\n`);
    usage();
    exit(2);
  }

  // 1. Open the local vault.
  const vault = new VaultNodeFs({ path: a['vault-path'] });

  // 2. Load (or restore) the device's AgentIdentity.  We do NOT auto-create
  //    here — running the migrator on a vault with no identity would write
  //    a brand-new device record under a freshly-generated key, almost
  //    certainly not what the user wants.
  let identity;
  try {
    identity = await AgentIdentity.restore(vault);
  } catch (err) {
    stderr.write(`migrate-vault-to-pod: could not restore AgentIdentity from '${a['vault-path']}': ${err.message}\n`);
    stderr.write('Make sure the vault contains an `agent-privkey` entry; this CLI does not generate new identities.\n');
    exit(1);
  }

  // 3. Load the BIP-39 mnemonic.
  const mnemonic = (await readFile(a['mnemonic-file'], 'utf8')).trim();

  // 4. Wire a PodClient via Solid-OIDC.  The SolidVault adapter wraps the
  //    same vault for OIDC token storage; if the user hasn't gone through
  //    the OIDC flow yet, this will fail loudly.
  const { PodClient, SolidOidcAuth } = await loadPodClient();
  const { SolidVault }               = await import('../packages/core/src/storage/SolidVault.js');

  const sv = new SolidVault({ webid: a.webid, vault });
  await sv.login();
  const auth = new SolidOidcAuth({ vault: sv });
  const podClient = new PodClient({ podRoot: a['pod-root'], auth });

  // 5. Run the migration.
  const deviceMeta = {};
  if (typeof a.label === 'string')          deviceMeta.label        = a.label;
  if (typeof a['platform-hint'] === 'string') deviceMeta.platformHint = a['platform-hint'];

  const report = await migrateVaultToPod({
    vault,
    identity,
    podClient,
    podRoot:  a['pod-root'],
    mnemonic,
    deviceMeta,
    dryRun:   Boolean(a['dry-run']),
    force:    Boolean(a.force),
  });

  stdout.write(JSON.stringify(report, null, 2) + '\n');
}

main().catch((err) => {
  stderr.write(`migrate-vault-to-pod: ${err?.message ?? err}\n`);
  if (err?.stack) stderr.write(err.stack + '\n');
  exit(1);
});
