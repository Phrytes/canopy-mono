/**
 * identityBootstrap — load-or-generate the agent identity at app start.
 *
 * Stoop V3 Phase 40.14 (2026-05-08).
 *
 * The identity (Ed25519 keypair) is stored in the OS keychain via
 * `KeychainVault` from `@canopy/react-native`. On first launch a
 * fresh keypair is generated; on subsequent launches it loads the
 * existing one. The mnemonic-restore flow (Phase 31's mid-flight
 * swap) replaces the keypair via `AgentIdentity.fromMnemonic`.
 *
 * The keychain `service` namespace is `'stoop'` so identity material
 * doesn't collide with folio's keychain entries.
 */

import { AgentIdentity } from '@canopy/core';

// `KeychainVault` is loaded lazily — its module-load imports
// `react-native-keychain` (a TS file), which vitest can't parse.
// Tests inject a stub vault and never trigger this path.
async function _defaultVault() {
  const mod = await import('@canopy/react-native/src/identity/KeychainVault.js');
  return new mod.KeychainVault({ service: STOOP_KEYCHAIN_SERVICE });
}

export const STOOP_KEYCHAIN_SERVICE = 'stoop';

/**
 * @param {object} [args]
 * @param {object} [args.vault]   inject for tests; defaults to a fresh `KeychainVault({service: 'stoop'})`.
 * @returns {Promise<{ identity: AgentIdentity, isFresh: boolean, vault: object }>}
 */
export async function loadOrGenerateIdentity({ vault } = {}) {
  const vlt = vault ?? await _defaultVault();

  // `AgentIdentity` keys the seed under `agent-privkey` in the vault.
  // `vault.get` returning a value means the keypair already exists.
  const raw = await vlt.get?.('agent-privkey');
  if (raw) {
    const identity = await AgentIdentity.restore(vlt);
    return { identity, isFresh: false, vault: vlt };
  }

  const identity = await AgentIdentity.generate(vlt);
  return { identity, isFresh: true, vault: vlt };
}

/**
 * Wipe the persisted identity. Used by sign-out + by the
 * mnemonic-restore flow before persisting the restored identity.
 *
 * @param {object} [args]
 * @param {object} [args.vault]
 */
export async function clearIdentity({ vault } = {}) {
  const vlt = vault ?? await _defaultVault();
  if (typeof vlt.delete !== 'function') return;
  // `agent-privkey` is the seed; `agent-stableid` + `agent-deviceid`
  // are the per-identity derived blobs that AgentIdentity persists.
  await Promise.all([
    vlt.delete('agent-privkey'),
    vlt.delete('agent-stableid'),
    vlt.delete('agent-deviceid'),
  ]).catch(() => { /* best-effort wipe */ });
}
