/**
 * canopy-chat-mobile v2 — AsyncStorage-backed `versions` adapter for the
 * shared kring stores (γ.2 / Phase 9).
 *
 * Mirror of web's `objectVersionsStorage.js`: the substrate factory lives
 * in `apps/canopy-chat` (which we already reach via the shared
 * `@canopy-app/canopy-chat` package); this module wires it onto
 * AsyncStorage using the same `asyncRawIo` shape already used by
 * `circleStoresRN.js`.
 *
 * Key shape: `cc.versions.<storeName>.<circleId>` — verbatim with web.
 * A future pod-sync sees one shape on both surfaces, mirroring the
 * `cc.circlePolicy.<id>` convention.
 */

// Pull the shared factory in via relative path (same pattern as
// circleStoresRN.js's relative import of podStorage.js — Metro doesn't
// honour package.json "exports" subpaths, and the canopy-chat package
// exports map intentionally doesn't list internal v2 modules).
import {
  createObjectVersionsAdapter,
} from '../../../canopy-chat/src/v2/objectVersionsStorage.js';

/** Generic `{load(key), save(key, value)}` IO over AsyncStorage. */
export function asyncObjectVersionsIo(storage) {
  return {
    load: async (key) => {
      try {
        const s = await storage.getItem(key);
        return s ? JSON.parse(s) : null;
      } catch {
        return null;
      }
    },
    save: async (key, value) => {
      try { await storage.setItem(key, JSON.stringify(value)); }
      catch { /* ignore */ }
    },
  };
}

/**
 * Compose the substrate factory with an AsyncStorage-backed IO.
 *
 * @param {string} storeName        e.g. 'policy' / 'recipe' / 'rules'
 * @param {object} storage          AsyncStorage instance
 * @param {object} [retention]      `{perKey?:number}` — defaults to substrate
 * @returns {{capture: Function, list: Function}}
 */
export function asyncStorageObjectVersions(storeName, storage, retention) {
  return createObjectVersionsAdapter({
    storeName,
    io: asyncObjectVersionsIo(storage),
    retention,
  });
}
