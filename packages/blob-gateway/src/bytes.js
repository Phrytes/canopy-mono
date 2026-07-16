// bytes.js — portable Uint8Array <-> base64url helpers (no Buffer; web-first).
//
// The sealing envelope (`@onderling/pod-client/sealing`) seals *strings*, so a binary
// blob is carried through it as a base64url string: bytes -> b64u -> seal -> ciphertext
// (itself ascii), and on the way back ciphertext -> open -> b64u -> bytes. The bucket
// therefore only ever holds the sealed ascii envelope, never plaintext bytes.

const te = new TextEncoder();
const td = new TextDecoder();

export function bytesToB64u(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uToBytes(s) {
  const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/** UTF-8 encode/decode for the sealed ascii envelope stored in the bucket. */
export const encodeText = (s) => te.encode(s);
export const decodeText = (u8) => td.decode(u8);

/** A random opaque bucket key (b64url, 128-bit). Random — never content-derived —
 *  so the untrusted host can't learn plaintext equality across uploads. */
export function randomKey() {
  const u8 = new Uint8Array(16);
  (globalThis.crypto || require('node:crypto').webcrypto).getRandomValues(u8);
  return bytesToB64u(u8);
}
