/**
 * recogniseEnvelopeShape — pure detector.
 *
 * Phase 52.9.1: distinguish notify-envelope wire shapes
 * (`{kind, ref, …}`) from chat-shaped builder outputs
 * (`{text, buttons?, meta?}`). Apps that want their scheduled
 * jobs to surface ref-with-payload notifications can build
 * envelope-shaped payloads; the bridge helper routes them
 * through `@canopy/notify-envelope` instead of a channel.
 *
 * Pure function; no I/O. Doesn't throw.
 */

/**
 * @param {*} payload
 * @returns {boolean} true when the payload looks like a notify-envelope
 *                    wire (has at least `kind: string` and `ref: string`).
 */
export function recogniseEnvelopeShape(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (typeof payload.kind !== 'string' || payload.kind.length === 0) return false;
  if (typeof payload.ref  !== 'string' || payload.ref.length === 0)  return false;
  return true;
}
