/**
 * helloGates.js — ready-made hello-gate predicates.
 *
 * A hello gate is an async function `(envelope) => boolean`. `handleHello`
 * consults the gate before registering the sender's key or sending an ack;
 * on `false` (or thrown error) the HI is silently dropped, so the sender's
 * `sendHello` times out with no way to tell whether we're online but
 * refusing them vs genuinely absent.
 *
 * Install one via `agent.setHelloGate(fn)`. No gate set = accept all
 * (preserves historical behaviour; backward-compatible).
 *
 * See Design-v3 "layered hello" proposal and CODING-PLAN.md Group W.
 */

/**
 * Pre-shared-secret gate.
 *
 * Accepts if `envelope.payload.authToken === secret`.
 *
 * @param {string} secret
 */
export function tokenGate(secret) {
  if (typeof secret !== 'string' || !secret.length) {
    throw new Error('tokenGate requires a non-empty string secret');
  }
  return async function tokenGateFn(envelope) {
    return envelope?.payload?.authToken === secret;
  };
}

/**
 * Group-membership gate.
 *
 * Expects `envelope.payload.authToken` to be a GroupProof (as minted by
 * `GroupManager.issueProof`). Accepts if that proof is valid and belongs
 * to one of `groupIds`.
 *
 * @param {string[]} groupIds
 * @param {import('../permissions/GroupManager.js').GroupManager} groupManager
 */
export function groupGate(groupIds, groupManager) {
  if (!Array.isArray(groupIds) || groupIds.length === 0) {
    throw new Error('groupGate requires a non-empty groupIds array');
  }
  if (!groupManager) {
    throw new Error('groupGate requires a GroupManager');
  }

  return async function groupGateFn(envelope) {
    const proof = envelope?.payload?.authToken;
    if (!proof || typeof proof !== 'object') return false;

    for (const gid of groupIds) {
      try {
        if (await groupManager.verifyProof?.(proof, gid)) return true;
      } catch {
        // verifyProof throwing → fail closed for that group, try next
      }
    }
    return false;
  };
}

/**
 * Composition helper — passes if any of the inner gates passes.
 * Short-circuits on the first accept.
 *
 * @param {...((envelope: object) => boolean | Promise<boolean>)} gates
 */
export function anyOf(...gates) {
  return async function anyOfFn(envelope) {
    for (const g of gates) {
      try {
        if (await g(envelope)) return true;
      } catch {
        // One sub-gate throwing doesn't disqualify the composition.
      }
    }
    return false;
  };
}
