/**
 * Per-write mode picker.
 *
 * Decides between two wire formats for every persistent write:
 *
 *   - 'envelope-only'  — pod-having + reachable. Tiny payload
 *                        ({kind, ref, etag, fromActor, timestamp});
 *                        recipients fetch by ref.
 *   - 'full-payload'   — no-pod crew, OR pod-having writer that's
 *                        currently offline. Whole resource over the
 *                        wire; recipients write it into their local
 *                        pseudo-pod replication ring.
 *
 * Scheme-based rule:
 *
 *   - `pseudo-pod://<deviceId>/<path>` → always full-payload.
 *     There's no pod to point at.
 *   - `https://...` → consult `podRouting.isPodReachable(ref)`:
 *     reachable → envelope-only; unreachable → full-payload + queue
 *     for upload-on-reconnect.
 *
 * The picker is a pure function — it doesn't call publish itself.
 * Callers run it, then act on the decision.
 *
 * See functional design §4.4.5a.
 */

/**
 * @typedef {object} ModeDecision
 * @property {'envelope-only'|'full-payload'} mode
 * @property {boolean} queue                — if true, also enqueue for later pod upload
 * @property {string}  reason               — short tag for telemetry / debug
 */

/**
 * @param {object} args
 * @param {string} args.ref
 * @param {{ isPodReachable: (uri: string) => boolean }} args.podRouting
 * @returns {ModeDecision}
 */
export function pickMode({ ref, podRouting } = {}) {
  if (typeof ref !== 'string' || ref.length === 0) {
    throw Object.assign(
      new Error('pickMode: ref is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (!podRouting || typeof podRouting.isPodReachable !== 'function') {
    throw Object.assign(
      new Error('pickMode: podRouting.isPodReachable is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

  if (ref.startsWith('pseudo-pod://')) {
    return { mode: 'full-payload', queue: false, reason: 'pseudo-pod-ref' };
  }
  // Treat anything non-pseudo-pod as a pod-attached ref. https:// is the
  // canonical case; future schemes (e.g. ipfs://) can be added here.
  if (podRouting.isPodReachable(ref)) {
    return { mode: 'envelope-only', queue: false, reason: 'pod-reachable' };
  }
  return { mode: 'full-payload', queue: true, reason: 'pod-unreachable-fallback' };
}
