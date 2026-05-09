/**
 * useSkill — hook for invoking a skill on the active group's agent.
 *
 * Stoop V3 Phase 40.14 (2026-05-08), lifted to substrate 2026-05-09
 * (Phase 41.0 L1 — Tasks-mobile is the second consumer). The hook
 * lives in `@canopy/sync-engine-rn/react` as a factory; this file
 * binds it to Stoop's ServiceContext.
 */

import { createReactBindings } from '@canopy/sync-engine-rn/react';
import { useService } from '../ServiceContext.js';

const _bindings = createReactBindings({ useService });

export const useSkill        = _bindings.useSkill;
export const useAgentEvent   = _bindings.useAgentEvent;
export const useSkillResult  = _bindings.useSkillResult;

// Back-compat re-export — existing tests + a few callers import
// `_toParts` from this module.
export { toParts as _toParts } from '@canopy/sync-engine-rn/react';
