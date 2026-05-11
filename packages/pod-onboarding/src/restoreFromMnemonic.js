/**
 * restoreFromMnemonic — re-attach an agent identity on a new
 * device.
 *
 * Steps:
 *   1. Reconstitute the AgentIdentity from the 24-word BIP-39
 *      phrase (deterministic; same pubkey as the original).
 *   2. Discover the user's pod pointers via WebID lookup. Callers
 *      pass a `webidCache` (a `@canopy/webid-discovery.WebIdCache`
 *      instance) — the cache handles fetching + parsing the
 *      profile. The substrate just consults its discovered pointers.
 *   3. Fetch storage-mapping + agent-registry from the pod (or the
 *      pseudo-pod replica for no-pod users).
 *   4. Return the assembled `{identity, pointers, storageMapping,
 *      agentRegistry}` payload — the caller wires this into a new
 *      Agent (typically via `agent-provisioning.provisionAgent`).
 *
 * Standardisation Phase 52.5 — see plan §52.5.4.
 */

import { AgentIdentity } from '@canopy/core';
import { VaultMemory }   from '@canopy/vault';

/**
 * @param {object} opts
 * @param {string} opts.mnemonic
 * @param {object} [opts.vault]              — defaults to VaultMemory
 * @param {object} [opts.webidCache]         — required for pod-having users
 * @param {object} [opts.pseudoPod]          — required for no-pod users (mirror copy)
 * @param {string} [opts.deviceId]           — required for pseudo-pod lookup
 * @param {object} [opts.podProvisioner]     — if supplied, used to fetch pod resources
 * @param {object} [opts.oidcSession]        — provides authenticatedFetch for pod reads
 */
export async function restoreFromMnemonic({
  mnemonic,
  vault: providedVault,
  webidCache,
  pseudoPod,
  deviceId,
  podProvisioner,
  oidcSession,
} = {}) {
  if (typeof mnemonic !== 'string' || mnemonic.length === 0) {
    throw Object.assign(
      new Error('restoreFromMnemonic: mnemonic is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

  // 1. Identity.
  const vault    = providedVault ?? new VaultMemory();
  const identity = await AgentIdentity.fromMnemonic(mnemonic, vault);

  // 2. WebID pointer discovery (pod-having path).
  let pointers       = null;
  let storageMapping = null;
  let agentRegistry  = null;
  let webidUri       = null;

  if (webidCache) {
    // The cache populates pointers via its own background refresh.
    if (typeof webidCache.refresh === 'function') {
      try { await webidCache.refresh(); } catch { /* offline-tolerant */ }
    }
    pointers = typeof webidCache.pointers === 'object' ? webidCache.pointers : null;
    webidUri = webidCache.webid ?? null;

    // 3a. Fetch pod resources via the provisioner if wired.
    if (podProvisioner && typeof podProvisioner.getResource === 'function' && oidcSession) {
      const fetch = typeof oidcSession.getAuthenticatedFetch === 'function'
        ? oidcSession.getAuthenticatedFetch()
        : undefined;
      if (pointers?.storageMappingUri) {
        try {
          const rec = await podProvisioner.getResource({ uri: pointers.storageMappingUri, fetch });
          if (rec?.body) storageMapping = rec.body;
        } catch { /* network flake — fall back to pseudo-pod */ }
      }
      if (pointers?.agentRegistryUri) {
        try {
          const rec = await podProvisioner.getResource({ uri: pointers.agentRegistryUri, fetch });
          if (rec?.body) agentRegistry = rec.body;
        } catch { /* network flake */ }
      }
    }
  }

  // 3b. Pseudo-pod replica (no-pod users + offline fall-back).
  if (pseudoPod && typeof deviceId === 'string') {
    if (!storageMapping) {
      const rec = await pseudoPod.read(`pseudo-pod://${deviceId}/private/storage-mapping`);
      if (rec?.bytes) storageMapping = rec.bytes;
    }
    if (!agentRegistry) {
      const rec = await pseudoPod.read(`pseudo-pod://${deviceId}/private/agent-registry`);
      if (rec?.bytes) agentRegistry = rec.bytes;
    }
  }

  return {
    identity,
    vault,
    webidUri,
    pointers,
    storageMapping,
    agentRegistry,
  };
}
