/**
 * canopy-chat v2 — localStorage IO for the pending-rules cache (γ-next.rules).
 *
 * Wires `createKringRulesPendingStore` to `window.localStorage` (or an
 * injected `storage` matching that interface for tests).  Key prefix
 * `cc.kringRulesPending.<circleId>` matches the convention of every
 * other circle store (`cc.circleRules.<id>`, `cc.kringRecipePending.<id>`).
 */

import { createKringRulesPendingStore } from './kringRulesPending.js';

const KEY_PREFIX = 'cc.kringRulesPending.';

export function localStorageKringRulesPendingIo(storage = globalThis.localStorage) {
  return {
    load: async (circleId) => {
      try {
        const raw = storage?.getItem?.(KEY_PREFIX + circleId);
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    },
    save: async (circleId, rulesDoc) => {
      try {
        storage?.setItem?.(KEY_PREFIX + circleId, JSON.stringify(rulesDoc));
      } catch { /* quota / disabled */ }
    },
    remove: async (circleId) => {
      try {
        storage?.removeItem?.(KEY_PREFIX + circleId);
      } catch { /* ignore */ }
    },
  };
}

export function createKringRulesPendingStoreLocal(storage = globalThis.localStorage) {
  return createKringRulesPendingStore(localStorageKringRulesPendingIo(storage));
}
