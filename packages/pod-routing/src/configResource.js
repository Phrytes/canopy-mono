/**
 * Storage-mapping config resource I/O.
 *
 * The config lives at:
 *   - `<anchor-pod>/private/storage-mapping` for pod-having users
 *     (V1 — once pod-client routes https:// URIs through the
 *     pseudo-pod cache).
 *   - `pseudo-pod://<deviceId>/private/storage-mapping` for no-pod
 *     users (V0 + ongoing).
 *
 * The pseudo-pod stores it as an opaque object; serialization is
 * the substrate's concern — we just stash + recover the JSON-shaped
 * payload via `pseudoPod.read/write`.
 *
 * Standardisation Phase 52.3 — see plan §52.3.6.
 */

import { CANONICAL_STORAGE_FUNCTIONS } from './storageFunctions.js';

/** Wire schema version. */
export const CONFIG_VERSION = 2;

/**
 * Compute the URI the config resource lives at.
 *
 * V0 always returns the pseudo-pod URI (we can read those reliably).
 * V1 will return the `<anchor-pod>/private/storage-mapping` URI once
 * pod-client https:// routing lands.
 */
export function configResourceUri({ deviceId, anchorPodUri }) {
  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    throw Object.assign(
      new Error('configResourceUri: deviceId is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  // V0: always pseudo-pod. Pod-having users will get pod-side later.
  void anchorPodUri;
  return `pseudo-pod://${deviceId}/private/storage-mapping`;
}

/**
 * @typedef {object} StorageMappingConfig
 * @property {number} version
 * @property {string} [defaultPolicy]  — hint: 'one-pod' | 'two-pod' | 'no-pod'
 * @property {Object<string,string>} mappings
 * @property {Object<string, {policy: string, groupPodUri?: string}>} circlePolicies
 * @property {string} [updatedAt]
 */

/**
 * Read the config resource. Returns the parsed config or `null` if
 * the resource doesn't exist. Throws on shape errors.
 *
 * @param {object} args
 * @param {import('@canopy/pseudo-pod').PseudoPod | object} args.pseudoPod
 * @param {string} args.uri
 * @returns {Promise<StorageMappingConfig|null>}
 */
export async function readConfig({ pseudoPod, uri }) {
  const rec = await pseudoPod.read(uri);
  if (!rec) return null;
  const parsed = _coerceToObject(rec.bytes);
  if (parsed === null) {
    throw Object.assign(
      new Error(`pod-routing: config at ${uri} is not a JSON object`),
      { code: 'INVALID_CONFIG' },
    );
  }
  return _normaliseConfig(parsed);
}

/**
 * Write the config resource. Bumps `updatedAt` if not supplied.
 *
 * @returns {Promise<{etag: string}>}
 */
export async function writeConfig({ pseudoPod, uri, config, now = () => new Date().toISOString() }) {
  const normalised = _normaliseConfig(config);
  const body = { ...normalised, updatedAt: normalised.updatedAt ?? now() };
  const { etag } = await pseudoPod.write(uri, body);
  return { etag };
}

/**
 * Validate + freeze a config object.
 */
export function _normaliseConfig(raw) {
  const version = typeof raw.version === 'number' ? raw.version : CONFIG_VERSION;
  if (version !== CONFIG_VERSION) {
    // Forward-compat: future versions read as if they were us; warn
    // (but don't throw) so older clients keep working.
    // Substrate-internal — no console here.
  }
  const mappings = (raw.mappings && typeof raw.mappings === 'object') ? { ...raw.mappings } : {};
  const circlePolicies = (raw.circlePolicies && typeof raw.circlePolicies === 'object')
    ? { ...raw.circlePolicies }
    : {};
  return Object.freeze({
    version,
    defaultPolicy: typeof raw.defaultPolicy === 'string' ? raw.defaultPolicy : undefined,
    mappings:      Object.freeze(mappings),
    circlePolicies:  Object.freeze(circlePolicies),
    updatedAt:     typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
  });
}

function _coerceToObject(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); }
    catch { return null; }
  }
  return null;
}

/** Exported helper for tests / external callers. */
export const _CANONICAL_NAMES = CANONICAL_STORAGE_FUNCTIONS;
