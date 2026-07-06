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
import { shareIntoAudience, resolveSharedRef, listShared, unsealItem } from '@canopy/item-store';
import { normalizeCirclePolicy } from './circlePolicy.js';

/**
 * Which share postures ride the COPY re-seal mechanism (a SEPARATE object sealed to the recipient(s), source
 * untouched). Decision "option 2": `trusted` and `registered` currently share the SAME copy mechanism as
 * `copy` — the only difference between the three is WHO MAY INITIATE (the slice-2 initiator gate), which is
 * already enforced above. Revocable multi-recipient *canonical* sharing (a mixed-mode envelope that re-wraps
 * the source in place, revocably, without minting a copy) is DEFERRED (option 1 — PLAN §5 / §8).
 */
export const usesCopyReseal = (p) => p === 'copy' || p === 'trusted' || p === 'registered';

/**
 * slice 3b — compose a source-circle enforcement `policy` with the READER's OWN opener so a cross-circle
 * recipient can decrypt content re-sealed to THEIR key. Copy mode wraps the content to the recipient's
 * TARGET-circle sealing key, so the reader opens with their target-circle private key (`readerOpen`); a
 * group-key (p2) source still opens with the source enforcement's own opener (`policy.openText`).
 *
 * Combined at the PER-TEXT level (deny-by-default, leak-safe): plaintext passes straight through; a sealed
 * field is opened by whichever key fits — the reader's (`readerOpen`) or the source group's (`openText`).
 * A recipient opener passes plaintext through and THROWS on a foreign envelope (it never returns ciphertext),
 * so if NEITHER key opens a sealed field the combined opener throws ⇒ `resolveSharedRef` drops the ref.
 * `checkGrant` is untouched.
 *
 * @param {{checkGrant?:Function, open?:Function, openText?:Function}|null} policy  the source-circle policy
 * @param {(text:string)=>string|Promise<string>} [readerOpen]  the reader's per-text opener (their key)
 */
