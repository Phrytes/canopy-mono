/**
 * buildIdentitySkills — pre-built skill definitions over a MemberMap.
 *
 * Returns an array of `defineSkill(...)` objects ready to register on a
 * `core.Agent`:
 *
 *   import { Agent } from '@canopy/core';
 *   import { MemberMap, buildIdentitySkills } from '@canopy/identity-resolver';
 *
 *   const agent = await Agent.createNew({ transport, label: 'X' });
 *   for (const def of buildIdentitySkills({ members })) agent.register(def);
 *
 * Skills returned:
 *
 *   resolveMember — DataPart in: {webid} or {externalIdNs, externalIdValue}
 *                   DataPart out: {member}
 *
 * Lifted from the duplicate copies in apps/tasks-v0 and
 * apps/neighborhood-v0 (rule-of-two). Migrated 2026-05-04 from the
 * legacy `(args, ctx) => result` shape to `defineSkill` shape as part
 * of L1d Phase 3.1 (substrate-vs-SDK refactor).
 */

import { defineSkill } from '@canopy/core';

/**
 * Read a single DataPart's `data` from a Parts[] input. Defaults to `{}`.
 * @param {Array<object>} parts
 * @returns {object}
 */
function dataArgs(parts) {
  if (!Array.isArray(parts)) return {};
  const dp = parts.find((p) => p?.type === 'DataPart');
  return dp?.data ?? {};
}

/**
 * @param {object} args
 * @param {import('./MemberMap.js').MemberMap | null | undefined} args.members
 * @returns {Array<object>} array of `defineSkill` definitions
 */
export function buildIdentitySkills({ members }) {
  return [
    defineSkill('resolveMember', async ({ parts }) => {
      const a = dataArgs(parts);
      if (!members) return { member: null };
      if (a.webid) {
        return { member: await members.resolveByWebid(a.webid) };
      }
      if (a.externalIdNs && a.externalIdValue) {
        return {
          member: await members.resolveByExternalId(a.externalIdNs, a.externalIdValue),
        };
      }
      return { member: null };
    }, {
      description: 'Resolve a member record by webid or external id (e.g. telegram uid).',
      visibility:  'authenticated',
    }),
  ];
}
