/**
 * Stub for `chokidar` — used by Folio's Node-side watcherNode adapter.
 * RN runtime uses watcherRN (interval polling), so the import only
 * needs to resolve so the engine module graph loads.
 */
export default {
  watch: () => ({
    on:    () => ({}),
    close: async () => {},
  }),
};
