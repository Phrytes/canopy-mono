/**
 * buildLocalStoreBundle — wraps a `core.DataSource` (FileSystemAdapter
 * on a real device, MemorySource under tests) in a CachingDataSource
 * to give buildMeshAgent the local-store bundle shape it expects.
 *
 * Phase 41.2 (2026-05-09).
 *
 * Mirrors the bundle shape `apps/tasks-v0/bin/tasks-ui.js` constructs
 * for the desktop CLI:
 *   { cache, cadence, attachInner, detachInner, close }
 *
 * `cadence` is null in V1 — Phase 41.14 wires it via
 * `@canopy/online-cadence`.
 */

import { CachingDataSource } from '@canopy/local-store';

/**
 * @param {object} args
 * @param {object} [args.inner]   `core.DataSource` to wrap. When omitted,
 *   the cache runs without an inner — pure-memory mode (tests, first
 *   launch before the device-side FS adapter has spun up, etc.).
 * @returns {Promise<{
 *   cache:        object,
 *   cadence:      null,
 *   attachInner:  (ds: object) => Promise<void>,
 *   detachInner:  () => Promise<void>,
 *   close:        () => Promise<void>,
 * }>}
 */
export async function buildLocalStoreBundle({ inner } = {}) {
  const cache = new CachingDataSource(inner ? { inner } : {});
  return {
    cache,
    cadence: null,
    async attachInner(ds) { await cache.attachInner(ds); },
    async detachInner()   { await cache.attachInner(null); },
    async close()         { /* no-op for V1; close releases nothing yet */ },
  };
}
