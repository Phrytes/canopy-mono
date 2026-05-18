/**
 * buildBundle — Tasks V1 local-first storage bundle.
 *
 * Wraps `@canopy/local-store`'s `CachingDataSource` so the agent
 * boots against a Map-cache immediately (Tasks V1's local-only-mode
 * rule) and write-throughs to an inner DataSource when one is
 * attached (pod sign-in flow).
 *
 * The CachingDataSource owns the local cache (a `Map<string, any>`
 * — see `packages/local-store/src/CachingDataSource.js`). For
 * restart-survival on Node CLI, callers pass an `onLocalChange`
 * callback that persists the Map to disk (Stoop wires
 * `lib/FilePersist.js` for this; that helper is still app-local in
 * Stoop and a substrate candidate in its own right).
 *
 * `attachInner(inner)` flips the bundle from local-only to attached;
 * it auto-flushes any pending writes and runs a bulk-sync.
 * `detachInner()` reverses (e.g. on pod sign-out — keep working
 * locally).
 *
 * M4 addition: the bundle now carries a `_podCtx` mutable holder and
 * passes an `innerKeyMap` closure to `CachingDataSource`. While
 * `_podCtx.active` is false (the no-pod default) `toInner`/`fromInner`
 * are pure identity → CachingDataSource stays byte-neutral
 * (pod-independence.md). `attachTasksBundle` fills `_podCtx` at pod
 * sign-in time. The returned bundle object exposes `_podCtx` so callers
 * can inspect routing state.
 *
 * This helper is intentionally small. Apps that want exotic shapes
 * (multiple data sources, sharded caches, foreground-only sync per
 * collection) should compose the substrate primitives directly.
 */

import { CachingDataSource, SyncCadence } from '@canopy/local-store';

/**
 * Build a Tasks-shaped local-first storage bundle.
 *
 * @param {object} [args]
 * @param {object} [args.inner]
 *   A `core.DataSource` to write through to. Default: none — bundle
 *   is local-only until `attachInner` is called.
 * @param {Map<string, any>} [args.localStore]
 *   Optional pre-loaded local cache. Default: a fresh Map. Apps that
 *   want restart-survival pass a Map loaded from a `FilePersist`-style
 *   adapter and supply `onLocalChange` to keep it on disk.
 * @param {(map: Map<string, any>) => void} [args.onLocalChange]
 *   Optional callback fired after every local-cache mutation. Wire
 *   this to a file-persist adapter for restart-survival. Out of
 *   scope for V0/V1 zero-config; relevant for the local-only-mode
 *   CLI when it lands.
 * @param {string[]} [args.localOnlyPrefixes]
 *   Paths matching ANY prefix here never sync to the inner pod.
 *   Tasks V1 default: `['mem://tasks/settings/devices/',
 *   'mem://tasks/settings/.migrated-from-v2']` so per-device settings
 *   + the migration marker stay local.
 * @param {object} [args.cadence]
 *   Optional `SyncCadence` configuration (currently informational —
 *   apps wire the cadence's `start()` / `stop()` themselves).
 *
 * @returns {{
 *   cache:        CachingDataSource,
 *   cadence:      SyncCadence | null,
 *   attachInner:  (inner: object) => Promise<void>,
 *   detachInner:  () => Promise<void>,
 *   close:        () => Promise<void>,
 * }}
 */
export function buildBundle({
  inner,
  localStore,
  onLocalChange,
  localOnlyPrefixes,
  cadence: cadenceCfg,
} = {}) {
  // M4: mutable pod-context holder. The `innerKeyMap` closure below
  // reads this at every toInner/fromInner call. While `active` is
  // false (the no-pod default) both functions are identity →
  // CachingDataSource is byte-neutral (pod-independence.md).
  // `attachTasksBundle` fills this at pod sign-in time so the
  // decentralised/hybrid routing activates transparently.
  const podCtx = {
    active:    false,
    classify:  null,
    reverse:   null,
    podRouting: null,
    crewId:    null,
    vars:      null,
  };

  const podInnerKeyMap = {
    toInner: (p) => {
      if (!podCtx.active
          || typeof podCtx.classify !== 'function'
          || !podCtx.podRouting) return p;
      const c = podCtx.classify(p, { crewId: podCtx.crewId });
      if (!c) return p; // unroutable → identity (no-pod safe)
      const base = podCtx.podRouting.resolve(c.storageFn, podCtx.vars || {});
      if (typeof base !== 'string' || base.length === 0) return p;
      return base.endsWith('/') ? base + c.tail : `${base}/${c.tail}`;
    },
    // Phase 3.3 inverse — re-key pod URIs to logical `mem://tasks/…`
    // space for pull-back / cross-app reads. Inactive → identity.
    fromInner: (u) => {
      if (!podCtx.active
          || typeof podCtx.reverse !== 'function'
          || !podCtx.podRouting) return u;
      const logical = podCtx.reverse({
        resolve: (fn, v) => podCtx.podRouting.resolve(fn, v),
        crewId:  podCtx.crewId,
        podUri:  u,
        vars:    podCtx.vars || {},
      });
      return logical ?? u;
    },
  };

  const cache = new CachingDataSource({
    inner:             inner ?? null,
    localStore,
    onLocalChange,
    localOnlyPrefixes: localOnlyPrefixes ?? [
      'mem://tasks/settings/devices/',
      'mem://tasks/settings/.migrated-from-v2',
    ],
    innerKeyMap: podInnerKeyMap,
  });

  const cadence = cadenceCfg ? new SyncCadence(cadenceCfg) : null;

  return {
    cache,
    cadence,
    // M4: expose the mutable podCtx as `_podCtx` so `attachTasksBundle`
    // can fill it at pod sign-in time (same seam as Stoop's Agent.js
    // Phase 2.4-core, and as tasks-mobile's forward-courtesy seam).
    _podCtx: podCtx,
    async attachInner(nextInner) {
      if (!nextInner || typeof nextInner.read !== 'function') {
        throw new TypeError('buildBundle.attachInner: inner DataSource required');
      }
      await cache.attachInner(nextInner);
    },
    async detachInner() {
      await cache.attachInner(null);
    },
    async close() {
      if (cadence?.stop) await cadence.stop();
    },
  };
}
