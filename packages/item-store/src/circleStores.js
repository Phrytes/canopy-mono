/**
 * createCircleStores — a per-circle registry of `CircleItemStore`s (cluster L · L1 integration).
 *
 * Mirrors the existing household per-circle pattern (realAgent.js: ONE shared DataSource, each circle gets a
 * store namespaced by a `…/circles/<circleId>/` rootContainer). Hands any function a live, type-indexed store
 * for the active circle — the data substrate L2 (containment) / L3 (dissolve) / L4 (capability) build on.
 *
 * web≡mobile by construction: this is one shared source both shells import; only the injected `dataSource`
 * (no-pod memory / persistent CachingDataSource / sealed pod-client-backed) differs per platform/tier.
 *
 * @param {object} args
 * @param {import('@canopy/core').DataSource} args.dataSource  ONE shared backing (read/write/delete/list); each
 *        circle is isolated by its rootContainer namespace, NOT a separate DataSource.
 * @param {{ validate?: (item:object)=>{ok:boolean,errors?:Array} }} [args.registry]  @canopy/item-types registry
 *        (injected; validates on write). Same instance for every circle so third-party `registerType`s apply uniformly.
 * @param {string} [args.rootPrefix='mem://circles/']  logical root; PodRouting maps it to the physical pod per tier.
 * @param {(circleId:string, store:import('./CircleItemStore.js').CircleItemStore)=>void} [args.onStore]  called ONCE
 *        when a circle's store is first created — the seam to attach a per-circle peer mirror (L3 · no-pod-sync-off-
 *        household: `onStore: (id, s) => wireStoreMirror(s, mirrorFor(id))`). Lazy stores mean there's no other moment.
 * @returns {{ getStore:(circleId:string)=>import('./CircleItemStore.js').CircleItemStore, has:(circleId:string)=>boolean, rootFor:(circleId:string)=>string }}
 */
import { CircleItemStore } from './CircleItemStore.js';

export function createCircleStores({ dataSource, registry, rootPrefix = 'mem://circles/', onStore } = {}) {
  if (!dataSource || typeof dataSource.read !== 'function') {
    throw new Error('createCircleStores: a shared core.DataSource (read/write/delete/list) is required');
  }
  const stores = new Map();   // circleId → CircleItemStore (created lazily, cached)
  const rootFor = (circleId) => `${rootPrefix}${circleId}/`;

  return {
    /** The live, type-indexed store for a circle — created on first ask, then cached. */
    getStore(circleId) {
      if (typeof circleId !== 'string' || !circleId) {
        throw new Error('createCircleStores.getStore: a non-empty circleId is required');
      }
      let store = stores.get(circleId);
      if (!store) {
        store = new CircleItemStore({ dataSource, rootContainer: rootFor(circleId), registry });
        stores.set(circleId, store);
        if (typeof onStore === 'function') { try { onStore(circleId, store); } catch { /* best-effort wiring */ } }
      }
      return store;
    },
    has: (circleId) => stores.has(circleId),
    rootFor,
  };
}
