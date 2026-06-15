/**
 * canopy-chat v2 — scope the GUI's DIRECT stoop callSkill to the active circle
 * (shared web + mobile). The per-circle stoop restructure, GUI slice.
 *
 * The dispatch path (slash / AI) already binds the active circle via
 * `scopeReadyDispatch` (router.js): it injects the circle id into the stoop scope
 * key so a post lands in — and a list reads from — the open circle. But the GUI
 * surfaces (the prikbord noticeboard, etc.) call `callSkill('stoop', op, args)`
 * DIRECTLY, bypassing that binding — so without this wrapper every circle's
 * prikbord hits the one shared `cc-default-buurt` and they all see each other's
 * posts. This wrapper closes that gap the same way:
 *   • item-creating / mutating stoop ops get the circle id injected as `groupId`
 *     (stoop's per-call scope key — realAgent maps it to `source.targets[]`), so
 *     the post is tagged to / routed to THIS circle (canopy-chat is multi-pod:
 *     the scope key is load-bearing for routing, not just a tag), and
 *   • list reads are filtered to the circle with the SAME lenient rule as
 *     `loadCircleItems` (`keepForCircle`): an item with no per-item circle hint is
 *     kept — the op already scoped it — so pre-existing unscoped posts don't vanish.
 *
 * This is the invariant-honoring shape: ONE stoop agent (service-context) with a
 * per-circle scope key threaded through ops — NOT N agents for N circles
 * (CLAUDE.md invariant #6). Pure + transport-free, so mobile reuses it verbatim.
 */
import { isInCircle } from './circleScope.js';

/** stoop ops whose created/mutated item belongs to / routes to the active circle. */
export const SCOPED_WRITE_OPS = new Set([
  'postRequest', 'respondToItem', 'cancelRequest', 'markReturned', 'assignLend', 'reportPost',
]);

/** stoop list ops whose `{ items }` are filtered to the active circle. */
export const SCOPED_LIST_OPS = new Set(['listOpen', 'listFeed', 'listMyRequests', 'getBulletin']);

/**
 * Keep `item` for `circleId` — lenient: an item carrying NO circle hint is kept
 * (the op already scoped it server-side). Mirrors `circleContent.js`'s rule so the
 * GUI and the content loader filter identically. A null circleId keeps everything.
 */
export function keepForCircle(item, circleId) {
  if (!circleId) return true;
  const it = item || {};
  const hasHint =
    it.circleId != null || it.crewId != null || it.groupId != null || it.audience != null;
  if (!hasHint) return true;            // op already scoped via args — trust it
  return isInCircle(it, circleId);
}

/**
 * Wrap a 3-arg host `callSkill(appOrigin, opId, args)` so stoop ops are scoped to
 * `circleId`. Non-stoop ops and a null circleId pass through untouched.
 *
 * @param {(appOrigin:string, opId:string, args?:object)=>Promise<any>} callSkill
 * @param {string|null} circleId
 * @returns {(appOrigin:string, opId:string, args?:object)=>Promise<any>}
 */
export function scopeStoopCallSkill(callSkill, circleId) {
  if (typeof callSkill !== 'function' || !circleId) return callSkill;
  return async (appOrigin, opId, args = {}) => {
    if (appOrigin !== 'stoop') return callSkill(appOrigin, opId, args);
    if (SCOPED_WRITE_OPS.has(opId)) {
      const scoped = { ...args };
      if (scoped.groupId == null) scoped.groupId = circleId;   // don't clobber an explicit scope
      return callSkill(appOrigin, opId, scoped);
    }
    const res = await callSkill(appOrigin, opId, args);
    if (SCOPED_LIST_OPS.has(opId) && res && Array.isArray(res.items)) {
      return { ...res, items: res.items.filter((it) => keepForCircle(it, circleId)) };
    }
    return res;
  };
}
