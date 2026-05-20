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

// Cross-app embeds traversal (Phase 52.6.1) + the cross-pod-ref
// resolver (Phase 3.3c — decentralised crew read path).
export { treeOf, createCrossPodRefResolver } from './embeds.js';

// SP-5b V0a (2026-05-21) — audience field bridge.
// `audienceFromItem(item)` resolves the effective audience by
// checking item.audience → item.visibility → 'household' default.
// Item-store stores audience verbatim; resolution to member sets
// happens in `@canopy/circles`'s `resolveAudience`.
export { audienceFromItem } from './audience.js';
