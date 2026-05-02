export { SyncEngine } from './SyncEngine.js';
export { BidirectionalSyncEngine } from './BidirectionalSyncEngine.js';
export { IngestQueueSource } from './sources/IngestQueueSource.js';
export { LocalFolderSource } from './sources/LocalFolderSource.js';
export { InMemoryBackend } from './backends/InMemoryBackend.js';
export {
  classifyStorage,
  buildReferenceManifest,
  DEFAULT_SMALL_THRESHOLD_BYTES,
} from './storageConvention.js';

// Folio-lifted helpers (V0.3+).  PathMap accepts an injected
// `parseSharePath` hook; consumers that don't care about share folders
// pass nothing.
export { PathMap, joinRel } from './PathMap.js';
export { scanLocal } from './scanLocal.js';
export { scanPod }   from './scanPod.js';
export { diff }      from './diff.js';
