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
import { itemCircleId } from './circleScope.js';

/** stoop ops whose created/mutated item belongs to / routes to the active circle. */
export const SCOPED_WRITE_OPS = new Set([
  'postRequest', 'respondToItem', 'cancelRequest', 'markReturned', 'assignLend', 'reportPost',
]);

/** stoop list ops whose `{ items }` are filtered to the active circle. */
export const SCOPED_LIST_OPS = new Set(['listOpen', 'listFeed', 'listMyRequests', 'getBulletin']);

/**
 * Stoop item types that are internal bookkeeping — the membership lifecycle + rules
 * documents — and must NEVER surface as user-facing noticeboard posts. `listOpen`
 * (no intent) returns them alongside real `request`/`offer` posts; the prikbord is
 * for asks/offers, so it filters these out.
 */
export const SYSTEM_STOOP_TYPES = new Set(['group-rules', 'membership-code', 'membership-redemption']);

/** True when `item` is a real noticeboard post (an ask/offer), not a system item. */
export function isNoticeboardPost(item) {
  if (SYSTEM_STOOP_TYPES.has(item?.type)) return false;
  // The local-first substrate/pseudo-pod collapses every stoop item to `type:'post'`,
  // losing the semantic type — but the original `source` shape survives. Recognise the
  // membership lifecycle + rules documents by their distinctive source fields so they
  // don't surface as noticeboard posts even when the type is flattened.
  const src = item?.source;
  if (src && typeof src === 'object') {
    if (src.rules != null) return false;                          // group-rules
    if (typeof src.code === 'string' && src.code) return false;   // membership-code
    if (src.redeemedBy != null) return false;                     // membership-redemption
  }
  return true;
}

/**
 * Keep `item` for `circleId` — lenient: an item carrying NO circle hint is kept
 * (the op already scoped it server-side). Mirrors `circleContent.js`'s rule so the
 * GUI and the content loader filter identically. A null circleId keeps everything.
 */
export function keepForCircle(item, circleId) {
  if (!circleId) return true;
  // itemCircleId now reads nested hints too (source.targets[]/source.groupId), so a
  // scoped item is recognised here instead of looking "unscoped". null hint = genuinely
  // unscoped → keep (the op already scoped it server-side).
  const hint = itemCircleId(item || {});
  if (hint == null) return true;
  return hint === circleId;
}

/** Open a list item's sealed `text`/`label` for a current recipient. A non-sealed body
 *  passes straight through (envelope.open is a no-op on plaintext); a body we can't open
 *  (not a recipient / stale key) is left as-is rather than dropped. */
function openItemText(it, strategy) {
  if (!it || typeof it.text !== 'string' || !it.text) return it;
  try {
    const opened = strategy.open(it.text);
    return opened === it.text ? it : { ...it, text: opened, label: opened };
  } catch { return it; }
}

/**
 * Wrap a 3-arg host `callSkill(appOrigin, opId, args)` so stoop ops are scoped to
 * `circleId`. Non-stoop ops and a null circleId pass through untouched.
 *
 * For a SEALED (p2/p3) circle, pass `getSealStrategy` — an async getter resolving the
 * circle's `{seal, open}` content strategy (cached by the caller). When present, a
 * `postRequest` body is SEALED before it reaches the pod (the host stores ciphertext)
 * and list items are OPENED after read — so every GUI reader/writer that routes through
 * this wrapper (prikbord + scherm noticeboard block) is transparently E2E-sealed. A p0/p1
 * circle resolves no strategy → plaintext, unchanged.
 *
 * @param {(appOrigin:string, opId:string, args?:object)=>Promise<any>} callSkill
 * @param {string|null} circleId
 * @param {(() => Promise<{seal:Function, open:Function}|null>)} [getSealStrategy]
 * @returns {(appOrigin:string, opId:string, args?:object)=>Promise<any>}
 */
export function scopeStoopCallSkill(callSkill, circleId, getSealStrategy) {
  if (typeof callSkill !== 'function' || !circleId) return callSkill;
  return async (appOrigin, opId, args = {}) => {
    if (appOrigin !== 'stoop') return callSkill(appOrigin, opId, args);
    const strategy = (typeof getSealStrategy === 'function'
      && (SCOPED_WRITE_OPS.has(opId) || SCOPED_LIST_OPS.has(opId)))
      ? await getSealStrategy().catch(() => null) : null;
    if (SCOPED_WRITE_OPS.has(opId)) {
      const scoped = { ...args };
      if (scoped.groupId == null) scoped.groupId = circleId;   // don't clobber an explicit scope
      if (strategy && opId === 'postRequest' && typeof scoped.text === 'string' && scoped.text) {
        scoped.text = strategy.seal(scoped.text);             // seal the body at rest
      }
      return callSkill(appOrigin, opId, scoped);
    }
    const res = await callSkill(appOrigin, opId, args);
    if (SCOPED_LIST_OPS.has(opId) && res && Array.isArray(res.items)) {
      let items = res.items.filter((it) => keepForCircle(it, circleId));
      if (strategy) items = items.map((it) => openItemText(it, strategy));
      return { ...res, items };
    }
    return res;
  };
}
