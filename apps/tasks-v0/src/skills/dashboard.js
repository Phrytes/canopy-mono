/**
 * dashboard — Tasks V2.5 cross-crew dashboard.
 *
 *   - `getMyCrews()` — self only. Returns one row per crew the actor
 *     belongs to (across every CrewState the meshAgent knows about),
 *     each with `{crewId, name, kind, counts: {open, overdue,
 *     awaitingApproval, mine}}`.
 *
 * After V2.8: registered ONCE on the meshAgent. The skill enumerates
 * crews via `crewsProvider()` (returns `Map<crewId, CrewState>` or
 * any iterable of CrewStates) and filters to crews where the actor
 * has a role.
 */

import { defineSkill } from '@canopy/core';

import { aggregateCrews } from '../dashboard/aggregator.js';

/**
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 *   Resolves the *calling* crew context. The skill body uses the
 *   caller's webid to filter `crewsProvider()` independently — so
 *   a single-crew launch still works (both bundleResolver and
 *   crewsProvider return the same one crew).
 * @param {() => Iterable<object>} args.crewsProvider
 *   Returns every CrewState the meshAgent knows about. Each
 *   CrewState exposes `.liveCrew` + `.itemStore` + `.roles` so the
 *   aggregator can compute counts.
 */
export function buildDashboardSkills({ bundleResolver, crewsProvider } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildDashboardSkills: bundleResolver(parts, ctx) required');
  }
  if (typeof crewsProvider !== 'function') {
    throw new TypeError('buildDashboardSkills: crewsProvider() required');
  }

  return [
    defineSkill('getMyCrews', async ({ parts, from, envelope }) => {
      const ctxCrew = bundleResolver(parts, { envelope, from });
      if (!ctxCrew) return { error: 'crewId required' };
      if (typeof from !== 'string' || !from) return { error: 'webid required' };
      // V2.5 multi-crew launches plumb a per-CrewState override
      // provider (`_dashboardCrewsProvider`) so the dashboard sees
      // every crew the launcher built — even those not in the local
      // wireSkills's `crewsProvider`. Falls back to the wireSkills
      // default for single-crew launches.
      const cp = typeof ctxCrew._dashboardCrewsProvider === 'function'
        ? ctxCrew._dashboardCrewsProvider
        : crewsProvider;
      const allCrews = [...(cp() ?? [])];
      const eligible = allCrews.filter((cs) => {
        const role = cs?.roles?.[from];
        return typeof role === 'string' && role.length > 0;
      });

      const inputs = [];
      for (const cs of eligible) {
        let openTasks = [];
        try { openTasks = await cs.itemStore.listOpen(); } catch { /* skip */ }
        inputs.push({ crew: cs.liveCrew, openTasks });
      }
      const crews = aggregateCrews({
        crews: inputs,
        actor: from,
        roleOf: (actor, crew) => {
          const cs = eligible.find((x) => x.liveCrew?.crewId === crew?.crewId);
          return cs?.roles?.[actor];
        },
      });
      return { crews };
    }, {
      description: 'List every crew the calling actor belongs to with counts.',
      visibility:  'authenticated',
    }),
  ];
}
