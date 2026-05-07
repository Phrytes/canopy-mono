/**
 * skillsMatch — pure functions for Stoop's Layer 1 matching
 * (Stoop V1 Phase 12, 2026-05-06; functional design § 4d).
 *
 * No I/O, no inference, no state.  Apps build a matcher by passing
 * the loaded taxonomy + dictionary in; the matcher returns
 * normalised tags + categories for arbitrary text, and computes
 * "is this post relevant to this member's skills?" deterministically.
 *
 * The dictionary lookups are case-insensitive (input lowercased
 * once at the call site).  Multilingual matching falls out of the
 * dictionary: NL `'fiets'` and EN `'bicycle'` both normalise to
 * canonical `bicycle` in category `vervoer`, so a Dutch post
 * matches an English skill profile.
 */

import taxonomyJson from './skillsTaxonomy.json' with { type: 'json' };
import dictJson     from './tagNormalisation.json' with { type: 'json' };

/**
 * Re-exported so apps can iterate the taxonomy for UI dropdowns.
 * Frozen to prevent accidental mutation.
 */
export const TAXONOMY = Object.freeze(taxonomyJson);

/** Indexed dictionary entries. */
const DICT = dictJson.entries;
/** Quick-set of valid category ids for membership checks. */
const CATEGORY_IDS = new Set(taxonomyJson.categories.map((c) => c.id));

/** Tokenise a free-text body into lowercase word tokens. */
function tokenise(text) {
  if (typeof text !== 'string' || !text) return [];
  return text.toLowerCase().split(/[^a-zà-ÿ0-9-]+/).filter(Boolean);
}

/**
 * Look up a single token in the normalisation dictionary.  Returns
 * `null` for unknown tokens.
 *
 * @param {string} token
 * @returns {{ tag: string, category: string } | null}
 */
export function normaliseTag(token) {
  if (typeof token !== 'string' || !token) return null;
  const k = token.toLowerCase();
  return DICT[k] ?? null;
}

/**
 * Suggest a category for a free-text post body.  Counts dictionary
 * hits per category; returns the category with the most hits, plus
 * the de-duplicated set of canonical tags extracted.
 *
 * Returns `{ categoryId: null, tags: [] }` when no dictionary hits.
 *
 * @param {string} text
 * @returns {{ categoryId: string | null, tags: string[] }}
 */
export function categoryFor(text) {
  const tokens = tokenise(text);
  /** @type {Map<string, number>} */
  const counts = new Map();
  /** @type {Set<string>} */
  const tags = new Set();
  for (const t of tokens) {
    const norm = normaliseTag(t);
    if (!norm) continue;
    counts.set(norm.category, (counts.get(norm.category) ?? 0) + 1);
    tags.add(norm.tag);
  }
  let bestCategory = null;
  let bestCount = 0;
  for (const [cat, n] of counts) {
    if (n > bestCount) { bestCategory = cat; bestCount = n; }
  }
  return { categoryId: bestCategory, tags: [...tags] };
}

/**
 * Decide whether a post is relevant to a member's skills profile.
 *
 * Hit when EITHER (a) the post's `categoryId` matches one of the
 * member's `skills[].categoryId` (with status `'active'`); OR
 * (b) any of the post's `tags` overlaps with the member's
 * `skills[].freeTags`.
 *
 * Pure function — no I/O.  Returns `{matched, reason}` for
 * debuggability.
 *
 * @param {object} post  `{categoryId?, tags?}`
 * @param {{skills?: Array<{categoryId: string, freeTags?: string[], status?: string}>}} member
 * @returns {{matched: boolean, reason?: string, viaCategory?: string, viaTags?: string[]}}
 */
export function matchesProfile(post, member) {
  const memberSkills = (member?.skills ?? []).filter((s) => (s.status ?? 'active') === 'active');
  if (memberSkills.length === 0) return { matched: false, reason: 'no-active-skills' };

  if (post?.categoryId) {
    const hit = memberSkills.find((s) => s.categoryId === post.categoryId);
    if (hit) return { matched: true, viaCategory: post.categoryId };
  }

  if (Array.isArray(post?.tags) && post.tags.length > 0) {
    const overlap = [];
    for (const skill of memberSkills) {
      const free = Array.isArray(skill.freeTags) ? skill.freeTags : [];
      for (const tag of post.tags) {
        if (free.includes(tag)) overlap.push(tag);
      }
    }
    if (overlap.length > 0) return { matched: true, viaTags: overlap };
  }

  return { matched: false, reason: 'no-overlap' };
}

/**
 * Validate a category id against the taxonomy.  Apps use this to
 * reject typo'd input early.
 */
export function isKnownCategory(id) {
  return CATEGORY_IDS.has(id);
}
