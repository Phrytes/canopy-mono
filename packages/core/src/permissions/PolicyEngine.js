/**
 * PolicyEngine — single entry point for all inbound permission checks.
 *
 * Called by taskExchange.handleTaskRequest and other protocol handlers
 * before invoking a skill handler.
 *
 * Check order:
 *   1. TrustRegistry → peer tier
 *   2. skill.visibility vs tier (public < authenticated < trusted < private)
 *   3. skill.policy vs tier
 *   4. (Group D+) resource limit checks via AgentConfig
 *
 * Throws PolicyDeniedError on any denial; returns { tier, allowed: true } otherwise.
 */
import { TIER_LEVEL }    from './TrustRegistry.js';
import { CapabilityToken, skillMatches } from './CapabilityToken.js';
import { roleRank }        from './Roles.js';

export class PolicyDeniedError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PolicyDeniedError';
    this.code = code;
  }
}

export class PolicyEngine {
  #trustRegistry;
  #skillRegistry;
  #agentPubKey;   // this agent's pubKey, used to verify token.agentId binding

  #groupManager;
  #isRevoked;

  /**
   * @param {object} opts
   * @param {import('./TrustRegistry.js').TrustRegistry}         opts.trustRegistry
   * @param {import('../skills/SkillRegistry.js').SkillRegistry} opts.skillRegistry
   * @param {string} [opts.agentPubKey]  — this agent's Ed25519 pubKey (base64url)
   * @param {import('./GroupManager.js').GroupManager} [opts.groupManager]  — D3: enables `requiredRole` checks
   * @param {(tokenId: string) => boolean | Promise<boolean>} [opts.isRevoked]
   *   Optional issuer-side revocation check (V1.5). When supplied,
   *   `checkInbound` calls it after the token's signature/expiry/
   *   subject/skill/issuer-trust checks pass; if it returns truthy
   *   the token is rejected as `INVALID_TOKEN: revoked`. Lets agents
   *   maintain a local revocation list independent of the holder's
   *   `TokenRegistry.revoke` (which only protects the holder side).
   */
  constructor({ trustRegistry, skillRegistry, agentPubKey = null, groupManager = null, isRevoked = null }) {
    this.#trustRegistry = trustRegistry;
    this.#skillRegistry = skillRegistry;
    this.#agentPubKey   = agentPubKey;
    this.#groupManager  = groupManager;
    this.#isRevoked     = typeof isRevoked === 'function' ? isRevoked : null;
  }

  /**
   * Replace the revocation-check callback at runtime. Pass `null` to
   * remove. Useful when the registry that owns the revocation list is
   * built after the PolicyEngine itself.
   */
  setRevocationCheck(fn) {
    this.#isRevoked = typeof fn === 'function' ? fn : null;
  }

