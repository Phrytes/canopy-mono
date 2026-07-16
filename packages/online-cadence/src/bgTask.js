/**
 * bgTask — convenience re-exports of the bg-task helpers that already
 * live in `@onderling/sync-engine-rn`. Apps using `online-cadence` for
 * the foreground ticker typically also want the bg-fetch bridge in
 * the same import line.
 *
 * The actual implementation stays in sync-engine-rn (it was lifted
 * there from folio-mobile in 2026-05-08).
 */

export {
  setBgRunOnce,
  clearBgRunOnce,
  bgRunOnce,
  registerBackgroundTask,
  defineBackgroundTask,
  registerBackgroundFetch,
  unregisterBackgroundFetch,
  statusBackgroundFetch,
  DEFAULT_BACKGROUND_FETCH_INTERVAL_S,
} from '@onderling/sync-engine-rn';
