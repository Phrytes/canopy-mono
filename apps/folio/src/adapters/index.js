// Lifted to @onderling/sync-engine.  Re-export shim for back-compat.
// The full FsAdapter/HashAdapter/WatcherAdapter contracts are documented
// in @onderling/sync-engine/adapters.
export {
  fsNode,
  watcherNode,
  hashNode,
  joinPosix,
  dirnamePosix,
  basenamePosix,
  extnamePosix,
} from '@onderling/sync-engine/adapters';
