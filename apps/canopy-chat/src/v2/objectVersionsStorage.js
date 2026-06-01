/**
 * canopy-chat v2 — concrete `versions` adapters for the kring stores
 * (γ.2 / Phase 9).
 *
 * Each kring store accepts an optional `versions = { capture, list }`
 * adapter that snapshots every save into per-circle history.  This
 * module composes the substrate `captureObjectVersion` /
 * `listObjectVersions` (from `@canopy/sync-engine/objectVersions`)
 * with a concrete key/value storage backend (localStorage on web,
 * AsyncStorage on mobile — see `objectVersionsStorageRN.js`).
 *
 * Key shape: `cc.versions.<storeName>.<circleId>` → JSON array of
 *   `{ts, sha256, value}` entries (newest-first).
 *
 * The substrate (`@canopy/sync-engine`) is imported via a relative
 * path so the canopy-chat package doesn't have to declare a workspace
 * dependency on it — same pattern as `circleStoresRN.js`'s relative
 * import of `podStorage.js`.  This keeps γ.2 strictly additive at the
 * package-manifest level.
 */

import {
  captureObjectVersion,
  listObjectVersions,
} from '../../../../packages/sync-engine/src/objectVersions.js';

/** Storage budget — INTENTIONALLY UNENFORCED (see objectVersions.js
 *  for the rationale).  Per-key retention × typical kring blob size
 *  fits comfortably under localStorage's origin quota.  γ.3 may revisit. */

/**
 * Build a `{capture, list}` versions adapter over a generic
 * `{load(key), save(key, value)}` keyed-blob IO.  This is the shared
 * factory; the localStorage / AsyncStorage variants below wire a
 * concrete backend into it.
 *
 * @param {object} args
 * @param {string} args.storeName  segment in the storage key (e.g. 'policy')
 * @param {{load: (k:string)=>Promise<any>, save: (k:string, v:any)=>Promise<void>}} args.io
 * @param {{perKey?:number}} [args.retention]
 * @returns {{ capture: Function, list: Function }}
 */
export function createObjectVersionsAdapter({ storeName, io, retention } = {}) {
  if (typeof storeName !== 'string' || !storeName) {
    throw new TypeError('createObjectVersionsAdapter: storeName required');
  }
  if (!io || typeof io.load !== 'function' || typeof io.save !== 'function') {
    throw new TypeError('createObjectVersionsAdapter: io must implement {load, save}');
  }
  const slotKey = (circleId) => `cc.versions.${storeName}.${circleId}`;
  // The objectVersions substrate wants {getList, setList}.  Bridge that
  // to the per-key IO by computing the slot key from the logical id.
  const storageFor = (circleId) => {
    const key = slotKey(circleId);
    return {
      getList: async () => {
        const v = await io.load(key);
        return Array.isArray(v) ? v : [];
      },
      setList: async (_k, entries) => { await io.save(key, entries); },
    };
  };
  return {
    /** Snapshot `value` into the history slot for `circleId`. */
    capture: async (circleId, value) => {
      if (typeof circleId !== 'string' || !circleId) return;
      try {
        await captureObjectVersion({
          storage: storageFor(circleId),
          key: slotKey(circleId),
          value,
          retention,
        });
      } catch { /* capture is best-effort */ }
    },
    /** Newest-first history for `circleId`; `[]` when none. */
    list: async (circleId) => {
      if (typeof circleId !== 'string' || !circleId) return [];
      try {
        return await listObjectVersions({
          storage: storageFor(circleId),
          key: slotKey(circleId),
        });
      } catch {
        return [];
      }
    },
  };
}

/**
 * localStorage-backed keyed-blob IO (web).  One key per slot; each
 * value is a JSON-encoded array of version entries.  Matches the
 * shape of `localStoragePolicyIo` etc. so a future test seam can
 * swap in a Map-backed mock.
 */
export function localStorageVersionsIo(storage = globalThis.localStorage) {
  return {
    load: async (key) => {
      try {
        const s = storage?.getItem(key);
        return s ? JSON.parse(s) : null;
      } catch {
        return null;
      }
    },
    save: async (key, value) => {
      try { storage?.setItem(key, JSON.stringify(value)); } catch { /* quota / disabled */ }
    },
  };
}

/**
 * Convenience composite — build a localStorage-backed versions
 * adapter for a single named store.  Web's `circleApp.js` calls this
 * once per kring store (policy / recipe / rules).
 */
export function localStorageObjectVersions(storeName, storage = globalThis.localStorage, retention) {
  return createObjectVersionsAdapter({
    storeName,
    io: localStorageVersionsIo(storage),
    retention,
  });
}
