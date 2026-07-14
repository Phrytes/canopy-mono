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
 *     v: 2,
 *     agents: [{
 *       agentId, pubKey, webid?, agentUri, role, name?, deviceId?,
 *       capabilities, grants, signedAt, revokedAt
 *     }],
 *     updatedAt: ISO
 *   }
 *
 * `grants[]` (v2+) holds the fine-grained signed-token authorities
 * `{ tokenId, skill, expiresAt, subject, capability }`. The token is the
 * enforced authority; `capabilities[]` only mirrors the coarse
 * `capability` of each grant. v1 resources (no `grants`) migrate
 * forward with `grants → []`.
 *
 * Standardisation Phase 52.10 — see plan §52.10.
 */

import { normaliseProperties } from './profileProperties.js';

// v3 (identity step 2) — added per-profile `properties` (own/inherit graph) + `ownerFingerprint`
// (the owner-root binding). Additive + forward-compatible: v2 entries simply lack them (→ {} / null).
export const RESOURCE_VERSION = 3;

/**
 * Default registry-resource path for a given pod / device.
 *
 * **V0 default — pseudo-pod-authoritative.** Per the Phase 52.10
 * lock the registry lives on the *pseudo-pod*: `pod-onboarding`
 * seeds it there during provisioning, and the underlying
 * pseudo-pod V0 (Phase 52.2) can only write to `pseudo-pod://`
 * URIs. Pod-side mirroring at `<anchorPodUri>/private/agent-registry`
 * is V1+ work — wired through cache-mode pseudo-pod (Phase 52.8) once
 * the consuming app composes the registry's pseudo-pod in cache mode.
 *
 * Callers that want the pod-side path today can pass `preferPodUri: true`
 * (forces the https:// path; the pseudo-pod must accept it, i.e. be
 * cache-mode or wrap a pod-client).
 */
export function registryResourceUri({ anchorPodUri, deviceId, preferPodUri = false }) {
  if (preferPodUri && typeof anchorPodUri === 'string' && anchorPodUri.length > 0) {
    const base = anchorPodUri.endsWith('/') ? anchorPodUri.slice(0, -1) : anchorPodUri;
    return `${base}/private/agent-registry`;
  }
  if (typeof deviceId === 'string' && deviceId.length > 0) {
    return `pseudo-pod://${deviceId}/private/agent-registry`;
  }
  if (typeof anchorPodUri === 'string' && anchorPodUri.length > 0) {
    const base = anchorPodUri.endsWith('/') ? anchorPodUri.slice(0, -1) : anchorPodUri;
    return `${base}/private/agent-registry`;
  }
  throw Object.assign(
    new Error('registryResourceUri: deviceId (preferred) or anchorPodUri is required'),
    { code: 'INVALID_ARGUMENT' },
  );
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
    grants:       Array.isArray(a.grants) ? Object.freeze(a.grants.map(_normaliseGrant).filter(Boolean)) : Object.freeze([]),
    signedAt:     typeof a.signedAt === 'string' ? a.signedAt : new Date().toISOString(),
    revokedAt:    typeof a.revokedAt === 'string' ? a.revokedAt : null,
    // identity step 2 — profile fields (additive; absent on v2 entries → {} / null)
    properties:       normaliseProperties(a.properties),
    ownerFingerprint: typeof a.ownerFingerprint === 'string' ? a.ownerFingerprint : null,
  });
}

/**
 * Strict-allowlist normalise for a single grant. Drops entries without
 * a usable `tokenId`; coerces the rest. Frozen.
 */
function _normaliseGrant(g) {
  if (!g || typeof g !== 'object') return null;
  if (typeof g.tokenId !== 'string' || g.tokenId.length === 0) return null;
  return Object.freeze({
    tokenId:    g.tokenId,
    skill:      typeof g.skill      === 'string' ? g.skill      : null,
    expiresAt:  typeof g.expiresAt  === 'string' ? g.expiresAt  : null,
    subject:    typeof g.subject    === 'string' ? g.subject    : null,
    capability: typeof g.capability === 'string' ? g.capability : null,
    // identity step 2.3 — a grant may NAME a profile the grantee (a device) may run,
    // so "delegate profile X to device D, revocably" rides the same token-first path.
    profile:    typeof g.profile    === 'string' ? g.profile    : null,
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
    grants:    [],
    signedAt:  new Date().toISOString(),
    revokedAt: null,
    properties: {},
    ownerFingerprint: null,
  };
}
