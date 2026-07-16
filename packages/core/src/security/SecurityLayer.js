/**
 * SecurityLayer — nacl.box encryption + Ed25519 signatures.
 *
 * Wraps every outbound envelope (encrypt + sign) and validates every inbound
 * envelope (verify sig + decrypt) on native transports.
 *
 * HI (hello) envelopes are signed but NOT encrypted — they carry the sender's
 * pubKey in plaintext so the peer can register it and set up the secure channel.
 *
 * All other envelopes: payload is nacl.box encrypted (Curve25519 DH +
 * XSalsa20-Poly1305), then the encrypted envelope is Ed25519-signed.
 *
 * Inbound checks (in order):
 *   1. Replay window: |now − _ts| ≤ REPLAY_WINDOW_MS
 *   2. Dedup cache: reject if _id was seen within DEDUP_TTL_MS
 *   3. HI auto-registers: extract sender pubKey from payload.pubKey
 *   4. Verify Ed25519 signature
 *   5. Decrypt payload (skip for HI)
 */
import { P, canonicalize }                          from '../Envelope.js';
import { AgentIdentity }                             from '../identity/AgentIdentity.js';
import { KeyRotation }                               from '../identity/KeyRotation.js';
import { encode as b64encode, decode as b64decode }  from '../crypto/b64.js';

const REPLAY_WINDOW_MS = 10 * 60 * 1_000;  // ±10 minutes (tolerates LAN clock drift)
const DEDUP_TTL_MS     = 10 * 60 * 1_000;  // match replay window

// ── Error ──────────────────────────────────────────────────────────────────

/**
 * Frozen map of SecurityError codes — one per inbound envelope validation failure
 * (missing/bad signature, replay window, duplicate, unknown peer, decrypt failure).
 */
export const SEC = Object.freeze({
  MISSING_SIG:       'MISSING_SIG',
  REPLAY_WINDOW:     'REPLAY_WINDOW',
  DUPLICATE:         'DUPLICATE',
  UNKNOWN_RECIPIENT: 'UNKNOWN_RECIPIENT',
  UNKNOWN_SENDER:    'UNKNOWN_SENDER',
  BAD_SIG:           'BAD_SIG',
  DECRYPT_FAILED:    'DECRYPT_FAILED',
});

/**
 * Error thrown when an envelope fails a security check. Carries a machine-readable
 * `code` (one of the SEC constants) alongside the human-readable message.
 */
export class SecurityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SecurityError';
    this.code = code;
  }
}

// ── SecurityLayer ──────────────────────────────────────────────────────────

/**
 * Per-agent envelope crypto: `encrypt()` boxes + signs outbound envelopes and
 * `decryptAndVerify()` validates inbound ones (replay window, dedup, signature, decrypt).
 * Peer pubkeys are auto-registered from HI envelopes; HI itself is signed but plaintext.
 * Also tracks key-rotation grace state so envelopes to/from a recently rotated key
 * still validate, and can attach an inline rotation proof to outbound envelopes.
 */
export class SecurityLayer {
  /** @type {import('../identity/AgentIdentity.js').AgentIdentity} */
  #identity;
  /** @type {Map<string, string>} address → Ed25519 pubKey (base64url) */
  #peers = new Map();
  /** @type {Map<string, number>} _id → expiresAt (ms) */
  #dedup = new Map();
  /**
   * Group FF — self-rotation grace state.
   *   oldPubKey → { identity: AgentIdentity, graceUntil: ms }
   * During the grace window we still accept inbound envelopes addressed
   * to our OLD pubkey (peers that missed the rotation broadcast) and
   * decrypt them using the old identity's privkey.
   * @type {Map<string, { identity: import('../identity/AgentIdentity.js').AgentIdentity, graceUntil: number }>}
   */
  #selfHistory = new Map();

  /**
   * Group FF+1 — inline proof attached to every outbound envelope during
   * the sender's grace window, so receivers that missed the broadcast
   * auto-migrate on the first post-rotation message.
   * @type {{ proof: object, graceUntil: number } | null}
   */
  #inlineProof = null;

