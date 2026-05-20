/**
 * `fetchSectionItems(section, {callSkill})` — V0.2 (2026-05-21).
 *
 * One-stop helper that adapters call to populate a NavModel section
 * with items.  Honours the V0.2 Q7 `section.dataSource` declaration
 * if present; otherwise falls back to the Q6 rule-b default
 * (`listOpen({type, ...filter})`).
 *
 * Removes adapter-side hard-coding of "this section calls listMine /
 * listMyRequests / getDagTree" that household + tasks-v0 + stoop web
 * bootstraps all currently duplicate.  Same helper feeds renderMobile
 * (Slice C) — keeping section→data-fetch logic device-independent.
 *
 * Robustness — skill replies vary in shape across apps:
 *   - Some return a bare array of items: `[{...}, {...}]`
 *   - Some return `{items: [...]}`
 *   - Some return `{tasks: [...]}` or `{approvals: [...]}` etc.
 *   - Household-side `addItem`/`listOpen` chat-shape returns
 *     `{replies, stateUpdates}` — the bootstrap re-reads the store
 *     to recover `items[]` (an A.3 signal).
 *
 * This helper does NOT try to normalise reply shapes.  It returns
 * `result` verbatim; adapters extract `items` per their app's
 * convention.  Forward-additive: V0.3 could normalise via a
 * configurable extractor if a real consumer needs it.
 *
 * @param {object} section          NavModel section (sees: itemType, filter?, dataSource?)
 * @param {object} args
 * @param {(skillId: string, args?: object) => Promise<*>} args.callSkill
 *   Adapter-supplied skill caller.  Same shape as @canopy/web-adapter's
 *   `callSkill(baseUrl, ...)` already-curried with baseUrl.
 * @param {string} [args.defaultListSkill='listOpen']
 *   Skill id to call when `section.dataSource` is absent.  Defaults to
 *   `'listOpen'`; apps with a different default (e.g. `'listAllOpen'`)
 *   can override.
 *
 * @returns {Promise<*>}   raw skill reply.  Adapters extract `items` per
 *                          their convention.
 */
export async function fetchSectionItems(section, { callSkill, defaultListSkill = 'listOpen' } = {}) {
  if (!section || typeof section !== 'object') {
    throw new TypeError('fetchSectionItems: section (NavModel section) required');
  }
  if (typeof callSkill !== 'function') {
    throw new TypeError('fetchSectionItems: callSkill (function) required');
  }

  // Q7 (V0.2) — explicit dataSource wins.
  if (section.dataSource && typeof section.dataSource.skillId === 'string') {
    const args = section.dataSource.args ?? {};
    return callSkill(section.dataSource.skillId, args);
  }

  // Q6 rule-b fallback — `listOpen({type, ...filter})`.
  const args = {
    ...(section.itemType !== undefined ? { type: section.itemType } : {}),
    ...(section.filter ?? {}),
  };
  return callSkill(defaultListSkill, args);
}
