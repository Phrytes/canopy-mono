/**
 * listsService — makes the dissolved Lists app (listsApp.js) callable through the standard `callSkill` shape
 * (cluster L · L3, the live wiring — additive first). Holds the per-circle `CircleItemStore` registry and
 * routes `callSkill('lists', op, args, {circleId})` to the Lists FUNCTIONS over the active circle's store.
 *
 * Additive by design: a NEW `'lists'` app-origin alongside the legacy household agent — zero regression. The
 * legacy household agent is retired only once this is the live path (the final L3 step). `app-origin` here is
 * a capability/provenance tag, not a storage key (cluster L) — every list lives in the one per-circle store.
 *
 * No-pod default uses an in-memory `memoryDataSource` (not persistent across reload); a real boot injects a
 * persistent CachingDataSource (no-pod) or a sealed pod-client-backed source (p2/p3) — the store doesn't care.
 */
import { createCircleStores, memoryDataSource } from '@canopy/item-store';
import { createRegistry, registerCanonicalTypes } from '@canopy/item-types';
import * as Lists from './listsApp.js';

/** A registry pre-loaded with the canonical types + the Lists app's own (`list`/`list-item`). */
export function listsRegistry() {
  const reg = createRegistry();
  registerCanonicalTypes(reg);
  Lists.registerListTypes(reg);
  return reg;
}

/** op → (store, args) → result. The whole "Lists app" surface, over a circle store. */
const OPS = {
  createList:   (store, a) => Lists.createList(store, a),
  addItem:      (store, a) => Lists.addItem(store, a.listId, a),
  getList:      (store, a) => Lists.getList(store, a.listId),
  listAll:      (store) => Lists.listAll(store),
  completeItem: (store, a) => Lists.completeItem(store, a.itemId),
  removeItem:   (store, a) => Lists.removeItem(store, a.listId, a.itemId),
};

/**
 * @param {object} [args]
 * @param {import('@canopy/core').DataSource} [args.dataSource]  shared backing (default: in-memory no-pod)
 * @param {object} [args.registry]  @canopy/item-types registry (default: canonical + Lists types)
 * @returns {{ callSkill:(op:string,args?:object,ctx?:{circleId?:string})=>Promise<*>, accepts:object, stores:object }}
 */
export function createListsService({ dataSource, registry } = {}) {
  const stores = createCircleStores({
    dataSource: dataSource || memoryDataSource(),
    registry:   registry || listsRegistry(),
  });
  return {
    /** `callSkill('lists', op, args, {circleId})` shim — routes to the active circle's store. */
    async callSkill(op, args = {}, ctx = {}) {
      const circleId = ctx.circleId ?? args.circleId;
      if (!circleId) throw new Error('listsService.callSkill: a circleId is required (scope)');
      const fn = OPS[op];
      if (!fn) throw new Error(`listsService.callSkill: unknown op "${op}"`);
      return fn(stores.getStore(circleId), args);
    },
    /** The manifest `accepts` policy this service contributes (cluster K surfacing). */
    accepts: Lists.LISTS_ACCEPTS,
    stores,
  };
}
