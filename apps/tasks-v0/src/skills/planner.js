/**
 * planner skills — Tasks V2.4 auto-scheduling.
 *
 * Three skills:
 *   - `suggestSchedule({lookaheadDays?})` — self only. Reads my open
 *     assignments + busy spans (via the V1 calendar reader) +
 *     working hours; returns a sorted list of suggestions. Pure
 *     algorithm runs in `../planner/greedy.js`.
 *   - `acceptSchedule({taskId, slotStart, slotEnd})` — self only.
 *     Sets `task.scheduledAt = slotStart` (and `task.estimateMinutes`
 *     if not already set). The calendar emission listener picks it
 *     up on the next debounce.
 *   - `rejectSchedule({taskId})` — self only. No-op (UI affordance).
 *
 * Working hours come from `liveCircle.workingHours` first, then from
 * `member.workingHours` if set (per-member override), else default
 * Mon-Fri 09:00-17:00.
 */

import { defineSkill } from '@canopy/core';

import { suggestSchedule as suggestPure } from '../planner/greedy.js';
import { readMyCalendar } from '../calendar/iCalReader.js';
import { argsFromParts } from '../bundleResolver.js';

const DEFAULT_WORKING_HOURS = Object.freeze([
  { day: 'mon', start: '09:00', end: '17:00' },
  { day: 'tue', start: '09:00', end: '17:00' },
  { day: 'wed', start: '09:00', end: '17:00' },
  { day: 'thu', start: '09:00', end: '17:00' },
  { day: 'fri', start: '09:00', end: '17:00' },
]);

function workingHoursFor(circle, webid) {
  const member = (circle?.members ?? []).find((m) => m?.webid === webid);
  if (Array.isArray(member?.workingHours?.windows) && member.workingHours.windows.length > 0) {
    return member.workingHours.windows;
  }
  if (Array.isArray(circle?.workingHours?.windows) && circle.workingHours.windows.length > 0) {
    return circle.workingHours.windows;
  }
  return [...DEFAULT_WORKING_HOURS];
}

/**
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 */
export function buildPlannerSkills({ bundleResolver } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildPlannerSkills: bundleResolver(parts, ctx) required');
  }

  return [
    defineSkill('suggestSchedule', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      if (typeof from !== 'string' || !from) return { error: 'webid required' };
      const a = argsFromParts(parts);
      const lookaheadDays = Number.isFinite(a.lookaheadDays) && a.lookaheadDays > 0
        ? a.lookaheadDays
        : 7;
      const now = Date.now();
      const range = { start: now, end: now + lookaheadDays * 86_400_000 };

      const open = await circle.itemStore.listOpen({ assignee: from });
      const tasks = open
        .filter((t) => Number.isFinite(t.dueAt))
        .map((t) => ({
          taskId:          t.id,
          dueAt:           t.dueAt,
          estimateMinutes: t.estimateMinutes,
          requiredSkills:  t.requiredSkills,
          addedAt:         t.addedAt,
        }));

      let busyEvents = [];
      try {
        busyEvents = await readMyCalendar({ dataSource: circle.dataSource, range });
      } catch { /* no calendar available — busy stays empty */ }
      const busySpans = busyEvents.map((e) => ({ start: e.start, end: e.end }));

      const lc = circle.liveCircle ?? {};
      const workingHours = workingHoursFor(lc, from);

      const suggestions = suggestPure({
        tasks, busySpans, workingHours, now, lookaheadDays,
      });
      return { lookaheadDays, suggestions };
    }, {
      description: 'Suggest concrete slots for my open assignments. Self only.',
      visibility:  'authenticated',
    }),

    defineSkill('acceptSchedule', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      if (typeof from !== 'string' || !from) return { error: 'webid required' };
      const a = argsFromParts(parts);
      if (typeof a.taskId !== 'string' || !a.taskId) return { error: 'taskId required' };
      if (!Number.isFinite(a.slotStart))             return { error: 'slotStart (ms) required' };
      if (!Number.isFinite(a.slotEnd))               return { error: 'slotEnd (ms) required' };
      const task = await circle.itemStore.getById(a.taskId);
      if (!task)            return { error: 'task not found' };
      if (task.assignee !== from) return { error: 'only the assignee can accept a schedule' };
      const estimateMinutes = Math.round((a.slotEnd - a.slotStart) / 60_000);
      const patch = { scheduledAt: a.slotStart };
      if (!Number.isFinite(task.estimateMinutes) && estimateMinutes > 0) {
        patch.estimateMinutes = estimateMinutes;
      }
      const updated = await circle.itemStore.update(a.taskId, patch, { actor: from });
      return { ok: true, task: updated };
    }, {
      description: 'Accept a proposed slot for one of my tasks (self only).',
      visibility:  'authenticated',
    }),

    defineSkill('rejectSchedule', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      if (typeof from !== 'string' || !from) return { error: 'webid required' };
      const a = argsFromParts(parts);
      if (typeof a.taskId !== 'string' || !a.taskId) return { error: 'taskId required' };
      // No-op — UI affordance only.
      return { ok: true, taskId: a.taskId };
    }, {
      description: 'Dismiss a planner suggestion (self only). No state mutation.',
      visibility:  'authenticated',
    }),
  ];
}
