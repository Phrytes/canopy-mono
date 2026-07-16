/**
 * bgRunOnce — Stoop-mobile bridge between the OS-driven background
 * task (defined at app-load via TaskManager.defineTask in index.js)
 * and the live Stoop sync engine (built inside ServiceContext after
 * sign-in / local bring-up).
 *
 * Mirrors `apps/folio-mobile/src/lib/bgRunOnce.js` — same module-level
 * singleton pattern, just with a stoop-specific task name.
 *
 * The underlying `setBgRunOnce` / `clearBgRunOnce` / `bgRunOnce`
 * helpers live in `@onderling/sync-engine-rn` (lifted 2026-05-08).
 */

export {
  setBgRunOnce,
  clearBgRunOnce,
  bgRunOnce,
  defineBackgroundTask,
  registerBackgroundFetch,
  unregisterBackgroundFetch,
  DEFAULT_BACKGROUND_FETCH_INTERVAL_S,
} from '@onderling/sync-engine-rn';

/**
 * Stable task name used by both `defineBackgroundTask` (at index.js
 * load) and `registerBackgroundFetch` / `unregisterBackgroundFetch`
 * (in ServiceContext, Phase 40.10). Keep the two callsites in sync
 * via this constant.
 */
export const BG_TASK_NAME = 'stoop-mobile-sync-background';
