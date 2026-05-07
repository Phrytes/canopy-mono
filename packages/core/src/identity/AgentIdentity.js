/**
 * AgentIdentity — Ed25519 keypair + nacl.box encryption + a separate
 * `stableId` (Stoop V1 Phase 11, 2026-05-06).
 *
 * The agent's *network* identity is its Ed25519 public key (rotates
 * via `Agent.rotateIdentity()`).  The agent's *stable* identity is
 * `stableId` — opaque base64url, generated once at first construction,
 * persisted in the vault under `'agent-stable-id'`, **untouched by
 * rotation**.  Apps use it as the "this person" key for mute / ban /
 * report / peer-cache.  Existing vaults that pre-date this field
 * lazy-init on first load.
 *
 * The same 32-byte seed drives both signing (Ed25519 via tweetnacl)
 * and encryption (Curve25519 via ed2curve). The private key stays in
 * the Vault; operations are synchronous once the identity is constructed.
 *
 * Key conversion: ed2curve maps Ed25519 → Curve25519 so that the single
 * Ed25519 keypair is enough for both signing and nacl.box encryption. Both
 * parties derive the same Diffie-Hellman session key from their respective
 * Ed25519 identities.
 */
import nacl       from 'tweetnacl';
import ed2curve   from 'ed2curve';
import { hkdfSync } from 'node:crypto';
import { encode as b64encode, decode as b64decode } from '../crypto/b64.js';
import { mnemonicToSeed, seedToMnemonic } from './Mnemonic.js';

const { convertPublicKey, convertKeyPair } = ed2curve;

/** Vault key for the per-agent stableId (Stoop V1 Phase 11). */
const STABLE_ID_KEY = 'agent-stable-id';

/**
 * HKDF salt for deterministic stableId derivation (V2.5+ Phase 32,
 * 2026-05-07).  **Permanent** — never change.  Changing it would
 * invalidate every restored identity's stableId across all apps.
 */
const STABLE_ID_HKDF_SALT = 'stoop-stableId-v1';
const STABLE_ID_BYTES = 16;

/**
 * Derive a deterministic stableId from a seed using HKDF-SHA256.
 * Same seed → same stableId, on any device, always.  Used when a
 * vault is fresh (no existing stableId) AND a seed is available
 * (i.e. caller is `generate`, `restore`, or `fromMnemonic`).
 */
function _deriveStableIdFromSeed(seed) {
  const out = hkdfSync('sha256', seed, STABLE_ID_HKDF_SALT, '', STABLE_ID_BYTES);
  return b64encode(new Uint8Array(out));
}

/**
 * Load (or lazy-init) the stableId for this vault.  Returns null for
 * detached identities (vault === null), e.g. the `previous` identity
 * handed back by `restoreWithPrevious` — those intentionally don't
 * persist anywhere.
 *
 * V2.5+ (Phase 32, 2026-05-07): when the vault has nothing AND a
 * `seed` is supplied, derive the stableId deterministically via
 * HKDF-SHA256(seed, salt='stoop-stableId-v1').  This makes
 * `restoreFromMnemonic` produce the SAME stableId across devices —
 * mute / report / contact-cache state survives the restore.
 *
 * Existing vaults with a random stableId keep theirs (back-compat).
 */
async function _loadOrInitStableId(vault, seed = null) {
  if (!vault) return null;
  const existing = await vault.get(STABLE_ID_KEY);
  if (existing && typeof existing === 'string' && existing.length > 0) return existing;
  const fresh = (seed instanceof Uint8Array && seed.length === 32)
    ? _deriveStableIdFromSeed(seed)
    : b64encode(nacl.randomBytes(16));
  await vault.set(STABLE_ID_KEY, fresh);
  return fresh;
}

export class AgentIdentity {
  /** @type {{ publicKey: Uint8Array, secretKey: Uint8Array }} */
  #signKP;
  /** @type {{ publicKey: Uint8Array, secretKey: Uint8Array }} */
  #boxKP;
  #vault;
  /** @type {string | null} — the stable opaque user id (Stoop V1 Phase 11). */
  #stableId = null;

  constructor({ seed, vault, stableId = null }) {
    this.#vault  = vault;
    this.#signKP = nacl.sign.keyPair.fromSeed(seed);
    this.#boxKP  = convertKeyPair(this.#signKP);
    if (!this.#boxKP) throw new Error('Failed to derive Curve25519 keypair from seed');
    this.#stableId = stableId;
  }

  // ── Factory methods ────────────────────────────────────────────────────────

  /** Generate a new keypair, persist the seed to the vault. */
  static async generate(vault) {
    const seed = nacl.randomBytes(32);
    await vault.set('agent-privkey', _writeEntry(seed, null));
    const stableId = await _loadOrInitStableId(vault, seed);
    return new AgentIdentity({ seed, vault, stableId });
  }

  /** Restore an existing keypair from the vault. */
  static async restore(vault) {
    const raw = await vault.get('agent-privkey');
    if (!raw) throw new Error('No agent key found in vault');
    const parsed = _parseEntry(raw);
    const seed = b64decode(parsed.current);
    const stableId = await _loadOrInitStableId(vault, seed);
    return new AgentIdentity({ seed, vault, stableId });
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
    const parsed   = _parseEntry(raw);
    const currentSeed = b64decode(parsed.current);
    const stableId = await _loadOrInitStableId(vault, currentSeed);
    const current  = new AgentIdentity({ seed: currentSeed, vault, stableId });
    let previous   = null;
    if (parsed.previous?.seed
        && typeof parsed.previous.graceUntil === 'number'
        && parsed.previous.graceUntil > Date.now()) {
      // Previous identity is NOT given the vault (we don't want it to
      // overwrite the current-identity blob via any future writes).
      // It carries the same stableId — rotation never changes it.
      previous = {
        identity:   new AgentIdentity({ seed: b64decode(parsed.previous.seed), vault: null, stableId }),
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
    const stableId = await _loadOrInitStableId(vault, seed);
    return new AgentIdentity({ seed, vault, stableId });
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
    /** stableId survives rotation — load (or lazy-init for legacy vaults). */
    const stableId    = await _loadOrInitStableId(vault, oldSeed);
    const oldIdentity = new AgentIdentity({ seed: oldSeed, vault, stableId });

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

    const newIdentity = new AgentIdentity({ seed: newSeed, vault, stableId });
    return { oldIdentity, newIdentity, graceUntil };
  }

  // ── Identity ───────────────────────────────────────────────────────────────

  /** Ed25519 public key as base64url string — rotates via `Agent.rotateIdentity()`. */
  get pubKey() {
    return b64encode(this.#signKP.publicKey);
  }

  /**
   * Stable opaque user identifier (Stoop V1 Phase 11).  Generated once
   * at first construction (or lazy-init on legacy vaults), persisted
   * under `agent-stable-id`, **untouched by rotation**.  Apps use it
   * for the "this person" key (mute / ban / report / peer-cache).
   *
   * Survives `Agent.rotateIdentity()`: the new keypair carries the
   * same `stableId` because the rotation path doesn't touch the
   * `agent-stable-id` vault key.  The detached `previous` identity
   * handed back by `restoreWithPrevious()` carries the same value
   * too — it's the same person under an older keypair.
   */
  get stableId() {
    return this.#stableId;
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
