/**
 * GroupManager — Ed25519-signed group membership proofs with roles.
 *
 * A GroupProof is issued by a group admin and certifies that a member
 * pubKey belongs to a named group at a given role until the expiry
 * timestamp.
 *
 * Wire format (JSON-serialisable):
 * {
 *   groupId:      string,
 *   adminPubKey:  base64url,
 *   memberPubKey: base64url,
 *   role:         string         ← Q-D.1: standard role or registered custom (default 'member')
 *   issuedAt:     unix-ms,
 *   expiresAt:    unix-ms,
 *   sig:          base64url    ← admin signs canonical body excluding sig
 * }
 *
 * Backward compat: proofs without `role` (pre-D3 shape) verify successfully
 * and are treated as having role 'member' for runtime checks.
 *
 * Vault keys:
 *   'group-proof:<groupId>'  → JSON of own proof
 *   'group-admin:<groupId>'  → JSON array of issued proofs (admin role)
 */
import { AgentIdentity }                            from '../identity/AgentIdentity.js';
import { encode as b64encode, decode as b64decode } from '../crypto/b64.js';
import { ROLES, isKnownRole, canPromote }           from './Roles.js';

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
   *
   * @param {string} memberPubKey — member's Ed25519 pubKey (base64url)
   * @param {string} groupId
   * @param {object|number} [opts] — options object, OR (legacy) `expiresIn` ms
   * @param {string} [opts.role='member']        — Q-D.1 role; default 'member'
   * @param {number} [opts.expiresIn=86400000]   — ms from now
   * @returns {Promise<object>}  the proof object
   */
  async issueProof(memberPubKey, groupId, opts = {}) {
    // Backward-compat: legacy callers passed `expiresIn` directly as the third arg.
    const o          = typeof opts === 'number' ? { expiresIn: opts } : (opts || {});
    const role       = o.role     ?? ROLES.MEMBER;
    const expiresIn  = o.expiresIn ?? 86_400_000;
    if (!isKnownRole(role)) {
      throw new Error(`GroupManager.issueProof: unknown role "${role}"`);
    }

    const now    = Date.now();
    const body   = { groupId, adminPubKey: this.#identity.pubKey, memberPubKey, role,
                     issuedAt: now, expiresAt: now + expiresIn };
    const sig    = this.#identity.sign(_canonical(body));
    const proof  = { ...body, sig: b64encode(sig) };

    // Persist under admin registry.
    const existing = JSON.parse((await this.#vault.get(`group-admin:${groupId}`)) ?? '[]');
    existing.push(proof);
    await this.#vault.set(`group-admin:${groupId}`, JSON.stringify(existing));

    return proof;
  }

  /**
   * Atomically change a member's role: invalidate their existing proof and
   * issue a fresh one at the new role, in a single vault transaction.
   *
   * Locked Q-D.5 (2026-04-28): this is the canonical way to change a role.
   * Caller MUST NOT compose `revokeProof` + `issueProof` themselves — that
   * sequence leaves a window where the member is briefly out of the group
   * entirely, racing concurrent auth checks.
   *
   * @param {string} memberPubKey
   * @param {string} groupId
   * @param {string} newRole  — must be a known role (standard or registered custom)
   * @param {object} [opts]
   * @param {number} [opts.expiresIn=86400000] — ms; defaults to 24 h from now
   * @returns {Promise<object>} the new proof
   */
  async setRole(memberPubKey, groupId, newRole, opts = {}) {
    if (!isKnownRole(newRole)) {
      throw new Error(`GroupManager.setRole: unknown role "${newRole}"`);
    }
    const expiresIn = opts.expiresIn ?? 86_400_000;
    const now       = Date.now();
    const key       = `group-admin:${groupId}`;
    const existing  = JSON.parse((await this.#vault.get(key)) ?? '[]');

    // Build the fresh proof (signed) BEFORE we touch the vault — so a
    // failure mid-build leaves the previous state intact.
    const body  = { groupId, adminPubKey: this.#identity.pubKey, memberPubKey, role: newRole,
                    issuedAt: now, expiresAt: now + expiresIn };
    const sig   = this.#identity.sign(_canonical(body));
    const proof = { ...body, sig: b64encode(sig) };

    // Atomic-from-the-caller's-perspective: compose new array, single set().
    const next = existing.filter(p => p.memberPubKey !== memberPubKey);
    next.push(proof);
    await this.#vault.set(key, JSON.stringify(next));

    return proof;
  }

  /** Remove a member's proof from the admin registry (full revocation). */
  async revokeProof(memberPubKey, groupId) {
    const key      = `group-admin:${groupId}`;
    const existing = JSON.parse((await this.#vault.get(key)) ?? '[]');
    const filtered = existing.filter(p => p.memberPubKey !== memberPubKey);
    await this.#vault.set(key, JSON.stringify(filtered));
  }

  /**
   * Look up the current role of a member in a group, by reading the admin
   * registry.  Returns null if not a member.  Backward-compat: legacy
   * proofs without an explicit `role` field are treated as 'member'.
   */
  async getRole(memberPubKey, groupId) {
    const issued = JSON.parse((await this.#vault.get(`group-admin:${groupId}`)) ?? '[]');
    const proof  = issued.find(p => p.memberPubKey === memberPubKey);
    if (!proof) return null;
    if (!(await this.verifyProof(proof))) return null;
    return proof.role ?? ROLES.MEMBER;
  }

  /** Members of a group at the given role.  Returns a list of pubKeys. */
  async listMembersByRole(groupId, role) {
    const issued = JSON.parse((await this.#vault.get(`group-admin:${groupId}`)) ?? '[]');
    const out    = [];
    for (const p of issued) {
      if ((p.role ?? ROLES.MEMBER) !== role) continue;
      if (!(await this.verifyProof(p)))     continue;
      out.push(p.memberPubKey);
    }
    return out;
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

  /**
   * Verify a proof's signature and expiry.  Backward-compat: legacy proofs
   * without an explicit `role` field verify against the same canonical body
   * they were signed with (no role field), so they remain valid.
   */
  async verifyProof(proof) {
    if (!proof?.sig) return false;
    if (Date.now() >= proof.expiresAt) return false;
    const { sig, ...body } = proof;
    return AgentIdentity.verify(_canonical(body), b64decode(sig), proof.adminPubKey);
  }

  /** Promotion check — does `actorPubKey` outrank `targetPubKey` in this group? */
  async canChangeRole(actorPubKey, targetPubKey, groupId) {
    const actorRole  = await this.getRole(actorPubKey, groupId);
    const targetRole = await this.getRole(targetPubKey, groupId);
    if (!actorRole || !targetRole) return false;
    return canPromote(actorRole, targetRole);
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
