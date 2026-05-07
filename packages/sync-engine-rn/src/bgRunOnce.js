/**
 * bgRunOnce — module-level bridge between the OS-driven background
 * task (defined at JS-bundle load via `TaskManager.defineTask`) and a
 * live engine that's only built mid-session (after sign-in / after
 * a user opens the app for the first time).
 *
 * Why a module-level singleton:
 * - `TaskManager.defineTask` MUST be called at JS-bundle load time —
 *   the OS needs the registration whether or not a user has signed in.
 *   At that moment the engine doesn't exist yet.
 * - When an app's bootstrap later builds the engine, it calls
 *   `setBgRunOnce(() => engine.runOnce())` so subsequent task firings
 *   reach the live engine.
 * - On sign-out / engine teardown, `clearBgRunOnce()` blanks it again.
 *
 * If the OS fires the task while the engine isn't ready (cold wake,
 * during boot, after sign-out), `bgRunOnce()` resolves with `null` and
 * the task can return `noData` (Expo BackgroundFetch.BackgroundFetchResult.NoData).
 * No headless engine boot is attempted at this layer — the app may
 * choose to do that itself in its TaskManager.defineTask handler.
 *
 * Lifted from `apps/folio-mobile/src/lib/bgRunOnce.js` 2026-05-08.
 * Folio-mobile's `BG_TASK_NAME = 'folio-mobile-sync-background'` is
 * now a *per-app* concern: pass your own task name via
 * `registerBackgroundTask({ taskName, defineTask })`.
 */

let _runOnce = null;

/**
 * Wire the bg task to the current engine's `runOnce`.  Idempotent.
 *
 * @param {() => Promise<unknown>} fn
 */
export function setBgRunOnce(fn) {
  if (typeof fn !== 'function') {
    throw new Error('setBgRunOnce: function required');
  }
  _runOnce = fn;
}

/**
 * Disconnect the bg task from any prior engine.
 */
export function clearBgRunOnce() {
  _runOnce = null;
}

/**
 * Called by the OS-driven background task.  Resolves with the runOnce
 * result if a live engine is wired, or `null` if not.
 *
 * @returns {Promise<unknown|null>}
 */
export async function bgRunOnce() {
  if (typeof _runOnce !== 'function') return null;
  return _runOnce();
}

/**
 * Helper for apps that want a one-line registration of the bg task at
 * JS-bundle load time.  The caller passes the (already-imported) Expo
 * `TaskManager.defineTask` and the task name; this helper wires the
 * task body to call `bgRunOnce()` and convert the result to the
 * appropriate `BackgroundFetchResult`.
 *
 * Apps that need richer behaviour (cold-wake engine boot, custom
 * result mapping) should call `defineTask` themselves and call
 * `bgRunOnce()` from inside.
 *
 * @param {object} args
 * @param {string} args.taskName     OS-stable task name (must match the
 *                                    name used by `BackgroundFetch.registerTaskAsync`).
 * @param {Function} args.defineTask `TaskManager.defineTask` from `expo-task-manager`.
 * @param {object} args.results      `BackgroundFetch.BackgroundFetchResult`
 *                                    enum from `expo-background-fetch`.
 */
export function registerBackgroundTask({ taskName, defineTask, results }) {
  if (typeof taskName !== 'string' || !taskName) {
    throw new Error('registerBackgroundTask: taskName required');
  }
  if (typeof defineTask !== 'function') {
    throw new Error('registerBackgroundTask: defineTask required');
  }
  if (!results || typeof results !== 'object') {
    throw new Error('registerBackgroundTask: results enum required');
  }
  defineTask(taskName, async () => {
    try {
      const r = await bgRunOnce();
      return r == null ? results.NoData : results.NewData;
    } catch {
      return results.Failed;
    }
  });
}
