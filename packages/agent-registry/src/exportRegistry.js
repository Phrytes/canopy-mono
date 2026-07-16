// Identity step 5A — export the profile set to an encrypted, storage-agnostic artifact.
// The "export my profiles to an encrypted file / purpose-built DB" layer (Frits' vision).
//
// Reuses @onderling/core CloudBackup (argon2id + xsalsa20poly1305) — the same passphrase-sealed
// envelope it uses for cloud identity backup — with a passthrough adapter so we get the sealed
// BYTES instead of an upload. The artifact is "everything, guard it": the OWNER ROOT (re-derives
// every profile key) + the REGISTRY SNAPSHOT (the profiles' properties/structure, which aren't
// derivable), sealed to a user passphrase. The pod-less recovery path.
import { CloudBackup } from '@onderling/core';

/** One-shot in-memory CloudAdapter — captures the sealed envelope bytes (no cloud). */
function bytesAdapter(initial = null) {
  let bytes = initial;
  return { async put(_ref, b) { bytes = b; return b; }, async get() { return bytes; }, bytes: () => bytes };
}

/**
 * Export the profile set to a passphrase-sealed, storage-agnostic artifact (identity step 5A):
 * the owner root plus a registry snapshot (`registry.list()`), sealed with core `CloudBackup`
 * (argon2id + xsalsa20poly1305). Returns the sealed envelope bytes; open them again with
 * `importProfileRegistry`.
 *
 * @param {object} a
 * @param {object} a.ownerRoot    a core Bootstrap — re-derives every profile key on import.
 * @param {object} a.registry     an @onderling/agent-registry handle (snapshotted via list()).
 * @param {string} a.passphrase   the export password ("this file is everything, guard it").
 * @param {object[]} [a.hints]    optional recovery hints.
 * @param {object} [a.argonOpts]  KDF cost override (tests pass a light one).
 * @returns {Promise<Uint8Array>} the sealed envelope — write to a file / purpose-built DB.
 */
export async function exportProfileRegistry({ ownerRoot, registry, passphrase, hints = [], argonOpts } = {}) {
  if (!ownerRoot?.toMnemonic) throw new Error('exportProfileRegistry: ownerRoot (a Bootstrap) is required');
  if (!registry || typeof registry.list !== 'function') throw new Error('exportProfileRegistry: a registry is required');
  if (typeof passphrase !== 'string' || passphrase.length === 0) throw new Error('exportProfileRegistry: a passphrase is required');
  const snapshot = { v: 1, resourceUri: registry.resourceUri ?? null, agents: await registry.list() };
  const registryBytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const adapter = bytesAdapter();
  await new CloudBackup({ adapter, ...(argonOpts ? { argonOpts } : {}) })
    .upload({ bootstrap: ownerRoot, passphrase, hints, fullPodArchive: registryBytes });
  return adapter.bytes();
}

/**
 * Open a sealed export → the owner root + the profile registry snapshot.
 * @returns {Promise<{ ownerRoot: object, registry: object|null }>}
 */
export async function importProfileRegistry({ sealed, passphrase, argonOpts } = {}) {
  if (!(sealed instanceof Uint8Array)) throw new Error('importProfileRegistry: sealed bytes are required');
  if (typeof passphrase !== 'string' || passphrase.length === 0) throw new Error('importProfileRegistry: a passphrase is required');
  const { bootstrap, fullPodArchive } = await new CloudBackup({ adapter: bytesAdapter(sealed), ...(argonOpts ? { argonOpts } : {}) })
    .restore({ passphrase });
  const registry = fullPodArchive ? JSON.parse(new TextDecoder().decode(fullPodArchive)) : null;
  return { ownerRoot: bootstrap, registry };
}

/** Write an imported snapshot into a (fresh) registry — the pod-less recovery of the profile set. */
export async function restoreProfilesInto(registry, snapshot) {
  const entries = Array.isArray(snapshot?.agents) ? snapshot.agents : [];
  let n = 0;
  for (const e of entries) {
    if (e?.agentId && e?.pubKey) { await registry.register(e); n += 1; }
  }
  return n;
}
