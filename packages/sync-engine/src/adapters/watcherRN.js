/**
 * watcherRN — interval-poll `WatcherAdapter` for React Native.
 *
 * RN has no chokidar.  The replacement walks the local tree periodically
 * (default 10s, configurable per `serviceFactory`) and compares each
 * file's `(mtimeMs, size)` pair against the previous walk.  Synthetic
 * events are emitted:
 *   - `add`    when a path appears that wasn't there before
 *   - `change` when `mtimeMs` OR `size` differ from the prior walk
 *   - `unlink` when a path is gone since the prior walk
 *
 * Tradeoffs
 * ---------
 * - Polling burns battery on a long-running app — by default we poll
 *   every 10 s, which keeps the cost modest and matches user expectation
 *   (mobile users tolerate "open the app to see updates" semantics).
 * - Background-fetch scheduling lives in `apps/folio/src/rn/backgroundTasks.js`,
 *   which fires `runOnce()` directly without going through the watcher.
 *
 * Why we expose `_walkOnce()` for tests
 * -------------------------------------
 * Real timers in vitest are flaky.  Tests inject the FS adapter and then
 * call `_walkOnce()` directly to assert the diffing logic.  Production
 * code never reaches for it.
 */

import { joinPosix } from './pathPosix.js';

/**
 * Default poll interval (10 s).  Per the C1 plan Q-C1.2.
 */
export const DEFAULT_POLL_INTERVAL_MS = 10_000;

/**
 * Build a fresh RN `WatcherAdapter`.
 *
 * @param {object} args
 * @param {import('./index.js').FsAdapter} args.fs
 *   FS adapter to use for walks (typically `fsRN`).
 * @param {number} [args.intervalMs=10_000]
 *   Poll interval in milliseconds.
 *
 * @returns {import('./index.js').WatcherAdapter}
 */
export function createWatcherRN({ fs, intervalMs = DEFAULT_POLL_INTERVAL_MS } = {}) {
  if (!fs) {
    throw new Error('createWatcherRN: fs adapter is required');
  }

  return {
    async start({ root, ignored, onEvent, onError }) {
      // Map<absPath, { mtimeMs, size }>
      let lastSnapshot = await safeWalk(fs, root, ignored, onError);
      let stopped = false;

      const tick = async () => {
        if (stopped) return;
        try {
          const fresh = await safeWalk(fs, root, ignored, onError);
          // Diff: files in fresh but not lastSnapshot → add; differing
          // (mtimeMs, size) → change; in lastSnapshot but not fresh → unlink.
          for (const [absPath, meta] of fresh) {
            const prior = lastSnapshot.get(absPath);
            if (!prior) {
              try { onEvent({ event: 'add', absPath }); }
              catch (err) { if (typeof onError === 'function') onError(err); }
              continue;
            }
            if (prior.mtimeMs !== meta.mtimeMs || prior.size !== meta.size) {
              try { onEvent({ event: 'change', absPath }); }
              catch (err) { if (typeof onError === 'function') onError(err); }
            }
          }
          for (const [absPath] of lastSnapshot) {
            if (!fresh.has(absPath)) {
              try { onEvent({ event: 'unlink', absPath }); }
              catch (err) { if (typeof onError === 'function') onError(err); }
            }
          }
          lastSnapshot = fresh;
        } catch (err) {
          if (typeof onError === 'function') onError(err);
        }
      };

      const timer = setInterval(() => { void tick(); }, intervalMs);
      // Don't pin the event loop in Node test environments.
      if (typeof timer.unref === 'function') timer.unref();

      return {
        async stop() {
          stopped = true;
          clearInterval(timer);
        },
        // Test-only escape hatch: trigger a single tick on demand.
        _tickForTest: tick,
      };
    },

    /**
     * Test-only — surface the walker so tests can assert it produces the
     * expected (path → meta) map without standing up a timer.  Call as
     * `watcherRN._walkOnce(root, ignored)`.
     */
    _walkOnce: (root, ignored) => safeWalk(fs, root, ignored, null),
  };
}

/**
 * Walk `root` recursively and return a Map<absPath, { mtimeMs, size }>.
 * `ignored(absPath)` filters out paths.  Errors during a single
 * `readdir` / `stat` are swallowed (best-effort) so a permission error
 * on one file doesn't take down the walk.
 */
async function safeWalk(fs, root, ignored, onError) {
  const out = new Map();
  await walk(fs, root, ignored, out, onError);
  return out;
}

async function walk(fs, dir, ignored, out, onError) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    // ENOENT → empty directory (root might not exist yet); other errors
    // surface to onError but don't abort sibling walks.
    if (err && err.code === 'ENOENT') return;
    if (typeof onError === 'function') onError(err);
    return;
  }
  for (const ent of entries) {
    const childAbs = joinPosix(dir, ent.name);
    if (typeof ignored === 'function' && ignored(childAbs)) continue;
    if (ent.isDirectory()) {
      await walk(fs, childAbs, ignored, out, onError);
      continue;
    }
    if (!ent.isFile()) continue;
    let st;
    try {
      st = await fs.stat(childAbs);
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      if (typeof onError === 'function') onError(err);
      continue;
    }
    out.set(childAbs, { mtimeMs: st.mtimeMs, size: st.size });
  }
}
