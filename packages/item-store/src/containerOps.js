/**
 * containerOps — the COMPOSABLE-OP engine (cluster K · K2) over a `CircleItemStore` + `containment`.
 *
 * Two pieces:
 *   1. `addChildTo` — the primitive: create a typed child *inside* a container (put it in the same circle
 *      store, then K2-`contain` it = ref + back-ref). "add ‹childType› to ‹container›".
 *   2. `resolveContainerAdd` — the K0-deferred NATURAL-VERB resolution: a bare "add X" in a container picks
 *      WHICH child type to create from the container type's declared `accepts` policy (a list → a list-item
 *      or a task; a task → a subtask). Pure; the dispatch layer feeds it the active container + its policy.
 *
 * The `accepts` policy is declared by the container TYPE (in its manifest, later — the surfacing step); here
 * it's injected, so the engine is pure + testable and identical web≡mobile.
 */
import { contain } from './containment.js';

/**
 * Create a typed child item inside `containerId` and contain it. The child lives in the SAME circle store
 * (inherits the circle's scope/seal — K1: containment never crosses stores by copy). Returns the new child.
 *
 * @param {object} store           a CircleItemStore (get/put/delete/list)
 * @param {string} containerId
 * @param {object} childItem       `{ type, … }` — validated + id-assigned by the store on `put`
 * @returns {Promise<object>} the stored child (with its id + `containedBy:[containerId]`)
 */
export async function addChildTo(store, containerId, childItem) {
  if (!childItem || typeof childItem.type !== 'string' || !childItem.type) {
    throw new Error('addChildTo: childItem.type is required');
  }
  const container = await store.get(containerId);
  if (!container) throw new Error(`addChildTo: container "${containerId}" not found`);
  const child = await store.put({ ...childItem });        // store validates the type + assigns the id
  await contain(store, containerId, child.id);            // K2 ref + back-ref
  return await store.get(child.id);                       // re-read so the returned child carries containedBy
}

/**
 * Resolve a bare "add X" inside a container to ONE child `{ type, op }`, from the container type's `accepts`.
 * Precedence: an explicit `hint` (the user named the type) › a single accepted type › a `default:true` ›
 * else `{ ambiguous:[…] }` (the caller asks which). Returns `null` when the container accepts nothing
 * (i.e. not composable here → fall back to the normal add).
 *
 * @param {object} args
 * @param {Array<{type:string, op:string, default?:boolean}>} args.accepts  the container type's accept-list
 * @param {string} [args.hint]  an explicitly-named child type (e.g. parsed from "add a TASK …")
 * @returns {{type:string, op:string} | {ambiguous:Array<{type:string,op:string}>} | null}
 */
export function resolveContainerAdd({ accepts, hint } = {}) {
  const list = (Array.isArray(accepts) ? accepts : []).filter((a) => a && a.type && a.op);
  if (list.length === 0) return null;
  if (hint) {
    const named = list.find((a) => a.type === hint);
    if (named) return { type: named.type, op: named.op };
  }
  if (list.length === 1) return { type: list[0].type, op: list[0].op };
  const def = list.find((a) => a.default);
  if (def) return { type: def.type, op: def.op };
  return { ambiguous: list.map((a) => ({ type: a.type, op: a.op })) };
}
