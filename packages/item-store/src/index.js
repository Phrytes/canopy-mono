/**
 * @canopy/item-store — public entry point.
 *
 * Post-Phase 5.2 (2026-05-04): the synthetic `Backend` interface +
 * `InMemoryBackend` were deleted as a duplicate of `core.DataSource`.
 * The substrate now composes any `core.DataSource` directly — see
 * `ItemStore` constructor JSDoc.
 */

export { ItemStore, computeStatus } from './ItemStore.js';
export { CircleItemStore } from './CircleItemStore.js';   // cluster L · L1 — per-circle, type-indexed generic store
export { createGenericAtomHandlers } from './genericAtomHandlers.js';  // B · Layer 1 §1b — generic CRUD-by-atom over any noun
export { memoryDataSource } from './memoryDataSource.js'; // cluster L · L1 — Map-backed DataSource (no-pod / tests)
export { createCircleStores } from './circleStores.js';  // cluster L · L1 — per-circle store registry (web≡mobile)
export {                                                 // cluster K · K2/L2 — containment (ref + back-ref) over a store
  contain, uncontain, listChildren, childIdsOf, parentsOf, deleteContainer, listLoose,
} from './containment.js';
export {                                                 // cluster K · K2 — composable ops engine + surfacing
  addChildTo, resolveContainerAdd, buildAcceptsPolicy, resolveAddInContainer,
} from './containerOps.js';
export { projectContainer } from './projectContainer.js';   // cluster K · K2 — recursive child-render projector
export { wireStoreMirror } from './mirrorSync.js';          // cluster L3 — attach a peer mirror to a store (no-pod sync publish)
export { wireCircleStoreInbound } from './circleStoreInbound.js';  // cluster L3 — ingest peer envelopes into a store (inbound)
export { causalWinner, causalRank } from './causalMerge.js';       // Objective L — origin-ts + writer-id causal LWW for inbound merge
export { recoverCircleFromCaches, writeRecoveredInto } from './podRecovery.js';  // Objective S — pod-recovery: causal merge of device caches
export { shareIntoAudience, resolveSharedRef, listShared } from './shareIntoAudience.js';  // cluster K2 — cross-circle share
export {                                                 // cluster K — injectable ACP/seal enforcement on the cross-circle read
  makeSharedRefPolicy, makePosturePolicy, makeShareGrantHook, makeCircleShareEnforcement,
  makeCanonicalShareHook,                                 // objective L — canonical share/revoke grant hook (createCanonicalShare-composed)
  SHARE_POSTURES, isCanonicalPosture,                     // objective L — revocable `canonical` posture (share-as-grant, no copy)
  unsealItem, sealItem, SEAL_RESERVED_KEYS,               // share-policy slice 3b — write-side content re-seal (symmetric to unsealItem)
} from './sharedRefPolicy.js';
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
// resolver (Phase 3.3c — decentralised circle read path).
export { treeOf, createCrossPodRefResolver } from './embeds.js';

// SP-5b V0a (2026-05-21) — audience field bridge.
// `audienceFromItem(item)` resolves the effective audience by
// checking item.audience → item.visibility → 'household' default.
// Item-store stores audience verbatim; resolution to member sets
// happens in `@canopy/circles`'s `resolveAudience`.
//
// SP-5b — `audienceMatches(itemAudience, filterAudience)` is the
// predicate behind `ListFilter.audience`: exact structural equality
// plus membership for `union`/`set` container audiences.
export { audienceFromItem, audienceMatches } from './audience.js';
