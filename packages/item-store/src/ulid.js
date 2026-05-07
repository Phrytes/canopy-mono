/**
 * ULID generator — Crockford-base32 of (48-bit ms timestamp + 80 bits
 * of crypto randomness).  ~26 chars, lexicographically sortable by
 * creation time, collision-resistant.
 *
 * Lifted from apps/household/src/storage/InMemoryStore.js (see
 * pattern-source notes in Project Files/Substrates/L1b-item-store.md).
 *
 * Requires `globalThis.crypto.getRandomValues` — Node ≥19, browsers,
 * and React Native (when react-native-get-random-values is loaded
 * before this module).
 */

// Crockford base32 alphabet — excludes I, L, O, U for human legibility.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Generate a ULID.  Time prefix (10 chars) + randomness (16 chars) = 26 chars total.
 *
 * @returns {string} 26-char ULID
 */
export function ulid() {
  const now = Date.now();
  // Encode 48-bit timestamp into 10 base32 chars, MSB first.
  let timeStr = '';
  let t = now;
  for (let i = 9; i >= 0; i--) {
    timeStr = CROCKFORD[t % 32] + timeStr;
    t = Math.floor(t / 32);
  }
  // 16 chars of randomness ≈ 80 bits.
  const rand = new Uint8Array(16);
  globalThis.crypto.getRandomValues(rand);
  let randStr = '';
  for (let i = 0; i < 16; i++) {
    randStr += CROCKFORD[rand[i] % 32];
  }
  return timeStr + randStr;
}
