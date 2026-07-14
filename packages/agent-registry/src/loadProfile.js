// Identity step 4 — load (materialize) a profile on THIS device.
//
// The selective-load step: a phone loads all your profiles, a low-trust gadget loads exactly one.
// From the owner root (`deriveAgentSeed(profileId)`) OR a DELEGATED profile seed (a gadget holds
// only its one profile's seed, never the root), materialise the profile's AgentIdentity in the
// device vault so the device can act as it, and expose its per-circle addresses.
import { AgentIdentity, deriveCircleAddress, deriveCircleSeed } from '@canopy/core';

/**
 * @param {object} a
 * @param {object} [a.ownerRoot]    a core Bootstrap (with a.profileId) — derives the profile seed.
 * @param {Uint8Array} [a.profileSeed]  a delegated 32-byte profile seed (gadget case; no owner root).
 * @param {string} [a.profileId]    the profile's id (for owner-root derivation + registry check).
 * @param {object} a.vault          the device vault the identity persists into.
 * @param {object} [a.registry]     optional — verify the materialised key matches the registered profile.
 * @returns {Promise<{ profileId, identity, pubKey, circleAddress:(c)=>string, circleSeed:(c)=>Uint8Array }>}
 */
export async function loadProfile({ ownerRoot, profileSeed, profileId, vault, registry } = {}) {
  if (!vault || typeof vault.set !== 'function') throw new Error('loadProfile: a device vault is required');
  const seed = (profileSeed instanceof Uint8Array)
    ? profileSeed
    : ((ownerRoot?.deriveAgentSeed && typeof profileId === 'string' && profileId) ? ownerRoot.deriveAgentSeed(profileId) : null);
  if (!(seed instanceof Uint8Array) || seed.length !== 32) {
    throw new Error('loadProfile: provide a 32-byte profileSeed, or ownerRoot + profileId');
  }
  const identity = await AgentIdentity.fromSeed(seed, vault);   // persist locally → the device can act as this profile
  // Optional integrity check: did we load the profile the registry recorded (right key for the id)?
  if (registry?.lookup && typeof profileId === 'string' && profileId) {
    const entry = await registry.lookup(profileId);
    if (entry?.pubKey && entry.pubKey !== identity.pubKey) {
      throw new Error(`loadProfile: derived key does not match the registered profile '${profileId}'`);
    }
  }
  return {
    profileId:     profileId ?? null,
    identity,
    pubKey:        identity.pubKey,
    // The address this profile presents in a circle (unlinkable-by-default), + the seed to sign with.
    circleAddress: (circleId) => deriveCircleAddress(seed, circleId),
    circleSeed:    (circleId) => deriveCircleSeed(seed, circleId),
  };
}
