/**
 * manifestHasOp.js — does a manifest declare an op with this id?
 * Used by the inbound bridge's unknown-tool guard.
 */

/**
 * @param {import('@canopy/app-manifest').Manifest} manifest
 * @param {string} opId
 * @returns {boolean}
 */
export function manifestHasOp(manifest, opId) {
  const ops = Array.isArray(manifest?.operations) ? manifest.operations : [];
  return ops.some((op) => op?.id === opId);
}
