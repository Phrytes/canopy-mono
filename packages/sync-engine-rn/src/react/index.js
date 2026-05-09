/**
 * @canopy/sync-engine-rn/react — React hooks for invoking skills
 * on the active agent bundle.
 *
 * Apps consume via the factory:
 *
 *   import { createReactBindings } from '@canopy/sync-engine-rn/react';
 *   import { useService } from './ServiceContext.js';
 *   export const { useSkill, useAgentEvent, useSkillResult } =
 *     createReactBindings({ useService });
 *
 * The `toParts` / `unwrapParts` helpers are also re-exported so apps
 * can build their own one-off skill calls without going through the
 * hooks (e.g. a `useEffect` that fires once on mount).
 */

export { createReactBindings }    from './createReactBindings.js';
export { createSettingsHook }      from './createSettingsHook.js';
export { createMemberProfileHook } from './createMemberProfileHook.js';
export { toParts, unwrapParts }    from './skillParts.js';
