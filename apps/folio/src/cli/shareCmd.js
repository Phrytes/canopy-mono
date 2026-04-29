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
