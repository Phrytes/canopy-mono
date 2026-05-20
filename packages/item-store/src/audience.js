/**
 * SP-5b V0a (2026-05-21) — `audienceFromItem(item)` bridge helper.
 *
 * Resolves an item's effective audience by checking, in order:
 *   1. `item.audience` (the new richer field — added SP-5b V0a).
 *   2. `item.visibility` (the legacy short-hand — kept forever per
 *      forward-additive discipline).
 *   3. Substrate default `'household'`.
 *
 * Consumers (renderer affordances, audience-aware queries,
 * `@canopy/circles`' `resolveAudience`) should call this helper
 * rather than reading either field directly.  That way the legacy
 * vs. new field choice stays contained.
 *
 * Item-store stores the field; it does NOT resolve audience to a
 * member set.  Resolution (string short-hands → webids, circle-ref
 * walks, union flattening) lives in `@canopy/circles`'s
 * `resolveAudience(audience, ctx)`.
 *
 * Forward-additive: a future SP-5b V0b may add normalisation here
 * (e.g. canonicalising `'role:admin'` to a structured form), but
 * the V0a contract is "return the value as-stored".  Don't pre-
 * normalise — leave that to `@canopy/circles`.
 *
 * @param {import('./types.js').Item} item
 * @returns {import('./types.js').Audience}
 */
export function audienceFromItem(item) {
  if (item == null) return 'household';
  if (item.audience !== undefined) return item.audience;
  if (item.visibility !== undefined) return item.visibility;
  return 'household';
}
