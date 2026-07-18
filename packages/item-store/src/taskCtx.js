/**
 * taskCtx — the SHARED, module-private ctx helpers for the functions-over-
 * CircleItemStore task surface (PLAN-capabilities-tasks-roles).
 *
 * Both `taskLifecycle.js` (the lifecycle VERBS) and `taskCrud.js` (the CRUD +
 * query surface) dispatch over a `CircleItemStore` with the SAME injected `ctx`
 * convention (`{ actor (required), rolePolicy, emit, … }`). The actor/gate/emit/
 * ref-resolution plumbing is identical for both, so it lives HERE ONCE rather
 * than being copy-pasted into each module — the "no duplicated gate/materialise
 * logic" mandate. These are internal to the package (not re-exported from
 * `index.js`).
 */

import { PermissionDeniedError } from './errors.js';

/** Require `ctx.actor` (webid). Parity with `ItemStore#requireActor`. */
export function requireActor(ctx) {
  if (!ctx || typeof ctx.actor !== 'string' || ctx.actor.length === 0) {
    throw new TypeError('taskCtx: ctx.actor (webid) is required');
  }
  return ctx.actor;
}

/**
 * Role-policy gate — parity with `ItemStore#gate`. `ctx.rolePolicy` is the same
 * `RolePolicy` shape (a bag of `can*` predicates); a missing policy or missing
 * predicate = allow (the no-op default). `false` becomes a thrown
 * `PermissionDeniedError`.
 */
export function gate(policy, method, actor, item, patch) {
  if (!policy) return;
  const fn = policy[method];
  if (typeof fn !== 'function') return;
  if (!fn(actor, item, patch)) {
    throw new PermissionDeniedError({
      action: method.replace(/^can/, '').toLowerCase(),
      actor,
      itemId: item?.id,
    });
  }
}

/** Fire the optional per-verb named event (the ItemStore-parity seam). */
export function emit(ctx, eventName, payload) {
  if (ctx && typeof ctx.emit === 'function') ctx.emit(eventName, payload);
}

/**
 * Resolve a markComplete/removeItems/update ref. Explicit id (`{id}` or a bare
 * string) only. Fuzzy-text resolution (`{match}`) was an ItemStore convenience
 * for conversational refs; in the dissolve model the interface projector
 * resolves text → id BEFORE dispatch, so args carry a resolved id.
 * Returns `{ id, item, explicit }`.
 */
export async function resolveById(store, ref) {
  const id = typeof ref === 'string' ? ref : ref?.id;
  if (typeof id !== 'string' || !id) return { id: null, item: null, explicit: false };
  return { id, item: await store.get(id), explicit: true };
}
