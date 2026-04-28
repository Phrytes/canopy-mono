/**
 * GroupAuthVerifier — gates relay connections by group membership.
 *
 * Locked Q-E.2 (2026-04-28): the relay accepts a connecting client only
 * if the client presents a valid `GroupManager`-issued proof for one of
 * the groups the relay operator has explicitly listed.  No new token
 * type — we reuse the proofs Track D already mints.
 *
 * Relay configuration shape:
 *   {
 *     acceptedGroups: [
 *       { groupId: '<id>', adminPubKey: '<base64url>', requiredRole?: 'member' },
 *       ...
 *     ]
 *   }
 *
 * Open-mode (backward-compat): when `acceptedGroups` is undefined or
 * empty, the relay accepts every client just like today.  Existing
 * deployments do not need to change anything.
 *
 * Composition with Track D3 roles: each entry MAY specify a
 * `requiredRole`.  The verifier then compares the proof's `proof.role`
 * against the configured role using a numeric rank table.  By default
 * the five standard role ranks are used (admin > coordinator > member >
 * observer > external); deployments using custom roles can pass a
 * `roleRanks` map at construction time.
 */
import { verifyGroupProof } from '@canopy/core';

/** Default rank table — mirrors `packages/core/src/permissions/Roles.js`. */
const DEFAULT_ROLE_RANKS = Object.freeze({
  admin:       100,
  coordinator:  80,
  member:       60,
  observer:     40,
  external:     20,
});

export class GroupAuthVerifier {
  #acceptedGroups;
  #ranks;

  /**
   * @param {object} [opts]
   * @param {Array<{ groupId: string, adminPubKey: string, requiredRole?: string }>} [opts.acceptedGroups]
   * @param {Record<string, number>} [opts.roleRanks] — optional rank
   *   override (e.g. when an app registers custom roles); merges with
   *   the default standard-role ranks.
   */
  constructor({ acceptedGroups = [], roleRanks } = {}) {
    if (!Array.isArray(acceptedGroups)) {
      throw new TypeError('GroupAuthVerifier: acceptedGroups must be an array');
    }
    this.#acceptedGroups = acceptedGroups;
    this.#ranks          = roleRanks
      ? { ...DEFAULT_ROLE_RANKS, ...roleRanks }
      : DEFAULT_ROLE_RANKS;
  }

  /** True if the verifier is configured for open mode (legacy behavior). */
  get isOpen() {
    return this.#acceptedGroups.length === 0;
  }

  /** The configured accepted groups (read-only snapshot). */
  get acceptedGroups() {
    return this.#acceptedGroups.slice();
  }

  /**
   * Decide whether a connecting client's group proof is acceptable.
   *
   * Reasons (when ok=false):
   *   - 'NO_PROOF'             — verifier is closed but client supplied no proof
   *   - 'GROUP_NOT_ACCEPTED'   — proof's groupId is not in the accepted list
   *   - 'INVALID_PROOF'        — sig invalid, expired, or wrong admin pubkey
   *   - 'INSUFFICIENT_ROLE'    — proof's role rank below the group's requiredRole
   *
   * @param {object|undefined} proof
   * @returns {{ ok: true, group: object|null } | { ok: false, reason: string }}
   */
  verify(proof) {
    if (this.isOpen) return { ok: true, group: null };

    if (!proof || typeof proof !== 'object') {
      return { ok: false, reason: 'NO_PROOF' };
    }

    const cfg = this.#acceptedGroups.find(g => g.groupId === proof.groupId);
    if (!cfg) return { ok: false, reason: 'GROUP_NOT_ACCEPTED' };

    if (!verifyGroupProof(proof, cfg.adminPubKey)) {
      return { ok: false, reason: 'INVALID_PROOF' };
    }

    if (cfg.requiredRole) {
      const callerRole   = proof.role ?? 'member'; // legacy proofs default to 'member'
      const callerRank   = this.#ranks[callerRole]      ?? 0;
      const requiredRank = this.#ranks[cfg.requiredRole] ?? 0;
      if (callerRank < requiredRank) {
        return { ok: false, reason: 'INSUFFICIENT_ROLE' };
      }
    }

    return { ok: true, group: cfg };
  }
}