  /**
   * @param {object} opts
   * @param {import('../identity/AgentIdentity.js').AgentIdentity} opts.identity
   */
  constructor({ identity }) {
    this.#identity = identity;
    // Auto-register self so outbound HI sigs are verifiable in loopback tests.
    this.#peers.set(identity.pubKey, identity.pubKey);
  }

  /**
   * Group FF — register an old identity for grace-period acceptance.
   * Called by Agent.rotateIdentity (and by agent startup when the vault
   * contains a still-in-grace previous key).  After the graceUntil
   * timestamp passes, #decryptAndVerify stops accepting envelopes
   * addressed to that pubkey.
   *
   * @param {import('../identity/AgentIdentity.js').AgentIdentity} oldIdentity
   * @param {number} graceUntil  — ms epoch
   */
  registerSelfRotation(oldIdentity, graceUntil) {
    this.#selfHistory.set(oldIdentity.pubKey, { identity: oldIdentity, graceUntil });
    // Keep #peers self-registered under the old pubkey too, so envelopes
    // signed BY us with the old key (e.g. the rotation proof itself,
    // echoed back from a test) still verify.
    this.#peers.set(oldIdentity.pubKey, oldIdentity.pubKey);
  }

  /**
   * Group FF — swap the current identity after a rotation.
   * Agent.rotateIdentity calls this AFTER registerSelfRotation so both
   * old and new are valid during grace.
   *
   * @param {import('../identity/AgentIdentity.js').AgentIdentity} newIdentity
   */
  swapIdentity(newIdentity) {
    this.#identity = newIdentity;
    this.#peers.set(newIdentity.pubKey, newIdentity.pubKey);
  }

