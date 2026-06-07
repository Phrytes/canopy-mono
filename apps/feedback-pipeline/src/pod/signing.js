// signing.js — participant signatures over contributions (PR-3, plan security gap #1).
//
// Sealing (project-seal.js) gives confidentiality but NOT authenticity: anyone with the
// project PUBLIC key can write a sealed contribution, so a malicious host/writer could
// inject or sybil contributions and skew aggregation / inflate the k-count. The fix is a
// participant SIGNATURE bound to a verified membership: one redeemed code → one identity →
// its contributions, and nothing else counts.
//
// Wire-compatible with the canopy substrate (packages/core AgentIdentity): Ed25519, public
// keys as b64url of the raw 32-byte key, seed-based private keys. So a real participant agent
// (tweetnacl Ed25519) and this verifier interoperate — but built on node:crypto only, so the
// app stays dependency-free and testable standalone (the substrate is injected, never imported).

import { generateKeyPairSync, sign as edSign, verify as edVerify, createPublicKey, createPrivateKey } from 'node:crypto';
import { generateProjectKeypair } from './project-seal.js';

const b64u = (b) => Buffer.from(b).toString('base64url');

const pubFromRaw = (xB64u) => createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: xB64u }, format: 'jwk' });
const privFromRaw = (xB64u, dB64u) => createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', x: xB64u, d: dB64u }, format: 'jwk' });

/** A participant identity: an Ed25519 SIGNING keypair (b64url raw, substrate `pubKey` format)
 *  + an X25519 ENCRYPTION keypair for receiving sealed two-way notifications — exactly the
 *  sign+box split a real AgentIdentity has (which derives box from sign via ed2curve; we keep
 *  them separate so the app stays dependency-free). */
export function generateParticipantIdentity() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'jwk' }).x;          // b64url raw 32-byte public key
  const seed = privateKey.export({ format: 'jwk' }).d;        // b64url raw seed
  const enc = generateProjectKeypair();                       // X25519 keypair for sealed notify
  return {
    publicKey: pub, privateKey: `${pub}.${seed}`,             // private bundles pub so signing needs one string
    encPublicKey: enc.publicKey, encPrivateKey: enc.privateKey,
  };
}

/** Canonical bytes that get signed: the contribution bound to WHO and WHICH project, so a
 *  signature cannot be replayed under another pseudonym or into another project. */
export function canonicalContribution({ projectId, participant, contribution }) {
  const c = contribution;
  return Buffer.from(JSON.stringify([
    'fp-contribution/1', projectId, participant,
    c.id, c.text, c.themeTags ?? [], c.timeWindow ?? null, c.lang ?? null,
  ]), 'utf8');
}

/** Sign a contribution with a participant private key (`pub.seed`). Returns a b64url signature. */
export function signContribution({ projectId, participant, contribution }, privateKey) {
  const [pub, seed] = String(privateKey).split('.');
  if (!pub || !seed) throw new Error('signContribution: private key must be "<pub>.<seed>"');
  return b64u(edSign(null, canonicalContribution({ projectId, participant, contribution }), privFromRaw(pub, seed)));
}

/** Verify a signature against a public key. Pure crypto check (no membership binding). */
export function verifyContribution({ projectId, participant, contribution }, signatureB64u, publicKey) {
  try {
    return edVerify(null, canonicalContribution({ projectId, participant, contribution }),
      pubFromRaw(publicKey), Buffer.from(signatureB64u, 'base64url'));
  } catch { return false; }
}

// ── Registration (the HI handshake) ────────────────────────────────────────────
// A participant proves key ownership by self-signing a registration that binds their public
// key to a specific activation code. Folded into activation so redemption (membership, single
// use) and key binding happen ATOMICALLY → one code → one identity (anti-sybil). Mirrors the
// substrate's `HI` pattern (signed plaintext carrying the sender's pubKey).

