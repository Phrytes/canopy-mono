/**
 * hash — the platform-wired SHA-256 `PodSearch` accepts as `args.hash`.
 *
 * PodSearch uses the content hash as the **cache key** for "may I reuse
 * this chunk's vector?" (`#cacheKey` = `${modelId}:${chunkingV}:${hash}`),
 * so it must be:
 *   - deterministic (same text → same hex digest, across restarts), and
 *   - identical on every platform the same index is read on (a web index
 *     reloaded on Node must reconstruct the same keys).
 *
 * One export, `hash(text) => Promise<hexSha256>`, feature-detects its
 * backend at call time so the SAME module works in a browser bundle and
 * on Node WITHOUT a static `node:crypto` import (which a web bundler would
 * try — and fail — to polyfill):
 *
 *   1. **WebCrypto** (`globalThis.crypto.subtle`) — present in browsers,
 *      Deno, and Node ≥ 18. The primary path; covers web-first + modern Node.
 *   2. **node:crypto** — dynamically imported only when WebCrypto is
 *      absent (older Node / odd embeds). Never loaded in the browser.
 *
 * Both paths hash the UTF-8 bytes of `text` and return the lowercase hex
 * digest, so they are byte-identical.
 *
 * ── FOLLOW-UP (not this phase) ──────────────────────────────────────
 * React Native / Expo has NO WebCrypto `subtle` and no `node:crypto`, so
 * neither path here fires on-device. The RN wiring is an `expo-crypto`
 * digest injected via `packages/react-native/platform` (mirrors how
 * `@onderling/sync-engine`'s `createHashRN({ Crypto })` is threaded) — the
 * seam is simply "pass a different `hash` fn into `PodSearch`", so no
 * change here is needed when it lands. Tracked as the pod-search RN pass.
 */

/** Lowercase hex of a byte buffer. */
function toHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

/** Cached `node:crypto.createHash` (resolved once, only if we ever need it). */
let nodeCreateHashPromise = null;
async function nodeSha256(text) {
  if (!nodeCreateHashPromise) {
    nodeCreateHashPromise = import('node:crypto').then((m) => m.createHash);
  }
  const createHash = await nodeCreateHashPromise;
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

/**
 * SHA-256 of `text`, as a lowercase hex string.
 *
 * @param {string} text
 * @returns {Promise<string>} 64-char lowercase hex digest
 */
export async function hash(text) {
  const str = String(text ?? '');
  const subtle = globalThis?.crypto?.subtle;
  if (subtle && typeof subtle.digest === 'function') {
    const data = new TextEncoder().encode(str);
    const buf = await subtle.digest('SHA-256', data);
    return toHex(new Uint8Array(buf));
  }
  // No WebCrypto (older Node / non-browser embed) → node:crypto fallback.
  return nodeSha256(str);
}

export default hash;
