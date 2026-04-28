// @canopy/core — storage/MergeContracts/lastWriteWins
//
// Pure-function merge contract for federated reads where the
// canonical view is whichever peer wrote most recently.

/**
 * @typedef {Object} Version
 * @property {*}      value     - The per-peer pod read result.  Any shape.
 * @property {number} timestamp - Unix-ms when this version was written.
 * @property {string} sourceId  - Stable identifier for the source pod.
 */

/**
 * Last-write-wins.
 *
 * Picks the version with the highest `version.timestamp`.  On
 * timestamp tie, the version with the lexicographically *largest*
 * `sourceId` wins.  (Largest is chosen — rather than smallest —
 * for parity with `setUnionWithDedupe`'s tie-break rule.)
 *
 * Empty input returns `undefined` — there's no winner.  Callers
 * that need a sentinel should check for `undefined` and substitute
 * their own default.
 *
 * @example
 * const versions = [
 *   { value: { name: 'old' }, timestamp: 100, sourceId: 'pod-a' },
 *   { value: { name: 'new' }, timestamp: 200, sourceId: 'pod-b' },
 * ];
 * lastWriteWins(versions);
 * // → { name: 'new' }
 *
 * @param {Version[]} versions
 * @param {object}    [opts] - Reserved for future use; currently unused.
 * @returns {*|undefined} The `value` from the winning version, or
 *   `undefined` if `versions` is empty / non-array.
 */
export function lastWriteWins (versions, _opts = {}) {
  if (!Array.isArray(versions) || versions.length === 0) return undefined;

  let winner;
  for (const version of versions) {
    if (!version) continue;
    if (
      !winner ||
      version.timestamp > winner.timestamp ||
      (version.timestamp === winner.timestamp && version.sourceId > winner.sourceId)
    ) {
      winner = version;
    }
  }
  return winner ? winner.value : undefined;
}
