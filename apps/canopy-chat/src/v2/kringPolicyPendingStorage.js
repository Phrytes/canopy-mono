/**
 * canopy-chat v2 — localStorage IO for the pending-policy cache (γ-next.policy).
 *
 * Wires `createKringPolicyPendingStore` to `window.localStorage` (or an
 * injected `storage` matching that interface for tests).  Key prefix
 * `cc.kringPolicyPending.<circleId>` matches the convention of every
 * other circle store (`cc.circlePolicy.<id>`, `cc.kringRulesPending.<id>`,
 * `cc.kringRecipePending.<id>`).
 */

import { createKringPolicyPendingStore } from './kringPolicyPending.js';

const KEY_PREFIX = 'cc.kringPolicyPending.';

export function localStorageKringPolicyPendingIo(storage = globalThis.localStorage) {
  return {
    load: async (circleId) => {
      try {
        const raw = storage?.getItem?.(KEY_PREFIX + circleId);
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    },
    save: async (circleId, policy) => {
      try {
        storage?.setItem?.(KEY_PREFIX + circleId, JSON.stringify(policy));
      } catch { /* quota / disabled */ }
    },
    remove: async (circleId) => {
      try {
        storage?.removeItem?.(KEY_PREFIX + circleId);
      } catch { /* ignore */ }
    },
  };
}

export function createKringPolicyPendingStoreLocal(storage = globalThis.localStorage) {
  return createKringPolicyPendingStore(localStorageKringPolicyPendingIo(storage));
}
