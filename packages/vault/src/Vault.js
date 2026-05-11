/**
 * Abstract Vault — secure secret storage.
 *
 * The private key seed is never held in plaintext outside the vault after
 * AgentIdentity is constructed. All backends implement these five methods.
 *
 * Key naming conventions (all vaults use these):
 *   'agent-privkey'             — base64url Ed25519 seed (32 bytes)
 *   'token:<agentId>:<skill>'   — JSON-serialised capability token
 *   'group-proof:<groupId>'     — JSON-serialised group proof
 *   'a2a-token:<url>'           — Bearer token for an A2A peer
 *   'solid-pod-token'           — Solid OIDC token
 */
export class Vault {
  /** @returns {Promise<string|null>} */
  async get(key)         { throw new Error(`${this.constructor.name}.get() not implemented`); }
  /** @returns {Promise<void>} */
  async set(key, value)  { throw new Error(`${this.constructor.name}.set() not implemented`); }
  /** @returns {Promise<void>} */
  async delete(key)      { throw new Error(`${this.constructor.name}.delete() not implemented`); }
  /** @returns {Promise<boolean>} */
  async has(key)         { throw new Error(`${this.constructor.name}.has() not implemented`); }
  /** @returns {Promise<string[]>} */
  async list()           { throw new Error(`${this.constructor.name}.list() not implemented`); }
}
