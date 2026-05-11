/**
 * Initial pod-resource bodies the substrate writes during
 * `provisionDefault`.
 *
 * The substrate computes the *content* here; the provisioner is
 * responsible for the wire transmission (PUT to the pod) and
 * serialization (JSON for V0, RDF / Turtle for V1 where the spec
 * calls for it).
 */

import { CONFIG_VERSION }      from '@canopy/pod-routing';
import { buildDefaultPolicy }  from '@canopy/pod-routing';
import { WEBID_PREDICATES }    from '@canopy/webid-discovery';

/**
 * Build the initial storage-mapping config that lives at
 * `<pod>/private/storage-mapping`.
 *
 * Uses pod-routing's default policy as a starting point — user
 * customisation rides on top via `pod-routing.updateMapping`.
 *
 * @param {object} args
 * @param {string} args.podUri
 * @param {string} args.deviceId
 * @returns {object}
 */
export function buildInitialStorageMapping({ podUri, deviceId }) {
  if (typeof podUri !== 'string' || podUri.length === 0) {
    throw Object.assign(
      new Error('buildInitialStorageMapping: podUri is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    throw Object.assign(
      new Error('buildInitialStorageMapping: deviceId is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  const { mappings, crewPolicyDefault } = buildDefaultPolicy({
    anchorPodUri: podUri,
    deviceId,
  });
  return {
    version:       CONFIG_VERSION,
    defaultPolicy: 'one-pod',
    mappings,
    crewPolicies:  {},
    crewPolicyDefault,
    updatedAt:     new Date().toISOString(),
  };
}

/**
 * Build the initial agent-registry entry. The full agent-registry
 * substrate lands in Phase 52.10 (P5) — for V0 we ship a minimal
 * single-agent entry so the resource exists and can be extended
 * later.
 *
 * Resource path: `<pod>/private/agent-registry`.
 */
export function buildInitialAgentRegistry({ agentInfo, podUri }) {
  if (!agentInfo || typeof agentInfo !== 'object') {
    throw Object.assign(
      new Error('buildInitialAgentRegistry: agentInfo is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  const required = ['deviceId', 'agentUri', 'pubKey'];
  for (const k of required) {
    if (typeof agentInfo[k] !== 'string' || agentInfo[k].length === 0) {
      throw Object.assign(
        new Error(`buildInitialAgentRegistry: agentInfo.${k} is required`),
        { code: 'INVALID_ARGUMENT' },
      );
    }
  }
  return {
    version:    1,
    podUri,
    agents: [{
      deviceId:     agentInfo.deviceId,
      agentUri:     agentInfo.agentUri,
      pubKey:       agentInfo.pubKey,
      displayName:  agentInfo.displayName ?? null,
      addedAt:      new Date().toISOString(),
      capabilities: Array.isArray(agentInfo.capabilities) ? [...agentInfo.capabilities] : [],
    }],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Build the WebID-profile predicates the provisioner stamps onto
 * the user's profile during onboarding.
 *
 * Returns the **logical pointers**, not the wire syntax. The
 * provisioner converts these to whatever predicate-IRI / object
 * pairs the underlying WebID format wants (Turtle / JSON-LD).
 */
export function buildWebidPointers({ podUri }) {
  if (typeof podUri !== 'string' || podUri.length === 0) {
    throw Object.assign(
      new Error('buildWebidPointers: podUri is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  const pod = _stripTrailingSlash(podUri);
  return Object.freeze({
    /** solid:storage — standard predicate already on most WebID profiles. */
    storage:           pod + '/',
    /** dec:storage-mapping-uri. */
    storageMappingUri: pod + '/private/storage-mapping',
    /** dec:agent-registry-uri. */
    agentRegistryUri:  pod + '/private/agent-registry',
    /** dec:audit-log-uri (deferred — written but not yet consumed). */
    auditLogUri:       pod + '/private/audit-log',
  });
}

/** Map logical pointer names → predicate IRIs. */
export function pointerPredicates() {
  return Object.freeze({
    storage:           'http://www.w3.org/ns/solid/terms#storage',
    storageMappingUri: WEBID_PREDICATES.storageMappingUri,
    agentRegistryUri:  WEBID_PREDICATES.agentRegistryUri,
    auditLogUri:       WEBID_PREDICATES.auditLogUri,
  });
}

function _stripTrailingSlash(s) {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
