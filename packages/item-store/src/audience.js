/**
 * V0a (2026-05-21) — `audienceFromItem(item)` bridge helper.
 *
 * Resolves an item's effective audience by checking, in order:
 *   1. `item.audience` (the new richer field — added V0a).
 *   2. `item.visibility` (the legacy short-hand — kept forever per
 *      forward-additive discipline).
 *   3. Substrate default `'household'`.
 *
 * Consumers (renderer affordances, audience-aware queries,
 * `@onderling/circles`' `resolveAudience`) should call this helper
 * rather than reading either field directly.  That way the legacy
 * vs. new field choice stays contained.
 *
 * Item-store stores the field; it does NOT resolve audience to a
 * member set.  Resolution (string short-hands → webids, circle-ref
 * walks, union flattening) lives in `@onderling/circles`'s
 * `resolveAudience(audience, ctx)`.
 *
 * Forward-additive: a future V0b may add normalisation here
 * (e.g. canonicalising `'role:admin'` to a structured form), but
 * the V0a contract is "return the value as-stored".  Don't pre-
 * normalise — leave that to `@onderling/circles`.
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

/**
 * Stable JSON stringify — sorts object keys so structural (deep,
 * key-order-independent) equality of plain audience values works.
 * Audiences are simple shapes (a string short-hand, or an object
 * with `{kind, members|id|of}`); nested `of` arrays recurse.
 *
 * @param {*} v
 * @returns {string}
 */
function jsonStable(v) {
  if (v === undefined || v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(jsonStable).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + jsonStable(v[k])).join(',') + '}';
}

/**
 * does an item's effective audience satisfy a `ListFilter.audience`
 * query?
 *
 * `itemAudience` is the item's effective audience (as produced by
 * `audienceFromItem`); `filterAudience` is the audience the caller is
 * querying for ("show me items shared with X").  Returns `true` when the
 * item should appear in the results.
 *
 * ## Match semantics
 * The relation is directional — "does `itemAudience` (the container)
 * cover the `filterAudience` (the target)?":
 *
 *  1. **Exact match.**  `itemAudience` structurally deep-equals
 *     `filterAudience` (key-order-independent).  This is the original
 *     V0b behaviour and covers every plain short-hand
 *     (`'circle:A'`, `'household'`, `'private'`, …), `set`, `circle-ref`,
 *     `union`, and `public` value against an identical filter.
 *
 *  2. **Union membership.**  When `itemAudience` is
 *     `{kind:'union', of:[…]}`, the item matches if the target satisfies
 *     ANY element of `of` (recursively).  So a query for
 *     `{kind:'circle-ref', id:'c1'}` — or the short-hand `'household'` —
 *     matches an item shared with `union(household, circle-ref c1)`.
 *
 *  3. **Set membership.**  When `itemAudience` is
 *     `{kind:'set', members:[…]}` and `filterAudience` is a plain webid
 *     string, the item matches if `members` includes that webid.  So a
 *     query for `'webid:bob'` matches an item shared with
 *     `set(webid:alice, webid:bob)`.
 *
 * All other cases are `false`.  In particular:
 *  - `{kind:'public'}` items match ONLY the `{kind:'public'}` filter
 *    (public is NOT treated as covering every possible target — that
 *    would silently broaden every audience query).
 *  - **Not normalised.**  The string short-hand `'circle:X'` and the
 *    structured `{kind:'circle-ref', id:'X'}` are still NOT equivalent
 *    — normalisation lives in `@onderling/circles`, which item-store can't
 *    depend on (layering).  A store may inject a `normalizeAudience`
 *    callback in a later revision to close that gap.
 *
 * Backward-compatible: a match that succeeded under V0b strict-equality
 * still succeeds here (rule 1 is unchanged); membership only ever
 * *adds* matches for `union`/`set` container audiences.
 *
 * @param {import('./types.js').Audience} itemAudience
 *   The item's effective audience (from `audienceFromItem`).
 * @param {import('./types.js').Audience} filterAudience
 *   The audience being queried for.
 * @returns {boolean}
 */
export function audienceMatches(itemAudience, filterAudience) {
  // Rule 1 — exact structural equality.
  if (jsonStable(itemAudience) === jsonStable(filterAudience)) return true;

  // Rule 2 — union membership: the target satisfies any constituent.
  if (
    itemAudience && typeof itemAudience === 'object' &&
    itemAudience.kind === 'union' && Array.isArray(itemAudience.of)
  ) {
    return itemAudience.of.some((member) => audienceMatches(member, filterAudience));
  }

  // Rule 3 — set membership: a plain-string target is one of the members.
  if (
    itemAudience && typeof itemAudience === 'object' &&
    itemAudience.kind === 'set' && Array.isArray(itemAudience.members) &&
    typeof filterAudience === 'string'
  ) {
    return itemAudience.members.includes(filterAudience);
  }

  return false;
}

/**
 * cross-circle query predicate. Does an item's effective
 * audience satisfy ANY audience in a SET (`ListFilter.audiences`)?
 *
 * A cross-circle query spans MULTIPLE audiences/circles at once — "show
 * me items visible to circle A OR circle B OR …".  This is the
 * set-valued sibling of {@link audienceMatches}: the item matches when
 * `audienceMatches(itemAudience, fa)` holds for at least one `fa` in
 * `filterAudiences`.  Each element is matched with the full
 * single-audience contract (exact / union-membership / set-membership),
 * so the per-audience semantics are unchanged.
 *
 * ## Edges
 *  - **Empty set** (`filterAudiences === []`) matches NOTHING — an
 *    empty union of audiences is visible to no-one, so a query across
 *    zero circles returns zero items.  (This mirrors `[].some(...) ===
 *    false` and the `union`-of-nothing intuition.)
 *  - **Single element** (`[a]`) is exactly `audienceMatches(item, a)` —
 *    the single-audience path is a strict special case, kept
 *    back-compatible.
 *
 * Item-store keeps `filter.audience` (single) and `filter.audiences`
 * (set) as independent, composable clauses; nothing about the
 * single-audience path changes.
 *
 * @param {import('./types.js').Audience} itemAudience
 *   The item's effective audience (from `audienceFromItem`).
 * @param {import('./types.js').Audience[]} filterAudiences
 *   The audience SET being queried for.
 * @returns {boolean}
 */
export function audienceMatchesAny(itemAudience, filterAudiences) {
  if (!Array.isArray(filterAudiences)) {
    throw new TypeError('audienceMatchesAny: filterAudiences must be an array');
  }
  return filterAudiences.some((fa) => audienceMatches(itemAudience, fa));
}
