// Identity step 2 — create a root-derived PROFILE entry in the registry.
//
// A profile's signing key is HKDF-derived from the owner root (Bootstrap.deriveAgentSeed),
// so the same owner root + profileId reproduce the SAME pubKey on any device — the recovery
// property. We record only the pubKey (via AgentIdentity.pubKeyFromSeed — no vault); the full
// identity is re-derived on the device that actually runs the profile.
import { AgentIdentity } from '@canopy/core';

/**
 * @param {object} a
 * @param {object} a.registry     a createAgentRegistry handle
 * @param {object} a.ownerRoot    a core Bootstrap (deriveAgentSeed + fingerprint)
 * @param {string} a.profileId    stable per-profile label (also the registry agentId)
 * @param {string} [a.role]       default 'profile'
 * @param {string} [a.name]
 * @param {object} [a.properties] own/inherit property map
 * @param {string} [a.agentUri]   default `profile:<id>`
 * @returns {Promise<{ entry: object, pubKey: string }>}
 */
export async function createProfile({ registry, ownerRoot, profileId, role = 'profile', name = null, properties = {}, agentUri } = {}) {
  if (!registry?.register) throw new Error('createProfile: a registry is required');
  if (!ownerRoot?.deriveAgentSeed || !ownerRoot?.fingerprint) {
    throw new Error('createProfile: ownerRoot (a core Bootstrap) is required');
  }
  if (typeof profileId !== 'string' || profileId.length === 0) {
    throw new Error('createProfile: profileId (string) is required');
  }
  const pubKey = AgentIdentity.pubKeyFromSeed(ownerRoot.deriveAgentSeed(profileId));
  const entry = {
    agentId:          profileId,
    pubKey,
    agentUri:         agentUri ?? `profile:${profileId}`,
    role,
    name,
    ownerFingerprint: ownerRoot.fingerprint(),
    properties,
  };
  await registry.register(entry);
  return { entry, pubKey };
}

/** The deterministic pubKey a profile WOULD have (recovery / verification), without registering. */
export function profilePubKey(ownerRoot, profileId) {
  return AgentIdentity.pubKeyFromSeed(ownerRoot.deriveAgentSeed(profileId));
}
