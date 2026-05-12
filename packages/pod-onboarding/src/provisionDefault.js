/**
 * provisionDefault — orchestrates first-run pod provisioning.
 *
 * Steps (per functional design §4.2.3):
 *   1. Identity: reconstitute from `mnemonic` (BIP-39 → HKDF seed
 *      via `AgentIdentity.fromMnemonic`) or use a caller-supplied
 *      pre-built identity.
 *   2. Pod creation: delegate to the injected `podProvisioner`.
 *      Returns `{podUri, webidUri, fetch}`.
 *   3. Container creation: PUT `/private/`, `/sharing/`,
 *      `/sharing/public/`.
 *   4. ACP stamping: apply the default templates to each container.
 *   5. Initial resources: PUT the storage-mapping + agent-registry
 *      resources on the pod.
 *   6. Local pseudo-pod mirror: write a local copy of the
 *      storage-mapping so the no-pod fallback works.
 *   7. WebID profile patch: add the pointer predicates
 *      (solid:storage, dec:storage-mapping-uri, etc.).
 *
 * Provisioner contract — see top-level README.
 */

import { AgentIdentity } from '@canopy/core';
import { VaultMemory }   from '@canopy/vault';

import { defaultAcpTemplates }      from './acpTemplates.js';
import {
  buildInitialStorageMapping,
  buildInitialAgentRegistry,
  buildWebidPointers,
  pointerPredicates,
} from './initialResources.js';

/** Convert a pubkey Uint8Array → base64. */
function _b64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

/**
 * @typedef {object} ProvisionDefaultOpts
 *
 * @property {string}   [oidcProvider]      — OIDC issuer URL. Passed verbatim to the provisioner.
 * @property {string}   [mnemonic]          — 24-word BIP-39 phrase. Required when `identity` is absent.
 * @property {object}   [identity]          — pre-built AgentIdentity. Alternative to mnemonic.
 * @property {object}   [vault]             — Vault for the new identity. Defaults to VaultMemory.
 * @property {object}   pseudoPod           — required. Local pseudo-pod for the mirror copy.
 * @property {object}   podProvisioner      — required. See README for the interface contract.
 * @property {object}   [agentInfo]         — required. `{deviceId, agentUri, pubKey?, displayName?}`.
 *                                            `pubKey` is auto-filled from `identity.pubKey` when absent.
 *
 * @typedef {object} ProvisionDefaultResult
 * @property {string} podUri
 * @property {string} webidUri
 * @property {object} pointers
 * @property {object} storageMapping
 * @property {object} agentRegistryEntry
 * @property {object} acpTemplates
 * @property {object} identity
 * @property {string} [mnemonic]
 */

/**
 * @param {ProvisionDefaultOpts} opts
 * @returns {Promise<ProvisionDefaultResult>}
 */
export async function provisionDefault({
  oidcProvider,
  mnemonic,
  identity: providedIdentity,
  vault: providedVault,
  pseudoPod,
  podProvisioner,
  agentInfo,
} = {}) {
  if (!pseudoPod || typeof pseudoPod.write !== 'function') {
    throw Object.assign(
      new Error('provisionDefault: `pseudoPod` is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (!podProvisioner || typeof podProvisioner.createPod !== 'function') {
    throw Object.assign(
      new Error('provisionDefault: `podProvisioner.createPod` is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (!agentInfo || typeof agentInfo !== 'object') {
    throw Object.assign(
      new Error('provisionDefault: `agentInfo` is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (typeof agentInfo.deviceId !== 'string' || agentInfo.deviceId.length === 0) {
    throw Object.assign(
      new Error('provisionDefault: agentInfo.deviceId is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (typeof agentInfo.agentUri !== 'string' || agentInfo.agentUri.length === 0) {
    throw Object.assign(
      new Error('provisionDefault: agentInfo.agentUri is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

  // 1. Identity.
  const vault = providedVault ?? new VaultMemory();
  let identity = providedIdentity;
  if (!identity) {
    if (typeof mnemonic !== 'string' || mnemonic.length === 0) {
      throw Object.assign(
        new Error('provisionDefault: either `mnemonic` or `identity` is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    identity = await AgentIdentity.fromMnemonic(mnemonic, vault);
  }
  const pubKey = agentInfo.pubKey ?? _b64(identity.pubKey);

  // 2. Pod creation.
  const podCreation = await podProvisioner.createPod({
    oidcProvider,
    identity,
    agentInfo: { ...agentInfo, pubKey },
  });
  const { podUri, webidUri, fetch: authedFetch } = podCreation;
  if (typeof podUri !== 'string' || typeof webidUri !== 'string') {
    throw Object.assign(
      new Error('provisionDefault: provisioner.createPod must return {podUri, webidUri, fetch}'),
      { code: 'PROVISIONER_FAILED' },
    );
  }

  // 3. Containers + 4. ACPs.
  const acps = defaultAcpTemplates({ agentWebid: webidUri });
  const containers = [
    { uri: _stripTrailingSlash(podUri) + '/private/',        acp: acps.private },
    { uri: _stripTrailingSlash(podUri) + '/sharing/',        acp: acps.sharing },
    { uri: _stripTrailingSlash(podUri) + '/sharing/public/', acp: acps.sharingPublic },
  ];
  if (typeof podProvisioner.createContainer === 'function') {
    for (const c of containers) {
      await podProvisioner.createContainer({ uri: c.uri, fetch: authedFetch });
    }
  }
  if (typeof podProvisioner.setAcp === 'function') {
    for (const c of containers) {
      await podProvisioner.setAcp({ uri: c.uri, acp: c.acp, fetch: authedFetch });
    }
  }

  // 5. Initial pod resources.
  const storageMapping = buildInitialStorageMapping({
    podUri,
    deviceId: agentInfo.deviceId,
  });
  const agentRegistryEntry = buildInitialAgentRegistry({
    podUri,
    // Carry the WebID into the seed so post-provision
    // `agent-registry.lookup(webid)` matches without a re-register.
    agentInfo: { ...agentInfo, pubKey, webid: agentInfo.webid ?? webidUri },
  });
  await podProvisioner.putResource({
    uri:         _stripTrailingSlash(podUri) + '/private/storage-mapping',
    body:        storageMapping,
    contentType: 'application/json',
    fetch:       authedFetch,
  });
  await podProvisioner.putResource({
    uri:         _stripTrailingSlash(podUri) + '/private/agent-registry',
    body:        agentRegistryEntry,
    contentType: 'application/json',
    fetch:       authedFetch,
  });

  // 6. Local pseudo-pod mirror copy (so the no-pod fallback works).
  await pseudoPod.write(
    `pseudo-pod://${agentInfo.deviceId}/private/storage-mapping`,
    storageMapping,
  );
  await pseudoPod.write(
    `pseudo-pod://${agentInfo.deviceId}/private/agent-registry`,
    agentRegistryEntry,
  );

  // 7. WebID profile patch.
  const pointers = buildWebidPointers({ podUri });
  if (typeof podProvisioner.patchWebidProfile === 'function') {
    await podProvisioner.patchWebidProfile({
      webidUri,
      pointers,
      predicates: pointerPredicates(),
      fetch:      authedFetch,
    });
  }

  return {
    podUri,
    webidUri,
    pointers,
    storageMapping,
    agentRegistryEntry,
    acpTemplates: acps,
    identity,
    ...(mnemonic ? { mnemonic } : {}),
  };
}

function _stripTrailingSlash(s) {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
