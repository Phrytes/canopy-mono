/**
 * Stable, declaration-order helpers.  The manifest schema relies on
 * insertion-order semantics for ES2015+ Maps + plain objects + arrays.
 * Within the package we never sort outputs, never use Set as a primary
 * collection when downstream order matters, and never rely on
 * Object.entries on objects whose keys arrived in an unstable order.
 *
 * This is the determinism invariant 's byte-equivalence gate
 * (PLAN §1.4) depends on.
 */

/**
 * Deduplicate `arr` while preserving the order of first occurrence.
 * @template T
 * @param {Iterable<T>} arr
 * @returns {T[]}
 */
export function dedupeInOrder(arr) {
  const seen = new Set();
  const out  = [];
  for (const item of arr) {
    if (!seen.has(item)) { seen.add(item); out.push(item); }
  }
  return out;
}

export const __internal__ = true;
