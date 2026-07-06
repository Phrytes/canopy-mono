/**
 * circleShare — the app-level cross-circle SHARE op (cluster K · the vertical slice that WIRES the merged
 * item-store substrate into a live, invocable operation). Pure + injectable so web≡mobile share this one
 * implementation and it's testable at the substrate seam (no DOM, no live pod).
 *
 * It threads three substrate seams and NOTHING platform-specific:
 *   • shareIntoAudience(stores, { …, onShare }) — writes the per-item `shared-ref` into the TARGET circle
 *     and, on a pod-active source, lands the ACP read-grant (+ optional re-seal) via the injected onShare.
 *   • resolveSharedRef(stores, ref, { policy, recipient }) — DENY-BY-DEFAULT cross-circle read: a
 *     non-recipient (or an unopenable envelope) resolves to null, so ciphertext/plaintext never leaks.
 *   • listShared(stores, circleId) — the target circle's `shared-ref`s (its surfacing list).
 *
 * The `{ onShare, policy }` binder (makeCircleShareEnforcement) is built at the app's POD site and injected
 * here as `enforcementFor(circleId) → { onShare, policy } | null`. Absent (no pod session / no sealing
 * strategy) it returns null and the whole op degrades to the in-memory `shared-ref` behaviour — byte-for-byte
 * the pre-K path (no grant, no seal, no read gate).
 *
 * Per-circle stores: each circle's lists service owns its OWN DataSource / seal strategy, so a circle's
 * `shared-ref` bookkeeping and its source-item read must go through THAT circle's store — the ref lands
 * sealed for the target's readers, and the source item opens with the source's strategy. We compose a tiny
 * SYNCHRONOUS `{ getStore }` facade over the pre-resolved per-circle stores — exactly the shape
 * shareIntoAudience / resolveSharedRef expect (they call getStore(circleId) synchronously).
 */
import { shareIntoAudience, resolveSharedRef, listShared } from '@canopy/item-store';
import { normalizeCirclePolicy } from './circlePolicy.js';

/**
 * A synchronous `{ getStore(circleId) }` registry over already-resolved per-circle stores. The substrate
 * calls getStore synchronously; the async per-circle service resolution (pod vs memory) is done by the
 * caller BEFORE composing this facade.
 *
 * @param {Map<string, object>|Record<string, object>} storeByCircle  circleId → its CircleItemStore
 */
export function makeCrossCircleStores(storeByCircle) {
  const map = storeByCircle instanceof Map
    ? storeByCircle
    : new Map(Object.entries(storeByCircle || {}));
  return {
    getStore(circleId) {
      const s = map.get(circleId);
      if (!s) throw new Error(`makeCrossCircleStores: no resolved store for circle "${circleId}"`);
      return s;
    },
  };
}

/**
 * Share ONE item from a source circle into a target circle's audience.
 *
 * @param {object} args
 * @param {(circleId:string)=>Promise<{stores:{getStore:Function}}|null>} args.resolveService  resolve a
 *        circle's lists service (its `.stores` is a createCircleStores registry). Sealed-pod when active,
 *        else the memory/IDB default.
 * @param {string} args.itemId
 * @param {string} args.fromCircleId
 * @param {string} args.toCircleId
 * @param {string} [args.by]
 * @param {string} [args.recipient]           single recipient WebID (pod grant target)
 * @param {string[]} [args.recipients]        multiple recipient WebIDs (a circle share → its members)
 * @param {(circleId:string)=>Promise<{onShare?:Function, policy?:object}|null>} [args.enforcementFor]
 *        the pod-tier binder for a circle (built at the pod site). Null ⇒ memory path (no grant/seal).
 * @param {(circleId:string)=>number} [args.postureOf]  target confidentiality (the posture-floor check).
 * @param {(circleId:string)=>(object|Promise<object>)} [args.policyOf]  the SOURCE circle's admin policy
 *        lookup (its `sharePosture` + `admins`). Injected so the caller wires the real per-circle policy;
 *        normalized via normalizeCirclePolicy. Missing/unreadable ⇒ default `'closed'` (deny-by-default).
 * @returns {Promise<{ok:true, ref:object}|{ok:false, error:string, cause?:any}>}
 */