/** Canonical bytes a participant self-signs to register: binds the signing pubKey AND the
 *  encryption key ↔ code ↔ project (so neither key can be swapped after the fact). */
export function canonicalRegistration({ projectId, code, pubKey, encPubKey }) {
  return Buffer.from(JSON.stringify(['fp-registration/1', projectId, code, pubKey, encPubKey ?? null]), 'utf8');
}

/** Self-sign a registration with the participant's private key (`pub.seed`). */
export function signRegistration({ projectId, code, pubKey, encPubKey }, privateKey) {
  const [pub, seed] = String(privateKey).split('.');
  if (!pub || !seed) throw new Error('signRegistration: private key must be "<pub>.<seed>"');
  if (pubKey && pubKey !== pub) throw new Error('signRegistration: pubKey does not match the private key');
  return b64u(edSign(null, canonicalRegistration({ projectId, code, pubKey: pub, encPubKey }), privFromRaw(pub, seed)));
}

/** Verify a registration is self-signed by the key it claims (proof of key ownership). */
export function verifyRegistration({ projectId, code, pubKey, encPubKey }, signatureB64u) {
  if (!pubKey || !signatureB64u) return false;
  try {
    return edVerify(null, canonicalRegistration({ projectId, code, pubKey, encPubKey }),
      pubFromRaw(pubKey), Buffer.from(signatureB64u, 'base64url'));
  } catch { return false; }
}

/** Roster: pseudonym → the ONE signing public key bound to it at activation. This is the
 *  data product of the membership handshake (one redeemed code → one identity). Backed by a
 *  Map here; a live deployment persists it in the project's activation pod. */
export class IdentityRoster {
  #byParticipant = new Map();   // participant -> { sign, enc }

  /** Bind a participant pseudonym to its signing key (+ optional encryption key for sealed
   *  notify). Idempotent for the same signing key; rejects a second, different signing key
   *  for the same pseudonym → no key swapping. */
  bind(participant, publicKey, encPublicKey) {
    const existing = this.#byParticipant.get(participant);
    if (existing && existing.sign !== publicKey) throw new Error(`participant ${participant} already bound to a different key`);
    this.#byParticipant.set(participant, { sign: publicKey, enc: encPublicKey ?? existing?.enc ?? null });
    return publicKey;
  }

  keyFor(participant) { return this.#byParticipant.get(participant)?.sign || null; }
  encKeyFor(participant) { return this.#byParticipant.get(participant)?.enc || null; }
  has(participant) { return this.#byParticipant.has(participant); }
  toJSON() { return Object.fromEntries(this.#byParticipant); }
  static fromJSON(obj) {
    const r = new IdentityRoster();
    for (const [p, v] of Object.entries(obj || {})) {
      if (typeof v === 'string') r.bind(p, v);                 // legacy {participant: signKey}
      else r.bind(p, v.sign, v.enc);
    }
    return r;
  }
}

/**
 * Build the verifier the central pod injects. It enforces BOTH:
 *   1. authenticity — the signature is valid over (projectId, participant, contribution);
 *   2. membership/anti-sybil — the signing key is the one bound to this pseudonym in the
 *      roster (so an unregistered or swapped key is rejected, and one code → one identity).
 * @returns {(participant, contribution, meta:{sig, pubKey}) => void}  throws on failure
 */
export function makeContributionVerifier({ roster, projectId }) {
  if (!roster || !projectId) throw new Error('makeContributionVerifier: roster and projectId required');
  return (participant, contribution, meta = {}) => {
    const { sig, pubKey } = meta;
    if (!sig || !pubKey) throw new Error('contribution is unsigned (signature + pubKey required)');
    const bound = roster.keyFor(participant);
    if (!bound) throw new Error(`participant ${participant} is not a verified member`);
    if (bound !== pubKey) throw new Error('signing key does not match the participant\'s registered key');
    if (!verifyContribution({ projectId, participant, contribution }, sig, pubKey)) throw new Error('invalid signature');
  };
}
