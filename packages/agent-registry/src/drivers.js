// Personal drivers — the `driver` property type (property layer §12 / plans note
// `personal-drivers-matching`). A driver is an OPT-IN, deeply personal property: what someone is
// trying to do or cares about, BEYOND skills (a hobby, goal, desire, motivation). It is just
// another property on the profile graph, so per-persona / per-circle disclosure comes for free
// from the existing disclosure policy — the value here is only the SHAPE + validation.
//
// Deliberately OPEN / semantic, NOT coarse buckets (contrast coarse-enum place/ageBand): a driver
// is a short human phrase + normalized tags. That shape keeps BOTH matching paths open —
// deterministic tag-overlap AND an optional LLM re-rank — while every surfaced match stays
// explainable ("you both care about: sailing, learning"), never a raw opaque score.
//
// Pure — web ≡ mobile, no I/O. The STORE keeps the value opaque; this module is the only place
// that knows a driver's internal shape.

import { descriptor } from './propertyVocabulary.js';

/** The kinds of personal driver. `driver` is the generic catch-all; the rest are finer intents. */
export const DRIVER_KINDS = Object.freeze(['hobby', 'goal', 'desire', 'motivation', 'driver']);

/** True iff `k` is one of the DRIVER_KINDS strings. */
export function isDriverKind(k) { return typeof k === 'string' && DRIVER_KINDS.includes(k); }

/**
 * Normalise one tag: lowercased, trimmed, internal whitespace/underscores → single hyphens,
 * stripped of anything but [a-z0-9-]. Returns '' for junk (callers drop empties). Keeps the tag
 * vocabulary clean so tag-overlap matching is stable across authors.
 */
export function normalizeTag(t) {
  return String(t ?? '')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Normalise + de-duplicate a tag list, preserving first-seen order. */
export function normalizeTags(tags) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(tags) ? tags : []) {
    const n = normalizeTag(raw);
    if (n && !seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
}

/**
 * Build a validated, frozen driver value: `{ kind, text, tags[] }`.
 * - `kind` falls back to the generic `driver` when unknown.
 * - `text` is a trimmed human phrase (may be empty when tags carry the meaning).
 * - `tags` are normalised + de-duped.
 * A driver with neither text NOR tags is meaningless — throws (nothing to disclose or match on).
 *
 * @param {{kind?:string, text?:string, tags?:string[]}} d
 * @returns {{kind:string, text:string, tags:string[]}}
 */
export function createDriver({ kind = 'driver', text = '', tags = [] } = {}) {
  const k = isDriverKind(kind) ? kind : 'driver';
  const t = String(text ?? '').trim();
  const tg = normalizeTags(tags);
  if (!t && tg.length === 0) {
    throw new TypeError('createDriver: a driver needs at least text or one tag');
  }
  return Object.freeze({ kind: k, text: t, tags: Object.freeze(tg) });
}

/**
 * Shape guard for an opaque stored property value — true iff `v` is a well-formed driver value.
 * The property store keeps values opaque, so consumers use this to know "is this key a driver?".
 */
export function isDriverValue(v) {
  return !!v
    && typeof v === 'object'
    && !Array.isArray(v)
    && isDriverKind(v.kind)
    && typeof v.text === 'string'
    && Array.isArray(v.tags)
    && v.tags.every((x) => typeof x === 'string')
    && (v.text.length > 0 || v.tags.length > 0);
}

/**
 * A property-vocabulary descriptor for a driver key. Type `driver`, `sensitive` (drivers are
 * personal), and NO coarseness ladder — a driver is all-or-nothing per context (you share the
 * whole driver or none of it; there is no "coarser" driver), unlike a coarse-enum attribute.
 *
 * @param {string} key
 */
export function driverDescriptor(key) {
  return descriptor({ key, type: 'driver', ladder: null, coarsen: null, sensitivity: 'sensitive' });
}

/**
 * Extract the DRIVER properties out of a full profile property map — a profile's `properties` holds
 * every kind (coarse-enum place/ageBand alongside drivers), so the matcher needs just the drivers.
 * Returns a `{ key → driverValue }` map, keeping only well-formed driver values (isDriverValue).
 *
 * @param {Record<string, any>} properties
 * @returns {Record<string, {kind:string,text:string,tags:string[]}>}
 */
export function driversFromProperties(properties) {
  const out = {};
  for (const [key, value] of Object.entries(properties ?? {})) {
    if (isDriverValue(value)) out[key] = value;
  }
  return out;
}
