// project-seal.js — at-rest sealing of contribution content to a project key.
//
// PR-1 gap-fill. The substrate's SecurityLayer (packages/core) is peer-to-peer —
// nacl.box between two REGISTERED agents — so it does not cover "seal to a project
// public key" at rest (anonymous writer, no peer handshake). That is the thin layer
// scoped by the plan, built on node:crypto only (no new deps):
//   • AES-256-GCM — the same cipher packages/vault/VaultNodeFs uses (house choice);
//   • X25519     — the Curve25519 family the substrate already standardises on, so the
//                  PR-3 Ed25519 signing/handshake sits on sibling keys.
//
// Construction: a hybrid sealed-box. A fresh random content key (CEK) encrypts the
// plaintext (AES-256-GCM); the CEK is then wrapped to each recipient via an ephemeral
// X25519 ECDH → HKDF-SHA256 → AES-256-GCM. The writer needs ONLY public keys, so the
// always-on writer never holds a private key (architecture §1.1 / §1.5): anyone can
// seal, only a holder of a recipient private key can open. Wrapping to N recipients
// stores the one CEK N times — used single-recipient (the project key) per contribution
// here, and reused multi-recipient to wrap the project PRIVATE key to a team elsewhere.

import {
  generateKeyPairSync, createPublicKey, createPrivateKey,
  diffieHellman, hkdfSync, randomBytes, createCipheriv, createDecipheriv,
  createHash,
} from 'node:crypto';

const SENTINEL = 'fp1:';
const ALG = 'aes-256-gcm';            // matches packages/vault/VaultNodeFs
const INFO = Buffer.from('fp1-kek');  // HKDF context

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(s, 'base64url');

const pubDer = (publicKey) => publicKey.export({ type: 'spki', format: 'der' });
const importPub = (b64) => createPublicKey({ key: unb64u(b64), format: 'der', type: 'spki' });
const importPriv = (b64) => createPrivateKey({ key: unb64u(b64), format: 'der', type: 'pkcs8' });

/** Stable short id for a recipient public key (b64url SPKI) — the slot label in an envelope. */
export function recipientId(publicKeyB64) {
  return b64u(createHash('sha256').update(unb64u(publicKeyB64)).digest().subarray(0, 8));
}

/** Generate a project (or recipient) X25519 keypair as b64url DER strings. The keygen
 *  LOCATION (client / external / host) is a menukaart choice about WHO calls this — the
 *  function is identical; only the holder of `privateKey` changes. */
export function generateProjectKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const pub = b64u(pubDer(publicKey));
  return {
    publicKey: pub,
    privateKey: b64u(privateKey.export({ type: 'pkcs8', format: 'der' })),
    recipientId: recipientId(pub),
  };
}

/** True if a stored text is a sealed envelope. */
export function isSealed(text) { return typeof text === 'string' && text.startsWith(SENTINEL); }

function aesEncrypt(key, plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv: b64u(iv), ct: b64u(ct), tag: b64u(cipher.getAuthTag()) };
}

function aesDecrypt(key, { iv, ct, tag }) {
  const decipher = createDecipheriv(ALG, key, unb64u(iv));
  decipher.setAuthTag(unb64u(tag));
  return Buffer.concat([decipher.update(unb64u(ct)), decipher.final()]);
}

/** Seal a string to one or more recipient public keys (b64url SPKI). Needs ONLY public keys. */
export function seal(plaintext, recipients) {
  const recips = (Array.isArray(recipients) ? recipients : [recipients]).filter(Boolean);
  if (recips.length === 0) throw new Error('seal: at least one recipient public key required');
  const cek = randomBytes(32);
  const body = aesEncrypt(cek, Buffer.from(String(plaintext), 'utf8'));
  const eph = generateKeyPairSync('x25519');
  const epkRaw = pubDer(eph.publicKey);
  const wrapped = recips.map((pubB64) => {
    const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: importPub(pubB64) });
    const kek = Buffer.from(hkdfSync('sha256', shared, epkRaw, INFO, 32));
    return { rid: recipientId(pubB64), ...aesEncrypt(kek, cek) };
  });
  const env = { v: 1, epk: b64u(epkRaw), body, recips: wrapped };
  return SENTINEL + b64u(Buffer.from(JSON.stringify(env), 'utf8'));
}

/** Open a sealed string with a recipient private key (b64url PKCS8). Plaintext passes
 *  through unchanged (tolerates mixed / pre-seal data). Throws if this key is not a
 *  recipient — so a non-recipient (the host, another team) genuinely cannot read. */
export function open(sealedText, privateKeyB64) {
  if (!isSealed(sealedText)) return sealedText;
  const env = JSON.parse(unb64u(sealedText.slice(SENTINEL.length)).toString('utf8'));
  if (env.v !== 1) throw new Error(`project-seal: unknown envelope version ${env.v}`);
  const priv = importPriv(privateKeyB64);
  const myRid = recipientId(b64u(pubDer(createPublicKey(priv))));
  const slot = env.recips.find((r) => r.rid === myRid);
  if (!slot) throw new Error('project-seal: not a recipient of this sealed contribution');
  const shared = diffieHellman({ privateKey: priv, publicKey: importPub(env.epk) });
  const kek = Buffer.from(hkdfSync('sha256', shared, unb64u(env.epk), INFO, 32));
  const cek = aesDecrypt(kek, slot);
  return aesDecrypt(cek, env.body).toString('utf8');
}

/** Closures the central pod injects. The sealer holds only public keys (host-blind
 *  writer); the opener holds a private key (the keyless aggregation job, after unwrap). */
export function makeSealer(recipients) { return (text) => seal(text, recipients); }
export function makeOpener(privateKeyB64) { return (text) => open(text, privateKeyB64); }