  /**
   * Check whether a peer is allowed to call a skill.
   *
   * @param {object}  opts
   * @param {string}  opts.peerPubKey   — caller's Ed25519 pubKey
   * @param {string}  opts.skillId
   * @param {string}  [opts.action='call']
   * @param {object}  [opts.token]      — raw CapabilityToken JSON from the RQ payload
   * @param {string}  [opts.agentPubKey] — this agent's pubKey (overrides constructor value)
   * @returns {Promise<{ tier: string, allowed: true }>}
   * @throws  {PolicyDeniedError}
   */
  async checkInbound({ peerPubKey, skillId, action = 'call', token = null, agentPubKey = null }) {
    const myPubKey = agentPubKey ?? this.#agentPubKey;
    const tier     = await this.#trustRegistry.getTier(peerPubKey);
    const skill    = this.#skillRegistry.get(skillId);

    if (!skill) {
      throw new PolicyDeniedError('NOT_FOUND', `Unknown skill: "${skillId}"`);
    }
    if (!skill.enabled) {
      throw new PolicyDeniedError('DISABLED', `Skill "${skillId}" is disabled`);
    }

    const callerLevel = TIER_LEVEL[tier]              ?? 1;
    const required    = TIER_LEVEL[skill.visibility]  ?? 1;

    if (callerLevel < required) {
      throw new PolicyDeniedError(
        'INSUFFICIENT_TIER',
        `Skill "${skillId}" requires tier "${skill.visibility}" but caller has "${tier}"`,
      );
    }

    // 'never' policy blocks all inbound callers unconditionally.
    if (skill.policy === 'never') {
      throw new PolicyDeniedError(
        'POLICY_NEVER',
        `Skill "${skillId}" is not available to external callers`,
      );
    }

    // D3: role-aware group check.  A skill may declare
    //   requiredRole: { group: <groupId>, role: <roleId> }
    // to require the caller hold a group proof at or above the given role.
    if (skill.requiredRole) {
      if (!this.#groupManager) {
        throw new PolicyDeniedError(
          'NO_GROUP_MANAGER',
          `Skill "${skillId}" requires a group role but PolicyEngine has no GroupManager wired`,
        );
      }
      const { group, role } = skill.requiredRole;
      if (!group || !role) {
        throw new PolicyDeniedError(
          'INVALID_REQUIRED_ROLE',
          `Skill "${skillId}" requiredRole must specify { group, role }`,
        );
      }
      const callerRole = await this.#groupManager.getRole(peerPubKey, group);
      if (!callerRole) {
        throw new PolicyDeniedError(
          'NOT_A_MEMBER',
          `Skill "${skillId}" requires membership in group "${group}"`,
        );
      }
      const callerRank   = roleRank(callerRole) ?? 0;
      const requiredRank = roleRank(role)        ?? 0;
      if (callerRank < requiredRank) {
        throw new PolicyDeniedError(
          'INSUFFICIENT_ROLE',
          `Skill "${skillId}" requires role "${role}" in group "${group}" but caller has "${callerRole}"`,
        );
      }
    }

    if (skill.policy === 'always-allow') {
      return { tier, allowed: true };
    }

    if (skill.policy === 'requires-token') {
      if (!token) {
        throw new PolicyDeniedError(
          'NO_TOKEN',
          `Skill "${skillId}" requires a capability token`,
        );
      }

      let parsed;
      try {
        parsed = CapabilityToken.fromJSON(token);
      } catch {
        throw new PolicyDeniedError('INVALID_TOKEN', 'Token is malformed');
      }

      // Verify signature, expiry, and agentId binding.
      // verify() may throw on malformed data (e.g. missing sig field), so
      // treat any exception as an invalid token.
      let tokenOk;
      try { tokenOk = CapabilityToken.verify(parsed, myPubKey ?? undefined); }
      catch { tokenOk = false; }
      if (!tokenOk) {
        throw new PolicyDeniedError(
          'INVALID_TOKEN',
          'Token is expired, has an invalid signature, or targets a different agent',
        );
      }

      // Subject must be the caller — prevents token theft / forwarding.
      if (parsed.subject !== peerPubKey) {
        throw new PolicyDeniedError(
          'INVALID_TOKEN',
          'Token subject does not match the calling peer',
        );
      }

      // Skill must match: exact, wildcard '*', or `prefix.*` pattern.
      // See `CapabilityToken.skillMatches` for the rules.
      if (!skillMatches(parsed.skill, skillId)) {
        throw new PolicyDeniedError(
          'INVALID_TOKEN',
          `Token grants skill "${parsed.skill}", not "${skillId}"`,
        );
      }

      // Issuer must be at least 'trusted' in this agent's TrustRegistry.
      const issuerTier  = await this.#trustRegistry.getTier(parsed.issuer);
      const issuerLevel = TIER_LEVEL[issuerTier] ?? 0;
      if (issuerLevel < TIER_LEVEL['trusted']) {
        throw new PolicyDeniedError(
          'INVALID_TOKEN',
          `Token issuer "${parsed.issuer.slice(0, 12)}…" is not trusted (tier: ${issuerTier})`,
        );
      }

      // V1.5 — issuer-side revocation list (optional). Catches "I
      // revoked this token I issued" before the handler runs, even
      // when the holder still has it stored locally.
      if (this.#isRevoked) {
        let revoked = false;
        try { revoked = await this.#isRevoked(parsed.id); } catch { revoked = false; }
        if (revoked) {
          throw new PolicyDeniedError('INVALID_TOKEN', 'Token has been revoked');
        }
      }

      return { tier, allowed: true };
    }

    return { tier, allowed: true };
  }

  /**
   * Check whether we are allowed to call a skill on a peer (outbound).
   * Phase 1: always allow; Token attachment is Group E+.
   */
  async checkOutbound({ peerId, skillId }) {
    return { allowed: true };
  }
}