  /**
   * Group FF+1 — install a signed rotation proof that will be attached
   * to every outbound encrypted envelope until `graceUntil` passes.
   * Peers that missed the broadcast OW thus auto-migrate on the first
   * post-rotation message they receive from us.  Passing `null` clears.
   *
   * @param {object|null} proof
   * @param {number|null} [graceUntil]
   */
  setInlineProof(proof, graceUntil = null) {
    if (!proof) { this.#inlineProof = null; return; }
    this.#inlineProof = { proof, graceUntil: graceUntil ?? Infinity };
  }

  /**
   * True while an inline rotation proof is armed and still within its grace
   * window — i.e. this layer is currently attaching a proof to every outbound
   * encrypted envelope so un-notified peers auto-migrate. The B★ in-process
   * fast-path checks this to STAY ON the wire path during rotation grace, so
   * the inline-proof migration side-effect is never skipped (Group FF+1).
   *
   * @returns {boolean}
   */
  get inlineProofActive() {
    return !!this.#inlineProof && Date.now() < this.#inlineProof.graceUntil;
  }

  /** @returns {string} — current self pubkey */
  get selfPubKey() { return this.#identity.pubKey; }

  // ── Peer registry ──────────────────────────────────────────────────────────

  /**
   * Register (or update) a peer's Ed25519 public key.
   * Called externally by the hello handshake (Phase 2) or manually in tests.
   * @param {string} address   — the peer's transport address
   * @param {string} pubKeyB64 — Ed25519 public key in base64url
   */
  registerPeer(address, pubKeyB64) {
    this.#peers.set(address, pubKeyB64);
  }

  /** @returns {string|null} */
  getPeerKey(address) {
    return this.#peers.get(address) ?? null;
  }

  /** Remove a peer's key so future sends require a fresh hello. */
  unregisterPeer(address) {
    this.#peers.delete(address);
  }

  /**
   * Group FF — peer key rotation.
   * Walk #peers and replace every entry whose value === `oldPubKey`
   * with `newPubKey`.  Called by the key-rotation receive handler after
   * a proof has been verified, so messages signed by the new key from
   * the same transport addresses continue to verify.
   *
   * @param {string} oldPubKey
   * @param {string} newPubKey
   * @returns {number} number of entries migrated
   */
  migratePeerKey(oldPubKey, newPubKey) {
    let n = 0;
    for (const [addr, pk] of this.#peers) {
      if (pk === oldPubKey) { this.#peers.set(addr, newPubKey); n++; }
    }
    // Also register the pubKey→pubKey mapping so envelopes addressed by
    // the pubKey directly (relay's common case) resolve.
    if (!this.#peers.has(newPubKey)) this.#peers.set(newPubKey, newPubKey);
    return n;
  }

  // ── Outbound ───────────────────────────────────────────────────────────────

  /**
   * Encrypt (if needed) and sign an outbound envelope.
   * Synchronous — all nacl operations are synchronous.
   *
   * @param   {object} envelope — plain envelope from Transport._send
   * @returns {object}          — signed (+ optionally encrypted) envelope
   * @throws  {SecurityError}   — UNKNOWN_RECIPIENT if peer not registered
   */
  encrypt(envelope) {
    const env = { ...envelope };

    if (env._p === P.HI) {
      // HI: sign plaintext; no encryption.
      return this.#sign(env);
    }

    // All other types: encrypt payload for the recipient.
    const recipientKey = this.#peers.get(env._to);
    if (!recipientKey) {
      throw new SecurityError(
        SEC.UNKNOWN_RECIPIENT,
        `No pubKey registered for recipient "${env._to}" — send HI first`,
      );
    }

    const plaintext = new TextEncoder().encode(JSON.stringify(env.payload));
    const { nonce, ciphertext } = this.#identity.box(plaintext, recipientKey);

    // Pack nonce ‖ ciphertext into a single base64url blob.
    const combined = new Uint8Array(nonce.length + ciphertext.length);
    combined.set(nonce, 0);
    combined.set(ciphertext, nonce.length);

    env.payload = { _box: b64encode(combined) };

    // Group FF — canonicalise env._to to the *pubkey* the ciphertext was
    // actually boxed for, so the receiver's decryptAndVerify can pick the
    // right self-identity (current vs. grace-window previous).  Without
    // this, a post-rotation peer that encrypts to the rotated recipient's
    // new key would still tag env._to with the recipient's old transport
    // address, and the receiver's grace logic would reach for the wrong
    // privkey.  Transport routing (_put's `to` parameter) is unaffected —
    // it still uses the address the caller passed in.
    env._to = recipientKey;

    // Group FF+1 — attach inline rotation proof if we're still in grace.
    // Lazy-expire: once the window passes, drop the proof.
    if (this.#inlineProof) {
      if (Date.now() >= this.#inlineProof.graceUntil) {
        this.#inlineProof = null;
      } else {
        env._rotationProof = this.#inlineProof.proof;
      }
    }

    return this.#sign(env);
  }

  // ── Inbound ────────────────────────────────────────────────────────────────

  /**
   * Verify and decrypt an inbound envelope.
   * Synchronous.
   *
   * @param   {object} rawEnvelope — as received from the network
   * @returns {object}             — verified + decrypted envelope
   * @throws  {SecurityError}
   */
  decryptAndVerify(rawEnvelope) {
    const env = { ...rawEnvelope };

    // 1. Replay window.
    const age = Date.now() - env._ts;
    if (Math.abs(age) > REPLAY_WINDOW_MS) {
      throw new SecurityError(
        SEC.REPLAY_WINDOW,
        `Envelope ${env._id} outside replay window (age=${age}ms)`,
      );
    }

    // 2. Dedup.
    this.#cleanDedup();
    if (this.#dedup.has(env._id)) {
      throw new SecurityError(SEC.DUPLICATE, `Duplicate envelope ${env._id}`);
    }
    this.#dedup.set(env._id, Date.now() + DEDUP_TTL_MS);

    // 3. HI auto-registers sender pubKey from payload.pubKey.
    if (env._p === P.HI && env.payload?.pubKey) {
      this.#peers.set(env._from, env.payload.pubKey);
    }

    // 3b. Group FF+1 — inline rotation proof auto-migrates the peers
    // map BEFORE signature verify so the fresh envelope (signed with
    // the new key) verifies against the new pubkey.  We do NOT tag the
    // envelope yet — mutating env before verify would change its
    // canonical bytes and break the signature check.  The Agent-layer
    // migration mirror is attached after verify succeeds (below).
    let inlineMigration = null;
    if (env._rotationProof) {
      const mapped = this.#peers.get(env._from);
      if (mapped && mapped === env._rotationProof.oldPubKey
          && KeyRotation.verify(env._rotationProof, env._rotationProof.oldPubKey)
          && KeyRotation.isWithinGracePeriod(env._rotationProof)) {
        this.#peers.set(env._from, env._rotationProof.newPubKey);
        inlineMigration = {
          oldPubKey: env._rotationProof.oldPubKey,
          newPubKey: env._rotationProof.newPubKey,
          proof:     env._rotationProof,
        };
      }
    }

    // 4. Verify signature.
    if (!env._sig) {
      throw new SecurityError(SEC.MISSING_SIG, `Envelope ${env._id} has no signature`);
    }

    const senderKey = this.#peers.get(env._from);
    if (!senderKey) {
      throw new SecurityError(
        SEC.UNKNOWN_SENDER,
        `No pubKey registered for sender "${env._from}" — await HI handshake first`,
      );
    }

    const sigBytes   = b64decode(env._sig);
    const withoutSig = { ...env, _sig: null };
    if (!AgentIdentity.verify(canonicalize(withoutSig), sigBytes, senderKey)) {
      // Group FF+1: roll back any inline-proof peer-map mutation when
      // signature verify fails.  Without this, a forged proof attached
      // to a bad-sig envelope would still leave the peers map migrated,
      // defeating the verify rejection.
      if (inlineMigration) {
        this.#peers.set(env._from, inlineMigration.oldPubKey);
      }
      throw new SecurityError(SEC.BAD_SIG, `Invalid signature on envelope ${env._id}`);
    }

    // Signature verified — now safe to tag env with the migration info
    // so Agent._dispatch can mirror the change into PeerGraph.
    if (inlineMigration) env._rotationMigrated = inlineMigration;

    // 5. HI is plaintext — return as verified.
    if (env._p === P.HI) {
      return env;
    }

    // 6. Decrypt payload.
    if (!env.payload?._box) {
      throw new SecurityError(
        SEC.DECRYPT_FAILED,
        `Envelope ${env._id} missing encrypted payload (_box field)`,
      );
    }

    const combined   = b64decode(env.payload._box);
    const nonce      = combined.slice(0, 24);
    const ciphertext = combined.slice(24);

    // Group FF — pick the right self-identity for nacl.box.open:
    //   • If env._to matches current self pubkey, use current.
    //   • If env._to matches a still-in-grace previous self pubkey, use
    //     that previous identity's privkey (peer hadn't received our
    //     rotation broadcast yet, so they encrypted to our old key).
    //   • Otherwise try current as a best-effort — nacl.box.open will
    //     fail cleanly if the recipient doesn't match.
    let unboxIdentity = this.#identity;
    if (env._to && env._to !== this.#identity.pubKey) {
      const hist = this.#selfHistory.get(env._to);
      if (hist && Date.now() < hist.graceUntil) {
        unboxIdentity = hist.identity;
      }
      // Clean up expired entries opportunistically.
      if (hist && Date.now() >= hist.graceUntil) {
        this.#selfHistory.delete(env._to);
      }
    }
    const plaintext  = unboxIdentity.unbox(ciphertext, nonce, senderKey);
    if (plaintext === null) {
      throw new SecurityError(SEC.DECRYPT_FAILED, `nacl.box.open failed on envelope ${env._id}`);
    }

    env.payload = JSON.parse(new TextDecoder().decode(plaintext));
    return env;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Sign an envelope: set _sig to null, sign canonical JSON, store base64url. */
  #sign(env) {
    const unsigned = { ...env, _sig: null };
    const sig      = this.#identity.sign(canonicalize(unsigned));
    return { ...unsigned, _sig: b64encode(sig) };
  }

  /** Remove expired entries from the dedup cache. */
  #cleanDedup() {
    const now = Date.now();
    for (const [id, expires] of this.#dedup) {
      if (expires < now) this.#dedup.delete(id);
    }
  }
}
