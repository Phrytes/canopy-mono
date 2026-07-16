/**
 * **Platform: web.** Objective L — persistent circle storage backend selection.
 *
 * Returns a browser-persistent IndexedDB StorageBackend (so a circle's items AND its
 * RAG vector index survive a hard page reload) when IndexedDB is available, and falls
 * back to the in-memory backend otherwise. The fallback keeps the circle store working
 * under SSR and the test env (happy-dom exposes no `indexedDB`) with unchanged
 * behaviour, and degrades to memory if IndexedDB is present but blocked (private
 * browsing / quota / SecurityError) rather than breaking the store.
 *
 * Both backends satisfy the same `@onderling/pseudo-pod` StorageBackend contract, so this
 * is a drop-in for `createMemoryBackend()` at the circle-store / vectorStore
 * construction sites in `circleApp.js`.
 */

import { createMemoryBackend }    from '@onderling/pseudo-pod';
import { createIndexedDbBackend } from '@onderling/pseudo-pod/browser';

/**
 * Pick the persistent backend for a circle store or the RAG index.
 *
 * @param {string} dbName  IndexedDB database name. Scope the per-circle item store by
 *                         circle id and the (internally circle-scoped) RAG index once,
 *                         so distinct stores never share a database.
 * @returns {object} a StorageBackend — IndexedDB-backed when available, else in-memory.
 */
export function pickWebBackend(dbName) {
  if (typeof indexedDB === 'undefined') return createMemoryBackend();
  try {
    return createIndexedDbBackend({ dbName });
  } catch {
    return createMemoryBackend();
  }
}
