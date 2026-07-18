/**
 * basis v2 — co-admin consensus (shared, footer).
 *
 * Decides how a settings edit commits when a circle has >1 admin and
 * `consensusRequired` is on: the edit becomes a pending proposal that the
 * other admins must approve before it applies. Pure model — the host
 * persists proposals + (1.3b) delivers them peer-to-peer (reusing the
 * groupRedeem request/response envelope).
 *
 * Statuses: 'ready' = all required approvals in, apply now · 'pending' =
 * still awaiting approvals.
 */

/** Build a proposal for `patch`. Applies immediately ('ready') unless consensus is needed. */
export function makeProposal({ circleId, patch, proposedBy, policy } = {}) {
  const admins = Array.isArray(policy?.admins) ? policy.admins : [];
  const needsConsensus = !!policy?.consensusRequired && admins.length >= 2;
  const required = needsConsensus ? admins.slice() : (proposedBy ? [proposedBy] : []);
  const approvals = proposedBy ? [proposedBy] : []; // proposer implicitly approves
  return {
    id: `prop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    circleId,
    patch: patch ?? {},
    proposedBy: proposedBy ?? null,
    proposedAt: Date.now(),
    requiredApprovers: required,
    approvals,
    status: isComplete(required, approvals) ? 'ready' : 'pending',
  };
}

/** Record `approver`'s approval; flips to 'ready' once every required approver is in. */
export function approveProposal(proposal, approver) {
  if (!proposal || proposal.status === 'ready') return proposal;
  const approvals = proposal.approvals.includes(approver)
    ? proposal.approvals
    : [...proposal.approvals, approver];
  return {
    ...proposal,
    approvals,
    status: isComplete(proposal.requiredApprovers, approvals) ? 'ready' : 'pending',
  };
}

/** Required approvers who haven't approved yet. */
export function pendingApprovers(proposal) {
  const required = proposal?.requiredApprovers ?? [];
  const approvals = proposal?.approvals ?? [];
  return required.filter((a) => !approvals.includes(a));
}

function isComplete(required, approvals) {
  return required.every((a) => approvals.includes(a));
}
