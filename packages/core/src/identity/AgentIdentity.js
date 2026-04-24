/**
 * AgentIdentity — Ed25519 keypair + nacl.box encryption.
 *
 * The agent's stable identity is its Ed25519 public key. The same 32-byte
 * seed drives both signing (Ed25519 via tweetnacl) and encryption (Curve25519
 * via ed2curve). The private key stays in the Vault; operations are synchronous
 * once the identity is constructed.
 *
 * Key conversion: ed2curve maps Ed25519 → Curve25519 so that the single
 * Ed25519 keypair is enough for both signing and nacl.box encryption. Both
 * parties derive the same Diffie-Hellman session key from their respective
 * Ed25519 identities.
 */
import nacl       from 'tweetnacl';
import ed2curve   from 'ed2curve';
import { encode as b64encode, decode as b64decode } from '../crypto/b64.js';
import { mnemonicToSeed, seedToMnemonic } from './Mnemonic.js';

const { convertPublicKey, convertKeyPair } = ed2curve;

export class AgentIdentity {
  /** @type {{ publicKey: Uint8Array, secretKey: Uint8Array }} */
  #signKP;
  /** @type {{ publicKey: Uint8Array, secretKey: Uint8Array }} */
  #boxKP;
  #vault;

  constructor({ seed, vault }) {
    this.#vault  = vault;
    this.#signKP = nacl.sign.keyPair.fromSeed(seed);
    this.#boxKP  = convertKeyPair(this.#signKP);
    if (!this.#boxKP) throw new Error('Failed to derive Curve25519 keypair from seed');
  }

  // ── Factory methods ────────────────────────────────────────────────────────

  /** Generate a new keypair, persist the seed to the vault. */
  static async generate(vault) {
    const seed = nacl.randomBytes(32);
    await vault.set('agent-privkey', _writeEntry(seed, null));
    return new AgentIdentity({ seed, vault });
  }

  /** Restore an existing keypair from the vault. */
  static async restore(vault) {
    const raw = await vault.get('agent-privkey');
    if (!raw) throw new Error('No agent key found in vault');
    const parsed = _parseEntry(raw);
    return new AgentIdentity({ seed: b64decode(parsed.current), vault });
  }

  /**
   * Group FF — restore the current identity AND (if available + still in
   * grace) the previous identity from before the most recent rotation.
   * Callers that support grace-period decryption (e.g. SecurityLayer)
   * use `previous` to keep decrypting envelopes addressed to our old
   * pubkey until graceUntil expires.
   *
   * @param {import('./Vault.js').Vault} vault
   * @returns {Promise<{ current: AgentIdentity, previous: { identity: AgentIdentity, graceUntil: number } | null }>}
   */
  static async restoreWithPrevious(vault) {
    const raw = await vault.get('agent-privkey');
    if (!raw) throw new Error('No agent key found in vault');
    const parsed  = _parseEntry(raw);
    const current = new AgentIdentity({ seed: b64decode(parsed.current), vault });
    let previous  = null;
    if (parsed.previous?.seed
        && typeof parsed.previous.graceUntil === 'number'
        && parsed.previous.graceUntil > Date.now()) {
      // Previous identity is NOT given the vault (we don't want it to
      // overwrite the current-identity blob via any future writes).
      previous = {
        identity:   new AgentIdentity({ seed: b64decode(parsed.previous.seed), vault: null }),
        graceUntil: parsed.previous.graceUntil,
      };
    }
    return { current, previous };
  }

  /**
   * Restore (or create) a keypair from a BIP39 mnemonic.
   * Persists the seed to vault — same behaviour as generate().
   */
  static async fromMnemonic(mnemonic, vault) {
    const seed = mnemonicToSeed(mnemonic);
    await vault.set('agent-privkey', _writeEntry(seed, null));
    return new AgentIdentity({ seed, vault });
  }

  /**
   * Group FF — rotate the agent's Ed25519 keypair.
   * Generates a fresh seed, persists a `{ current, previous: { seed,
   * pubkey, graceUntil } }` blob to the vault, and returns both
   * identities.  The caller (Agent.rotateIdentity) is responsible for:
   *   • building + broadcasting the KeyRotationProof signed by `old`
   *   • registering `old` with SecurityLayer for grace-period decryption
   *   • swapping agent.identity to `new`
   *
   * @param {import('./Vault.js').Vault} vault
   * @param {object} [opts]
   * @param {number} [opts.gracePeriodSeconds=604800]  — 7 days default
   * @returns {Promise<{ oldIdentity: AgentIdentity, newIdentity: AgentIdentity, graceUntil: number }>}
   */
  static async rotate(vault, { gracePeriodSeconds = 604_800 } = {}) {
    const raw = await vault.get('agent-privkey');
    if (!raw) throw new Error('No agent key found in vault');
    const parsed = _parseEntry(raw);

    const oldSeed     = b64decode(parsed.current);
    const oldIdentity = new AgentIdentity({ seed: oldSeed, vault });

    const newSeed     = nacl.randomBytes(32);
    const graceUntil  = Date.now() + gracePeriodSeconds * 1_000;

    const blob = {
      current: b64encode(newSeed),
      previous: {
        seed:       b64encode(oldSeed),
        pubkey:     oldIdentity.pubKey,
        graceUntil,
      },
    };
    await vault.set('agent-privkey', JSON.stringify(blob));

    const newIdentity = new AgentIdentity({ seed: newSeed, vault });
    return { oldIdentity, newIdentity, graceUntil };
  }

  // ── Identity ───────────────────────────────────────────────────────────────

  /** Ed25519 public key as base64url string — the agent's stable identity. */
  get pubKey() {
    return b64encode(this.#signKP.publicKey);
  }

  /**
   * The underlying Vault instance (may be null for "detached" identities
   * such as the previous-identity handed back by restoreWithPrevious —
   * those intentionally can't write back to the vault).
   */
  get vault() { return this.#vault; }

  /** Ed25519 public key as raw Uint8Array. */
  get pubKeyBytes() {
    return this.#signKP.publicKey;
  }

  /** Curve25519 public key bytes (derived from Ed25519 for nacl.box). */
  get boxPubKeyBytes() {
    return this.#boxKP.publicKey;
  }

  /** Return the BIP39 mnemonic for the current seed (reads from vault). */
  async getMnemonic() {
    if (!this.#vault) return null;
    const raw = await this.#vault.get('agent-privkey');
    if (!raw) return null;
    const parsed = _parseEntry(raw);
    return seedToMnemonic(b64decode(parsed.current));
  }

  // ── Signing ────────────────────────────────────────────────────────────────

  /**
   * Sign data with the Ed25519 private key.
   * @param   {string|Uint8Array} data
   * @returns {Uint8Array} 64-byte signature
   */
  sign(data) {
    if (typeof data === 'string') data = new TextEncoder().encode(data);
    return nacl.sign.detached(data, this.#signKP.secretKey);
  }

  /**
   * Verify an Ed25519 signature.
   * @param {string|Uint8Array} data
   * @param {string|Uint8Array} sig       - 64-byte signature (or base64url)
   * @param {string}            pubKeyB64 - signer's Ed25519 pubKey (base64url)
   */
  static verify(data, sig, pubKeyB64) {
    if (typeof data === 'string') data = new TextEncoder().encode(data);
    if (typeof sig  === 'string') sig  = b64decode(sig);
    return nacl.sign.detached.verify(data, sig, b64decode(pubKeyB64));
  }

  // ── Asymmetric encryption ──────────────────────────────────────────────────

  /**
   * Encrypt plaintext for a recipient identified by their Ed25519 public key.
   * Uses Curve25519 DH + XSalsa20-Poly1305 (nacl.box).
   *
   * @param   {Uint8Array} plaintext
   * @param   {string}     recipientPubKeyB64 — recipient's Ed25519 pubKey (base64url)
   * @returns {{ nonce: Uint8Array, ciphertext: Uint8Array }}
   */
  box(plaintext, recipientPubKeyB64) {
    const recipientCurve = convertPublicKey(b64decode(recipientPubKeyB64));
    if (!recipientCurve) throw new Error('Invalid recipient Ed25519 public key');
    const nonce      = nacl.randomBytes(nacl.box.nonceLength); // 24 bytes
    const sessionKey = nacl.box.before(recipientCurve, this.#boxKP.secretKey);
    const ciphertext = nacl.box.after(plaintext, nonce, sessionKey);
    return { nonce, ciphertext };
  }

  /**
   * Decrypt a nacl.box ciphertext from a sender.
   *
   * @param   {Uint8Array} ciphertext
   * @param   {Uint8Array} nonce
   * @param   {string}     senderPubKeyB64 — sender's Ed25519 pubKey (base64url)
   * @returns {Uint8Array|null}  null if authentication fails
   */
  unbox(ciphertext, nonce, senderPubKeyB64) {
    const senderCurve = convertPublicKey(b64decode(senderPubKeyB64));
    if (!senderCurve) throw new Error('Invalid sender Ed25519 public key');
    const sessionKey = nacl.box.before(senderCurve, this.#boxKP.secretKey);
    return nacl.box.open.after(ciphertext, nonce, sessionKey);
  }

  /**
   * Derive a shared symmetric session key with a peer (for stream encryption).
   * Both sides compute nacl.box.before from their respective keypairs and arrive
   * at the same 32-byte key — no extra message exchange needed.
   *
   * @param   {string}     peerPubKeyB64 — peer's Ed25519 pubKey (base64url)
   * @returns {Uint8Array} 32-byte session key
   */
  deriveSessionKey(peerPubKeyB64) {
    const peerCurve = convertPublicKey(b64decode(peerPubKeyB64));
    if (!peerCurve) throw new Error('Invalid peer Ed25519 public key');
    return nacl.box.before(peerCurve, this.#boxKP.secretKey);
  }

  // ── Symmetric encryption ───────────────────────────────────────────────────

  /**
   * Encrypt with a pre-shared session key (nacl.secretbox / XSalsa20-Poly1305).
   * Used for stream chunks (ST/SE/BT) where nonce is derived from streamId+seq.
   *
   * @param   {Uint8Array} plaintext
   * @param   {Uint8Array} nonce      — 24 bytes
   * @param   {Uint8Array} sessionKey — 32 bytes (from deriveSessionKey)
   * @returns {Uint8Array}
   */
  static secretbox(plaintext, nonce, sessionKey) {
    return nacl.secretbox(plaintext, nonce, sessionKey);
  }

  /**
   * Decrypt with a session key.
   * @returns {Uint8Array|null} null if authentication fails
   */
  static secretunbox(ciphertext, nonce, sessionKey) {
    return nacl.secretbox.open(ciphertext, nonce, sessionKey);
  }
}

// ── Vault envelope helpers (Group FF) ────────────────────────────────────────
//
// Old format (legacy, pre-rotation): the vault stored a bare base64url seed
// ("42-ish chars") under 'agent-privkey'.
// New format: a JSON blob with a `current` seed (b64) and optional
// `previous: { seed, pubkey, graceUntil }` for the last rotated-from
// identity.  Legacy values read fine — they get parsed as current-only,
// and any subsequent generate/rotate upgrades the blob in place.

function _parseEntry(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return { current: '', previous: null };
  // Try JSON first.
  if (raw[0] === '{') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.current === 'string') {
        return {
          current:  parsed.current,
          previous: parsed.previous ?? null,
        };
      }
    } catch { /* fall through to legacy */ }
  }
  // Legacy bare-b64 seed.
  return { current: raw, previous: null };
}

function _writeEntry(seed, previous) {
  return JSON.stringify({
    current:  typeof seed === 'string' ? seed : b64encode(seed),
    previous: previous ?? null,
  });
}
