/**
 * GroupManager — join/leave groups, sign and verify HMAC-SHA256 membership proofs.
 *
 * Group proof format:
 *   { group: string, agentId: string, expiry: ISO-string, sig: hex-string }
 *
 * The group admin signs with a shared secret (HMAC key).
 * Any peer holding the same secret can verify without contacting the admin.
 *
 * Usage:
 *   // Admin creates proof (done once, offline)
 *   const proof = await GroupManager.sign('dev-team', agent.id, adminSecret);
 *
 *   // Agent carries the proof
 *   agent.joinGroup('dev-team', proof, adminSecret);
 *
 *   // Any peer can verify
 *   const ok = await GroupManager.verify(proof, adminSecret);
 */
export class GroupManager {
  #memberships = new Map();   // groupId -> { proof, adminSecret }

  /**
   * Join a group by presenting a signed proof.
   * @param {string}  groupId
   * @param {object}  proof        — { group, agentId, expiry, sig }
   * @param {string}  adminSecret  — the HMAC key to verify/re-sign proofs
   */
  join(groupId, proof, adminSecret) {
    this.#memberships.set(groupId, { proof, adminSecret });
    return this;
  }

  leave(groupId) {
    this.#memberships.delete(groupId);
    return this;
  }

  isMember(groupId) { return this.#memberships.has(groupId); }

  /** All group IDs this agent belongs to. */
  groups() { return Array.from(this.#memberships.keys()); }

  /** Return the stored membership record for a group. */
  getMembership(groupId) { return this.#memberships.get(groupId) ?? null; }

  // ── Static helpers ────────────────────────────────────────────────────────

  /**
   * Create a signed group membership proof (admin operation).
   *
   * @param {string} groupId
   * @param {string} agentId
   * @param {string} adminSecret  — any string; keep private
   * @param {{ expiryMs?: number }} options
   */
  static async sign(groupId, agentId, adminSecret, { expiryMs = 7 * 86_400_000 } = {}) {
    const expiry  = new Date(Date.now() + expiryMs).toISOString();
    const message = `${groupId}:${agentId}:${expiry}`;
    const sig     = await GroupManager.#hmacHex(adminSecret, message);
    return { group: groupId, agentId, expiry, sig };
  }

  /**
   * Verify a group membership proof.
   * Returns true only if the signature is valid and the proof has not expired.
   */
  static async verify(proof, adminSecret) {
    if (!proof?.sig || !proof?.expiry || !proof?.group || !proof?.agentId) return false;
    if (new Date(proof.expiry) < new Date()) return false;
    const message  = `${proof.group}:${proof.agentId}:${proof.expiry}`;
    const expected = await GroupManager.#hmacHex(adminSecret, message);
    return expected === proof.sig;
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  static async #hmacHex(secret, message) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const raw = await crypto.subtle.sign('HMAC', key, enc.encode(message));
    return Array.from(new Uint8Array(raw))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}
