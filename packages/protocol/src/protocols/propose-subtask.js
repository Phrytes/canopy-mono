/**
 * propose-subtask — the canonical first consumer protocol.
 *
 * The Tasks app's "I'd like to spawn a sub-task assigned to you"
 * negotiation flow, modelled as a state machine. Spec'd here so the
 * substrate API gets shaped against a real load-bearing case before
 * opening to other apps (Phase 52.13.4 lock).
 *
 * States:
 *   proposed   — proposer has submitted; assignee hasn't responded yet
 *   accepted   — assignee accepted; the new sub-task is live
 *   declined   — assignee declined; flow ends
 *   withdrawn  — proposer withdrew before assignee responded
 *   expired    — TTL hit without a response
 *
 * Events:
 *   accept     proposed → accepted    — assignee accepts (payload: {at})
 *   decline    proposed → declined    — assignee declines (payload: {at, note?})
 *   withdraw   proposed → withdrawn   — proposer withdraws
 *   expire     proposed → expired     — TTL timer fires (payload: {at})
 *
 * Standardisation Phase 52.13.4.
 */

import { defineProtocol } from '../defineProtocol.js';

export const PROPOSE_SUBTASK = defineProtocol({
  id:      'propose-subtask',
  name:    'Propose a sub-task to another assignee',
  initial: 'proposed',
  states: [
    'proposed',
    'accepted',
    'declined',
    'withdrawn',
    'expired',
  ],
  validators: {
    initial: (ctx) => {
      // Context must carry: proposer, assignee, parentTaskId, body.
      return typeof ctx?.proposer === 'string'
          && typeof ctx?.assignee === 'string'
          && typeof ctx?.parentTaskId === 'string'
          && typeof ctx?.body === 'string'
          && ctx.body.length > 0;
    },
  },
  transitions: [
    {
      from:    'proposed',
      event:   'accept',
      to:      'accepted',
      guard:   (ctx, payload) => payload?.actor === ctx.assignee,
      reducer: (ctx, payload) => ({
        ...ctx,
        acceptedAt:  payload?.at ?? new Date().toISOString(),
        ...(payload?.subtaskId ? { subtaskId: payload.subtaskId } : {}),
      }),
    },
    {
      from:    'proposed',
      event:   'decline',
      to:      'declined',
      guard:   (ctx, payload) => payload?.actor === ctx.assignee,
      reducer: (ctx, payload) => ({
        ...ctx,
        declinedAt: payload?.at ?? new Date().toISOString(),
        ...(payload?.note ? { declineNote: payload.note } : {}),
      }),
    },
    {
      from:    'proposed',
      event:   'withdraw',
      to:      'withdrawn',
      guard:   (ctx, payload) => payload?.actor === ctx.proposer,
      reducer: (ctx, payload) => ({
        ...ctx,
        withdrawnAt: payload?.at ?? new Date().toISOString(),
      }),
    },
    {
      from:    'proposed',
      event:   'expire',
      to:      'expired',
      reducer: (ctx, payload) => ({
        ...ctx,
        expiredAt: payload?.at ?? new Date().toISOString(),
      }),
    },
  ],
});
