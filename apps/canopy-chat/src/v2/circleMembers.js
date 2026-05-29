/**
 * canopy-chat v2 — circle member directory (shared web + mobile, F-5.1).
 *
 * Normalises the result of the `listGroupMembers` op into the member shape
 * `circleViewAs` (board 4C) consumes. The op is reached two ways depending
 * on the host's dispatch:
 *   - raw stoop skill →  { groupId, members: [{ webid, handle, displayName, role }] }
 *   - chat-shell reshape → { items:   [{ id, webid, label, handle, role }] }
 * so we accept either and map to `{ id, handle, realName, reveals }`.
 * (`reveals` — the pairwise reveal list — isn't surfaced by the op yet, so
 * it defaults to [], which means View-as hides real names under pairwise
 * unless the policy is 'open'. That's the safe/correct default.)
 */

export function normalizeCircleMembers(result) {
  if (!result || typeof result !== 'object') return [];
  const raw = Array.isArray(result.members) ? result.members
    : Array.isArray(result.items) ? result.items
      : Array.isArray(result) ? result
        : [];
  return raw
    .filter((m) => m && typeof m === 'object')
    .map((m) => {
      const id = m.webid ?? m.id ?? null;
      const handle = m.handle ?? null;
      // raw MemberMap carries displayName; the reshaped item collapses it
      // into `label` (= displayName ?? handle ?? webid) — only treat label
      // as a real name when it's distinct from the handle/id.
      let realName = m.displayName ?? null;
      if (realName == null && m.label != null && m.label !== handle && m.label !== id) {
        realName = m.label;
      }
      return {
        id,
        handle,
        realName,
        reveals: Array.isArray(m.reveals) ? m.reveals : [],
      };
    })
    .filter((m) => m.id != null);
}

/** Member count from a listGroupMembers result (for launcher tiles). */
export function circleMemberCount(result) {
  return normalizeCircleMembers(result).length;
}
