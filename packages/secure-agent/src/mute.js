/**
 * @canopy/secure-agent — persistent peer mute set.
 *
 * Layer: substrate.  Platform-neutral (depends only on the Vault
 * interface from @canopy/vault).
 *
 * Wires A.1 from the v0.7 security roadmap.  A mute applies to:
 *   - inbound HI       (rejected via the helloGate composition)
 *   - inbound envelopes (dropped before onPeerMessage fires)
 *   - outbound sendTo  (throws — refuse to talk to muted peers)
 *
 * Mute is matched on the NKN peer ADDRESS today.  Future S-slices
 * (S4 identity-resolver) will additionally match on stableId + webid
 * once those mappings are available at this layer.
 */

/**
 * Build a MuteSet bound to a vault key.  Persistence is opt-in: if
 * `vaultKey` is falsy the set is in-memory only (still useful for
 * the factory consumer that wants the API without persistence).
 *
 * @param {object} args
 * @param {object} args.vault             VaultMemory | VaultLocalStorage
 * @param {string|null} [args.vaultKey]   persistence slot; null → in-memory
 * @returns {Promise<MuteSet>}
 */
export async function loadMuteSet({ vault, vaultKey = null } = {}) {
  const set = new Set();
  if (vaultKey && vault) {
    try {
      const raw = await vault.get(vaultKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const k of parsed) if (typeof k === 'string') set.add(k);
        }
      }
    } catch {
      // Corrupt slot → start clean; next persist overwrites it.
    }
  }
  return new MuteSet({ set, vault, vaultKey });
}

export class MuteSet {
  #set;
  #vault;
  #key;

  constructor({ set, vault, vaultKey }) {
    this.#set   = set;
    this.#vault = vault;
    this.#key   = vaultKey;
  }

  has(peerKey)  { return this.#set.has(peerKey); }
  list()        { return [...this.#set]; }
  get size()    { return this.#set.size; }

  async add(peerKey) {
    if (typeof peerKey !== 'string' || !peerKey) {
      throw new Error('MuteSet.add: peerKey must be a non-empty string');
    }
    if (this.#set.has(peerKey)) return false;
    this.#set.add(peerKey);
    await this.#persist();
    return true;
  }

  async remove(peerKey) {
    if (!this.#set.has(peerKey)) return false;
    this.#set.delete(peerKey);
    await this.#persist();
    return true;
  }

  async clear() {
    if (this.#set.size === 0) return;
    this.#set.clear();
    await this.#persist();
  }

  async #persist() {
    if (!this.#key || !this.#vault) return;
    await this.#vault.set(this.#key, JSON.stringify([...this.#set]));
  }
}
