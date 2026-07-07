/**
 * calendarEmission — Tasks V2.1 admin/self skills for the
 * calendar-write side-channel.
 *
 * Three skills:
 *   - `setCalendarEmission({enabled})` — admin/coord. Toggles
 *     `liveCrew.calendarEmission.enabled`.
 *   - `getCalendarEmissionUrl()`       — self. Returns the URL the
 *     calling actor's calendar app subscribes to.
 *   - `getCalendarEmissionStatus()`    — self. Returns whether
 *     emission is on for the crew, plus the actor's URL when it is.
 *
 * The actual emit-loop lives in `../calendar/wireCalendarEmission.js`
 * and is wired by `Crew.js` per-member when `liveCrew.calendarEmission?.enabled`
 * is true. The skill calls `crew.onCalendarEmissionChange?.()` after
 * toggling so Crew.js can attach/detach the per-member loops.
 */

import { defineSkill } from '@canopy/core';

import { argsFromParts } from '../bundleResolver.js';

/**
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 *   Resolver returns a CrewState; per-CrewState `onCalendarEmissionChange`
 *   callback wires the rewire loop in `Crew.js`.
 */
export function buildCalendarEmissionSkills({ bundleResolver } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildCalendarEmissionSkills: bundleResolver(parts, ctx) required');
  }

  return [
    defineSkill('setCalendarEmission', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'circleId required' };
      const role = crew.roles?.[from];
      if (role !== 'admin' && role !== 'coordinator') {
        return { error: 'admin or coordinator required' };
      }
      const a = argsFromParts(parts);
      if (typeof a.enabled !== 'boolean') {
        return { error: 'enabled (boolean) required' };
      }
      const lc = crew.liveCrew ?? {};
      const next = { ...(lc.calendarEmission ?? {}), enabled: a.enabled };
      crew.crewMutator({ calendarEmission: next });
      try { crew.onCalendarEmissionChange?.(); } catch { /* re-wire failure must not break the toggle skill */ }
      return { ok: true, enabled: a.enabled };
    }, {
      description: 'Toggle calendar emission for the crew (admin/coord only).',
      visibility:  'authenticated',
    }),

    defineSkill('getCalendarEmissionUrl', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'circleId required' };
      if (typeof from !== 'string' || !from) {
        return { error: 'webid required (from envelope)' };
      }
      const lc = crew.liveCrew ?? {};
      const enabled = !!lc.calendarEmission?.enabled;
      if (!enabled) {
        return {
          enabled: false,
          url:     null,
          path:    null,
        };
      }
      // Per-member path so each member subscribes to their own filtered
      // calendar (containing tasks they're assigned, master, or approver of).
      const path = `mem://user/tasks/calendars/${encodeURIComponent(lc.circleId ?? 'unknown')}-${encodeURIComponent(from)}.ics`;
      return {
        enabled: true,
        path,
        // The agent-ui's static-file overlay translates mem:// paths
        // to http:// URLs the host is reachable on; CLI surfaces the
        // mem:// path verbatim and the agent-ui layer rewrites.
        url: path,
      };
    }, {
      description: 'Return the calendar URL the calling actor should subscribe to.',
      visibility:  'authenticated',
    }),

    defineSkill('getCalendarEmissionStatus', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'circleId required' };
      const lc = crew.liveCrew ?? {};
      const enabled = !!lc.calendarEmission?.enabled;
      const role = crew.roles?.[from];
      const canToggle = role === 'admin' || role === 'coordinator';
      return {
        enabled,
        canToggle,
        ...(enabled && from
          ? { path: `mem://user/tasks/calendars/${encodeURIComponent(lc.circleId ?? 'unknown')}-${encodeURIComponent(from)}.ics` }
          : {}),
      };
    }, {
      description: 'Read the calendar-emission flag + the URL when on.',
      visibility:  'authenticated',
    }),
  ];
}
