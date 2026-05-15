/**
 * folio share <path> — mint a PodCapabilityToken for a file or folder.
 *
 * Loads the BIP-39 phrase from the vault, derives an AgentIdentity from
 * the seed, and issues a signed PodCapabilityToken granting the named peer
 * read (or other) access to a path under the configured podRoot.
 *
 * Flags:
 *   --scope read|write|delete|*    (default: read)
 *   --for   <peer-pubkey-b64url>   (REQUIRED — the recipient)
 *   --expires <ms-from-now>        (default: 3_600_000)
 *   --mode  cap-token|acp          (default: cap-token)
 *                                  cap-token: mint a PodCapabilityToken (this CLI's only V1 path).
 *                                  acp: NOT supported from the CLI — requires an authenticated
 *                                  Pod session. Use the browser Share pane instead, or call
 *                                  POST /share against `folio serve` with mode:'acp'.
 *                                  See Phase 52.16 (2026-05-14) in
 *                                  `Project Files/Inrupt-migration/`.
 *
 * Output: the serialized token JSON, one line, ready to paste/share.
 */
import {
  AgentIdentity,
  Bootstrap,
  PodCapabilityToken,
  VaultNodeFs,
} from '@canopy/core';

import { requireConfig } from './_config.js';

const VALID_SCOPES = new Set(['read', 'write', 'delete', '*']);

export async function shareCmd(args) {
  const subjPath = args.find((a) => !a.startsWith('--'));
  if (!subjPath) {
    throw new Error('usage: folio share <path> --for <peer-pubkey-b64url> [--scope read|write|delete|*] [--expires <ms>]');
  }

  const flags = parseFlags(args);
  const scope = flags.scope ?? 'read';
  if (!VALID_SCOPES.has(scope)) {
    throw new Error(`invalid --scope "${scope}"; must be one of: ${[...VALID_SCOPES].join(', ')}`);
  }
  const subject = flags.for;
  if (!subject) {
    throw new Error('missing --for <peer-pubkey-b64url>');
  }
  const expiresIn = flags.expires ? Number(flags.expires) : 3_600_000;
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('--expires must be a positive number of milliseconds');
  }
  // Phase 52.16.3 (2026-05-14) — `--mode` flag exists for parity with
  // the browser/server share pane. The CLI is cap-token-only: ACP
  // grants require an authenticated Pod session, which the CLI
  // doesn't have.
  const mode = flags.mode ?? 'cap-token';
  if (mode === 'acp') {
    throw new Error(
      'folio share --mode acp is not supported from the CLI (no authenticated Pod session). ' +
      'Use the browser Share pane at http://127.0.0.1:8888 (after `folio serve` + sign-in), ' +
      'or POST /share with mode:"acp" body field.',
    );
  }
  if (mode !== 'cap-token') {
    throw new Error(`invalid --mode "${mode}"; supported from CLI: cap-token`);
  }

  const cfg = await requireConfig();
  if (!cfg.vaultPath) throw new Error('config has no vaultPath; re-run `folio init`');

  const vault       = new VaultNodeFs(cfg.vaultPath);
  const seedB64     = await vault.get('bootstrap-seed-b64');
  const mnemonic    = await vault.get('bootstrap-mnemonic');
  if (!seedB64 && !mnemonic) {
    throw new Error('no identity material in vault — re-run `folio init`');
  }
  const bootstrap = seedB64
    ? Bootstrap.fromSeed(new Uint8Array(Buffer.from(seedB64, 'base64')))
    : Bootstrap.fromMnemonic(mnemonic);

  const identity = new AgentIdentity({ seed: bootstrap.secret, vault: null });

  // Translate the share path to a pod-relative path.  Accept absolute pod
  // URIs verbatim, otherwise treat as relative to the configured podRoot.
  const relPath = subjPath.startsWith('http://') || subjPath.startsWith('https://')
    ? subjPath.slice(cfg.podRoot.length).replace(/^\/+/, '')
    : subjPath.replace(/^\/+/, '');
  const scopePath = `/${relPath}`;
  const scopeStr  = `pod.${scope}:${scopePath}`;

  const token = await PodCapabilityToken.issue(identity, {
    subject,
    pod:       cfg.podRoot,
    scopes:    [scopeStr],
    expiresIn,
  });

  // Output: bare token JSON, one line — back-compat with downstream
  // pipelines (`folio share … | something`). The CLI mode is always
  // cap-token in V1; the server `/share` endpoint is where the
  // wrapped `{mode, token? | grant?}` envelope lives (Phase 52.16.3).
  console.log(JSON.stringify(token.toJSON()));
}

function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    const key  = a.slice(2);
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
