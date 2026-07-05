/**
 * @canopy/pod-client — high-level pod read/write/list + conflict
 * detection + tombstone-backed delete-scope. Public API.
 *
 * **Layer: SDK foundation.** Substrates and apps compose primitives from this
 * package; substrates MUST NOT reinvent them (no parallel HTTP fetch, no
 * homebrew tombstone store, no in-substrate merge contracts), apps MUST
 * justify direct use in their README. See
 * `Project Files/conventions/architectural-layering.md`.
 *
 * Scaffolded by A5a; A5b1 added `CapabilityAuth` + `SolidOidcAuth`;
 * A5b2 added `PodClient`. A6 added `TombstoneStore` + per-platform adapters.
 * A7 added `ConflictResolver`.
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
  SharingUnsupportedError,
  mapSourceCode,
} from './Errors.js';

// Pod storage adapter + portable archive export/import (extracted from
// @canopy/core — the concrete Solid pod DataSource and its backup pair).
export { SolidPodSource } from './SolidPodSource.js';
// L1b — sealed, pod-backed `core.DataSource` (SolidPodSource + createSealedPodClient → read/write/delete/list),
// so a per-circle CircleItemStore can persist to a real pod with content sealed at rest under the group key.
export { createSealedPodDataSource, podGroupPrefix } from './sealedPodDataSource.js';
export { PodExporter }    from './PodExporter.js';
export { PodImporter }    from './PodImporter.js';

export { Auth } from './Auth/Auth.js';
export { CapabilityAuth } from './Auth/CapabilityAuth.js';
export { SolidOidcAuth }  from './Auth/SolidOidcAuth.js';
export { PodClient }      from './PodClient.js';

// A7 — Conflict detection + resolution.
export { ConflictResolver } from './ConflictResolver.js';

// Phase 52.16 (2026-05-14) — ACP/WAC sharing primitives. The main
// API is `client.sharing.{grant, revoke, list, capabilities}` on a
// PodClient instance; the factory + test seam are exposed for
// substrate consumers that want to wire sharing without a full
// PodClient.
export { createClientSharing, _setInruptModuleForTests } from './sharing/index.js';
export { probeCapabilities, parseSharingLinkHeader }     from './sharing/capabilities.js';

// Opt-in at-rest envelope encryption (recipient-wrap + group-key modes). Node-side (node:crypto).
export {
  recipientId, generateKeypair, generateGroupKey, isSealed,
  seal, open, sealWithGroupKey, openWithGroupKey,
  makeSealer, makeOpener, makeGroupSealer, makeGroupOpener,
  createSealedPodClient, recipientStrategy, groupKeyStrategy,
  buildGroupKeyResource, unwrapGroupKey, grantMember, rotateGroupKeyResource,
  createSealedIndex, upsertEntry, removeEntry, getEntry, decodePseudonym,
  queryIndex, semanticQuery, serializeIndex, parseIndex, shardKeyFor,
  createControlAgent, createPodKeyStore, readGroupKey, createMemberSealingIdentity,
  resolveCircleStorage, circleStorageClient,
} from './sealing/index.js';

// Identity-on-pod (extracted from @canopy/core — Track B / identity-pod-schema).
// On-pod identity store, vault→pod migration, and the pod↔vault identity
// sync engine. These operate ON a pod, so they live at the SDK pod layer;
// AgentIdentity / Bootstrap / KeyRotation (kernel identity) stay in @canopy/core.
export { IdentityPodStore } from './identity/IdentityPodStore.js';
export { IdentitySync, vaultCacheKeyFor, resourcePathFromCacheKey } from './identity/IdentitySync.js';
export { migrateVaultToPod } from './identity/migrateVaultToPod.js';

// A6 — Delete-scope primitive (TombstoneStore + per-platform adapters).
export { TombstoneStore }         from './TombstoneStore.js';
export { MemoryTombstones }       from './tombstones/MemoryTombstones.js';
export { IndexedDBTombstones }    from './tombstones/IndexedDBTombstones.js';
export { AsyncStorageTombstones } from './tombstones/AsyncStorageTombstones.js';
export { FileTombstones }         from './tombstones/FileTombstones.js';
