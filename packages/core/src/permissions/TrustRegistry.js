/**
 * TrustRegistry — persists peer trust tiers in the Vault.
 *
 * Tier string → numeric level mapping:
 *   public        → 0  (unauthenticated, any caller)
 *   authenticated → 1  (known pubKey, no group required)
 *   trusted       → 2  (group member or capability token holder)
 *   private       → 3  (admin / self)
 *
 * Vault keys:  'trust:<pubKeyB64>' → JSON { tier, groups, tokenIds }
 */

/** @typedef {'public'|'authenticated'|'trusted'|'private'} Tier */

export const TIER_LEVEL = Object.freeze({
  public:        0,
  authenticated: 1,
  trusted:       2,
  private:       3,
});

export class TrustRegistry {
  #vault;

  /** @param {import('../identity/Vault.js').Vault} vault */
  constructor(vault) {
    if (!vault) throw new Error('TrustRegistry requires a vault');
    this.#vault = vault;
  }

  // ── Tier ─────────────────────────────────────────────────────────────────

  /** @param {Tier} tier */
  async setTier(pubKey, tier) {
    const rec = await this.#load(pubKey);
    rec.tier  = tier;
    await this.#save(pubKey, rec);
  }

  /** @returns {Tier} defaults to 'authenticated' for unknown peers */
  async getTier(pubKey) {
    const rec = await this.#load(pubKey);
    return rec.tier ?? 'authenticated';
  }

  /** @returns {{ tier: Tier, groups: string[], tokenIds: string[] }} */
  async getRecord(pubKey) {
    return this.#load(pubKey);
  }

  // ── Groups ────────────────────────────────────────────────────────────────

  async addGroup(pubKey, groupId) {
    const rec = await this.#load(pubKey);
    if (!rec.groups.includes(groupId)) rec.groups.push(groupId);
    await this.#save(pubKey, rec);
  }

  async removeGroup(pubKey, groupId) {
    const rec    = await this.#load(pubKey);
    rec.groups   = rec.groups.filter(g => g !== groupId);
    await this.#save(pubKey, rec);
  }

  // ── Token grants ──────────────────────────────────────────────────────────

  async addTokenGrant(pubKey, tokenId) {
    const rec = await this.#load(pubKey);
    if (!rec.tokenIds.includes(tokenId)) rec.tokenIds.push(tokenId);
    await this.#save(pubKey, rec);
  }

  // ── Enumerate ─────────────────────────────────────────────────────────────

  /** @returns {Promise<Record<string, object>>} */
  async all() {
    const keys  = await this.#vault.list();
    const trust = keys.filter(k => k.startsWith('trust:'));
    const out   = {};
    for (const k of trust) {
      const pubKey = k.slice(6);
      out[pubKey]  = await this.#load(pubKey);
    }
    return out;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  async #load(pubKey) {
    const raw = await this.#vault.get(`trust:${pubKey}`);
    return raw ? JSON.parse(raw) : { tier: 'authenticated', groups: [], tokenIds: [] };
  }

  async #save(pubKey, rec) {
    await this.#vault.set(`trust:${pubKey}`, JSON.stringify(rec));
  }
}
