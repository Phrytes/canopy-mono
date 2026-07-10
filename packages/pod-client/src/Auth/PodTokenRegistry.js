/**
 * PodTokenRegistry — vault-backed revocation ledger for `PodCapabilityToken`s.
 *
 * OWNER-SIDE: the pod owner (the device that issued a delegation to a host)
 * revokes a token by id here; the pod-side gate consults `isRevoked(id)` (the
 * `PodTokenVerifier`'s revocation seam) on every request, so a revoked
 * delegation stops authorizing before its `expiresAt`.
 *
 * Mirrors `@canopy/core`'s `TokenRegistry` shape/conventions, but is trimmed to
 * the revocation half — the companion's owner only needs "revoke + is-it-
 * revoked", not a held-token cache. Uses a distinct key prefix so it can share a
 * vault with a `TokenRegistry` without colliding.
 *
 * Vault keys:
 *   'pod-revoked:<tokenId>' → '1'
 */
export class PodTokenRegistry {
  #vault;

  /** @param {import('@canopy/vault').Vault} vault */
  constructor(vault) {
    if (!vault) throw new Error('PodTokenRegistry requires a vault');
    this.#vault = vault;
  }

  /**
   * Revoke a delegated token by id. Idempotent.
   * @param {string} tokenId
   */
  async revoke(tokenId) {
    if (typeof tokenId !== 'string' || tokenId.length === 0) {
      throw new Error('PodTokenRegistry.revoke: tokenId is required');
    }
    await this.#vault.set(`pod-revoked:${tokenId}`, '1');
  }

  /**
   * @param {string} tokenId
   * @returns {Promise<boolean>} true iff this id was revoked.
   */
  async isRevoked(tokenId) {
    if (typeof tokenId !== 'string' || tokenId.length === 0) return false;
    return this.#vault.has(`pod-revoked:${tokenId}`);
  }

  /**
   * Undo a revocation (e.g. an operator mistake). Idempotent.
   * @param {string} tokenId
   */
  async unrevoke(tokenId) {
    if (typeof tokenId !== 'string' || tokenId.length === 0) return;
    await this.#vault.delete(`pod-revoked:${tokenId}`);
  }

  /**
   * All currently-revoked token ids.
   * @returns {Promise<string[]>}
   */
  async list() {
    const keys = await this.#vault.list();
    return keys
      .filter(k => k.startsWith('pod-revoked:'))
      .map(k => k.slice('pod-revoked:'.length));
  }
}
