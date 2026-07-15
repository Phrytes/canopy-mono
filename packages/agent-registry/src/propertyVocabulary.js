// Property vocabulary — the TYPED catalogue for the property layer (design Phase 0).
// See plans/NOTE-property-layer-design.md §1–2.
//
// The STORE (profileProperties.js) keeps a property's `value` OPAQUE. This layer adds the
// *type* metadata ALONGSIDE it, keyed by property key — so the store stays untouched and
// `value` stays extensible: a scalar/enum today, OR a structured `{ code, system, ... }`
// form for coded/medical properties (NOTE-property-layer-design.md §6). NEVER assume a
// property value is a string.
//
// A vocabulary is the union of DESCRIPTORS. A descriptor describes ONE key: its type, its
// coarseness ladder (rung names, COARSEST→finest), an optional coarsen(value, rung), and a
// sensitivity hint. Concrete descriptors (place/ageBand/role → coarse-enum; goals → driver;
// allergy → coded) are REGISTERED by consumers, so agent-registry stays independent of any
// one vocabulary (e.g. @canopy/attribute-charter's coarse-enum set).

export const PROPERTY_TYPES = Object.freeze(['coarse-enum', 'driver', 'coded', 'credential', 'scalar']);

export function isPropertyType(t) { return PROPERTY_TYPES.includes(t); }

/**
 * Build a validated, frozen descriptor for one property key.
 * @param {object} d
 * @param {string} d.key
 * @param {string} [d.type='scalar']                one of PROPERTY_TYPES
 * @param {string[]} [d.ladder=null]                rung names, COARSEST→finest (null = no ladder)
 * @param {(value:any, rung:?string)=>any} [d.coarsen=null]  coarsen a value to a rung (default: identity)
 * @param {string} [d.sensitivity='normal']         'normal' | 'sensitive' | 'special-category'
 */
export function descriptor({ key, type = 'scalar', ladder = null, coarsen = null, sensitivity = 'normal' } = {}) {
  if (typeof key !== 'string' || !key) throw new TypeError('descriptor: key required');
  if (!isPropertyType(type)) throw new RangeError(`descriptor: unknown type ${JSON.stringify(type)}`);
  if (ladder != null && (!Array.isArray(ladder) || ladder.some((r) => typeof r !== 'string'))) {
    throw new TypeError('descriptor: ladder must be an array of rung names (coarsest→finest)');
  }
  if (coarsen != null && typeof coarsen !== 'function') throw new TypeError('descriptor: coarsen must be a function');
  return Object.freeze({
    key,
    type,
    ladder: ladder ? Object.freeze([...ladder]) : null,
    coarsen: coarsen || null,
    sensitivity,
  });
}

/** A vocabulary over a set of descriptors. Read-only lookups + a value-coarsening helper. */
export function createVocabulary(descriptors = []) {
  const byKey = new Map();
  for (const d of descriptors) {
    const norm = d && d.key && d.type && d.ladder !== undefined ? d : descriptor(d);
    byKey.set(norm.key, norm);
  }
  return Object.freeze({
    has: (k) => byKey.has(k),
    get: (k) => byKey.get(k) ?? null,
    type: (k) => byKey.get(k)?.type ?? null,
    ladder: (k) => byKey.get(k)?.ladder ?? null,
    sensitivity: (k) => byKey.get(k)?.sensitivity ?? null,
    keys: () => [...byKey.keys()],
    /**
     * Coarsen a value for `key` to `rung`. Uses the descriptor's coarsen fn when present;
     * otherwise returns the value unchanged (the rung is then only a label). A value shape
     * the coarsen fn doesn't understand is returned as-is (never throws) — coarsening is a
     * privacy REDUCTION, so "couldn't coarsen" must never accidentally reveal MORE than asked;
     * callers gate on the descriptor when that matters.
     */
    coarsen: (k, value, rung) => {
      const d = byKey.get(k);
      if (!d?.coarsen) return value;
      try { return d.coarsen(value, rung ?? null); } catch { return value; }
    },
  });
}
