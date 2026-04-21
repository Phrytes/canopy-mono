/**
 * GroupManager — Ed25519-signed group membership proofs.
 *
 * A GroupProof is issued by a group admin and certifies that a member
 * pubKey belongs to a named group until the expiry timestamp.
 *
 * Wire format (JSON-serialisable):
 * {
 *   groupId:      string,
 *   adminPubKey:  base64url,
 *   memberPubKey: base64url,
 *   issuedAt:     unix-ms,
 *   expiresAt:    unix-ms,
 *   sig:          base64url    ← admin signs { groupId, memberPubKey, issuedAt, expiresAt }
 * }
 *
 * Vault keys:
 *   'group-proof:<groupId>'  → JSON of own proof (member role)
 *   'group-admin:<groupId>'  → JSON array of issued proofs (admin role)
 */
import { AgentIdentity }                            from '../identity/AgentIdentity.js';
import { encode as b64encode, decode as b64decode } from '../crypto/b64.js';

export class GroupManager {
  #identity;
  #vault;

  /**
   * @param {object} opts
   * @param {import('../identity/AgentIdentity.js').AgentIdentity} opts.identity
   * @param {import('../identity/Vault.js').Vault} opts.vault
   */
  constructor({ identity, vault }) {
    if (!identity) throw new Error('GroupManager requires identity');
    if (!vault)    throw new Error('GroupManager requires vault');
    this.#identity = identity;
    this.#vault    = vault;
  }

  // ── Admin operations ──────────────────────────────────────────────────────

  /**
   * Issue a membership proof for a member (admin only).
   * @param {string} memberPubKey — member's Ed25519 pubKey (base64url)
   * @param {string} groupId
   * @param {number} [expiresIn=86400000] — ms from now (default 24 h)
   * @returns {Promise<object>}  the proof object
   */
  async issueProof(memberPubKey, groupId, expiresIn = 86_400_000) {
    const now    = Date.now();
    const body   = { groupId, adminPubKey: this.#identity.pubKey, memberPubKey,
                     issuedAt: now, expiresAt: now + expiresIn };
    const sig    = this.#identity.sign(_canonical(body));
    const proof  = { ...body, sig: b64encode(sig) };

    // Persist under admin registry.
    const existing = JSON.parse((await this.#vault.get(`group-admin:${groupId}`)) ?? '[]');
    existing.push(proof);
    await this.#vault.set(`group-admin:${groupId}`, JSON.stringify(existing));

    return proof;
  }

  /** Remove a member's proof from the admin registry (revocation). */
  async revokeProof(memberPubKey, groupId) {
    const key      = `group-admin:${groupId}`;
    const existing = JSON.parse((await this.#vault.get(key)) ?? '[]');
    const filtered = existing.filter(p => p.memberPubKey !== memberPubKey);
    await this.#vault.set(key, JSON.stringify(filtered));
  }

  // ── Member operations ─────────────────────────────────────────────────────

  /** Store a proof issued to us. Validates before saving. */
  async storeProof(proof) {
    if (!(await this.verifyProof(proof))) {
      throw new Error('Invalid or expired group proof');
    }
    await this.#vault.set(`group-proof:${proof.groupId}`, JSON.stringify(proof));
  }

  /** @returns {Promise<object|null>} own proof for groupId */
  async getProof(groupId) {
    const raw = await this.#vault.get(`group-proof:${groupId}`);
    return raw ? JSON.parse(raw) : null;
  }

  /**
   * Check if a pubKey has a valid proof for groupId.
   * If pubKey is our own key, checks our stored proof.
   * Otherwise looks in the admin registry (if we are admin).
   */
  async hasValidProof(pubKey, groupId) {
    if (pubKey === this.#identity.pubKey) {
      const p = await this.getProof(groupId);
      return p ? await this.verifyProof(p) : false;
    }
    const issued = JSON.parse((await this.#vault.get(`group-admin:${groupId}`)) ?? '[]');
    const proof  = issued.find(p => p.memberPubKey === pubKey);
    return proof ? await this.verifyProof(proof) : false;
  }

  /** Verify a proof's signature and expiry. */
  async verifyProof(proof) {
    if (!proof?.sig) return false;
    if (Date.now() >= proof.expiresAt) return false;
    const { sig, ...body } = proof;
    return AgentIdentity.verify(_canonical(body), b64decode(sig), proof.adminPubKey);
  }

  /** @returns {Promise<string[]>} group ids this agent holds valid proofs for */
  async listGroups() {
    const keys   = await this.#vault.list();
    const groups = [];
    for (const k of keys) {
      if (!k.startsWith('group-proof:')) continue;
      const groupId = k.slice(12);
      const raw     = await this.#vault.get(k);
      if (!raw) continue;
      const proof = JSON.parse(raw);
      if (await this.verifyProof(proof)) groups.push(groupId);
    }
    return groups;
  }
}

function _canonical(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}
