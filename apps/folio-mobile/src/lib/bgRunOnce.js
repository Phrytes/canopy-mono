/**
 * bgRunOnce — tiny module-level bridge between the OS-driven background
 * task (defined at app-load via TaskManager.defineTask, see index.js)
 * and the live Folio sync engine (built inside ServiceContext after
 * sign-in).
 *
 * Why a module-level singleton:
 * - `TaskManager.defineTask` MUST be called at JS-bundle load time —
 *   the OS needs the registration whether or not a user has signed in.
 *   At that moment the engine doesn't exist yet.
 * - When ServiceContext later boots the engine, it calls
 *   `setBgRunOnce(() => engine.runOnce())` so subsequent task firings
 *   reach the live engine.
 * - On sign-out / engine teardown, `clearBgRunOnce()` blanks it again.
 *
 * If the OS fires the task while the engine isn't ready (cold wake,
 * during boot, after sign-out), `bgRunOnce()` resolves with `null` and
 * the task returns `noData` to the OS.  No headless engine boot is
 * attempted in this v0 — that's a follow-up (see SOLID-RN-NOTES if a
 * trap surfaces during cold-wake testing).
 */

let _runOnce = null;

/**
 * Wire the bg task to the current engine's `runOnce`.  Idempotent.
 *
 * @param {() => Promise<{ uploads:number, downloads:number, deletes:number, conflicts:number }>} fn
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
 * result if a live engine is wired, or `null` if not (task returns
 * `noData`).
 *
 * @returns {Promise<null | { uploads:number, downloads:number, deletes:number, conflicts:number }>}
 */
export async function bgRunOnce() {
  if (typeof _runOnce !== 'function') return null;
  return _runOnce();
}

/**
 * Stable task name used by both `defineBackgroundTask` (at index.js
 * load) and `registerBackgroundFetch` / `unregisterBackgroundFetch`
 * (in ServiceContext).  Keep them in sync via this constant.
 */
export const BG_TASK_NAME = 'folio-mobile-sync-background';
