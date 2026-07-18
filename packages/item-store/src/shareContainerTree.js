/**
 * shareContainerTree (journey J5 · SENDABLE LISTS) — make a WHOLE list travel across a circle boundary.
 *
 * The single-item share (`shareIntoAudience`) is deliberately non-transitive: sharing a container writes ONE
 * `shared-ref` to the container itself, and its children do NOT travel (see shareIntoAudience.js). This helper
 * closes that gap WITHOUT inventing a bundle format: it ENUMERATES the container subtree (via the existing
 * `childIdsOf` containment edges) and FANS the EXISTING single-item share over EVERY node — the container plus
 * every descendant (list-items, nested lists, tasks) — each landing its own per-node `shared-ref`.
 *
 * Reconstruction on the recipient side is emergent, not bespoke: every node's `shared-ref` resolves to the
 * SOURCE item, which still carries its own `embeds:[{…,rel:'contains'}]` + `containedBy[]`. So the recipient
 * rebuilds the nesting from the shared items' own structure — the tree shape travels PER-NODE, exactly as the
 * containment model already stores it. Nothing new is persisted beyond N ordinary shared-refs.
 *
 * ORDER is preserved: a pre-order walk (container first, then each child's subtree in declaration order) means
 * the shared-refs land — and `listShared`/`listSharedResolved` surface — in the same order the list reads.
 *
 * GUARDS (reused from treeOf's discipline): a `seen` set makes the walk idempotent — a node reachable via two
 * parents (multi-parent containment) is enumerated + shared ONCE, never twice — and `maxDepth` bounds accidental
 * cycles. Missing children are skipped (survive-on-delete), never fatal.
 */
import { childIdsOf } from './containment.js';
import { shareIntoAudience } from './shareIntoAudience.js';

/**
 * Enumerate a container subtree over one circle's store, in pre-order (root first, then each child's subtree in
 * `childIdsOf` declaration order). De-duped (a shared child appears once) and depth-bounded.
 *
 * @param {object} store            a CircleItemStore (needs `get(id)`)
 * @param {string} rootId           the container id
 * @param {object} [opts]
 * @param {number} [opts.maxDepth=8]  cycle/depth guard (mirrors treeOf)
 * @returns {Promise<string[]>}      subtree item ids in pre-order (empty when the root is missing)
 */
export async function collectSubtree(store, rootId, { maxDepth = 8 } = {}) {
  const order = [];
  const seen  = new Set();
  async function walk(id, depth) {
    if (seen.has(id) || depth > maxDepth) return;   // CYCLE/DEPTH guard + idempotence (share each node once)
    const item = await store.get(id);
    if (!item) return;                              // survive-on-delete: a detached/missing child is skipped
    seen.add(id);
    order.push(id);
    for (const childId of childIdsOf(item)) {       // declaration order = list order
      await walk(childId, depth + 1);
    }
  }
  await walk(rootId, 0);
  return order;
}

/**
 * Share a WHOLE container subtree into a target circle by fanning the single-item share over every node.
 *
 * The fan uses `shareIntoAudience` by default (the memory/plain `shared-ref` path). An app-level op that needs
 * posture gating / re-seal / pod grants injects `shareNode(itemId) => Promise<{ok, ref?}>` — the SAME per-item
 * write path it uses for a single share — so the list rides EXACTLY the single-item mechanics, once per node.
 *
 * @param {{getStore:(id:string)=>object}} stores  a createCircleStores-shaped registry
 * @param {object} args
 * @param {string} args.containerId                 the list (container) whose subtree is sent
 * @param {string} args.fromCircleId                the circle the container lives in
 * @param {string} args.toCircleId                  the audience to send the list into
 * @param {number} [args.maxDepth=8]                subtree cycle/depth guard
 * @param {(itemId:string)=>Promise<{ok:boolean, ref?:object, error?:string, cause?:any}>} [args.shareNode]
 *        INJECTED per-node share (the app fans its own posture-gated write path). Default: fan `shareIntoAudience`
 *        over `stores` with the remaining `args` (by/posture/postureOf/recipient(s)/onShare/…) forwarded.
 * @param {...*} [args.rest]  forwarded to the default `shareIntoAudience` fan (by, posture, postureOf, onShare, …)
 * @returns {Promise<{ok:boolean, container?:string, order?:string[], shared?:Array<{itemId:string, ref:object}>,
 *                     failed?:Array<{itemId:string, error:string, cause?:any}>, error?:string}>}
 *          `ok` is true only when EVERY node shared. `order` is the pre-order the fan ran in (nesting/order proof).
 */
export async function shareContainerTree(stores, {
  containerId, fromCircleId, toCircleId, maxDepth = 8, shareNode, ...rest
} = {}) {
  if (!stores || typeof stores.getStore !== 'function' || !containerId || !fromCircleId || !toCircleId) {
    return { ok: false, error: 'missing-args' };
  }
  if (fromCircleId === toCircleId) return { ok: false, error: 'same-circle' };

  const store = stores.getStore(fromCircleId);
  const order = await collectSubtree(store, containerId, { maxDepth });
  if (order.length === 0) return { ok: false, error: 'container-not-found' };

  // Default fan = the EXISTING single-item share, once per node. Non-transitive by design, so calling it N times
  // is what makes the whole list travel (each node lands its own shared-ref; structure rides per-node).
  const fan = typeof shareNode === 'function'
    ? shareNode
    : (itemId) => shareIntoAudience(stores, { itemId, fromCircleId, toCircleId, ...rest });

  const shared = [];
  const failed = [];
  for (const itemId of order) {                     // ORDER PRESERVED — container first, then children in order
    let r;
    try { r = await fan(itemId); }
    catch (cause) { r = { ok: false, error: 'share-threw', cause }; }
    if (r && r.ok) shared.push({ itemId, ref: r.ref });
    else failed.push({ itemId, error: (r && r.error) || 'unknown', ...(r && r.cause ? { cause: r.cause } : {}) });
  }
  return { ok: failed.length === 0, container: containerId, order, shared, failed };
}
