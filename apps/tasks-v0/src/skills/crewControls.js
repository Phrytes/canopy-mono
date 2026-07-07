/**
 * crewControls — Tasks V1 Phase 10 lifecycle controls.
 *
 * Five skills:
 *
 *   - `pauseCrew()`      — admin/coord only. Sets `crew.paused = true`.
 *   - `unpauseCrew()`    — admin/coord only. Clears `crew.paused`.
 *   - `archiveCrew()`    — admin only. Sets `crew.archived = true`.
 *                          Reversible — does NOT delete items.
 *   - `unarchiveCrew()`  — admin only. Clears `crew.archived`.
 *   - `getPrivacyNotice({lang?})` — returns the localised
 *                          closed-beta privacy notice; default `en`.
 *
 * The pause/archive flags are honoured by `addTask` (in
 * `src/skills/index.js`) — when paused or archived, addTask returns
 * `{error: 'crew-paused' | 'crew-archived'}` instead of writing.
 *
 * Other skills (claim, complete, submit, approve, reject, revoke,
 * addSubtask) are NOT blocked by pause — paused crews keep
 * processing existing tasks; they only block creating new ones.
 * Archived crews block all mutations except read + close-out.
 *
 * The crew config is mutated through `crew.crewMutator(patch)` so the
 * Crew.js wiring keeps the `liveCrew` pointer in sync (frozen-copy
 * swap pattern).
 */

import { defineSkill } from '@canopy/core';

import { argsFromParts } from '../bundleResolver.js';
import { privacyNoticeFor } from '../lib/privacyNotice.js';

/**
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 */
export function buildCrewControlSkills({ bundleResolver } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildCrewControlSkills: bundleResolver(parts, ctx) required');
  }

  return [
    defineSkill('pauseCrew', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'circleId required' };
      const role = crew.roles?.[from];
      if (role !== 'admin' && role !== 'coordinator') {
        return { error: 'admin or coordinator required' };
      }
      crew.crewMutator({ paused: true });
      return { ok: true, paused: !!crew.liveCrew?.paused };
    }, {
      description: 'Pause the crew — blocks new tasks; existing tasks remain workable.',
    }),

    defineSkill('unpauseCrew', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'circleId required' };
      const role = crew.roles?.[from];
      if (role !== 'admin' && role !== 'coordinator') {
        return { error: 'admin or coordinator required' };
      }
      crew.crewMutator({ paused: false });
      return { ok: true, paused: !!crew.liveCrew?.paused };
    }, {
      description: 'Resume the crew after a pause.',
    }),

    defineSkill('archiveCrew', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'circleId required' };
      const role = crew.roles?.[from];
      if (role !== 'admin') {
        return { error: 'admin required' };
      }
      crew.crewMutator({ archived: true });
      return { ok: true, archived: !!crew.liveCrew?.archived };
    }, {
      description: 'Archive the crew — read-only ledger; reversible via unarchiveCrew.',
    }),

    defineSkill('unarchiveCrew', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'circleId required' };
      const role = crew.roles?.[from];
      if (role !== 'admin') {
        return { error: 'admin required' };
      }
      crew.crewMutator({ archived: false });
      return { ok: true, archived: !!crew.liveCrew?.archived };
    }, {
      description: 'Reverse an archive.',
    }),

    defineSkill('getPrivacyNotice', async ({ parts }) => {
      const a = argsFromParts(parts);
      const lang = typeof a.lang === 'string' && a.lang ? a.lang : 'en';
      return { lang, items: privacyNoticeFor(lang) };
    }, {
      description: 'Return the localised closed-beta privacy notice.',
    }),
  ];
}
