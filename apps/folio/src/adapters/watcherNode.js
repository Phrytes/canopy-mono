/**
 * watcherNode — chokidar-backed default `WatcherAdapter`.
 *
 * Mirrors what SyncEngine used to do inline.  Translates chokidar's
 * `'all'` event stream into the adapter's `{ event, absPath }` shape:
 *   - chokidar `add`     → `{ event: 'add', absPath }`
 *   - chokidar `change`  → `{ event: 'change', absPath }`
 *   - chokidar `unlink`  → `{ event: 'unlink', absPath }`
 *   - chokidar `addDir` / `unlinkDir` are dropped (SyncEngine doesn't
 *     act on directory events; v1 walks the tree itself).
 *
 * `ignored` predicate is wired straight through to chokidar's matcher.
 */

import chokidar from 'chokidar';

/**
 * Build a fresh Node `WatcherAdapter`.  Each call returns a fresh object
 * — there is no shared state between watchers.
 *
 * @returns {import('./index.js').WatcherAdapter}
 */
export function createWatcherNode() {
  return {
    async start({ root, ignored, onEvent, onError }) {
      const watcher = chokidar.watch(root, {
        persistent:    true,
        ignoreInitial: true,
        ignored:       typeof ignored === 'function' ? ignored : undefined,
      });
      watcher.on('all', (event, absPath) => {
        if (event === 'add' || event === 'change' || event === 'unlink') {
          try {
            onEvent({ event, absPath });
          } catch (err) {
            if (typeof onError === 'function') onError(err);
          }
        }
      });
      watcher.on('error', (err) => {
        if (typeof onError === 'function') onError(err);
      });
      return {
        async stop() {
          try {
            await watcher.close();
          } catch {
            // swallow — close() is best-effort
          }
        },
      };
    },
  };
}

/** Default singleton. */
export const watcherNode = createWatcherNode();
