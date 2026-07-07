/**
 * photoPresets — Tasks-mobile's presets for the substrate's
 * `pickAndResize({mode, preset, max})` helper.
 *
 * Phase 41.5.4 (2026-05-09).
 *
 * Lifted-pattern: the substrate ships generic DELIVERABLE_PRESET +
 * AVATAR_PRESET (Phase 41.0 L3); Tasks-mobile passes its own here so
 * the desktop's web-side resize numbers stay consistent (1280px JPEG
 * q=0.82 — matches `apps/tasks-v0/web/lib/imageResize.js`).
 */

/** Deliverable photos — 1280px JPEG, 120px thumbnail. */
export const DELIVERABLE_PRESET = Object.freeze({
  maxEdgePx:    1280,
  thumbEdgePx:  120,
  quality:      0.82,
  thumbQuality: 0.7,
});

/** Avatar — 256px square; thumbnail = the avatar itself. */
export const AVATAR_PRESET = Object.freeze({
  maxEdgePx:    256,
  thumbEdgePx:  64,
  quality:      0.85,
  thumbQuality: 0.7,
});

/**
 * Per-task deliverable storage path. Anchors the photo under the
 * crew's local-store namespace so isolation is automatic.
 */
export function deliverableRef({ circleId, taskId, photoId }) {
  if (typeof circleId !== 'string' || !circleId) throw new TypeError('deliverableRef: circleId required');
  if (typeof taskId !== 'string' || !taskId) throw new TypeError('deliverableRef: taskId required');
  if (typeof photoId !== 'string' || !photoId) throw new TypeError('deliverableRef: photoId required');
  return `mem://tasks/crews/${circleId}/deliverables/${taskId}/${photoId}.jpg`;
}

/**
 * Generate a short photoId (8 chars). Tests inject a stable rng if
 * they need deterministic ids.
 */
export function photoId(rng = Math.random) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += alphabet[Math.floor(rng() * alphabet.length)];
  }
  return out;
}
