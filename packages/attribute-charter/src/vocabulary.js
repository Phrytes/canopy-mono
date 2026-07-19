/**
 * Curated coarse vocabulary — the ONLY attributes a charter can request, at the
 * ONLY granularities allowed. The coarsening is part of the vocabulary itself:
 * a project lead literally cannot request "exact age" or an address, because the
 * value space is fixed to a handful of buckets here. New attributes are added
 * centrally (with a coarsening), never invented per-project.
 *
 * Sits inside the general personal-properties / disclosure model.
 */

// `buckets: null` = an open value that is coarse by KIND rather than by enum.
// `place` is a municipality name (a named district is a later, cohort-gated
// refinement) — never an address or coordinates. Its value is validated as a
// short non-numeric label, not against a fixed list.
export const VOCABULARY = Object.freeze({
  place: Object.freeze({
    buckets: null,
    granularity: 'municipality',
    note: 'municipality; a named district ONLY for large cohorts (deferred)',
    never: Object.freeze(['address', 'coordinates', 'postcode']),
  }),
  ageBand: Object.freeze({
    buckets: Object.freeze(['<18', '18-34', '35-54', '55+']),
    never: Object.freeze(['birthdate', 'exact-age']),
  }),
  // NAMESPACE — this is `charter:role`, NOT `governance:role`. It is a DISCLOSED
  // coarse background attribute (who you are in a neighbourhood: resident /
  // visitor / …). It grants NOTHING: no rank, no authority, no policy gate. The
  // rank-bearing standing (admin/coordinator/member) lives in
  // packages/core/src/permissions/Roles.js and is a wholly separate concept that
  // merely shares the bare word "role". Reference this key via CHARTER_ROLE_KEY
  // (below) so it can never be confused with the governance role. See
  // plans/PLAN-capabilities-tasks-roles.md Phase 0 (NAMESPACE — kill the `role` collision).
  role: Object.freeze({
    buckets: Object.freeze(['resident', 'works-here', 'visitor', 'business-owner']),
    never: Object.freeze(['free-text']),
  }),
  tenure: Object.freeze({
    buckets: Object.freeze(['<2y', '2-10y', '10y+']),
    never: Object.freeze(['move-in-date']),
  }),
  household: Object.freeze({
    buckets: Object.freeze(['alone', 'with-others', 'with-kids']),
    never: Object.freeze(['names', 'count']),
  }),
});

/**
 * The disambiguated key for the charter `role` attribute — i.e. `charter:role`.
 *
 * Two unrelated concepts share the bare word "role" in this codebase:
 *  - **charter role** (THIS): a disclosed personal property describing who you
 *    are in a neighbourhood (resident / works-here / visitor / business-owner).
 *    It is a plain coarse-enum attribute; it grants NO rank and NO authority.
 *  - **governance role** (`packages/core/src/permissions/Roles.js`): a
 *    rank-bearing standing (admin / coordinator / member …) that grants
 *    authority and satisfies policy gates.
 *
 * Reference the charter attribute through this constant (never a bare `'role'`
 * literal) so a build path can never conflate the two. Convention: write
 * `charter:role` vs `governance:role` in docs/comments when they must coexist.
 */
export const CHARTER_ROLE_KEY = 'role';

/** The attribute keys the vocabulary offers. */
export function attributeKeys() {
  return Object.keys(VOCABULARY);
}

/** Is `key` a known vocabulary attribute? */
export function isVocabKey(key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(VOCABULARY, key);
}

/** The allowed buckets for an enum attribute, or null for an open-coarse one (place). */
export function bucketsFor(key) {
  return isVocabKey(key) ? VOCABULARY[key].buckets : undefined;
}

/**
 * Is `value` an allowed coarse value for `key`?
 * - enum attributes: must be exactly one of the buckets.
 * - `place` (open-coarse): a short non-empty label that is not a number /
 *   coordinate / postcode-looking string (defence-in-depth against fine values
 *   sneaking through; the vocabulary is the primary guard).
 */
export function isValidValue(key, value) {
  if (!isVocabKey(key)) return false;
  const buckets = VOCABULARY[key].buckets;
  if (buckets) return buckets.includes(value);
  // open-coarse (place): reject anything that looks finer than a place label
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (v.length === 0 || v.length > 60) return false;
  if (/\d{4,}/.test(v)) return false;                 // postcodes / coordinates
  if (/[-+]?\d+\.\d+/.test(v)) return false;           // decimal coordinates
  return true;
}

/** The maximum bucket count for an attribute — used by the device-warning combo-space estimate. */
export function bucketCount(key) {
  if (!isVocabKey(key)) return 0;
  const buckets = VOCABULARY[key].buckets;
  // `place` is open-coarse → treat as highly identifying (many possible values).
  return buckets ? buckets.length : PLACE_COMBO_WEIGHT;
}

// A place is far more identifying than a 3-5 bucket enum; weight it heavily so
// the device warning fires when place is combined with other attributes.
/** Effective bucket count `bucketCount` assigns the open-coarse `place` attribute (no fixed buckets). */
export const PLACE_COMBO_WEIGHT = 1000;
