/**
 * @canopy/item-store — public entry point.
 *
 * Post-Phase 5.2 (2026-05-04): the synthetic `Backend` interface +
 * `InMemoryBackend` were deleted as a duplicate of `core.DataSource`.
 * The substrate now composes any `core.DataSource` directly — see
 * `ItemStore` constructor JSDoc.
 */

export { ItemStore, computeStatus } from './ItemStore.js';
export {
  ItemNotFoundError,
  PermissionDeniedError,
  ClaimRaceError,
  InvalidLifecycleError,
  MissingArgumentError,
  DependenciesOpenError,
} from './errors.js';
export { ulid } from './ulid.js';

// DAG helpers (lifted from apps/tasks-v0/src/dag.js in Phase 52.6.2).
// `computeStatus(item)` above is the substrate's LIFECYCLE status;
// `computeDagStatus` here is the DAG-aware status (ready/waiting/blocked).
export {
  computeDagStatus,
  effectiveStatus,
  unmetDeps,
  detectCycle,
} from './dag.js';

// Cross-app embeds traversal (Phase 52.6.1).
export { treeOf } from './embeds.js';
