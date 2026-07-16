/**
 * External-store adapter pattern for the pod-storage convention helpers.
 *
 * The convention layer (`PodStorageConvention.js`) writes small content
 * inline to a Solid pod and offloads big content to a pluggable
 * `ExternalStore`.  This module documents the interface and re-exports the
 * v1 default (`NoneStore`).  Real adapters (S3, IPFS, Drive, …) ship
 * outside `@onderling/core`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `ExternalStore` interface (JSDoc only — duck-typed):
 *
 *   interface ExternalStore {
 *     // Upload a blob.  `opts.contentType` is required; `opts.hash` is
 *     // optional and (when present) is the same `sha256:<hex>` string the
 *     // convention layer wrote into the reference manifest.  Implementations
 *     // may use it for content-addressed storage or skip it entirely.
 *     // Returns the URI where the blob was stored — this is what gets
 *     // recorded in the manifest's `uri` field.
 *     put(blob: Uint8Array | Buffer | string,
 *         opts: { contentType: string, hash?: string }): Promise<string>;
 *
 *     // Fetch a blob previously written via `put`.  MUST return raw bytes;
 *     // `readWithConvention` re-hashes them to verify integrity.
 *     get(uri: string): Promise<Uint8Array>;
 *
 *     // Remove a blob.  Idempotent — should not throw if the URI is gone.
 *     delete(uri: string): Promise<void>;
 *
 *     // Existence check; cheap probe.
 *     exists(uri: string): Promise<boolean>;
 *   }
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Errors: implementations should throw plain `Error` instances with a
 * `.code` field so `ConventionError` mapping in Track A5 stays simple.  The
 * v1 default (`NoneStore`) uses `.code = 'EXTERNAL_STORE_NOT_CONFIGURED'`.
 */

export { NoneStore } from './NoneStore.js';
