/**
 * canopy-chat-mobile — AsyncStorage IO for the screen-blocks cache (δ.1).
 *
 * Mirrors web's `screenBlocksCacheStorage.js` verbatim on the key shape
 * (`cc.screenBlocksCache.<screenId>`) so a future pod-sync sees one
 * canonical key prefix across surfaces.
 *
 * Portable: `storage` is injected (no top-level AsyncStorage import) so
 * vitest exercises round-trip with a mock and the launcher screen passes
 * the real `@react-native-async-storage/async-storage` instance.
 */

import { createScreenBlocksCache } from '../../../canopy-chat/src/v2/screenBlocksCache.js';

const KEY_PREFIX = 'cc.screenBlocksCache.';

export function asyncStorageScreenBlocksCacheIo(storage) {
  return {
    load: async (screenId) => {
      try {
        const raw = await storage?.getItem?.(KEY_PREFIX + screenId);
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    },
    save: async (screenId, blocks) => {
      try {
        await storage?.setItem?.(KEY_PREFIX + screenId, JSON.stringify(blocks));
      } catch { /* ignore */ }
    },
    remove: async (screenId) => {
      try {
        await storage?.removeItem?.(KEY_PREFIX + screenId);
      } catch { /* ignore */ }
    },
  };
}

export function makeScreenBlocksCacheRN(storage) {
  return createScreenBlocksCache(asyncStorageScreenBlocksCacheIo(storage));
}
