// ── DoD-lifecycle status (Tasks V1) ─────────────────────────────────────────
//
// The pure, substrate-level lifecycle-status function, extracted out of the
// RETIRED `ItemStore` class so production code (`taskLifecycle` / `taskCrud`)
// no longer routes through the deprecated class file. `ItemStore.js` re-imports
// `computeStatus` from here for its own internal use + parity reference.

/**
 * Compute the lifecycle status of an item from its persisted state.
 *
 * Returns one of: `'open' | 'claimed' | 'submitted' | 'rejected' | 'complete'`.
 *
 * This is the substrate-level status — it considers only the item's
 * own fields (no DAG dependency walk; apps layer that on top, e.g.
 * `apps/tasks-v0/src/dag.js#computeStatus(task, openItems, closedItems)`
 * which returns `'ready' | 'waiting' | 'blocked'`).
 *
 * Rules (in order):
 *   1. `completedAt` set        → `'complete'`
 *   2. last reviewLog == submit → `'submitted'`
 *   3. last reviewLog == reject → `'rejected'`
 *   4. `assignee` set           → `'claimed'`
 *   5. otherwise                → `'open'`
 *
 * Pure function; no I/O.
 *
 * @param {import('./types.js').Item} item
 * @returns {'open' | 'claimed' | 'submitted' | 'rejected' | 'complete'}
 */
export function computeStatus(item) {
  if (!item || typeof item !== 'object') return 'open';
  if (item.completedAt) return 'complete';
  const last = _lastReviewDecision(item.reviewLog);
  if (last === 'submit') return 'submitted';
  if (last === 'reject') return 'rejected';
  if (item.assignee)    return 'claimed';
  return 'open';
}

/** Last decision in the review log, or null. */
export function _lastReviewDecision(reviewLog) {
  if (!Array.isArray(reviewLog) || reviewLog.length === 0) return null;
  return reviewLog[reviewLog.length - 1]?.decision ?? null;
}
