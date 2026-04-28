/**
 * @canopy/pod-client — public API.
 *
 * Scaffolded by A5a.  A5b1 will add `CapabilityAuth` + `SolidOidcAuth`
 * concretes; A5b2 will add `PodClient`.  Until those land, this package
 * exposes only the error taxonomy and the `Auth` interface.
 */

export {
  PodClientError,
  AuthError,
  CapabilityError,
  NotFoundError,
  ConflictError,
  NetworkError,
  PolicyError,
  MalformedResourceError,
  EncryptionError,
  ConventionError,
  mapSourceCode,
} from './Errors.js';

export { Auth } from './Auth/Auth.js';
export { CapabilityAuth } from './Auth/CapabilityAuth.js';
export { SolidOidcAuth }  from './Auth/SolidOidcAuth.js';
export { PodClient }      from './PodClient.js';

// A7 — Conflict detection + resolution.
export { ConflictResolver } from './ConflictResolver.js';

// A6 — Delete-scope primitive (TombstoneStore + per-platform adapters).
export { TombstoneStore }         from './TombstoneStore.js';
export { MemoryTombstones }       from './tombstones/MemoryTombstones.js';
export { IndexedDBTombstones }    from './tombstones/IndexedDBTombstones.js';
export { AsyncStorageTombstones } from './tombstones/AsyncStorageTombstones.js';
export { FileTombstones }         from './tombstones/FileTombstones.js';
