// Stub for chokidar (Node-only file-watcher; folio's watcherNode adapter
// uses it via @onderling/sync-engine). RN never reaches it.
export default {};
export const watch = () => ({
  on:    () => ({}),
  close: async () => {},
});
