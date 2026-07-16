/**
 * Re-export of the lifted active-cadence helper.
 *
 * The implementation moved to `@onderling/online-cadence` 2026-05-09
 * (Phase 41.0 L2). This file stays as a re-export so existing imports
 * keep working.
 */
export { createActiveCadence, _cadenceInternal as _internal } from '@onderling/online-cadence';
