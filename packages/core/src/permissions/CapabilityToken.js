/**
 * CapabilityToken — signed capability grants.
 *
 * A token gives a specific subject (peer pubKey) permission to call a
 * specific skill (or '*' for all) on a specific agent, until expiry.
 *
 * Tokens can be chained: a holder can issue attenuated sub-tokens
 * (same or narrower permissions, same or shorter expiry).
 *
 * Wire format (JSON-serialisable):
 * {
 *   id:         uuid,
 *   issuer:     pubKeyB64,
 *   subject:    pubKeyB64,
 *   agentId:    string,
 *   skill:      string | '*',
 *   constraints?: object,
 *   issuedAt:   unix-ms,
 *   expiresAt:  unix-ms,
 *   parentId?:  uuid,
 *   sig:        base64url
 * }
 */
import { AgentIdentity }                            from '../identity/AgentIdentity.js';
import { encode as b64encode, decode as b64decode } from '../crypto/b64.js';
import { genId }                                    from '../Envelope.js';

export class CapabilityToken {
  #raw;

  constructor(raw) { this.#raw = raw; }

  get id()          { return this.#raw.id; }
  get issuer()      { return this.#raw.issuer; }
  get subject()     { return this.#raw.subject; }
  get agentId()     { return this.#raw.agentId; }
  get skill()       { return this.#raw.skill; }
  get constraints() { return this.#raw.constraints ?? {}; }
  get issuedAt()    { return this.#raw.issuedAt; }
  get expiresAt()   { return this.#raw.expiresAt; }
  get parentId()    { return this.#raw.parentId ?? null; }
  get isExpired()   { return Date.now() >= this.#raw.expiresAt; }

  /** Serialise for storage or wire transfer. */
  toJSON()  { return { ...this.#raw }; }
  toString(){ return JSON.stringify(this.#raw); }

  // ── Issuance ──────────────────────────────────────────────────────────────

  /**
   * Issue a signed CapabilityToken.
   *
   * @param {import('../identity/AgentIdentity.js').AgentIdentity} identity
   * @param {object} opts
   * @param {string}  opts.subject      — recipient's pubKey (base64url)
   * @param {string}  opts.agentId      — this agent's id / pubKey
   * @param {string}  [opts.skill='*']  — skill id or '*' for all
   * @param {number}  [opts.expiresIn=3600000] — ms from now
   * @param {object}  [opts.constraints]
   * @param {string}  [opts.parentId]   — parent token id for chaining
   */
  static async issue(identity, opts) {
    const now = Date.now();
    const unsigned = {
      id:         genId(),
      issuer:     identity.pubKey,
      subject:    opts.subject,
      agentId:    opts.agentId,
      skill:      opts.skill   ?? '*',
      issuedAt:   now,
      expiresAt:  now + (opts.expiresIn ?? 3_600_000),
      ...(opts.constraints ? { constraints: opts.constraints } : {}),
      ...(opts.parentId    ? { parentId:    opts.parentId    } : {}),
      sig: null,
    };

    const sig = identity.sign(_canonical(unsigned));
    return new CapabilityToken({ ...unsigned, sig: b64encode(sig) });
  }

  // ── Verification ──────────────────────────────────────────────────────────

  /**
   * Verify signature and expiry.
   * @param {CapabilityToken|object} token
   * @param {string} [expectedAgentId]  — if set, verify token.agentId matches
   */
  static verify(token, expectedAgentId) {
    const raw = token instanceof CapabilityToken ? token.toJSON() : token;
    if (Date.now() >= raw.expiresAt) return false;
    if (expectedAgentId && raw.agentId !== expectedAgentId) return false;
    const { sig, ...unsigned } = raw;
    unsigned.sig = null;
    return AgentIdentity.verify(_canonical(unsigned), b64decode(sig), raw.issuer);
  }

  /**
   * Verify a token chain: walk parentId links, check attenuation (skill must
   * be equal-or-narrower, expiry must be equal-or-shorter than parent).
   * For Phase 1 this just verifies each link independently.
   */
  static verifyChain(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0) return false;
    for (const t of tokens) {
      if (!CapabilityToken.verify(t)) return false;
    }
    // Check attenuation: each child must not exceed parent's permissions.
    for (let i = 1; i < tokens.length; i++) {
      const parent = tokens[i - 1] instanceof CapabilityToken ? tokens[i-1].toJSON() : tokens[i-1];
      const child  = tokens[i]     instanceof CapabilityToken ? tokens[i].toJSON()   : tokens[i];
      if (parent.skill !== '*' && child.skill !== parent.skill) return false;
      if (child.expiresAt > parent.expiresAt)                   return false;
    }
    return true;
  }

  // ── Parse ─────────────────────────────────────────────────────────────────

  static fromJSON(obj) {
    return new CapabilityToken(typeof obj === 'string' ? JSON.parse(obj) : obj);
  }
}

function _canonical(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}
