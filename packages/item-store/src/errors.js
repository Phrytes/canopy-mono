/**
 * Error classes thrown by the item-store substrate.
 */

/**
 * Thrown when a read references an id that doesn't exist.
 */
export class ItemNotFoundError extends Error {
  constructor(id) {
    super(`item-store: item not found: ${id}`);
    this.name = 'ItemNotFoundError';
    this.code = 'ITEM_NOT_FOUND';
    this.itemId = id;
  }
}

/**
 * Thrown when a role-policy gate returns false for an action.
 */
export class PermissionDeniedError extends Error {
  constructor({ action, actor, itemId }) {
    super(`item-store: permission denied: actor=${actor} action=${action} item=${itemId ?? '(new)'}`);
    this.name = 'PermissionDeniedError';
    this.code = 'PERMISSION_DENIED';
    this.action = action;
    this.actor = actor;
    this.itemId = itemId;
  }
}

/**
 * Thrown when a compare-and-swap claim races and loses.  Returned as a
 * structured result rather than thrown (per the L1b sketch's
 * "claim returns success or {error, current}" shape) — but exists as
 * a class for cases where consumers want to throw rather than branch.
 */
export class ClaimRaceError extends Error {
  constructor({ itemId, currentAssignee }) {
    super(`item-store: claim race: item ${itemId} already assigned to ${currentAssignee}`);
    this.name = 'ClaimRaceError';
    this.code = 'CLAIM_RACE';
    this.itemId = itemId;
    this.currentAssignee = currentAssignee;
  }
}

/**
 * Thrown when an update or markComplete can't proceed because the item
 * is already in a terminal state (already complete, or has been
 * removed).
 */
export class InvalidLifecycleError extends Error {
  constructor({ itemId, currentState, attemptedAction }) {
    super(
      `item-store: invalid lifecycle: cannot ${attemptedAction} item ${itemId} in state ${currentState}`,
    );
    this.name = 'InvalidLifecycleError';
    this.code = 'INVALID_LIFECYCLE';
    this.itemId = itemId;
    this.currentState = currentState;
    this.attemptedAction = attemptedAction;
  }
}

/**
 * Thrown when a DoD-lifecycle transition is missing a required argument
 * (e.g. `revoke` without a reason, `reject` without a note).
 */
export class MissingArgumentError extends Error {
  constructor({ itemId, action, argument }) {
    super(`item-store: ${action} on ${itemId} requires '${argument}'`);
    this.name = 'MissingArgumentError';
    this.code = 'MISSING_ARGUMENT';
    this.itemId = itemId;
    this.action = action;
    this.argument = argument;
  }
}

/**
 * thrown by `markComplete` and `approve` when the substrate's
 * `enforceDependencies` flag is on and the item being closed has at
 * least one open dependency. Carries the open-dep ids so callers can
 * render a useful error message ("Can't close — 2 open sub-tasks: …").
 *
 * The gate doesn't fire when `enforceDependencies` is off (default,
 * back-compat). Removed-or-missing deps are treated as satisfied
 * (don't block forever).
 */
export class DependenciesOpenError extends Error {
  constructor({ itemId, openDeps }) {
    super(
      `item-store: cannot close item ${itemId} — ${openDeps.length} open dependencies: ${openDeps.join(', ')}`,
    );
    this.name = 'DependenciesOpenError';
    this.code = 'DEPENDENCIES_OPEN';
    this.itemId = itemId;
    this.openDeps = [...openDeps];
  }
}
