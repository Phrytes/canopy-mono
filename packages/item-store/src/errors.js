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
