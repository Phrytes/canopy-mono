/**
 * canopy-chat v2 — circle scoping (shared web + mobile).
 *
 * F1: given an active `circleId`, decide which items belong to it. An
 * item is "in" a circle if any of its circle references match — it
 * carries `circleId` / `crewId` (alias, CIRCLE_ID_IS_CREW_ID_ALIAS) /
 * `groupId`, or an `audience` shorthand like `circle:ID` / `crew:ID`
 * (or the structured `{kind:'circle-ref', id}`). Self-contained — no
 * `@canopy/circles` import — so it stays portable for Metro/RN.
 *
 * A null/empty `circleId` means "no active circle" → unscoped (keep all).
 */

/** The circle id an item is scoped to, or null if it carries none. */
export function itemCircleId(item = {}) {
  if (item.circleId) return item.circleId;
  if (item.crewId) return item.crewId;
  if (item.groupId) return item.groupId;
  // Stoop persists the per-call circle scope NESTED, not at the top level:
  //  • real posts → source.targets[{ kind:'group', groupId }] (the write path injects it)
  //  • system items (rules / membership) → source.groupId
  // Reading top-level only meant every item looked "unscoped" → the circle filter kept
  // everything → cross-circle leak on the noticeboard. Read the nested hints too.
  const targets = item.source?.targets;
  if (Array.isArray(targets)) {
    const g = targets.find((t) => t && t.kind === 'group' && typeof t.groupId === 'string');
    if (g) return g.groupId;
  }
  if (typeof item.source?.groupId === 'string' && item.source.groupId) return item.source.groupId;
  const a = item.audience;
  if (typeof a === 'string') return circleRefFromShorthand(a);
  if (a && typeof a === 'object' && a.kind === 'circle-ref' && a.id) return a.id;
  return null;
}

function circleRefFromShorthand(str) {
  const i = str.indexOf(':');
  if (i < 0) return null;
  const prefix = str.slice(0, i);
  if (prefix === 'circle' || prefix === 'crew') return str.slice(i + 1) || null;
  return null;
}

/** Is `item` in `circleId`? A null circleId (no active circle) matches everything. */
export function isInCircle(item, circleId) {
  if (!circleId) return true;
  return itemCircleId(item) === circleId;
}

/** Filter `items` to the active circle (returns a copy; tolerates non-arrays). */
export function scopeItems(items, circleId) {
  const list = Array.isArray(items) ? items : [];
  if (!circleId) return list.slice();
  return list.filter((it) => isInCircle(it, circleId));
}
