// availability — the UNIFIED person-level "am I reachable?" property (availability
// unification, plans/NOTE-skills-properties-audit.md §4/§5, decision). It replaces
// TWO older models that meant the same thing: the per-offering `availability` sub-field
// (MemberMap.offerings[].availability) AND the standalone `holidayMode` boolean. There is
// now ONE property key `availability` on the profile graph; offerings REFERENCE it (they do
// not each carry a copy), and holiday mode is simply its coarsest 'away' value.
//
// Modelled PRAGMATICALLY as a coarse-enum-style property (like place/ageBand) — NOT a
// calendar: a small state enum, not free/busy times.
//   • open    — generally available
//   • limited — free/busy; reachable some of the time
//   • away    — holiday / not available (== the old holidayMode:true)
// The value is a plain state string today. The ladder is coarsest→finest
// `['state','detail']`: coarsening to 'state' drops any richer free-text "when"
// (a future 'detail' rung — TODO: a small agenda) and yields just the state; the
// 'detail' rung releases the whole value. coarsen() FAILS CLOSED — an unknown/null
// rung collapses to the bare state, never revealing more than asked.
//
// Pure — web ≡ mobile, no I/O. The STORE keeps the value opaque; this module owns the
// shape + validation, like drivers.js / offeringsTaxonomy.js.

import { descriptor } from './propertyVocabulary.js';

/** The valid availability states, coarsest concept first (frozen). */
export const AVAILABILITY_STATES = Object.freeze(['open', 'limited', 'away']);

/** The coarse 'away' value — this IS holiday mode (the old `holidayMode:true`). */
export const AVAILABILITY_AWAY = 'away';

/**
 * The availability coarseness ladder, COARSEST→finest (propertyVocabulary convention):
 * `state` (just the state string) → `detail` (the whole value incl. a future free-text
 * "when"). Below `state` sits the implicit ∅ — disclosure withholds the key entirely.
 */
export const AVAILABILITY_LADDER = Object.freeze(['state', 'detail']);

/** True iff `v` is one of the AVAILABILITY_STATES strings. */
export function isAvailabilityState(v) {
  return typeof v === 'string' && AVAILABILITY_STATES.includes(v);
}

/**
 * Extract the coarse STATE from a stored availability value. Accepts both the plain
 * string form (`'away'`) and a future structured form (`{ state, when }`) — returns the
 * state string, or `null` when nothing recognisable is present.
 *
 * @param {string|{state?:string}} value
 * @returns {string|null}
 */
export function availabilityState(value) {
  if (isAvailabilityState(value)) return value;
  if (value && typeof value === 'object' && !Array.isArray(value) && isAvailabilityState(value.state)) {
    return value.state;
  }
  return null;
}

/** True iff the availability value resolves to 'away' (holiday / not reachable). */
export function isAway(value) {
  return availabilityState(value) === AVAILABILITY_AWAY;
}

/**
 * The property-vocabulary descriptor for the availability key. Type `coarse-enum`
 * (a small bucket set, like place/ageBand), ladder `state → detail`. Coarsening is
 * FAIL-CLOSED: only the `detail` rung releases the whole value; `state` — and any
 * null/unknown rung — collapses to the bare state string (dropping any free-text
 * "when", a future 'detail'-only field).
 *
 * @param {string} [key='availability']
 */
export function availabilityDescriptor(key = 'availability') {
  return descriptor({
    key,
    type: 'coarse-enum',
    ladder: AVAILABILITY_LADDER,
    sensitivity: 'normal',
    coarsen: (value, rung) => {
      // 'detail' (finest) releases the whole value (incl. a future free-text "when").
      if (rung === 'detail') return value;
      // 'state' (coarsest) — and any null/unknown rung — fail-closed to the bare state.
      return availabilityState(value);
    },
  });
}
