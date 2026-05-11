/**
 * Hub ↔ bundle version negotiation.
 *
 * Bundles declare a `clientVersions` array (e.g. `[1, 2]`); the Hub
 * declares its own `supportedVersions` array. We pick the highest
 * version both sides support.
 *
 * Mismatch handling:
 *   - Bundle = [1, 2]  Hub = [1]      → pick 1   (Hub fallback to V1)
 *   - Bundle = [1]     Hub = [1, 2]   → pick 1   (bundle fallback to V1)
 *   - Bundle = [2]     Hub = [1]      → throw NO_COMPATIBLE_VERSION
 *
 * Standardisation Phase 51.9.2.
 */

/**
 * @param {object} args
 * @param {number[]} args.clientVersions  — bundle-supported versions
 * @param {number[]} args.hubVersions     — Hub-supported versions
 * @returns {number}                       — negotiated version
 */
export function negotiateVersion({ clientVersions, hubVersions } = {}) {
  if (!Array.isArray(clientVersions) || clientVersions.length === 0) {
    throw Object.assign(
      new Error('negotiateVersion: clientVersions must be a non-empty array'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (!Array.isArray(hubVersions) || hubVersions.length === 0) {
    throw Object.assign(
      new Error('negotiateVersion: hubVersions must be a non-empty array'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  const clientSet = new Set(clientVersions);
  const both = hubVersions.filter(v => clientSet.has(v));
  if (both.length === 0) {
    throw Object.assign(
      new Error(`negotiateVersion: no compatible IHub version (client=[${clientVersions.join(',')}], hub=[${hubVersions.join(',')}])`),
      { code: 'NO_COMPATIBLE_VERSION', clientVersions, hubVersions },
    );
  }
  return Math.max(...both);
}
