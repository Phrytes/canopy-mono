/**
 * loadRecipe — fetch (optionally), parse, validate + normalise, and
 * trust-gate an AUTHORED REMOTE recipe (B #64).
 *
 *   loadRecipe(source, { fetch?, verify? }) → { recipe, warnings } | { error }
 *
 * `source` is one of:
 *   - an OBJECT — used directly as the parsed recipe (rawSource = the object);
 *   - a URL string (`http(s)://…` / `file://…`) — fetched via the INJECTED
 *     `fetch` (there is no ambient network here: no `fetch` ⇒ `no-fetch`);
 *   - any other string — parsed as JSON.
 *
 * TRUST SEAM (deny-by-default). `verify(recipe, rawSource) → boolean` is an
 * injected signature/origin check — the ONLY place trust is decided. When a
 * `verify` is supplied it must return truthy or the load is DENIED
 * (`verify-denied`); if it throws, that too is a denial (`verify-error`). When
 * NO `verify` is supplied the recipe still loads but carries a
 * `warnings: ['unverified']` advisory. This slice deliberately ships only the
 * SEAM — real signature crypto (key discovery, canonical-bytes, algorithm) is
 * out of scope and plugs in behind this same `verify` contract.
 *
 * DEFERRED (reported, not built): turning a loaded recipe into an ACTIVE circle
 * policy — the apply-wiring — lives in canopy-chat (it needs CIRCLE_FEATURES /
 * CIRCLE_POLICY_ENUMS + the installed manifests to schema-check settings and
 * merge onto DEFAULT_CIRCLE_POLICY). This package stops at a validated,
 * normalised, trust-tagged bundle ready to hand to that applier.
 *
 * @param {string|object} source
 * @param {object} [opts]
 * @param {(url:string) => (string | {text?:()=>Promise<string>|string, json?:()=>Promise<any>|any} | Promise<any>)} [opts.fetch]
 *   injected fetcher — returns a string, or a Response-like `{ text()/json() }`.
 * @param {(recipe:object, rawSource:string|object) => boolean} [opts.verify]
 *   injected trust check — see TRUST SEAM above.
 * @returns {Promise<{ recipe: object, warnings: string[] } | { error: { code:string, message:string, issues?:Array } }>}
 */
import { validateRecipe } from './validateRecipe.js';
import { RECIPE_CODES, WARNING_CODES, fail } from './errors.js';

const { NO_FETCH, FETCH_FAILED, PARSE_FAILED, NOT_OBJECT, INVALID, VERIFY_DENIED, VERIFY_ERROR } = RECIPE_CODES;
const { UNVERIFIED } = WARNING_CODES;

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const isUrl = (s) => /^(https?|file):\/\//i.test(s);

export async function loadRecipe(source, { fetch, verify } = {}) {
  // 1. Resolve `source` → a raw value + the raw bytes/object we hand to verify.
  let parsed;
  let rawSource;
  if (isPlainObject(source)) {
    parsed = source;
    rawSource = source;
  } else if (typeof source === 'string') {
    if (isUrl(source)) {
      if (typeof fetch !== 'function') {
        return fail(NO_FETCH, `source looks like a URL (${source}) but no fetch was injected`);
      }
      let text;
      try {
        text = await readFetched(await fetch(source));
      } catch (e) {
        return fail(FETCH_FAILED, `fetch failed for ${source}: ${e?.message ?? e}`);
      }
      rawSource = text;
      const p = tryParse(text);
      if (p.error) return p.error;
      parsed = p.value;
    } else {
      rawSource = source;
      const p = tryParse(source);
      if (p.error) return p.error;
      parsed = p.value;
    }
  } else {
    return fail(NOT_OBJECT, `source must be a URL string, a JSON string, or an object (got ${typeof source})`);
  }

  // 2. Validate + normalise.
  const result = validateRecipe(parsed);
  if (!result.ok) {
    return fail(INVALID, `recipe failed validation (${result.issues.length} issue(s))`, { issues: result.issues });
  }
  const recipe = result.recipe;
  const warnings = result.warnings.map((w) => w.code);

  // 3. Trust gate (deny-by-default when a verify is supplied).
  if (typeof verify === 'function') {
    let ok;
    try {
      ok = verify(recipe, rawSource);
    } catch (e) {
      return fail(VERIFY_ERROR, `verify threw: ${e?.message ?? e}`);
    }
    if (!ok) {
      return fail(VERIFY_DENIED, 'recipe rejected by verify (untrusted origin/signature)');
    }
  } else {
    warnings.push(UNVERIFIED);
  }

  return { recipe, warnings };
}

/** Read a fetch result that may be a string or a Response-like object. */
async function readFetched(res) {
  if (typeof res === 'string') return res;
  if (res && typeof res.text === 'function') return await res.text();
  if (res && typeof res.json === 'function') return JSON.stringify(await res.json());
  throw new Error('fetch returned neither a string nor a Response-like { text()/json() }');
}

/** Parse JSON text into `{ value }` or `{ error }` (a top-level parse-failed result). */
function tryParse(text) {
  try {
    return { value: JSON.parse(text) };
  } catch (e) {
    return { error: fail(PARSE_FAILED, `source is not valid JSON: ${e?.message ?? e}`) };
  }
}
