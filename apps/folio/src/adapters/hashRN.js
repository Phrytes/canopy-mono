/**
 * hashRN — `HashAdapter` backed by `expo-crypto`.
 *
 * Uses `Crypto.digestStringAsync(SHA256, input, { encoding: 'hex' })`.
 *
 * Like `fsRN`, the Expo namespace is injected explicitly rather than
 * imported at module load — `expo-crypto` is a peer dependency, and a
 * top-level import would crash the CLI/web build when the package is
 * not installed.
 *
 * Input handling
 * --------------
 * `expo-crypto.digestStringAsync` only accepts a string.  For binary
 * input (Uint8Array / Buffer), the adapter base64-encodes the bytes and
 * hashes them as a Base64 string — `expo-crypto` supports a
 * `CryptoEncoding.BASE64` encoding option for the source format, so the
 * digest is computed over the raw bytes (NOT over the base64 text).
 */

/**
 * @param {object} args
 * @param {object} args.Crypto
 *   A namespace import of `expo-crypto`.  Required surface:
 *     `digestStringAsync(algorithm, data, opts) → Promise<string>`
 *     `CryptoDigestAlgorithm: { SHA256, ... }`
 *     `CryptoEncoding: { UTF8, BASE64, HEX }` (constants vary by SDK
 *      version; we fall back to string literals so older mocks work)
 *
 * @returns {import('./index.js').HashAdapter}
 */
export function createHashRN({ Crypto }) {
  if (!Crypto) {
    throw new Error('createHashRN: Crypto namespace is required (pass `import * as Crypto from "expo-crypto"`)');
  }

  const ALGO = Crypto.CryptoDigestAlgorithm?.SHA256 ?? 'SHA-256';
  const ENC_UTF8   = Crypto.CryptoEncoding?.UTF8   ?? 'utf8';
  const ENC_BASE64 = Crypto.CryptoEncoding?.BASE64 ?? 'base64';

  return {
    async sha256(input) {
      if (input == null) {
        return Crypto.digestStringAsync(ALGO, '', { encoding: ENC_UTF8 });
      }
      if (typeof input === 'string') {
        return Crypto.digestStringAsync(ALGO, input, { encoding: ENC_UTF8 });
      }
      // Bytes path — base64 encode and tell `expo-crypto` to interpret
      // the source as base64 so the digest covers the raw bytes.
      const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
      const b64 = buf.toString('base64');
      return Crypto.digestStringAsync(ALGO, b64, { encoding: ENC_BASE64 });
    },
  };
}
