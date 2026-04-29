/**
 * backgroundTasks — minimal scaffold for periodic background sync on RN.
 *
 * Why this exists
 * ---------------
 * On mobile, the user expects "the app catches up when I open it" and
 * "the app catches up occasionally even when closed".  The first half is
 * served by `engine.runOnce()` on app foreground; the second half needs
 * platform background-fetch hooks.
 *
 * Per the C1 plan Q-C1.4: configurable cadence, default 30 minutes.
 * iOS Doze + Android Doze both impose minimum intervals; iOS in
 * particular schedules background-fetch opportunistically — the cadence
 * is a *floor* the OS may exceed.  Document this for users.
 *
 * What this file ships
 * --------------------
 * A tiny, pure-JS scaffold that takes `expo-background-fetch` +
 * `expo-task-manager` namespaces (peer-dep, injection-friendly) and
 * registers a task that calls `engine.runOnce()` on each fire.  Tests
 * mock the platform APIs at the module boundary; vitest never touches a
 * real device.
 *
 * C2 owns the actual app-side wiring:
 *   - calling `defineBackgroundTask({ TaskManager, taskName, runOnce })`
 *     ONCE at app startup (before any `registerBackgroundFetch`)
 *   - calling `registerBackgroundFetch({ BackgroundFetch, taskName, ... })`
 *     after the user signs in
 *   - calling `unregisterBackgroundFetch({ BackgroundFetch, taskName })`
 *     on sign-out
 */

/**
 * Default fetch cadence (30 min in seconds).  iOS treats this as a
 * MINIMUM; the OS schedules opportunistically and may run less often.
 * Android (WorkManager) treats it as a hint subject to Doze.
 */
export const DEFAULT_BACKGROUND_FETCH_INTERVAL_S = 30 * 60;

/**
 * Define the background task.  Must be called ONCE at app startup,
 * BEFORE `registerBackgroundFetch`.  This is the contract Expo requires:
 * `TaskManager.defineTask(name, fn)` must be evaluated when the JS
 * bundle loads, even on a cold start triggered by the OS waking the app
 * for a background fetch.
 *
 * @param {object} args
 * @param {object} args.TaskManager  `import * as TaskManager from 'expo-task-manager'`
 * @param {string} args.taskName     unique identifier (e.g. 'folio-sync-background')
 * @param {() => Promise<{ uploads:number, downloads:number, deletes:number, conflicts:number }>} args.runOnce
 *   A bound callable that performs ONE sync pass and resolves with the
 *   result counts.  Typically `engine.runOnce.bind(engine)`.
 *
 * @returns {void}
 */
export function defineBackgroundTask({ TaskManager, taskName, runOnce }) {
  if (!TaskManager) throw new Error('defineBackgroundTask: TaskManager namespace required');
  if (!taskName)    throw new Error('defineBackgroundTask: taskName required');
  if (typeof runOnce !== 'function') {
    throw new Error('defineBackgroundTask: runOnce(): Promise required');
  }
  TaskManager.defineTask(taskName, async () => {
    try {
      const r = await runOnce();
      // BackgroundFetchResult.NewData = 1 (per `expo-background-fetch`).
      // We can't import the constant here without a peer dep; surface
      // 'newData' / 'noData' as a string so the host app can map.
      const changed = (r?.uploads ?? 0) + (r?.downloads ?? 0) + (r?.deletes ?? 0);
      return changed > 0 ? 'newData' : 'noData';
    } catch {
      return 'failed';
    }
  });
}

/**
 * Register the periodic background fetch.  Must be called AFTER
 * `defineBackgroundTask` and AFTER the user is signed in (no point
 * waking the app to sync if there's no session).
 *
 * @param {object} args
 * @param {object} args.BackgroundFetch  `import * as BackgroundFetch from 'expo-background-fetch'`
 * @param {string} args.taskName         the same name passed to `defineBackgroundTask`
 * @param {number} [args.intervalSeconds=1800] minimum interval (30 min default)
 * @param {boolean} [args.startOnBoot=true]
 * @param {boolean} [args.stopOnTerminate=false]
 *
 * @returns {Promise<void>}
 */
export async function registerBackgroundFetch({ BackgroundFetch, taskName, intervalSeconds = DEFAULT_BACKGROUND_FETCH_INTERVAL_S, startOnBoot = true, stopOnTerminate = false }) {
  if (!BackgroundFetch) throw new Error('registerBackgroundFetch: BackgroundFetch namespace required');
  if (!taskName)        throw new Error('registerBackgroundFetch: taskName required');
  return BackgroundFetch.registerTaskAsync(taskName, {
    minimumInterval: intervalSeconds,
    startOnBoot,
    stopOnTerminate,
  });
}

/**
 * Tear down the registration (on sign-out).
 *
 * @param {object} args
 * @param {object} args.BackgroundFetch
 * @param {string} args.taskName
 * @returns {Promise<void>}
 */
export async function unregisterBackgroundFetch({ BackgroundFetch, taskName }) {
  if (!BackgroundFetch) throw new Error('unregisterBackgroundFetch: BackgroundFetch namespace required');
  if (!taskName)        throw new Error('unregisterBackgroundFetch: taskName required');
  return BackgroundFetch.unregisterTaskAsync(taskName);
}

/**
 * Read the current registration status.  Useful for surfacing a "last
 * background sync: 12 minutes ago" UI element.
 *
 * @param {object} args
 * @param {object} args.BackgroundFetch
 * @returns {Promise<{ status: number, isRegistered: (taskName: string) => Promise<boolean> }>}
 */
export async function statusBackgroundFetch({ BackgroundFetch }) {
  if (!BackgroundFetch) throw new Error('statusBackgroundFetch: BackgroundFetch namespace required');
  const status = await BackgroundFetch.getStatusAsync();
  return {
    status,
    async isRegistered(taskName) {
      // Some Expo versions expose this on TaskManager; we leave it to
      // callers who already have TaskManager — too thin a wrapper to
      // bother re-exposing here.
      return typeof BackgroundFetch.getRegisteredTasksAsync === 'function'
        ? !!(await BackgroundFetch.getRegisteredTasksAsync()).find((t) => t === taskName)
        : true;
    },
  };
}
