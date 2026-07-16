/**
 * circleVersioning — per-circle pod version history (web).
 *
 * P3 of PLAN-pod-versioning-history-recovery: gives each circle's
 * pseudo-pod a `@onderling/versioning` store so DISPLACED bytes (overwrites ·
 * peer-updates · dropped concurrent forks · deletes) land in history
 * instead of vanishing — the substrate under the my-data
 * "restore corrupted / lost data" ops.
 *
 * One store per circle, sharing the circle pod's OWN backend (version keys
 * under `versions/`, disjoint from live `pseudo-pod://` keys, so history
 * rides the same IndexedDB persistence the circle already has) with
 * `writerId = the circle pod's deviceId` (multi-writer-safe keys).
 *
 * Web-scoped: hashes via `globalThis.crypto.subtle` (browser + modern Node
 * for tests). The mobile twin injects an RN-appropriate hash instead —
 * do NOT import this module from RN code.
 */

import { createVersionStore } from '@onderling/versioning';

/** async sha256 → hex over string | Uint8Array | JSON-able value (pod `bytes` are opaque). */
export async function webSha256(content) {
  const data = typeof content === 'string'
    ? new TextEncoder().encode(content)
    : content instanceof Uint8Array
      ? content
      : new TextEncoder().encode(JSON.stringify(content) ?? 'undefined');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** circleId → version store (build-once; module-scoped like circleApp's other per-circle caches). */
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
      hash: webSha256,
      writerId: deviceId,
      // Live hooks for UNDOABLE restore: the pseudo-pod's backend key IS
      // the uri (identity mapping), so the live resource is addressable
      // directly. readLive feeds the pre-restore snapshot; writeLive puts
      // the restored content back (backend.put bumps _v, so subscribers
      // see the change; the store itself already snapshotted the current
      // state, so no double-capture).
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
