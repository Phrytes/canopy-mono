/**
 * BotIdentity — the household bot's keypair lifecycle.
 *
 * The bot is a member of the household with its own cryptographic
 * identity (Q-H2.13 lock).  Audit trails distinguish "the author added
 * bread" (signed by the author's webid) from "bot marked complete"
 * (signed by the bot's keypair).  This class wraps
 * `@canopy/core`'s `AgentIdentity` for that lifecycle:
 *
 *   - load-or-generate-and-persist on `load()`
 *   - sign autonomous payloads via `sign()`
 *   - expose `pubkey` and the bot's `webid`
 *
 * The bot's webid follows the Solid convention:
 *
 *     <botPodRoot>/profile/card#me
 *
 * Persistence model: AgentIdentity hardcodes the vault key
 * `'agent-privkey'`.  To avoid clashing with any other
 * AgentIdentity-backed component sharing the same vault (Folio,
 * the user's own agent, etc.), BotIdentity wraps the supplied
 * vault with a namespacing adapter that remaps that one key to
 * `'household-bot-identity-privkey'`.  All other keys pass
 * through unchanged.
 */
import { AgentIdentity } from '@canopy/core';

/** Vault key under which the bot's seed is stored (after namespacing). */
const BOT_IDENTITY_VAULT_KEY = 'household-bot-identity-privkey';

/** AgentIdentity's hardcoded internal key — what we remap. */
const AGENT_IDENTITY_INTERNAL_KEY = 'agent-privkey';

export class BotIdentity {
  /** @type {import('@canopy/core').Vault} */
  #vault;
  /** @type {import('@canopy/core').Vault} */
  #namespacedVault;
  /** @type {string|null} */
  #botPodRoot;
  /** @type {AgentIdentity|null} */
  #identity = null;

  /**
   * @param {object} args
   * @param {import('@canopy/core').Vault} args.vault
   *   A Vault instance from @canopy/core (e.g. VaultMemory in
   *   tests, VaultNodeFs in prod).  The bot persists its keypair
   *   under a namespaced key in this vault — safe to share.
   * @param {string} [args.botPodRoot]
   *   The bot's pod URL (e.g. `'https://pod.example.com/bot/'`).
   *   Used to derive the bot's webid.  Optional: omit if the bot
   *   is operating before the pod is provisioned, then set later
   *   via property (we keep webid as a getter, not stored state).
   */
  constructor({ vault, botPodRoot } = {}) {
    if (!vault) throw new Error('BotIdentity: vault is required');
    this.#vault           = vault;
    this.#botPodRoot      = botPodRoot ?? null;
    this.#namespacedVault = _namespaceVault(vault);
  }

  /**
   * Load the existing identity from the vault, OR generate a new
   * keypair and persist it.  Idempotent: calling twice returns the
   * same identity (no second generation).
   */
  async load() {
    if (this.#identity) return;

    const existing = await this.#namespacedVault.get(AGENT_IDENTITY_INTERNAL_KEY);
    if (existing) {
      this.#identity = await AgentIdentity.restore(this.#namespacedVault);
    } else {
      this.#identity = await AgentIdentity.generate(this.#namespacedVault);
    }
  }

  /**
   * Sign an arbitrary payload.  Used by skills the bot invokes
   * itself (e.g. autonomous nudges, completions on the user's
   * behalf), as opposed to signing-on-behalf-of a human member
   * (which uses the member's identity, not the bot's).
   *
   * @param {string|Uint8Array} payload
   * @returns {Promise<Uint8Array>} 64-byte Ed25519 signature
   */
  async sign(payload) {
    if (!this.#identity) {
      throw new Error('BotIdentity: load() must be called before sign()');
    }
    return this.#identity.sign(payload);
  }

  /**
   * The bot's Ed25519 public key as a base64url string.  Null
   * before `load()`.
   * @returns {string|null}
   */
  get pubkey() {
    return this.#identity?.pubKey ?? null;
  }

  /**
   * The bot's webid.  Convention: `<botPodRoot>/profile/card#me`,
   * mirroring how Solid users' webids are structured.  Null when
   * either the keypair hasn't been loaded yet or no botPodRoot was
   * supplied.
   * @returns {string|null}
   */
  get webid() {
    if (!this.#identity || !this.#botPodRoot) return null;
    // Tolerate trailing-slash on botPodRoot — both `<root>/` and
    // `<root>` should produce a sensible webid.
    const root = this.#botPodRoot.endsWith('/')
      ? this.#botPodRoot.slice(0, -1)
      : this.#botPodRoot;
    return `${root}/profile/card#me`;
  }

  /**
   * Bot's pod root URL (read-only echo of the constructor arg).
   * @returns {string|null}
   */
  get botPodRoot() { return this.#botPodRoot; }

  /**
   * The wrapped AgentIdentity instance — exposed read-only so that
   * helpers in this app (e.g. AdminCapability.rotateAdminCaps) can
   * issue tokens signed by the bot.  Null before `load()`.
   * @returns {AgentIdentity|null}
   */
  get agentIdentity() { return this.#identity; }
}

// ── Internals ──────────────────────────────────────────────────────────────

/**
 * Wrap a Vault so that the single key `'agent-privkey'` is
 * remapped to `'household-bot-identity-privkey'`.  Everything else
 * passes through unchanged — leaves room for a future need to
 * store auxiliary bot-secrets under their own keys directly on the
 * underlying vault.
 */
function _namespaceVault(underlying) {
  const remap = key => key === AGENT_IDENTITY_INTERNAL_KEY
    ? BOT_IDENTITY_VAULT_KEY
    : key;
  return {
    async get(key)        { return underlying.get(remap(key)); },
    async set(key, value) { return underlying.set(remap(key), value); },
    async delete(key)     { return underlying.delete(remap(key)); },
    async has(key)        { return underlying.has(remap(key)); },
    async list()          {
      const keys = await underlying.list();
      return keys.map(k => k === BOT_IDENTITY_VAULT_KEY
        ? AGENT_IDENTITY_INTERNAL_KEY
        : k);
    },
  };
}
