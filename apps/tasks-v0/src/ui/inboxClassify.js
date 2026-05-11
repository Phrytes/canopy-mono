/**
 * inboxClassify — pure-fn helpers for the inbox event taxonomy.
 *
 * Phase 41.6 (2026-05-09).
 *
 * Lifted 2026-05-10 from `apps/tasks-mobile/src/lib/inboxClassify.js`
 * into `apps/tasks-v0/src/ui/` per the
 * "Shared UI-glue helpers between platform shells" rule
 * (`Project Files/conventions/architectural-layering.md`).
 *
 * Both shells consume from here:
 *   - `apps/tasks-v0/web/inbox.html` + handlers  (desktop)
 *   - `apps/tasks-mobile/src/screens/InboxScreen.jsx`
 *
 * The desktop web inbox dispatches by button-id prefixes
 * (`approveSubtaskProposal:<id>`, `declineSubtaskProposal:<id>`).
 * Mobile uses the typed action object directly. This file owns the
 * normalisation + small `kindOf(event)` / `proposalIdOf(event)` /
 * `requestIdOf(event)` helpers used by both renderers to pick the
 * right card layout.
 *
 * Pure-fn only — must not import from `react-native`, DOM globals,
 * or any platform module.
 */

/**
 * @typedef {'subtask-proposal' | 'subtask-request' | 'task-rejected' | 'task-claimed' | 'task-completed' | 'unknown'} InboxKind
 *
 * @param {object} event   listMyInbox item
 * @returns {InboxKind}
 */
export function kindOf(event) {
  if (!event || typeof event !== 'object') return 'unknown';
  // Tasks-app inbox events carry `kind` directly (V1 InAppInboxBridge).
  const k = event.kind ?? event.eventKind ?? null;
  if (k === 'subtask-proposal') return 'subtask-proposal';
  if (k === 'subtask-request')  return 'subtask-request';
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

/**
 * Pull the requestId off a subtask-request event. Substrate writes
 * the id at `event.requestId` (V1 InAppInboxBridge convention) but
 * older bridges may use `event.id`. Both round-trip through here.
 */
export function requestIdOf(event) {
  if (!event || typeof event !== 'object') return null;
  if (typeof event.requestId === 'string' && event.requestId) return event.requestId;
  if (typeof event.id === 'string' && event.id) return event.id;
  return null;
}
