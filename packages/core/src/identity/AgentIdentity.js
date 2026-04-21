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
    await vault.set('agent-privkey', b64encode(seed));
    return new AgentIdentity({ seed, vault });
  }

  /** Restore an existing keypair from the vault. */
  static async restore(vault) {
    const raw = await vault.get('agent-privkey');
    if (!raw) throw new Error('No agent key found in vault');
    return new AgentIdentity({ seed: b64decode(raw), vault });
  }

  /**
   * Restore (or create) a keypair from a BIP39 mnemonic.
   * Persists the seed to vault — same behaviour as generate().
   */
  static async fromMnemonic(mnemonic, vault) {
    const seed = mnemonicToSeed(mnemonic);
    await vault.set('agent-privkey', b64encode(seed));
    return new AgentIdentity({ seed, vault });
  }

  // ── Identity ───────────────────────────────────────────────────────────────

  /** Ed25519 public key as base64url string — the agent's stable identity. */
  get pubKey() {
    return b64encode(this.#signKP.publicKey);
  }

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
    const raw = await this.#vault.get('agent-privkey');
    if (!raw) return null;
    return seedToMnemonic(b64decode(raw));
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
