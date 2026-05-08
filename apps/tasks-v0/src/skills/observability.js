/**
 * observability skills — Tasks V1 Phase 9.
 *
 * Skills:
 *   - `getMetrics()` — read-only snapshot of the local MetricsTracker.
 *     V1 keeps the snapshot strictly local (no auto-share); the UI
 *     surfaces it on the crew settings tab. Future V2 work adds an
 *     opt-in pod-mirror so admins can aggregate across members.
 *   - `getCrewCadences()` — current per-event cadence map for the crew.
 *   - `setCrewCadences({cadences})` — admin/coord only; mutates the
 *     live crew config.
 *   - `getMyCadenceOverrides()` — the user's overrides from Settings.
 *   - `setMyCadenceOverrides({overrides})` — write the user's overrides.
 *   - `resolveMyCadence({eventType})` — convenience: returns the
 *     effective `{channel, suppressed, leadMs}` for the caller given
 *     all three layers.
 *
 * The metrics tracker is per-CrewState (`crew.metricsTracker`) since
 * each ItemStore has its own tracker. `userSettings` is process-level
 * (per-device, not per-crew) and is passed as a separate dep to the
 * builder.
 */

import { defineSkill } from '@canopy/core';

import { resolveCadence, sanitiseCadenceMap } from '../observability/cadence.js';
import { argsFromParts } from '../bundleResolver.js';

/**
 * Build the observability skills.
 *
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 *   CrewState exposes `metricsTracker` + `userSettings` (the latter is
 *   process-level but read off the CrewState so wireSkills doesn't
 *   need to know about per-process bindings — createCrewAgent installs
 *   `crewState.userSettings` post-construction).
 * @param {{loadShared, updateShared}} [args.userSettings]
 *   Fallback used only if `crew.userSettings` is missing — typically
 *   the no-op default supplied by wireSkills on the V0 path.
 */
export function buildObservabilitySkills({ bundleResolver, userSettings: fallbackUserSettings } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildObservabilitySkills: bundleResolver(parts, ctx) required');
  }
  const fallback = fallbackUserSettings ?? {
    loadShared:   async () => ({}),
    updateShared: async () => ({}),
  };
  function settingsOf(crew) {
    return crew.userSettings ?? fallback;
  }

  return [
    defineSkill('getMetrics', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const tracker = crew.metricsTracker;
      if (!tracker?.snapshot) return { error: 'metricsTracker not wired for this crew' };
      return { snapshot: tracker.snapshot() };
    }, {
      description: 'Read the local MetricsTracker snapshot (counters + latency p50/p90).',
    }),

    defineSkill('getCrewCadences', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const lc = crew.liveCrew ?? {};
      return { cadences: { ...(lc.cadences ?? {}) } };
    }, {
      description: 'Read the crew\'s per-event cadence config.',
    }),

    defineSkill('setCrewCadences', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const role = crew.roles?.[from];
      if (role !== 'admin' && role !== 'coordinator') {
        return { error: 'admin or coordinator required' };
      }
      const a = argsFromParts(parts);
      const sanitised = sanitiseCadenceMap(a.cadences ?? {});
      crew.crewMutator({ cadences: sanitised });
      const lc = crew.liveCrew ?? {};
      return { cadences: { ...(lc.cadences ?? {}) } };
    }, {
      description: 'Set the crew-wide cadence config (admin/coord only).',
    }),

    defineSkill('getMyCadenceOverrides', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const settings = await settingsOf(crew).loadShared();
      return { overrides: { ...(settings.cadenceOverrides ?? {}) } };
    }, {
      description: 'Read my user-side cadence overrides.',
    }),

    defineSkill('setMyCadenceOverrides', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const a = argsFromParts(parts);
      const sanitised = sanitiseCadenceMap(a.overrides ?? {});
      await settingsOf(crew).updateShared({ cadenceOverrides: sanitised });
      return { overrides: sanitised };
    }, {
      description: 'Set my user-side cadence overrides.',
    }),

    defineSkill('resolveMyCadence', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const a = argsFromParts(parts);
      if (typeof a.eventType !== 'string' || !a.eventType) {
        return { error: 'eventType required' };
      }
      const lc = crew.liveCrew ?? {};
      const settings = await settingsOf(crew).loadShared();
      const resolved = resolveCadence({
        eventType: a.eventType,
        crew:      lc.cadences ?? {},
        user:      settings.cadenceOverrides ?? {},
      });
      return { resolved };
    }, {
      description: 'Resolve the effective cadence for an event (user > crew > baseline).',
    }),
  ];
}
