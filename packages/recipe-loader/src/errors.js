/**
 * Coded errors for the recipe loader (B #64).
 *
 * Every failure path returns `{ error: { code, message, ... } }` — a stable,
 * machine-readable `code` (so a caller/UI can branch without string-matching)
 * plus a human `message`. Field-level validation failures aggregate into a
 * single `RECIPE_CODES.INVALID` error carrying an `issues[]` array — one entry
 * per problem, each with its own `code` + JSON-pointer-ish `path` — mirroring
 * `@onderling/app-manifest` `validateManifest`'s `{ ok, errors }` shape.
 */

/** Top-level (whole-load) failure codes returned as `error.code`. */
export const RECIPE_CODES = Object.freeze({
  /** `source` was a URL but no `fetch` was injected (offline-by-construction). */
  NO_FETCH:      'no-fetch',
  /** the injected `fetch` threw or resolved to something unreadable. */
  FETCH_FAILED:  'fetch-failed',
  /** the fetched/passed text was not parseable JSON. */
  PARSE_FAILED:  'parse-failed',
  /** the parsed value is not a plain object. */
  NOT_OBJECT:    'not-an-object',
  /** one or more fields failed validation — see `error.issues[]`. */
  INVALID:       'invalid-recipe',
  /** an injected `verify` was supplied and returned falsy — deny-by-default. */
  VERIFY_DENIED: 'verify-denied',
  /** an injected `verify` threw — treated as a denial. */
  VERIFY_ERROR:  'verify-error',
});

/** Per-issue codes used inside `error.issues[]` (field-level validation). */
export const ISSUE_CODES = Object.freeze({
  NOT_OBJECT:       'not-an-object',
  BAD_NOUN:         'bad-noun',           // noun not in the @onderling/item-types registry
  BAD_ATOM:         'bad-atom',           // verb not an SDK atom (see atoms.js)
  BAD_ATOMS_SHAPE:  'bad-atoms-shape',    // capabilities[noun].atoms is not an array
  BAD_CAP_ENTRY:    'bad-capability',     // capabilities[noun] is not an { atoms } object
  BAD_FREEDOM_KEY:  'bad-freedom-key',    // freedom key isn't "<app> <atom> <noun>"
  BAD_FREEDOM:      'bad-freedom',        // freedom not 'required'|'optional'
  BAD_CONSEQUENCE:  'bad-consequence',    // consequence not greyed|hidden|limited
  BAD_ENABLED:      'bad-enabled',        // enabled not boolean
  BAD_PRIVACY_FLOOR:'bad-privacy-floor',  // privacyFloor not boolean
  BAD_FREEDOM_ENTRY:'bad-freedom-entry',  // freedoms[key] is not an object
  BAD_SETTING_KEY:  'bad-setting-key',    // setting key isn't "<app>.<key>"
  BAD_SETTING_VALUE:'bad-setting-value',  // setting value isn't JSON-serialisable
  BAD_FEATURES:     'bad-features',       // surfaces.features isn't an object
  BAD_FEATURE:      'bad-feature',        // a feature flag isn't a boolean
  BAD_VIEW:         'bad-view',           // surfaces.view isn't a non-empty string
  BAD_SECTION:      'bad-section',        // a top-level section has the wrong type
});

/** Non-fatal advisories surfaced in `warnings[]` (never flip a load to failure). */
export const WARNING_CODES = Object.freeze({
  /** no `verify` was supplied — the recipe's origin/signature is unchecked. */
  UNVERIFIED:    'unverified',
  /** an atom was declared by an alias; it was canonicalised on normalise. */
  ALIAS_ATOM:    'alias-atom',
  /** an unrecognised top-level field was tolerated (forward-additive). */
  UNKNOWN_FIELD: 'unknown-field',
});

/** Build a top-level `{ error }` result. */
export function fail(code, message, extra = {}) {
  return { error: { code, message, ...extra } };
}
