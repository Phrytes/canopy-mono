/**
 * shareIntoAudience — the cross-circle SHARE op (cluster K · K2, the one net-new op from K1).
 *
 * Containment never crosses circles by copy or grant (K1): an item lives in ONE circle's store. Sharing it
 * into ANOTHER circle's audience is an EXPLICIT, per-item op that writes a `shared-ref` into the target circle
 * pointing back at the source — NOT a copy, and NOT a transitive grant (it exposes ONLY that item, never its
 * container or siblings). Resolving the ref crosses circles = the 🔒-gated cross-pod read (ACP + seal enforce
 * it on real pods; in-memory here it just reads). The POSTURE FLOOR protects the item: sharing into a LESS-
 * confidential circle would downgrade it, so that's refused (K1: never downgrade below the floor).
 *
 * @param {{getStore:(id:string)=>object}} stores  a createCircleStores registry
 * @param {object} args
 * @param {string} args.itemId
 * @param {string} args.fromCircleId   the circle the item lives in
 * @param {string} args.toCircleId     the audience to share into
 * @param {string} [args.by]           who is sharing
 * @param {number} [args.posture]      the item's required confidentiality (default: the item's own `posture`, else 0)
 * @param {(circleId:string)=>number} [args.postureOf]  the target circle's confidentiality (for the floor check;
 *        omit to skip the floor). Refuses when `postureOf(toCircleId) < posture`.
 * @returns {Promise<{ok:true, ref:object}|{ok:false, error:string, required?:number, target?:number}>}
 */
export async function shareIntoAudience(stores, { itemId, fromCircleId, toCircleId, by, posture, postureOf } = {}) {
  if (!stores || typeof stores.getStore !== 'function' || !itemId || !fromCircleId || !toCircleId) {
    return { ok: false, error: 'missing-args' };
  }
  if (fromCircleId === toCircleId) return { ok: false, error: 'same-circle' };
  const item = await stores.getStore(fromCircleId).get(itemId);
  if (!item) return { ok: false, error: 'item-not-found' };

  // The item's required confidentiality (the floor the target must meet).
  const required = Number.isFinite(posture) ? posture : (Number.isFinite(item.posture) ? item.posture : 0);
  // POSTURE FLOOR — sharing into a less-confidential circle would downgrade the item ⇒ refuse.
  if (typeof postureOf === 'function') {
    const target = Number(postureOf(toCircleId)) || 0;
    if (target < required) return { ok: false, error: 'posture-floor', required, target };
  }

  // Per-item `shared-ref` in the target circle. NOT a copy + NOT a transitive grant — only this one item.
  const ref = await stores.getStore(toCircleId).put({
    type:         'shared-ref',
    sourceCircle: fromCircleId,
    sourceId:     itemId,
    sourceType:   item.type,
    sharedBy:     by ?? 'unknown',
    posture:      required,
  }, { by });
  return { ok: true, ref };
}

/** Resolve a `shared-ref` to its source item — crosses circles (🔒-gated on real pods). Null if absent/invalid. */
export async function resolveSharedRef(stores, ref) {
  if (!stores || typeof stores.getStore !== 'function') return null;
  if (!ref || ref.type !== 'shared-ref' || !ref.sourceCircle || !ref.sourceId) return null;
  return stores.getStore(ref.sourceCircle).get(ref.sourceId);
}

/** Everything shared INTO a circle (its `shared-ref`s). */
export async function listShared(stores, circleId) {
  if (!stores || typeof stores.getStore !== 'function' || !circleId) return [];
  return stores.getStore(circleId).listByType('shared-ref');
}
