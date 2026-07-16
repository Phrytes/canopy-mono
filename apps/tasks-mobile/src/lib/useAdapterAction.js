/**
 * useAdapterAction — V0.6 (Q24, 2026-05-20).
 *
 * Companion to `renderItemActions` / `renderSectionActions`: those
 * resolve WHICH op + WHICH args to dispatch from the manifest; this
 * hook does the dispatch without the screen wiring a per-op
 * `useSkill(opId)`.
 *
 * Pre-Q24 pattern (InboxScreen C.4):
 *
 *   const approveProposal = useSkill('approveSubtaskProposal');
 *   const declineProposal = useSkill('declineSubtaskProposal');
 *   // ... 6 more useSkill lines, one per op the substrate surfaces
 *   await approveProposal.call({ proposalId });
 *
 * With useAdapterAction:
 *
 *   const dispatch = useAdapterAction();
 *   const actions  = adapter.renderItemActions(section, item);
 *   await dispatch(actions[0]);                      // = invoke(opId, args)
 *   await dispatch(actions[0], { note: 'reason' });  // merges extra args
 *
 * One hook call returns a stable async dispatcher; Rules-of-Hooks
 * compliant (no per-action binding); works for any opId the substrate
 * surfaces — including ones added to the manifest later, without code
 * changes on the screen.
 *
 * Enrichment mirrors useSkill exactly: `_scope` (group/circle id) is
 * auto-injected; the agent's `invoke(localPeer, skillId, parts)` is
 * called; reply parts are unwrapped.  Same activeCircleId semantics as
 * the existing per-op `useSkill('id').call(args)` pattern.
 *
 * V0.6 status: lives in tasks-mobile.  Lift to a shared
 * `@onderling/manifest-adapter-rn` package once a second RN app adopts —
 * same migration story as `useAdapterSection`.
 *
 *   import { useAdapterAction } from './lib/useAdapterAction.js';
 *
 * Return shape:
 *   `async (action, extraArgs?) => unwrappedReply | undefined`
 *
 *   - `undefined` when action is malformed, no active bundle, or the
 *     agent is missing — same forgiving semantics as `useSkillResult`'s
 *     missing-bundle path.
 *   - Otherwise the unwrapped reply (same shape `useSkill('id').call`
 *     returns).
 *
 * Errors are NOT swallowed — they propagate to the caller (mirror
 * useSkill.call, which `throw err`-s after setError).  Callers should
 * `.catch()` as today.
 *
 * @returns {(action: {opId: string, args?: object}, extraArgs?: object)
 *           => Promise<*>}
 */

import { useCallback } from 'react';
import { useService } from '../ServiceContext.js';
import { toParts, unwrapParts } from '@onderling/sync-engine-rn/react';

export function useAdapterAction() {
  const svc = useService();

  return useCallback(async (action, extraArgs = {}) => {
    if (!action || typeof action !== 'object') return undefined;
    if (typeof action.opId !== 'string' || action.opId === '') return undefined;

    const bundle = svc?.activeBundle;
    if (!bundle?.agent?.invoke) return undefined;

    // Merge action.args (manifest-prefilled + per-item) with extraArgs
    // (caller-supplied at dispatch time).  extraArgs wins on conflict —
    // intentional, so callers can override a manifest default.
    const baseArgs = {
      ...(action.args ?? {}),
      ...(extraArgs && typeof extraArgs === 'object' ? extraArgs : {}),
    };

    // Same _scope enrichment as useSkill (sync-engine-rn react bindings).
    const enriched = {
      ...baseArgs,
      _scope: bundle.groupId ?? svc?.activeGroupId ?? null,
    };

    const localPeer = bundle.agent.address ?? bundle.agent.identity?.pubKey ?? null;
    const rawParts  = await bundle.agent.invoke(localPeer, action.opId, toParts(enriched));
    return unwrapParts(rawParts);
  }, [svc]);
}
