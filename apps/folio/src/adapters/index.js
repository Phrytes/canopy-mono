// Lifted to @canopy/sync-engine.  Re-export shim for back-compat.
// The full FsAdapter/HashAdapter/WatcherAdapter contracts are documented
// in @canopy/sync-engine/adapters.
export {
  fsNode,
  watcherNode,
  hashNode,
  joinPosix,
  dirnamePosix,
  basenamePosix,
  extnamePosix,
} from '@canopy/sync-engine/adapters';
