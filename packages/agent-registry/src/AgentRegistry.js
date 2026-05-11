/**
 * createAgentRegistry — the substrate factory.
 *
 * Reads + mutates the agent-registry pod resource via the pseudo-pod,
 * with etag-based optimistic concurrency. Apps inject the pseudo-pod;
 * the substrate owns the resource shape, validation, indexing, and
 * retry policy.
 *
 * Standardisation Phase 52.10.
 */

import {
  registryResourceUri,
  normaliseResource,
  emptyResource,
  RESOURCE_VERSION,
} from './resource.js';
import { withCAS } from './concurrency.js';

/**
 * @param {object} opts
 * @param {object}  opts.pseudoPod
 * @param {string}  [opts.anchorPodUri]   — for pod-having users
 * @param {string}  [opts.deviceId]       — required for no-pod users
 * @param {string}  [opts.resourceUri]    — explicit override
 * @param {number}  [opts.maxRetries=3]
 * @param {(err: Error) => void} [opts.onPersistentConflict]
 * @param {() => string} [opts.now]
 */
export function createAgentRegistry({
  pseudoPod,
  anchorPodUri,
  deviceId,
  resourceUri,
  maxRetries,
  onPersistentConflict,
  now = () => new Date().toISOString(),
} = {}) {
  if (!pseudoPod || typeof pseudoPod.read !== 'function') {
    throw Object.assign(
      new Error('createAgentRegistry: pseudoPod is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  const uri = resourceUri ?? registryResourceUri({ anchorPodUri, deviceId });

  async function _readCurrent() {
    const rec = await pseudoPod.read(uri);
    if (!rec) return { body: emptyResource(), etag: null };
    return {
      body: normaliseResource(rec.bytes),
      etag: rec.etag ?? null,
    };
  }

  async function _writeNext(body, etag) {
    try {
      const result = await pseudoPod.write(uri, body, etag);
      return { etag: result?.etag };
    } catch (err) {
      // Pseudo-pod V0 / V1 doesn't yet enforce CAS — surface a CONFLICT
      // for any caller that supplies an etag-aware backend on top.
      if (err?.code === 'CONFLICT' || err?.code === 'PRECONDITION_FAILED') {
        throw Object.assign(new Error('agent-registry: write conflict'), { code: 'CONFLICT', cause: err });
      }
      throw err;
    }
  }

  function _agentMatches(a, identifier) {
    return a.agentId === identifier
        || a.pubKey === identifier
        || a.webid === identifier
        || a.agentUri === identifier
        || a.deviceId === identifier;
  }

  /**
   * Register a new agent OR update an existing entry (matched by
   * agentId). Etag-CAS retry on conflict.
   */
  async function register(entry = {}) {
    if (typeof entry.agentId !== 'string' || entry.agentId.length === 0) {
      throw Object.assign(
        new Error('register: entry.agentId is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (typeof entry.pubKey !== 'string' || entry.pubKey.length === 0) {
      throw Object.assign(
        new Error('register: entry.pubKey is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (typeof entry.agentUri !== 'string' || entry.agentUri.length === 0) {
      throw Object.assign(
        new Error('register: entry.agentUri is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    const signedAt = entry.signedAt ?? now();
    return withCAS({
      readCurrent: _readCurrent,
      writeNext:   _writeNext,
      maxRetries:  maxRetries ?? 3,
      onPersistentConflict,
      mutate(body /*, etag */) {
        const without = body.agents.filter(a => a.agentId !== entry.agentId);
        const next = {
          v:         RESOURCE_VERSION,
          agents:    [...without, {
            agentId:      entry.agentId,
            pubKey:       entry.pubKey,
            webid:        entry.webid ?? null,
            agentUri:     entry.agentUri,
            role:         entry.role ?? 'device',
            name:         entry.name ?? null,
            deviceId:     entry.deviceId ?? null,
            capabilities: Array.isArray(entry.capabilities) ? [...entry.capabilities] : [],
            signedAt,
            revokedAt:    entry.revokedAt ?? null,
          }],
          updatedAt: now(),
        };
        return next;
      },
    });
  }

  /**
   * Look up an agent by any identifier (agentId / pubKey / webid /
   * agentUri / deviceId). Returns the frozen normalised entry, or
   * `null` on miss.
   */
  async function lookup(identifier) {
    if (typeof identifier !== 'string' || identifier.length === 0) return null;
    const { body } = await _readCurrent();
    return body.agents.find(a => _agentMatches(a, identifier)) ?? null;
  }

  /**
   * Mark an agent revoked (sets `revokedAt`). Idempotent — a
   * revoked agent stays revoked. Etag-CAS retry on conflict.
   */
  async function revoke(identifier) {
    return withCAS({
      readCurrent: _readCurrent,
      writeNext:   _writeNext,
      maxRetries:  maxRetries ?? 3,
      onPersistentConflict,
      mutate(body /*, etag */) {
        const ts = now();
        const next = {
          v:         RESOURCE_VERSION,
          agents:    body.agents.map(a =>
            _agentMatches(a, identifier) && !a.revokedAt
              ? { ...a, revokedAt: ts }
              : a,
          ),
          updatedAt: ts,
        };
        return next;
      },
    });
  }

  /**
   * Replace the `capabilities` array on a specific agent. Etag-CAS
   * retry on conflict.
   */
  async function updateCapabilities(identifier, caps) {
    if (!Array.isArray(caps)) {
      throw Object.assign(
        new Error('updateCapabilities: caps must be an array'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    return withCAS({
      readCurrent: _readCurrent,
      writeNext:   _writeNext,
      maxRetries:  maxRetries ?? 3,
      onPersistentConflict,
      mutate(body) {
        const ts = now();
        const next = {
          v:         RESOURCE_VERSION,
          agents:    body.agents.map(a =>
            _agentMatches(a, identifier)
              ? { ...a, capabilities: [...caps] }
              : a,
          ),
          updatedAt: ts,
        };
        return next;
      },
    });
  }

  async function list() {
    const { body } = await _readCurrent();
    return body.agents;
  }

  async function reload() {
    return _readCurrent();
  }

  return {
    register,
    lookup,
    revoke,
    updateCapabilities,
    list,
    reload,

    get resourceUri() { return uri; },
  };
}
