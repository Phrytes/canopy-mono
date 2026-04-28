// @canopy/core — storage/MergeContracts/appendOnlyEventLog
//
// Pure-function merge contract for federated reads of append-only
// event logs.  Each peer pod returns an array of events, each with
// its own `timestamp`.  The merged view is the chronological
// concatenation of all events, with deterministic tie-breaking.

/**
 * @typedef {Object} Version
 * @property {*}      value     - The per-peer pod read result; for this
 *                                contract, expected to be an Array of
 *                                event objects each with a `.timestamp`.
 * @property {number} timestamp - Unix-ms when this version was written
 *                                (NOT used for ordering — events bring
 *                                their own per-event timestamp).
 * @property {string} sourceId  - Stable identifier for the source pod.
 */

/**
 * Append-only event log merge.
 *
 * Each `version.value` is an array of events; each event MUST have a
 * numeric `timestamp` field.  The merged output is the concatenation
 * of all events from all versions, sorted ascending by event
 * timestamp.  Tie-break is deterministic: by `version.sourceId`
 * lexicographic ascending, then by the event's original index within
 * its source array (preserving intra-source order on identical
 * timestamps).
 *
 * Note: the *outer* `version.timestamp` is intentionally unused — log
 * ordering is driven by the per-event timestamp the writer recorded
 * at the time the event was logged.
 *
 * @example
 * const versions = [
 *   {
 *     value: [{ timestamp: 100, type: 'a' }, { timestamp: 300, type: 'c' }],
 *     timestamp: 999,
 *     sourceId: 'pod-a',
 *   },
 *   {
 *     value: [{ timestamp: 200, type: 'b' }],
 *     timestamp: 999,
 *     sourceId: 'pod-b',
 *   },
 * ];
 * appendOnlyEventLog(versions);
 * // → [{ timestamp: 100, ... }, { timestamp: 200, ... }, { timestamp: 300, ... }]
 *
 * @param {Version[]} versions
 * @param {object}    [opts] - Reserved for future use; currently unused.
 * @returns {Array} Single ordered event array.
 */
export function appendOnlyEventLog (versions, _opts = {}) {
  if (!Array.isArray(versions) || versions.length === 0) return [];

  // Stable sort: build (event, sourceId, idx) tuples and sort with a
  // total-ordering comparator.  JS Array#sort is stable since ES2019,
  // but explicit tuple ordering makes intent clear and survives
  // accidental engine quirks.
  const tuples = [];
  for (const version of versions) {
    if (!version || !Array.isArray(version.value)) continue;
    const sourceId = version.sourceId;
    for (let i = 0; i < version.value.length; i++) {
      const event = version.value[i];
      const ts = event && typeof event.timestamp === 'number' ? event.timestamp : 0;
      tuples.push({ event, ts, sourceId, idx: i });
    }
  }

  tuples.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    if (a.sourceId !== b.sourceId) return a.sourceId < b.sourceId ? -1 : 1;
    return a.idx - b.idx;
  });

  return tuples.map((t) => t.event);
}
