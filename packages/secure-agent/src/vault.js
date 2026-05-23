/**
 * @canopy/secure-agent — vault helpers.
 *
 * Lifted from canopy-chat's `apps/canopy-chat/src/web/realAgent.js`
 * (v0.7.P3a).  Promoted to substrate so the factory + any other
 * app can reuse the same persistence pattern.
 *
 * Layer: substrate.  Platform: neutral (uses globalThis for the
 * browser-detection check; tests inject VaultMemory directly).
 */

import {
  VaultMemory,
  VaultLocalStorage,
} from '@canopy/vault';
import { AgentIdentity } from '@canopy/core';

/**
 * Pick the right vault for the runtime:
 *   - Browser → VaultLocalStorage (persists across reloads)
 *   - Node / tests / SSR → VaultMemory (transient)
 *
 * Caller can always pass an explicit `vault` to createSecureAgent
 * to bypass this picker entirely (e.g. tests inject VaultMemory).
 *
 * @param {string} [prefix='sa-id:']   localStorage key namespace
 * @returns {Vault}
 */
export function makeBrowserVault(prefix = 'sa-id:') {
  if (typeof globalThis.localStorage !== 'undefined') {
    try {
      return new VaultLocalStorage({ prefix });
    } catch {
      // Storage may be disabled / over quota; fall through to in-memory.
    }
  }
  return new VaultMemory();
}

/**
 * Restore an AgentIdentity from the vault; generate a fresh one
 * if none persisted.  Same key persists across reloads via the
 * vault's `agent-privkey` slot.
 *
 * @param {Vault} vault
 * @returns {Promise<AgentIdentity>}
 */
export async function restoreOrGenerate(vault) {
  try {
    if (await vault.has('agent-privkey')) {
      return await AgentIdentity.restore(vault);
    }
  } catch {
    // Corrupt or unreadable entry → generate fresh (next slice
    // could surface a clearer warning + recovery flow).
  }
  return AgentIdentity.generate(vault);
}
