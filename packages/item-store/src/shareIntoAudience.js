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
 * @param {(ctx:{ref:object,item:object,recipient?:string,recipients?:string[],stores:object})=>Promise<void>} [args.onShare]
 *        INJECTED WRITE-SIDE pod hook (additive · cluster K pod-tier). When the store is pod-backed the
 *        composition injects `makeShareGrantHook(...)` here: after the `shared-ref` is written, the hook
 *        creates the ACP read-grant for the recipient on the source item's resource (and optionally re-seals).
 *        The memory path leaves it undefined ⇒ behaviour is EXACTLY as before. A throw from the hook fails the
 *        share (`{ok:false, error:'share-grant-failed'}`) so a share never silently lands without its grant.
 * @param {string} [args.recipient]        the recipient WebID to grant to (pod-backed shares); passed to `onShare`.
 * @param {string[]} [args.recipients]     multiple recipient WebIDs (a circle share resolves members here).
 * @returns {Promise<{ok:true, ref:object}|{ok:false, error:string, required?:number, target?:number, cause?:any}>}
 */
export async function shareIntoAudience(stores, { itemId, fromCircleId, toCircleId, by, posture, postureOf, onShare, recipient, recipients } = {}) {
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

  // WRITE-SIDE pod hook (additive). On a pod-backed store this creates the ACP read-grant + (re-)seals so the
  // recipient can actually read the ref. Deny-safe: if the grant can't be made, the share FAILS — we never
  // report a share that would resolve to `null` on read. Memory path (no hook) is untouched.
  if (typeof onShare === 'function') {
    try {
      await onShare({ ref, item, recipient, recipients, stores });
    } catch (cause) {
      return { ok: false, error: 'share-grant-failed', cause };
    }
  }
  return { ok: true, ref };
}

/**
 * Resolve a `shared-ref` to its source item — the read that CROSSES circles (🔒-gated on real pods).
 * Null if absent/invalid.
 *
 * ENFORCEMENT (cluster K · additive, backward-compatible). Pass an injected `policy` (see
 * `sharedRefPolicy.js`) to gate + unseal the cross-circle read:
 *   1. `policy.checkGrant({ ref, recipient, stores })` — DENY-BY-DEFAULT: if it returns falsy or throws,
 *      resolve to `null` (the recipient was NOT granted this item). On a real pod this checks a live
 *      ACP/WAC grant via `client.sharing`; on the memory substrate it enforces the modeled posture floor.
 *   2. read the source item (unchanged path).
 *   3. `policy.open(item, { ref, recipient })` — unseal sealed content (sealing/`open`). If it throws
 *      (e.g. the reader isn't a recipient of the envelope) resolve to `null` — never leak ciphertext.
 *
 * With NO policy the behaviour is EXACTLY as before: read and return the source item. Enforcement engages
 * only when a policy is supplied (i.e. when the read is pod-backed / the caller wired the pod layer).
 *
 * @param {{getStore:(id:string)=>object}} stores
 * @param {object} ref  the `shared-ref` item
 * @param {object} [opts]
 * @param {{ checkGrant?:Function, open?:Function }} [opts.policy]  injected enforcement surface
 * @param {string} [opts.recipient]  who is reading (passed to the policy; used for the grant check)
 */
export async function resolveSharedRef(stores, ref, opts = {}) {
  if (!stores || typeof stores.getStore !== 'function') return null;
  if (!ref || ref.type !== 'shared-ref' || !ref.sourceCircle || !ref.sourceId) return null;

  const policy = opts && opts.policy;
  const recipient = opts && opts.recipient;

  // 1. Grant gate — deny-by-default when a policy is present but the grant check fails/throws.
  if (policy && typeof policy.checkGrant === 'function') {
    let allowed = false;
    try { allowed = await policy.checkGrant({ ref, recipient, stores }); }
    catch { allowed = false; }
    if (!allowed) return null;
  }

  // 2. The source read.
  const item = await stores.getStore(ref.sourceCircle).get(ref.sourceId);
  if (!item) return null;

  // 3. Unseal — a throw here means the reader can't open the envelope ⇒ deny (don't leak ciphertext).
  if (policy && typeof policy.open === 'function') {
    try { return await policy.open(item, { ref, recipient }); }
    catch { return null; }
  }
  return item;
}

/** Everything shared INTO a circle (its `shared-ref`s). */
export async function listShared(stores, circleId) {
  if (!stores || typeof stores.getStore !== 'function' || !circleId) return [];
  return stores.getStore(circleId).listByType('shared-ref');
}
