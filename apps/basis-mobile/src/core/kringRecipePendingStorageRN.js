/**
 * basis-mobile — AsyncStorage IO for the pending-recipe cache
 * (γ-next.recipe).  Mirrors web's `kringRecipePendingStorage.js`
 * verbatim on the key shape (`cc.kringRecipePending.<circleId>`) so a
 * future pod-sync sees one canonical key prefix across surfaces.
 *
 * Portable: `storage` is injected (no top-level AsyncStorage import)
 * so vitest exercises round-trip with a mock and the launcher screen
 * passes the real `@react-native-async-storage/async-storage` instance.
 */

import { createKringRecipePendingStore } from '../../../basis/src/v2/kringRecipePending.js';

const KEY_PREFIX = 'cc.kringRecipePending.';

export function asyncStorageKringRecipePendingIo(storage) {
  return {
    load: async (circleId) => {
      try {
        const raw = await storage?.getItem?.(KEY_PREFIX + circleId);
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    },
    save: async (circleId, recipe) => {
      try {
        await storage?.setItem?.(KEY_PREFIX + circleId, JSON.stringify(recipe));
      } catch { /* ignore */ }
    },
    remove: async (circleId) => {
      try {
        await storage?.removeItem?.(KEY_PREFIX + circleId);
      } catch { /* ignore */ }
    },
  };
}

export function makeKringRecipePendingStoreRN(storage) {
  return createKringRecipePendingStore(asyncStorageKringRecipePendingIo(storage));
}
