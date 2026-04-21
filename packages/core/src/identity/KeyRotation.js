/**
 * KeyRotation — proof-of-rotation for Ed25519 identity keys.
 *
 * A KeyRotationProof is a JSON object signed by the *old* private key that
 * asserts "I am rotating to newPubKey; the old key remains valid for
 * gracePeriod seconds".  Receivers can verify the proof and then:
 *   - trust messages signed by newPubKey with the same tier as oldPubKey
 *   - optionally stop trusting the old key once the grace period elapses
 *
 * Proof format:
 * {
 *   type:        'key-rotation',
 *   oldPubKey:   base64url,
 *   newPubKey:   base64url,
 *   issuedAt:    unix-ms,
 *   gracePeriod: seconds,
 *   sig:         base64url  ← Ed25519 signature of the other fields (canonical JSON)
 * }
 */
import { AgentIdentity } from './AgentIdentity.js';
import { encode as b64encode, decode as b64decode } from '../crypto/b64.js';

export class KeyRotation {
  /**
   * Build and sign a key-rotation proof using the old identity.
   *
   * @param {import('./AgentIdentity.js').AgentIdentity} oldIdentity
   * @param {string} newPubKey           — new Ed25519 public key (base64url)
   * @param {number} [gracePeriodSeconds=604800]  — 7 days default
   * @returns {object}  KeyRotationProof
   */
  static async buildProof(oldIdentity, newPubKey, gracePeriodSeconds = 604_800) {
    const unsigned = {
      type:        'key-rotation',
      oldPubKey:   oldIdentity.pubKey,
      newPubKey,
      issuedAt:    Date.now(),
      gracePeriod: gracePeriodSeconds,
    };
    const sig = oldIdentity.sign(KeyRotation.#canonicalBytes(unsigned));
    return { ...unsigned, sig: b64encode(sig) };
  }

  /**
   * Verify a key-rotation proof.
   *
   * @param {object} proof
   * @param {string} [expectedOldPubKey]  — if provided, must match proof.oldPubKey
   * @returns {boolean}
   */
  static verify(proof, expectedOldPubKey) {
    try {
      const { sig, ...unsigned } = proof;
      if (unsigned.type !== 'key-rotation') return false;
      if (expectedOldPubKey && unsigned.oldPubKey !== expectedOldPubKey) return false;
      if (!sig) return false;
      return AgentIdentity.verify(
        KeyRotation.#canonicalBytes(unsigned),
        sig,
        unsigned.oldPubKey,
      );
    } catch {
      return false;
    }
  }

  /**
   * Return true if the proof is within its grace period (old key still valid).
   *
   * @param {object} proof
   * @returns {boolean}
   */
  static isWithinGracePeriod(proof) {
    return Date.now() < proof.issuedAt + proof.gracePeriod * 1_000;
  }

  /**
   * Broadcast the proof to all reachable peers in the graph.
   * Each peer receives an OW envelope containing the proof.
   *
   * @param {object} proof
   * @param {import('../Agent.js').Agent} agent
   * @param {import('../discovery/PeerGraph.js').PeerGraph} peerGraph
   */
  static async broadcast(proof, agent, peerGraph) {
    const peers = await peerGraph.reachable();
    await Promise.allSettled(
      peers
        .map(p => p.pubKey ?? p.url)
        .filter(Boolean)
        .map(peerId =>
          agent.transport.sendOneWay(peerId, {
            type:  'key-rotation',
            proof,
          }).catch(() => {}),
        ),
    );
  }

  /**
   * Apply a rotation proof to a TrustRegistry:
   *   • Copy the old key's record (tier, groups, tokenIds) to the new key.
   *   • Optionally delete the old key's record.
   *
   * The proof must be valid before calling this method.
   *
   * @param {object}  proof
   * @param {import('../permissions/TrustRegistry.js').TrustRegistry} trustRegistry
   * @param {object}  [opts]
   * @param {boolean} [opts.removeOld=false]  — delete old key record after copying
   */
  static async applyToRegistry(proof, trustRegistry, { removeOld = false } = {}) {
    const oldRecord = await trustRegistry.getRecord(proof.oldPubKey);
    const { tier, groups = [], tokenIds = [] } = oldRecord;

    // Promote the new key to the same tier.
    await trustRegistry.setTier(proof.newPubKey, tier);

    // Copy group memberships.
    for (const g of groups) {
      await trustRegistry.addGroup(proof.newPubKey, g);
    }

    // Copy token grants.
    for (const id of tokenIds) {
      await trustRegistry.addTokenGrant(proof.newPubKey, id);
    }

    if (removeOld) {
      // No bulk-delete API — set old key to public tier (effectively demoted).
      await trustRegistry.setTier(proof.oldPubKey, 'public');
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Canonical UTF-8 bytes for signing: alphabetically sorted keys, no sig.
   * @param {object} obj
   * @returns {Uint8Array}
   */
  static #canonicalBytes(obj) {
    const sorted = Object.fromEntries(
      Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)),
    );
    return new TextEncoder().encode(JSON.stringify(sorted));
  }
}
