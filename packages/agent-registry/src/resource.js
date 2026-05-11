/**
 * Agent-registry resource shape + read/write helpers.
 *
 * Lives at `<anchor-pod>/private/agent-registry` (or
 * `pseudo-pod://<deviceId>/private/agent-registry` for no-pod
 * users). The substrate reads + writes through the pseudo-pod —
 * cache mode handles real-pod write-through, replication-ring
 * mode keeps a no-pod replica in sync across the user's devices.
 *
 * Wire shape (forward-additive):
 *
 *   {
 *     v: 1,
 *     agents: [{
 *       agentId, pubKey, webid?, agentUri, role, name?, deviceId?,
 *       capabilities, signedAt, revokedAt
 *     }],
 *     updatedAt: ISO
 *   }
 *
 * Standardisation Phase 52.10 — see plan §52.10.
 */

export const RESOURCE_VERSION = 1;

/**
 * Default registry-resource path for a given pod / device.
 */
export function registryResourceUri({ anchorPodUri, deviceId }) {
  if (typeof anchorPodUri === 'string' && anchorPodUri.length > 0) {
    const base = anchorPodUri.endsWith('/') ? anchorPodUri.slice(0, -1) : anchorPodUri;
    return `${base}/private/agent-registry`;
  }
  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    throw Object.assign(
      new Error('registryResourceUri: anchorPodUri or deviceId is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  return `pseudo-pod://${deviceId}/private/agent-registry`;
}

/**
 * Default empty resource body.
 */
export function emptyResource() {
  return Object.freeze({
    v:         RESOURCE_VERSION,
    agents:    Object.freeze([]),
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Normalise a resource read from the pseudo-pod. Tolerates absent
 * fields; freezes the result.
 */
export function normaliseResource(raw) {
  if (!raw || typeof raw !== 'object') return emptyResource();
  const agents = Array.isArray(raw.agents) ? raw.agents : [];
  return Object.freeze({
    v:         typeof raw.v === 'number' ? raw.v : RESOURCE_VERSION,
    agents:    Object.freeze(agents.map(_normaliseAgent)),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  });
}

function _normaliseAgent(a) {
  if (!a || typeof a !== 'object') return Object.freeze({ ...emptyAgent() });
  return Object.freeze({
    agentId:      typeof a.agentId === 'string' ? a.agentId : '',
    pubKey:       typeof a.pubKey  === 'string' ? a.pubKey  : '',
    webid:        typeof a.webid   === 'string' ? a.webid   : null,
    agentUri:     typeof a.agentUri === 'string' ? a.agentUri : '',
    role:         typeof a.role    === 'string' ? a.role    : 'device',
    name:         typeof a.name    === 'string' ? a.name    : null,
    deviceId:     typeof a.deviceId === 'string' ? a.deviceId : null,
    capabilities: Array.isArray(a.capabilities) ? Object.freeze([...a.capabilities]) : Object.freeze([]),
    signedAt:     typeof a.signedAt === 'string' ? a.signedAt : new Date().toISOString(),
    revokedAt:    typeof a.revokedAt === 'string' ? a.revokedAt : null,
  });
}

function emptyAgent() {
  return {
    agentId:   '',
    pubKey:    '',
    webid:     null,
    agentUri:  '',
    role:      'device',
    name:      null,
    deviceId:  null,
    capabilities: [],
    signedAt:  new Date().toISOString(),
    revokedAt: null,
  };
}
