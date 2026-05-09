/**
 * inboxClassify — pure-fn helpers for the inbox event taxonomy.
 *
 * Phase 41.6 (2026-05-09).
 *
 * The desktop web inbox dispatches by button-id prefixes
 * (`approveSubtaskProposal:<id>`, `declineSubtaskProposal:<id>`).
 * Mobile uses the typed action object directly. This file owns the
 * normalisation + a small `kindOf(event)` helper used by the
 * InboxScreen renderer to pick the right card layout.
 */

/**
 * @typedef {'subtask-proposal' | 'task-rejected' | 'task-claimed' | 'task-completed' | 'unknown'} InboxKind
 *
 * @param {object} event   listMyInbox item
 * @returns {InboxKind}
 */
export function kindOf(event) {
  if (!event || typeof event !== 'object') return 'unknown';
  // Tasks-app inbox events carry `kind` directly (V1 InAppInboxBridge).
  const k = event.kind ?? event.eventKind ?? null;
  if (k === 'subtask-proposal') return 'subtask-proposal';
  if (k === 'task-rejected')    return 'task-rejected';
  if (k === 'task-claimed')     return 'task-claimed';
  if (k === 'task-completed')   return 'task-completed';
  return 'unknown';
}

/**
 * Pull the proposalId off a subtask-proposal event. The desktop
 * bridges write it to `event.proposalId`; the substrate's
 * `subtask-proposal` Item carries its own id at `event.id`.
 */
export function proposalIdOf(event) {
  if (!event || typeof event !== 'object') return null;
  if (typeof event.proposalId === 'string' && event.proposalId) return event.proposalId;
  if (typeof event.id === 'string' && event.id) return event.id;
  return null;
}
