/**
 * canopy-chat v2 — the LIVE sealed-media composition for a circle (media P1
 * wiring; plans/NOTE-media-and-streaming.md "no live composition point" gap).
 *
 * `createMediaEmbed` (src/core/handlers/mediaEmbed.js) owns NO infra — it
 * needs an injected `mediaGateway {bucket, sealer, opener?, keyRef?}`. Until
 * now only test harnesses composed one. This module builds that gateway for
 * the ACTIVE circle from the circle's own seal strategy, so the v2 web shell
 * (and later the mobile shell — this module is platform-neutral, no DOM) can
 * offer a real attach affordance:
 *
 *   circle seal strategy ({seal, open}, getCircleSealStrategy)
 *        └─▶ { sealer, opener }               (content sealed with the circle's key)
 *   injected bucket (dev default below)
 *        └─▶ { bucket }                        (ciphertext-only object store)
 *   createBlobGatekeeper + a local-session verifier/ACL
 *        └─▶ { gate, token }                   (deny-by-default full-image reads)
 *
 * SEALED-ONLY stands: a circle with NO content seal strategy (p0/p1 posture,
 * or the strategy failed to resolve) composes to `null` — the caller hides
 * the attach affordance instead of falling back to an unsealed upload.
 *
 * ── What is DEV-GRADE here vs real ────────────────────────────────────────
 * The default bucket (`makeDevMediaBucket`) is an IN-MEMORY, per-session
 * object store: uploads do not survive a reload and never leave this device.
 * It exists so the sealed path is user-reachable and demoable NOW. The seal
 * strategy, the upload/refuse-plaintext invariants, and the deny-by-default
 * gate are the REAL contracts. The recorded swap point for live infra:
 *   • bucket      → `@canopy/blob-gateway/adapters/s3`   (createS3Bucket, S3/R2)
 *   • verifyToken → `@canopy/blob-gateway/adapters/solid-verifier`
 *   • acl         → `@canopy/blob-gateway/adapters/pod-acl`
 *   • HTTP edge   → `@canopy/blob-gateway/http` (createHttpGate)
 * Only the `bucket`/`gate`/`token` seams change; the gateway shape — and so
 * the handler, the message pointer, and the chip — stay byte-identical.
 */

import { createBlobGatekeeper, openBlob } from '@canopy/blob-gateway';

/**
 * DEV-GRADE in-memory bucket (same injected contract blob-gateway's own test
 * rig models: put / presign / delete + a fetchPresigned resolver standing in
 * for "the presigned URL grants access to the ciphertext"). One instance per
 * app session; holds ONLY sealing envelopes (uploadBlob refuses plaintext).
 */
export function makeDevMediaBucket() {
  const store = new Map();      // key → sealed envelope (ciphertext)
  const presigns = new Map();   // url → { key, expiresAt }
  let n = 0;
  return {
    store,
    async put(key, bytes) { store.set(key, bytes); },
    async presign(key, { ttl } = {}) {
      if (!store.has(key)) return null;
      const url = `dev-bucket://presigned/${key}?sig=${(n += 1)}`;
      presigns.set(url, { key, expiresAt: Date.now() + (ttl ?? 60) * 1000 });
      return url;
    },
    async delete(key) { store.delete(key); },
    /** Resolve a presigned URL back to the stored ciphertext (the dev stand-in
     *  for HTTP-fetching a real presigned bucket URL). */
    async fetchPresigned(url) {
      const rec = presigns.get(url);
      if (!rec || Date.now() > rec.expiresAt) return null;
      return store.get(rec.key);
    },
  };
}

/**
 * Compose the sealed-media gateway for ONE circle, or `null` when the circle
 * has no content seal strategy (p0/p1 / unresolved) — sealed-only, no
 * unsealed fallback.
 *
 * The gate is REAL even though the identity plumbing is session-local: a
 * random per-composition token maps to `localActor`, and the ACL grants
 * exactly the refs uploaded THROUGH this composition to that actor. Every
 * other (token, ref) pair is denied — deny-by-default is preserved, and the
 * swap to the Solid verifier + pod ACL changes the seams, not the contract.
 *
 * @param {object} a
 * @param {string}   a.circleId
 * @param {() => Promise<{seal:Function, open:Function}|null>} a.getSealStrategy
 *   the circle's content strategy resolver (web: `() => getCircleSealStrategy(id, policy)`)
 * @param {string}   a.localActor   the local user's actor id (ACL subject + item issuer)
 * @param {object}   a.bucket       injected bucket (dev default: `makeDevMediaBucket()`)
 * @param {number}   [a.ttl]        presign TTL seconds for the gate
 * @returns {Promise<null | {
 *   circleId: string,
 *   mediaGateway: {bucket:object, sealer:Function, opener:Function, keyRef:string, gate:Function, token:string},
 *   openFullImage: (line: object|string) => Promise<{bytes:Uint8Array, media:object|null}>,
 * }>}
 */
export async function createCircleMediaGateway({
  circleId, getSealStrategy, localActor, bucket, ttl = 60,
} = {}) {
  if (!circleId || !bucket || typeof getSealStrategy !== 'function') return null;
  let strategy = null;
  try { strategy = await getSealStrategy(); } catch { strategy = null; }
  if (!strategy || typeof strategy.seal !== 'function' || typeof strategy.open !== 'function') {
    return null;   // p0/p1 (or unresolved) → NO sealed path; the affordance stays hidden
  }

  // Session-local identity + ACL for the deny-by-default gate (dev slice of
  // the Solid-verifier + pod-ACL pair; see module doc for the swap point).
  const token = `dev-media-${Math.random().toString(36).slice(2, 10)}`;
  const verifyToken = async (tk) => (tk === token ? { webId: localActor } : null);
  const granted = new Set();   // blob refs uploaded through THIS composition
  const acl = {
    async canRead(webId, ref) { return webId === localActor && granted.has(ref); },
  };
  // Grant-on-upload: every blob put through this gateway becomes readable by
  // the uploader (and nobody else). uploadBlob's key IS the ref authority.
  const uploadingBucket = {
    ...bucket,
    put: async (key, bytes) => { await bucket.put(key, bytes); granted.add(`blob://${key}`); },
  };
  const gate = createBlobGatekeeper({ verifyToken, acl, bucket, ttl });

  return {
    circleId,
    mediaGateway: {
      bucket: uploadingBucket,
      sealer: strategy.seal,
      opener: strategy.open,
      keyRef: `urn:circle:${circleId}:content-key`,
      gate,
      token,
    },
    /** Full-size read of a manifest line, THROUGH the gate (denials throw). */
    openFullImage: (line) => openBlob({
      ref: line, gate, token, opener: strategy.open,
      fetch: typeof bucket.fetchPresigned === 'function' ? bucket.fetchPresigned : undefined,
    }),
  };
}