export async function shareItemAcrossCircles({
  resolveService, itemId, fromCircleId, toCircleId, by,
  recipient, recipients, enforcementFor, postureOf, policyOf,
} = {}) {
  if (typeof resolveService !== 'function' || !itemId || !fromCircleId || !toCircleId) {
    return { ok: false, error: 'missing-args' };
  }
  if (fromCircleId === toCircleId) return { ok: false, error: 'same-circle' };

  // slice 2 — INITIATOR GATE by the SOURCE circle's sharePosture (crypto-free; the write/read mechanics below
  // are unchanged when the gate passes). Missing/unreadable policy ⇒ normalizeCirclePolicy → default 'closed'
  // (deny-by-default, consistent with slice 1).
  let srcPolicy;
  try { srcPolicy = typeof policyOf === 'function' ? await policyOf(fromCircleId) : undefined; }
  catch { srcPolicy = undefined; }
  const policy = normalizeCirclePolicy(srcPolicy);
  const posture = policy.sharePosture;
  if (posture === 'closed') return { ok: false, error: 'sharing-closed' };
  if (posture === 'registered' && !policy.admins.includes(by)) {
    return { ok: false, error: 'sharing-admin-only' };
  }
  // 'copy' / 'trusted' ⇒ any member may initiate → proceed.

  const [fromSvc, toSvc] = await Promise.all([resolveService(fromCircleId), resolveService(toCircleId)]);
  if (!fromSvc?.stores || !toSvc?.stores) return { ok: false, error: 'no-stores' };

  const stores = makeCrossCircleStores(new Map([
    [fromCircleId, fromSvc.stores.getStore(fromCircleId)],
    [toCircleId,   toSvc.stores.getStore(toCircleId)],
  ]));

  // Pod-active source? build the WRITE-side onShare (ACP grant + optional re-seal) for the SOURCE item's pod.
  // Null ⇒ memory path: shareIntoAudience just writes the ref (unchanged behaviour).
  const enforcement = typeof enforcementFor === 'function' ? await enforcementFor(fromCircleId) : null;

  return shareIntoAudience(stores, {
    itemId, fromCircleId, toCircleId, by, recipient, recipients, postureOf,
    onShare: enforcement?.onShare,
  });
}

/**
 * The READ path: everything shared INTO `circleId`, resolved through the source's enforcement policy.
 * DENY-BY-DEFAULT — a ref the reader isn't a recipient of resolves to null and is DROPPED (never surfaced).
 *
 * @param {object} args
 * @param {(circleId:string)=>Promise<{stores:{getStore:Function}}|null>} args.resolveService
 * @param {string} args.circleId              the target circle whose shared items we surface
 * @param {string} [args.recipient]           who is reading (the grant-check subject; my WebID on a pod)
 * @param {(circleId:string)=>Promise<{policy?:object}|null>} [args.enforcementFor]  source-circle binder
 * @returns {Promise<Array<{ref:object, item:object}>>}  only the refs that RESOLVED (deny-safe)
 */
export async function listSharedResolved({
  resolveService, circleId, recipient, enforcementFor,
} = {}) {
  if (typeof resolveService !== 'function' || !circleId) return [];
  const svc = await resolveService(circleId);
  if (!svc?.stores) return [];

  const refs = await listShared(svc.stores, circleId);
  const out = [];
  for (const ref of refs) {
    if (!ref?.sourceCircle) continue;
    const srcSvc = await resolveService(ref.sourceCircle);
    if (!srcSvc?.stores) continue;
    const stores = makeCrossCircleStores(new Map([
      [circleId,          svc.stores.getStore(circleId)],
      [ref.sourceCircle,  srcSvc.stores.getStore(ref.sourceCircle)],
    ]));
    const enforcement = typeof enforcementFor === 'function' ? await enforcementFor(ref.sourceCircle) : null;
    // DENY-BY-DEFAULT: null (non-recipient / unopenable) is dropped — no plaintext, no ciphertext.
    const item = await resolveSharedRef(stores, ref, { policy: enforcement?.policy, recipient });
    if (item) out.push({ ref, item });
  }
  return out;
}
