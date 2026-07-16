// @onderling/core — storage/MergeContracts
//
// A small library of pure-function merge contracts apps can pick
// from when doing federated reads across member pods.  Each contract
// has the same shape:
//
//   merge(versions: Version[], opts?: object) → mergedValue
//
// where each `Version` is `{ value, timestamp, sourceId }` and
// `mergedValue` shape depends on the contract.
//
// All contracts are pure: same input → same output, no side effects,
// no async, no I/O.  Output is deterministic across machines so
// federated reads converge regardless of which member runs them.

import { setUnionWithDedupe } from './setUnionWithDedupe.js';
import { appendOnlyEventLog } from './appendOnlyEventLog.js';
import { lastWriteWins } from './lastWriteWins.js';

export { setUnionWithDedupe } from './setUnionWithDedupe.js';
export { appendOnlyEventLog } from './appendOnlyEventLog.js';
export { lastWriteWins } from './lastWriteWins.js';

/**
 * Map of contract name → function.  Use this when the contract is
 * selected dynamically (e.g., from a per-field config string).
 *
 * @example
 * const merge = MergeContracts[fieldConfig.mergeContract];
 * const view  = merge(versions);
 */
export const MergeContracts = {
  setUnionWithDedupe,
  appendOnlyEventLog,
  lastWriteWins,
};
