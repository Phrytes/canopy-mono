export { PodSearch } from './PodSearch.js';
export { VectorIndex } from './VectorIndex.js';
export { chunkText, resolveChunking, CHUNKING_V1 } from './chunking.js';
export { codedError } from './errors.js';
export { createBackfill } from './backfill.js'; // Phase 52.24 — resumable backfill orchestrator
// Hash adapter (52.25) — the platform-wired SHA-256 PodSearch takes as `hash`.
export { hash } from './adapters/hash.js';
