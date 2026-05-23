/**
 * persistPicker — pick the right cache-persistence adapter for the
 * runtime, so `Agent.js` doesn't hard-import the node-only
 * `FilePersist` (which breaks browser composition).
 *
 * Two adapters today, same interface:
 *   - `FilePersist`        Node:  `{path: '/data/stoop.json'}`
 *   - `IndexedDBPersist`   Browser: `{dbName: 'stoop-cache'}`
 *
 * Callers pass exactly ONE of these.  The picker validates +
 * dynamically imports the matching adapter so a browser bundle
 * never pulls in `node:fs/promises`.
 *
 * # Why a picker (not just "use what's available")
 *
 * Node tests + the existing CLI deliberately use FilePersist; the
 * browser canopy-chat integration deliberately uses IndexedDB.  We
 * don't want auto-detect picking the "wrong" one based on
 * environment alone — that hides intent.  Caller declares; picker
 * just validates + lazy-loads.
 */

/**
 * @param {object}  args
 * @param {string}  [args.path]                  → FilePersist (Node)
 * @param {string}  [args.dbName]                → IndexedDBPersist (browser)
 * @param {string}  [args.storeName]             IndexedDB-only
 * @param {number}  [args.saveDelayMs]           applies to both
 * @returns {Promise<{ persist: object, kind: 'file' | 'idb' } | null>}
 *   Returns null when neither is set (caller wanted in-memory only).
 */
export async function pickPersist(args = {}) {
  if (typeof args.path === 'string' && args.path) {
    if (typeof args.dbName === 'string' && args.dbName) {
      throw new TypeError(
        'pickPersist: pass EITHER {path} (FilePersist) OR {dbName} ' +
        '(IndexedDBPersist), not both.',
      );
    }
    const { FilePersist } = await import('./FilePersist.js');
    return {
      kind:    'file',
      persist: new FilePersist({
        path:        args.path,
        saveDelayMs: args.saveDelayMs,
      }),
    };
  }
  if (typeof args.dbName === 'string' && args.dbName) {
    const { IndexedDBPersist } = await import('./IndexedDBPersist.js');
    return {
      kind:    'idb',
      persist: new IndexedDBPersist({
        dbName:      args.dbName,
        storeName:   args.storeName,
        saveDelayMs: args.saveDelayMs,
      }),
    };
  }
  return null;
}
