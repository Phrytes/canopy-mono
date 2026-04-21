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
import { encode as b64encode, decode as b64decode }  from '../crypto/b64.js';

const REPLAY_WINDOW_MS = 10 * 60 * 1_000;  // ±10 minutes (tolerates LAN clock drift)
const DEDUP_TTL_MS     = 10 * 60 * 1_000;  // match replay window

// ── Error ──────────────────────────────────────────────────────────────────

export const SEC = Object.freeze({
  MISSING_SIG:       'MISSING_SIG',
  REPLAY_WINDOW:     'REPLAY_WINDOW',
  DUPLICATE:         'DUPLICATE',
  UNKNOWN_RECIPIENT: 'UNKNOWN_RECIPIENT',
  UNKNOWN_SENDER:    'UNKNOWN_SENDER',
  BAD_SIG:           'BAD_SIG',
  DECRYPT_FAILED:    'DECRYPT_FAILED',
});

export class SecurityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SecurityError';
    this.code = code;
  }
}

// ── SecurityLayer ──────────────────────────────────────────────────────────

export class SecurityLayer {
  /** @type {import('../identity/AgentIdentity.js').AgentIdentity} */
  #identity;
  /** @type {Map<string, string>} address → Ed25519 pubKey (base64url) */
  #peers = new Map();
  /** @type {Map<string, number>} _id → expiresAt (ms) */
  #dedup = new Map();

  /**
   * @param {object} opts
   * @param {import('../identity/AgentIdentity.js').AgentIdentity} opts.identity
   */
  constructor({ identity }) {
    this.#identity = identity;
    // Auto-register self so outbound HI sigs are verifiable in loopback tests.
    this.#peers.set(identity.pubKey, identity.pubKey);
  }

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
      throw new SecurityError(SEC.BAD_SIG, `Invalid signature on envelope ${env._id}`);
    }

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

    const plaintext  = this.#identity.unbox(ciphertext, nonce, senderKey);
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
