/**
 * audience — pure helpers for the AudiencePicker / PostCompose
 * audience-target list. Lives outside the JSX file so vitest can
 * import without JSX-in-`.js` tricks.
 *
 * Stoop's `targetResolver.js` accepts targets in two shapes:
 *   - `{kind: 'group',   groupId: string}`
 *   - `{kind: 'contact', webid:   string}`
 */

/**
 * Stable comparator: two targets refer to the same row.
 *
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
export function targetsEqual(a, b) {
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'group')   return a.groupId === b.groupId;
  if (a.kind === 'contact') return (a.webid ?? a.stableId) === (b.webid ?? b.stableId);
  return false;
}

/**
 * @param {Array<object>} targets
 * @param {object} target
 */
export function isTargetSelected(targets, target) {
  if (!Array.isArray(targets)) return false;
  return targets.some((t) => targetsEqual(t, target));
}

/**
 * @param {Array<object>} targets
 * @param {object} target
 * @returns {Array<object>}   new array (immutable update)
 */
export function toggleTarget(targets, target) {
  const arr = Array.isArray(targets) ? targets : [];
  const filtered = arr.filter((t) => !targetsEqual(t, target));
  if (filtered.length === arr.length) {
    // wasn't present → add it
    return [...filtered, target];
  }
  // was present → drop it (filtered is the new list)
  return filtered;
}

/**
 * Distance presets the slider snaps to. Matches the desktop's
 * DISTANCE_PRESETS in `apps/stoop/src/lib/geo.js`.
 */
export const DISTANCE_PRESETS = Object.freeze([1, 2, 5, 10, 25]);

/**
 * Snap a free-form km value to the nearest preset.
 */
export function snapDistance(km) {
  if (typeof km !== 'number' || !Number.isFinite(km)) return null;
  let best = DISTANCE_PRESETS[0];
  let bestDiff = Math.abs(km - best);
  for (const p of DISTANCE_PRESETS) {
    const d = Math.abs(km - p);
    if (d < bestDiff) { best = p; bestDiff = d; }
  }
  return best;
}
