// Offerings taxonomy + the `offering` property descriptor (offering→property fold-in,
// plans/NOTE-skills-properties-audit.md Q1/Q4). "offering" = the human-profile "I can do X" DATA
// (the disclosure-controlled SOURCE); the INVOCABLE A2A sense keeps the word "skill" —
// see plans/NOTE-skills-vs-capabilities.md + plans/NOTE-offering-rename-inventory.md.
//
// An OFFERING is a driver-like OPEN item `{ kind:'offering', text, tags[] }` (see drivers.js — kind
// `offering` is in DRIVER_KINDS; legacy `skill` is read-accepted). The fixed taxonomy below is
// DEMOTED to the COARSE rung: it is what an offering *coarsens to* under disclosure / for
// roster-bucket matching — not what an offering *is*. Fine matching = tags/text on-device
// (driverMatch.js); coarse matching = the category projection this module derives.
//
// The JSON moved here from `packages/identity-resolver/src/` (Q4: agent-registry is the
// vocabulary-machinery home; attribute-charter keeps only its feedback-flavoured descriptors).
// identity-resolver's offeringsMatch keeps its own dictionary (`tagNormalisation.json`) and now
// imports the taxonomy from here via the literal-path subpath export
// `@onderling/agent-registry/src/offeringsTaxonomy.js` (works under BOTH Node's exports map and
// Metro's exports-OFF literal resolution — see docs/agent-notes-known-gotchas.md).
//
// Pure — web ≡ mobile, no I/O.

import { descriptor } from './propertyVocabulary.js';
import { normalizeTag } from './drivers.js';
import taxonomyJson from './offeringsTaxonomy.json' with { type: 'json' };

/**
 * The fixed offerings taxonomy: `{ version, categories: [{ id, label:{nl,en}, hint:{nl,en} }] }`.
 * Frozen; iterate `categories` for UI dropdowns. (identity-resolver re-exports this as
 * `TAXONOMY` for its existing consumers.)
 */
export const OFFERINGS_TAXONOMY = Object.freeze(taxonomyJson);

/**
 * The offering coarseness ladder, COARSEST→finest (propertyVocabulary convention):
 * `category` (only the derived `{ categoryId }`) → `full` (the whole `{ text, tags }` item).
 * Below `category` sits the implicit ∅ — disclosure simply withholds the key.
 */
export const OFFERING_LADDER = Object.freeze(['category', 'full']);

/** Words too common (NL/EN function words) to count as category-keyword evidence. */
const STOPWORDS = new Set([
  'en', 'de', 'het', 'een', 'voor', 'met', 'naar', 'van', 'wat', 'die', 'dat', 'niet',
  'and', 'the', 'for', 'with', 'that', 'not', 'alles', 'hierboven', 'past', 'anything',
  'does', 'fit', 'above', 'other', 'anders', 'kleine', 'small', 'samen', 'together',
]);

/** Lowercase word tokens (letters incl. accents + digits; hyphens split). */
function tokenise(text) {
  if (typeof text !== 'string' || !text) return [];
  return text.toLowerCase().split(/[^a-zà-ÿ0-9]+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/** The keyword set for one taxonomy category: id parts + label + hint words (nl + en). */
function categoryKeywords(cat) {
  const words = new Set(tokenise(String(cat?.id ?? '').replace(/-/g, ' ')));
  for (const field of [cat?.label, cat?.hint]) {
    for (const v of Object.values(field ?? {})) for (const w of tokenise(v)) words.add(w);
  }
  return words;
}

/**
 * Best-effort category for an open offering item — DETERMINISTIC tag/keyword scoring against the
 * taxonomy, no model. Per category: a tag equal to the category id scores 3; a tag or text word
 * found in the category's keyword set (id + label + hint words, NL+EN) scores 2 (tags) / 1
 * (text words); a tag sharing a ≥4-char substring with a keyword scores 1. Highest score wins;
 * ties resolve to taxonomy order; no evidence at all → `null` (callers keep the offering
 * uncategorised or ask the user to pick).
 *
 * @param {{text?:string, tags?:string[]}} item   an open offering (kind/extra fields ignored)
 * @param {{categories?:Array<{id:string,label?:object,hint?:object}>}} [taxonomy=OFFERINGS_TAXONOMY]
 * @returns {string|null} categoryId
 */
export function deriveOfferingCategory(item = {}, taxonomy = OFFERINGS_TAXONOMY) {
  const tags = new Set(
    (Array.isArray(item?.tags) ? item.tags : []).map(normalizeTag).filter(Boolean),
  );
  const textWords = new Set(tokenise(typeof item?.text === 'string' ? item.text : ''));
  const categories = Array.isArray(taxonomy?.categories) ? taxonomy.categories : [];

  let best = null;
  let bestScore = 0;
  for (const cat of categories) {
    const keywords = categoryKeywords(cat);
    let score = 0;
    for (const tag of tags) {
      if (tag === cat.id) { score += 3; continue; }
      if (keywords.has(tag)) { score += 2; continue; }
      // hyphenated tags ('bicycle-repair') → try their parts, then loose substring overlap
      const parts = tag.split('-').filter((p) => p.length >= 3 && !STOPWORDS.has(p));
      if (parts.some((p) => keywords.has(p))) { score += 2; continue; }
      if (tag.length >= 4 && [...keywords].some((k) => k.length >= 4 && (k.includes(tag) || tag.includes(k)))) score += 1;
    }
    for (const w of textWords) if (keywords.has(w)) score += 1;
    if (score > bestScore) { best = cat.id; bestScore = score; }
  }
  return bestScore > 0 ? best : null;
}

/** Is `id` a category id of the given taxonomy? */
function isCategoryId(id, taxonomy) {
  return typeof id === 'string'
    && (Array.isArray(taxonomy?.categories) ? taxonomy.categories : []).some((c) => c.id === id);
}

/**
 * The property-vocabulary descriptor for an offering key. Type `driver` (an offering IS a
 * driver-like open item), `sensitive`, ladder `category → full`. Coarsening is FAIL-CLOSED: only
 * the `full` rung releases the item itself; `category` — and any null/unknown rung — collapses to
 * `{ categoryId }` ONLY (text/tags dropped; a user-picked `item.categoryId` wins over
 * derivation; no match → `{ categoryId: null }`, which reveals nothing).
 *
 * @param {string} [key='offering']
 * @param {{taxonomy?:object}} [opts]   override taxonomy (tests / future per-app overlays)
 */
export function offeringDescriptor(key = 'offering', { taxonomy = OFFERINGS_TAXONOMY } = {}) {
  return descriptor({
    key,
    type: 'driver',
    ladder: OFFERING_LADDER,
    sensitivity: 'sensitive',
    coarsen: (value, rung) => {
      if (rung === 'full') return value;
      const picked = isCategoryId(value?.categoryId, taxonomy) ? value.categoryId : null;
      return Object.freeze({ categoryId: picked ?? deriveOfferingCategory(value, taxonomy) });
    },
  });
}
