/**
 * wireSkills — V2.8 single-registration root.
 *
 * Registers every Tasks skill on the process-wide meshAgent ONCE.
 * Skills resolve their per-crew CrewState at dispatch time via the
 * supplied `bundleResolver`. See `./bundleResolver.js` for the
 * single/multi-crew strategies.
 *
 * Design: this is the only place skills get registered. Crew.js
 * goes from "register N times per crew" to "build CrewState; wire
 * once" — see Stoop's 2026-05-08 single-agent-refactor for the
 * functional sketch this mirrors.
 *
 * Mandatory args:
 *   - `meshAgent` — the target `core.Agent`
 *   - `bundleResolver` — `(parts, ctx) → CrewState | null`
 *   - `userSettings` — `{loadShared, updateShared}` for observability
 *
 * Optional:
 *   - `crewsProvider` — `() => Iterable<CrewState>` for the dashboard
 *     skill. Defaults to a single-crew iterator if omitted.
 *   - `members` — when supplied, identity-resolver registers in the
 *     classic single-crew shape with this MemberMap. For multi-crew,
 *     pass `getBundle` instead (returns `{members}` per resolved crew).
 *   - `getBundle` — `(args, ctx) => {members} | null` for multi-crew
 *     identity skills.
 */

import { buildIdentitySkills } from '@canopy/identity-resolver';

import { buildSkills } from './skills/index.js';
import { buildProfileSkills } from './skills/profile.js';
import { buildAppealSkill } from './skills/appeal.js';
import { buildSubtaskSkills } from './skills/subtasks.js';
import { buildInboxSkills } from './skills/inbox.js';
import { buildWorkspaceSkills } from './skills/workspace.js';
import { buildObservabilitySkills } from './skills/observability.js';
import { buildCrewControlSkills } from './skills/crewControls.js';
import { buildCustomRoleSkills } from './skills/customRoles.js';
import { buildBotBindingSkills } from './skills/botBindings.js';
import { buildCalendarEmissionSkills } from './skills/calendarEmission.js';
import { buildInvoicingSkills } from './skills/invoicing.js';
import { buildAvailabilitySkills } from './skills/availability.js';
import { buildPlannerSkills } from './skills/planner.js';
import { buildDashboardSkills } from './skills/dashboard.js';
import { buildForceCompleteSkill } from './skills/forceComplete.js';
import { buildBotSkills } from './bot/skills.js';

/**
 * @param {object} args
 * @param {object} args.meshAgent
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 * @param {{loadShared, updateShared}} [args.userSettings]
 *   Optional. When omitted, a no-op default is supplied so the
 *   observability skills register but report empty state when called.
 * @param {() => Iterable<object>} [args.crewsProvider]
 * @param {object} [args.members]
 * @param {(args: object, ctx?: object) => object | null} [args.getBundle]
 * @returns {{registered: string[]}}
 */
export function wireSkills({
  meshAgent,
  bundleResolver,
  userSettings,
  crewsProvider,
  members,
  getBundle,
} = {}) {
  if (!meshAgent?.skills?.register) {
    throw new TypeError('wireSkills: meshAgent (with skills registry) required');
  }
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('wireSkills: bundleResolver(parts, ctx) required');
  }

  // No-op userSettings keeps observability skill registration possible
  // even on the V0 zero-config path (createTasksAgent — no settings file).
  const us = userSettings ?? {
    loadShared:   async () => ({}),
    updateShared: async () => ({}),
  };

  const cp = typeof crewsProvider === 'function'
    ? crewsProvider
    : () => {
        // Default: derive single-crew iterator by resolving the empty parts.
        const crew = bundleResolver([], {});
        return crew ? [crew] : [];
      };

  const idsArgs = members
    ? { members }
    : (typeof getBundle === 'function' ? { getBundle } : null);
  if (!idsArgs) {
    throw new TypeError('wireSkills: pass either `members` (single-crew) or `getBundle` (multi-crew) for identity skills');
  }

  const allBuilders = [
    buildIdentitySkills(idsArgs),
    buildSkills({ bundleResolver }),
    buildProfileSkills({ bundleResolver }),
    buildAppealSkill({ bundleResolver }),
    buildSubtaskSkills({ bundleResolver }),
    buildInboxSkills({ bundleResolver }),
    buildWorkspaceSkills({ bundleResolver }),
    buildObservabilitySkills({ bundleResolver, userSettings: us }),
    buildCrewControlSkills({ bundleResolver }),
    buildCustomRoleSkills({ bundleResolver }),
    buildBotBindingSkills({ bundleResolver }),
    buildCalendarEmissionSkills({ bundleResolver }),
    buildInvoicingSkills({ bundleResolver }),
    buildAvailabilitySkills({ bundleResolver }),
    buildPlannerSkills({ bundleResolver }),
    buildDashboardSkills({ bundleResolver, crewsProvider: cp }),
    buildForceCompleteSkill({ bundleResolver }),
    buildBotSkills({ bundleResolver }),
  ];

  const registered = [];
  for (const defs of allBuilders) {
    for (const def of defs) {
      meshAgent.skills.register(def);
      registered.push(def.id);
    }
  }
  return { registered };
}
