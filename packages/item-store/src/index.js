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
