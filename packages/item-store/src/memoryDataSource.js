/**
 * memoryDataSource — a Map-backed `core.DataSource` (`read`/`write`/`delete`/`list`).
 *
 * The no-pod / pseudo-pod backing for a `CircleItemStore` (cluster L · L1), and the default for tests.
 * Values are stored verbatim (the stores write JSON strings). `list(prefix)` returns the keys whose URI
 * starts with `prefix` — matching how `ItemStore`/`CircleItemStore` enumerate `…/items/`.
 *
 * For a persistent no-pod backing, swap this for an IDB/AsyncStorage-backed `CachingDataSource` (the same
 * shape the household per-circle registry already uses, realAgent.js); for a sealed pod, inject a
 * pod-client-backed DataSource. The store doesn't care — it only needs `read/write/delete/list`.
 */
export function memoryDataSource(seed) {
  const m = seed instanceof Map ? seed : new Map();
  return {
    /** @internal exposed for tests/inspection */ _map: m,
    async read(uri)       { return m.has(uri) ? m.get(uri) : null; },
    async write(uri, val) { m.set(uri, val); },
    async delete(uri)     { m.delete(uri); },
    async list(prefix)    { return [...m.keys()].filter((k) => k.startsWith(prefix)); },
  };
}
