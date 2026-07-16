/**
 * E5 (mobile) — pure predicate deciding whether a rendered reply gets an
 * "⤢ Open in full" affordance.
 *
 * Mirrors the web semantic (domAdapter `onExpandPanel`, wired only for
 * record / mini-page panels).  Kept RN-free so it is unit-testable in
 * the portable vitest suite — the RN MessageBubble + RecordDetailModal
 * consume it for presentation only.
 *
 * A reply is expandable when it is a record/mini-page shape that
 * actually carries fields (an empty record has nothing extra to show
 * full-screen).
 *
 * @param {object} r  a RenderedReply
 * @returns {boolean}
 */
export function recordCanExpand(r) {
  if (!r || typeof r !== 'object') return false;
  if (r.kind !== 'record' && r.kind !== 'mini-page') return false;
  return Array.isArray(r.fields) && r.fields.length > 0;
}
