/**
 * dashboard — Tasks V2.5 cross-circle dashboard.
 *
 *   - `getMyCircles()` — self only. Returns one row per circle the actor
 *     belongs to (across every CircleState the meshAgent knows about),
 *     each with `{circleId, name, kind, counts: {open, overdue,
 *     awaitingApproval, mine}}`.
 *
 * After V2.8: registered ONCE on the meshAgent. The skill enumerates
 * circles via `circlesProvider()` (returns `Map<circleId, CircleState>` or
 * any iterable of CircleStates) and filters to circles where the actor
 * has a role.
 */

import { defineSkill } from '@canopy/core';

import { aggregateCircles } from '../dashboard/aggregator.js';

/**
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 *   Resolves the *calling* circle context. The skill body uses the
 *   caller's webid to filter `circlesProvider()` independently — so
 *   a single-circle launch still works (both bundleResolver and
 *   circlesProvider return the same one circle).
 * @param {() => Iterable<object>} args.circlesProvider
 *   Returns every CircleState the meshAgent knows about. Each
 *   CircleState exposes `.liveCircle` + `.itemStore` + `.roles` so the
 *   aggregator can compute counts.
 */
export function buildDashboardSkills({ bundleResolver, circlesProvider } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildDashboardSkills: bundleResolver(parts, ctx) required');
  }
  if (typeof circlesProvider !== 'function') {
    throw new TypeError('buildDashboardSkills: circlesProvider() required');
  }

  return [
    defineSkill('getMyCircles', async ({ parts, from, envelope }) => {
      const ctxCircle = bundleResolver(parts, { envelope, from });
      if (!ctxCircle) return { error: 'circleId required' };
      if (typeof from !== 'string' || !from) return { error: 'webid required' };
      // V2.5 multi-circle launches plumb a per-CircleState override
      // provider (`_dashboardCirclesProvider`) so the dashboard sees
      // every circle the launcher built — even those not in the local
      // wireSkills's `circlesProvider`. Falls back to the wireSkills
      // default for single-circle launches.
      const cp = typeof ctxCircle._dashboardCirclesProvider === 'function'
        ? ctxCircle._dashboardCirclesProvider
        : circlesProvider;
      const allCircles = [...(cp() ?? [])];
      const eligible = allCircles.filter((cs) => {
        const role = cs?.roles?.[from];
        return typeof role === 'string' && role.length > 0;
      });

      const inputs = [];
      for (const cs of eligible) {
        let openTasks = [];
        try { openTasks = await cs.itemStore.listOpen(); } catch { /* skip */ }
        inputs.push({ circle: cs.liveCircle, openTasks });
      }
      const circles = aggregateCircles({
        circles: inputs,
        actor: from,
        roleOf: (actor, circle) => {
          const cs = eligible.find((x) => x.liveCircle?.circleId === circle?.circleId);
          return cs?.roles?.[actor];
        },
      });
      return { circles };
    }, {
      description: 'List every circle the calling actor belongs to with counts.',
      visibility:  'authenticated',
    }),
  ];
}