export function composeReaderOpen(policy, readerOpen) {
  if (typeof readerOpen !== 'function') return policy ?? undefined;
  const groupOpenText = typeof policy?.openText === 'function' ? policy.openText : null;
  const perTextOpen = async (text) => {
    if (typeof text !== 'string') return text;
    // The reader's own key first (copy-mode content sealed to them). A recipient opener returns plaintext
    // unchanged and throws on a foreign envelope — so a success here is either plaintext or MY decrypt.
    try { return await readerOpen(text); } catch { /* not mine — try the source group opener */ }
    if (groupOpenText) return groupOpenText(text);   // group source: decrypts, or throws on a foreign envelope
    throw new Error('composeReaderOpen: not a recipient of this sealed field');
  };
  return {
    ...(policy || {}),
    open: (item) => unsealItem(item, perTextOpen),
  };
}

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
 * @param {string[]} [args.recipientKeys]     share-policy slice 3a — the recipients' SEALING PUBLIC KEYS,
 *        resolved by the caller against the TARGET circle's roster (`recipientSealKeyFor(toCircleId,…)`).
 *        Threaded to the write-side re-seal so a cross-circle recipient (NOT in the source's group key) can
 *        decrypt. Absent ⇒ no re-seal (group-key posture / plaintext source).
 * @param {(item:object, keys:string[])=>(object|Promise<object>)} [args.sealCopy]  share-policy slice 3b —
 *        an injected recipient re-sealer (built from `@canopy/pod-client` `recipientStrategy` + item-store's
 *        `sealItem`; pod-layer, so this module stays pod-client-free). Used by the copy-reseal postures
 *        (`copy`/`trusted`/`registered` — see usesCopyReseal) to produce a SEPARATE object sealed to the
 *        recipient(s), leaving the source untouched.
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
  recipient, recipients, recipientKeys, sealCopy, enforcementFor, postureOf, policyOf,
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
  // 'copy' / 'trusted' ⇒ any member may initiate → proceed. All three of copy/trusted/registered then ride the
  // SAME copy re-seal mechanism below (usesCopyReseal); the posture only decided WHO could initiate.

  const [fromSvc, toSvc] = await Promise.all([resolveService(fromCircleId), resolveService(toCircleId)]);
  if (!fromSvc?.stores || !toSvc?.stores) return { ok: false, error: 'no-stores' };

  const stores = makeCrossCircleStores(new Map([
    [fromCircleId, fromSvc.stores.getStore(fromCircleId)],
    [toCircleId,   toSvc.stores.getStore(toCircleId)],
  ]));

  // Pod-active source? build the WRITE-side onShare (ACP grant + optional re-seal) for the SOURCE item's pod.
  // Null ⇒ memory path: shareIntoAudience just writes the ref (unchanged behaviour).
  const enforcement = typeof enforcementFor === 'function' ? await enforcementFor(fromCircleId) : null;

  // COPY re-seal: write a SEPARATE object sealed to the recipient(s), source UNTOUCHED, and share THAT copy
  // (the shared-ref points at the copy; the ACP grant lands on the copy). Cleanest re-seal — works for ANY
  // source posture (the source item is read through its own store, opened at rest, then re-sealed fresh to the
  // recipients' keys), and never locks the source's own members out of the canonical item.
  //
  // Decision "option 2": `copy`, `trusted`, AND `registered` all ride this ONE mechanism (usesCopyReseal). The
  // three postures differ ONLY in who may initiate (the slice-2 gate above: `closed` refuses, `registered`
  // admin-only, `copy`/`trusted` any member); the re-seal mechanism is now shared. Revocable multi-recipient
  // *canonical* sharing (a mixed-mode in-place envelope) is DEFERRED — see PLAN §5 / §8.
  const keys = Array.isArray(recipientKeys) ? recipientKeys.filter(Boolean) : [];
  if (usesCopyReseal(posture) && enforcement?.onShare && typeof sealCopy === 'function' && keys.length) {
    const fromStore = stores.getStore(fromCircleId);
    const srcItem = await fromStore.get(itemId);
    if (!srcItem) return { ok: false, error: 'item-not-found' };
    let copy;
    try {
      const sealed = await sealCopy(srcItem, keys);
      // Drop the source id so `put` MINTS a fresh resource (a separate object) — never overwrites the source.
      const { id: _srcId, ...sealedNoId } = sealed;
      copy = await fromStore.put({ ...sealedNoId, sharedCopyOf: itemId }, { by });
    } catch (cause) {
      return { ok: false, error: 'share-seal-failed', cause };
    }
    return shareIntoAudience(stores, {
      itemId: copy.id, fromCircleId, toCircleId, by, recipient, recipients, postureOf,
      onShare: enforcement.onShare,   // grant on the copy; no further re-seal (already sealed to the recipients)
    });
  }

  // Fallback (no pod/keys, or an enforcement without onShare) — canonical path: write the ref to the source
  // item and let the enforcement's injected `seal` (if any) re-wrap IN PLACE, fed the recipients' sealing keys.
  // A copy-reseal posture (copy/trusted/registered) reaches here only when the copy branch's preconditions
  // (pod onShare + a sealer + recipient keys) aren't ALL met, degrading to the pre-re-seal behaviour.
  return shareIntoAudience(stores, {
    itemId, fromCircleId, toCircleId, by, recipient, recipients, recipientKeys: keys, postureOf,
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
 * @param {(text:string)=>string|Promise<string>} [args.readerOpen]  slice 3b — the READER's own per-text
 *        opener (their TARGET-circle sealing key). Composed with the source enforcement's `open` so content
 *        re-sealed to the reader (copy mode) decrypts; a non-recipient's opener throws ⇒ the ref is dropped.
 * @returns {Promise<Array<{ref:object, item:object}>>}  only the refs that RESOLVED (deny-safe)
 */
export async function listSharedResolved({
  resolveService, circleId, recipient, enforcementFor, readerOpen,
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
    // slice 3b — compose the reader's own opener so a copy re-sealed to the reader's key decrypts.
    const policy = composeReaderOpen(enforcement?.policy, readerOpen);
    // DENY-BY-DEFAULT: null (non-recipient / unopenable) is dropped — no plaintext, no ciphertext.
    const item = await resolveSharedRef(stores, ref, { policy, recipient });
    if (item) out.push({ ref, item });
  }
  return out;
}
