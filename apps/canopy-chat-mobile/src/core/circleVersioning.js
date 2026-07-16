/**
 * circleVersioning — per-circle pod version history (mobile).
 *
 * P3 of PLAN-pod-versioning-history-recovery: gives each circle's
 * pseudo-pod a `@onderling/versioning` store so DISPLACED bytes (overwrites ·
 * peer-updates · dropped concurrent forks · deletes) land in history
 * instead of vanishing — the substrate under the my-data
 * "restore corrupted / lost data" ops.
 *
 * One store per circle, sharing the circle pod's OWN backend (version keys
 * under `versions/`, disjoint from live `pseudo-pod://` keys, so history
 * rides the same AsyncStorage persistence the circle already has) with
 * `writerId = the circle pod's deviceId` (multi-writer-safe keys).
 *
 * RN-scoped: Hermes has no reliable `crypto.subtle`, so `rnSha256` hashes
 * via `expo-crypto` — the repo's established RN sha256 (the
 * `@onderling/sync-engine/adapters/hashRN.js` pattern; expo-crypto is already
 * an app dep + pinned in metro.config.js). Like that adapter, expo-crypto
 * is never imported at module load (the native module would crash Node);
 * it's loaded lazily on first hash. Fallback order:
 *   1. expo-crypto (device/Hermes): `digestStringAsync` for strings (hex
 *      out — hashRN's string path), `Crypto.digest(SHA256, bytes)` for raw
 *      bytes (BufferSource → ArrayBuffer; no Buffer/base64 detour — Hermes
 *      has no Buffer, and `CryptoEncoding` is output-format only).
 *   2. `globalThis.crypto.subtle` (vitest's Node ≥ 20 + Expo web, where
 *      the native module can't load) — the exact hash web's twin uses.
 * Both paths produce the same node:crypto-compatible hex sha256.
 *
 * The web twin is `apps/canopy-chat/src/web/circleVersioning.js` — do NOT
 * import this module from web code.
 */

import { createVersionStore } from '@onderling/versioning';

/** Lazy expo-crypto namespace: resolves null where the native module can't load (Node/web). */
let _expoCryptoPromise = null;
function loadExpoCrypto() {
  if (!_expoCryptoPromise) {
    _expoCryptoPromise = import('expo-crypto').then(
      (m) => (typeof m?.digestStringAsync === 'function' ? m : null),
      () => null,
    );
  }
  return _expoCryptoPromise;
}

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** async sha256 → hex over string | Uint8Array | JSON-able value (pod `bytes` are opaque). */
export async function rnSha256(content) {
  // Same normalisation as web's webSha256: strings + bytes hash as-is,
  // anything else hashes its JSON form.
  const data = typeof content === 'string' || content instanceof Uint8Array
    ? content
    : (JSON.stringify(content) ?? 'undefined');
  const Crypto = await loadExpoCrypto();
  if (Crypto) {
    const ALGO = Crypto.CryptoDigestAlgorithm?.SHA256 ?? 'SHA-256';
    if (typeof data === 'string') {
      return Crypto.digestStringAsync(ALGO, data, { encoding: Crypto.CryptoEncoding?.HEX ?? 'hex' });
    }
    const digest = await Crypto.digest(ALGO, data);
    return toHex(new Uint8Array(digest));
  }
  // Fallback — identical to web's webSha256 (Node ≥ 20 vitest, Expo web).
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return toHex(new Uint8Array(digest));
}

/** circleId → version store (build-once; module-scoped like circlePods' other per-circle caches). */
const storesByCircle = new Map();

/**
 * Build-or-get the version store for one circle. Called from the circle
 * pod construction site so the SAME backend instance is shared.
 *
 * @param {string} circleId
 * @param {string} deviceId — the circle pod's deviceId (becomes writerId)
 * @param {object} backend  — the circle pod's StorageBackend
 */
export function circleVersioningFor(circleId, deviceId, backend) {
  let store = storesByCircle.get(circleId);
  if (!store) {
    store = createVersionStore({
      backend,
      hash: rnSha256,
      writerId: deviceId,
      // Live hooks for UNDOABLE restore (same as the web twin): the
      // pseudo-pod's backend key IS the uri, so the live resource is
      // addressable directly. readLive feeds the pre-restore snapshot;
      // writeLive puts the restored content back (backend.put bumps _v,
      // so subscribers see the change; no double-capture).
      readLive:  async (uri) => (await backend.get(uri))?.bytes,
      writeLive: async (uri, content) => { await backend.put(uri, content); },
    });
    storesByCircle.set(circleId, store);
  }
  return store;
}

/** Resolve a circle's version store (null when its pod was never built). */
export function getCircleVersionStore(circleId) {
  return storesByCircle.get(circleId) ?? null;
}

/** Test hook — drop all per-circle stores. */
export function _resetCircleVersionStores() {
  storesByCircle.clear();
}
