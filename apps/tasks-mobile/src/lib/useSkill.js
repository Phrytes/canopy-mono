/**
 * useSkill — hooks bound to tasks-mobile's ServiceContext.
 *
 * Phase 41.2 (2026-05-09). The substrate factories live in
 * `@onderling/sync-engine-rn/react`; this file is the per-app
 * binding that supplies tasks-mobile's `useService` hook.
 *
 *   import { useSkill } from './lib/useSkill.js';
 *
 *   const post = useSkill('addTask');
 *   await post.call({ text: 'buy milk' });    // circleId auto-injected
 */

import {
  createReactBindings,
  createSettingsHook,
  createMemberProfileHook,
  toParts,
  unwrapParts,
} from '@onderling/sync-engine-rn/react';
import { useService } from '../ServiceContext.js';

const _bindings = createReactBindings({ useService });

export const useSkill        = _bindings.useSkill;
export const useAgentEvent   = _bindings.useAgentEvent;
export const useSkillResult  = _bindings.useSkillResult;

export const useSettings        = createSettingsHook({ useService });
export const useMemberProfile   = createMemberProfileHook({ useService });

// Re-export the parts helpers so screens that need a one-off invoke
// (outside the hook lifecycle) don't have to reach into the substrate.
export { toParts, unwrapParts };
