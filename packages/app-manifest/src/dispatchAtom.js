/**
 * dispatchAtom — invoke a manifest capability by its ATOM + NOUN instead of its bespoke op-id.
 *
 * The atom set (the 16 canonical SDK verbs) + the noun set ARE the stable vocabulary (PLAN-capability-arc §1;
 * decisions.md 2026-07-02 declared-authoritative). A caller — the LLM interpreter, a circle recipe, a
 * gate-driven affordance — can say "add a task" as `{atom:'add', noun:'task'}` without knowing the app's
 * bespoke op-id (`addTask`). `resolveAtom` looks the (atom × noun) up against the manifest's declared/derived
 * capability surface; the caller-provided `dispatch(opId, args)` runs the (existing) handler.
 *
 * This is the §1b SEAM: it does NOT replace the per-op handlers — it routes to them by (atom, noun), so a new
 * app that DECLARES a noun becomes reachable through the standard verb vocabulary immediately. Later slices can
 * put a generic store-backed handler *behind* the resolved op; nothing here assumes one.
 *
 * Pure + transport/reply-shape-agnostic (the caller owns `dispatch`). Alias atoms (create→add, grab→claim,
 * delete→remove, edit→update) are canonicalised by `resolveAtom` first.
 *
 * @param {object} manifest
 * @param {{atom:string, noun:string, args?:object}} cap
 * @param {(opId:string, args:object) => any|Promise<any>} dispatch  runs the resolved op (e.g. a callSkill bound to the app origin)
 * @returns {Promise<{ok:true, opId:string, result:any} | {ok:false, code:'unimplemented'|'no-dispatch', atom?:string, noun?:string, opId?:string}>}
 *   `unimplemented` = the (atom×noun) is not implemented by any op (a declared-but-unimplemented capability, or a bad pair).
 */
import { resolveAtom } from './capabilities.js';
import { canonicalAtom } from './atoms.js';

export async function dispatchAtom(manifest, { atom, noun, args = {} } = {}, dispatch) {
  const opId = resolveAtom(manifest, atom, noun);
  if (!opId) return { ok: false, code: 'unimplemented', atom: canonicalAtom(atom), noun };
  if (typeof dispatch !== 'function') return { ok: false, code: 'no-dispatch', opId };
  const result = await dispatch(opId, args);
  return { ok: true, opId, result };
}
