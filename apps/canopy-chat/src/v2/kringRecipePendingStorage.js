/**
 * canopy-chat v2 — localStorage IO for the pending-recipe cache (γ-next.recipe).
 *
 * Wires `createKringRecipePendingStore` to `window.localStorage` (or an
 * injected `storage` matching that interface for tests).  Key prefix
 * `cc.kringRecipePending.<circleId>` matches the convention of every
 * other circle store (`cc.circleRecipe.<id>`, `cc.circleRules.<id>`).
 */

import { createKringRecipePendingStore } from './kringRecipePending.js';

const KEY_PREFIX = 'cc.kringRecipePending.';

export function localStorageKringRecipePendingIo(storage = globalThis.localStorage) {
  return {
    load: async (circleId) => {
      try {
        const raw = storage?.getItem?.(KEY_PREFIX + circleId);
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    },
    save: async (circleId, recipe) => {
      try {
        storage?.setItem?.(KEY_PREFIX + circleId, JSON.stringify(recipe));
      } catch { /* quota / disabled */ }
    },
    remove: async (circleId) => {
      try {
        storage?.removeItem?.(KEY_PREFIX + circleId);
      } catch { /* ignore */ }
    },
  };
}

export function createKringRecipePendingStoreLocal(storage = globalThis.localStorage) {
  return createKringRecipePendingStore(localStorageKringRecipePendingIo(storage));
}
