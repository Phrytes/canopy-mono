/**
 * availabilityGrid — pure-fn helpers for the V2.3 7×2 availability
 * grid (days × half-days).
 *
 * Phase 41.9 (2026-05-09).
 *
 * The substrate's `AvailabilityHints` data class lives at
 * `apps/tasks-v0/src/availability/AvailabilityHints.js`; the mobile
 * screen exchanges per-cell state via the `setMyAvailability` /
 * `getMyAvailability` skills. This file owns the pure UI bits:
 *   - state cycle (unknown → open → tight → unavailable → unknown)
 *   - colour/label mapping
 *   - ISO-week calculation for the "current week" header
 */

export const STATE_CYCLE = ['unknown', 'open', 'tight', 'unavailable'];

/** Next state after a tap. Wraps around at the end. */
export function nextState(s) {
  const i = STATE_CYCLE.indexOf(s);
  if (i < 0) return STATE_CYCLE[0];
  return STATE_CYCLE[(i + 1) % STATE_CYCLE.length];
}

/** Theme token key for each state's pill background. */
export const STATE_COLOR = Object.freeze({
  unknown:     'surfaceMuted',
  open:        'success',
  tight:       'warning',
  unavailable: 'danger',
});

/** Localisation keys for each state. */
export const STATE_LABEL_KEY = Object.freeze({
  unknown:     'mobile.availability.state_unknown',
  open:        'mobile.availability.state_open',
  tight:       'mobile.availability.state_tight',
  unavailable: 'mobile.availability.state_unavailable',
});

/** ISO-week label `YYYY-Www` for `now`. */
export function isoWeekOf(now = new Date()) {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** Day order for the grid header. Short labels — apps localise the long form. */
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const HALVES = ['am', 'pm'];

/**
 * Build the 7×2 grid from a per-cell `{[day]: {am, pm}}` map.
 * Returns rows of `{day, am, pm}` for FlatList rendering.
 *
 * @param {object} weekState  e.g. `{mon: {am: 'open', pm: 'unknown'}, tue: {...}}`
 * @returns {Array<{day: string, am: string, pm: string}>}
 */
export function buildGrid(weekState = {}) {
  return DAYS.map((day) => ({
    day,
    am: weekState?.[day]?.am ?? 'unknown',
    pm: weekState?.[day]?.pm ?? 'unknown',
  }));
}
