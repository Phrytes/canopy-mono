// @canopy/core — storage/MergeContracts/setUnionWithDedupe
//
// Pure-function merge contract for federated reads where each
// peer's pod returns an array of items and the merged view is
// the union of all those arrays with duplicates collapsed.

/**
 * @typedef {Object} Version
 * @property {*}      value     - The per-peer pod read result; for this
 *                                contract, expected to be an Array of items.
 * @property {number} timestamp - Unix-ms when this version was written.
 * @property {string} sourceId  - Stable identifier for the source pod.
 */

/**
 * Default item-hash: structural equality via JSON.stringify with
 * stably ordered keys.  Sufficient for v0 — apps with non-JSON-safe
 * items (functions, cycles, BigInts) should pass `opts.itemHash`.
 *
 * @param {*} item
 * @returns {string}
 */
function defaultItemHash (item) {
  return stableStringify(item);
}

/**
 * Stable JSON stringify — sorts object keys recursively so that
 * `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` produce the same hash.
 *
 * @param {*} value
 * @returns {string}
 */
function stableStringify (value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k]));
  return '{' + parts.join(',') + '}';
}

/**
 * Set-union with timestamp-based dedupe.
 *
 * Each `version.value` is an array of items.  The merged output is
 * the union of all input items with duplicates collapsed.  Two items
 * are considered equal iff their hashes (per `opts.itemHash` or the
 * default structural hash) match.  When duplicates appear in
 * different versions, the item from the version with the highest
 * outer `version.timestamp` is retained.  Tie on outer timestamp:
 * the version whose `sourceId` is lexicographically *largest* wins
 * (deterministic).
 *
 * Output is sorted by item-hash ascending so that identical inputs
 * produce byte-identical outputs across machines.
 *
 * @example
 * const versions = [
 *   { value: [{ id: 1 }, { id: 2 }], timestamp: 100, sourceId: 'pod-a' },
 *   { value: [{ id: 2 }, { id: 3 }], timestamp: 200, sourceId: 'pod-b' },
 * ];
 * setUnionWithDedupe(versions, { itemHash: (x) => String(x.id) });
 * // → [{ id: 1 }, { id: 2 }, { id: 3 }]   (id:2 came from pod-b, ts 200)
 *
 * @param {Version[]} versions
 * @param {object}    [opts]
 * @param {(item: *) => string} [opts.itemHash] - Custom hash for
 *   identifying duplicates.  Defaults to a stable structural hash.
 * @returns {Array} Deduplicated, deterministically sorted union.
 */
export function setUnionWithDedupe (versions, opts = {}) {
  if (!Array.isArray(versions) || versions.length === 0) return [];

  const itemHash = typeof opts.itemHash === 'function' ? opts.itemHash : defaultItemHash;

  // Map<hash, { item, ts, sourceId }>
  const winners = new Map();

  for (const version of versions) {
    if (!version || !Array.isArray(version.value)) continue;
    const ts = version.timestamp;
    const sourceId = version.sourceId;
    for (const item of version.value) {
      const hash = itemHash(item);
      const prev = winners.get(hash);
      if (
        !prev ||
        ts > prev.ts ||
        (ts === prev.ts && sourceId > prev.sourceId)
      ) {
        winners.set(hash, { item, ts, sourceId });
      }
    }
  }

  // Deterministic sort by hash ascending.
  const entries = [...winners.entries()];
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return entries.map(([, v]) => v.item);
}
