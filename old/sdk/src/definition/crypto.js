/**
 * Symmetric encryption helpers (AES-256-GCM + PBKDF2).
 *
 * All encrypted values are stored as a single base64 string:
 *   base64( salt[16] | iv[12] | authTag[16] | ciphertext )
 *
 * Key derivation is intentionally slow (100k PBKDF2 iterations) to resist
 * brute-force attacks on the master password.
 *
 * Future: swap this module for an asymmetric implementation (per-agent
 * keypairs) without changing the definition file format — just replace
 * encrypt()/decrypt() and the stored blob shape.
 */

import crypto from 'crypto';

const ALGORITHM   = 'aes-256-gcm';
const KEY_LEN     = 32;          // 256 bits
const SALT_LEN    = 16;
const IV_LEN      = 12;
const TAG_LEN     = 16;
const PBKDF2_ITER = 100_000;
const PBKDF2_DIG  = 'sha256';

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITER, KEY_LEN, PBKDF2_DIG);
}

export function encrypt(plaintext, masterKey) {
  const salt   = crypto.randomBytes(SALT_LEN);
  const iv     = crypto.randomBytes(IV_LEN);
  const key    = deriveKey(masterKey, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LEN });
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();

  return Buffer.concat([salt, iv, tag, enc]).toString('base64');
}

export function decrypt(blob, masterKey) {
  const buf  = Buffer.from(blob, 'base64');
  const salt = buf.subarray(0, SALT_LEN);
  const iv   = buf.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag  = buf.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const enc  = buf.subarray(SALT_LEN + IV_LEN + TAG_LEN);
  const key  = deriveKey(masterKey, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LEN });
  decipher.setAuthTag(tag);
  return decipher.update(enc) + decipher.final('utf8');
}
