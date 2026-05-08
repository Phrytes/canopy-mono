/**
 * Calendar write-side — Tasks V2.1.
 *
 * Builds an `.ics` string for a member of a crew that calendar
 * applications (Google Calendar, Apple Calendar, Proton, …) can
 * subscribe to. One VEVENT per task that has either:
 *   - `dueAt`         → all-day or timed event at the deadline
 *   - `scheduledAt`   → timed event when the planner accepted a slot
 *                       (V2.4 hooks this in; V2.1 emits dueAt-only)
 *
 * Wire convention:
 *   - `UID = task.id` so calendar clients update existing events
 *     when the .ics is re-imported.
 *   - `SUMMARY = task.text` (truncated to 80 chars for the title).
 *   - `DESCRIPTION = task.notes ?? ''` — notes if present.
 *   - `DTSTART = dueAt` (UTC).
 *   - `DTEND   = dueAt + 30min` (placeholder duration; `estimateMinutes`
 *     widens it when present).
 *   - `STATUS:COMPLETED` for completed tasks (clients grey them out).
 *   - `LAST-MODIFIED = max(updatedAt, completedAt, addedAt)`.
 *
 * Removed-task cancellations are emitted via a parallel call to
 * `buildCancellationIcs(removedIds)` so calendar clients drop the UIDs.
 *
 * Pure function: no I/O. Composed by `wireCalendarEmission.js`, which
 * owns the debouncing + write-through to the local-store cache.
 */

import ICAL from 'ical.js';

const DEFAULT_DURATION_MIN = 30;

/**
 * @param {object} args
 * @param {string} args.crewId
 * @param {string} args.crewName
 * @param {string} args.member            — webid of the calendar's owner
 * @param {Array<object>} args.tasks      — all open + closed tasks (we
 *   filter inside this function so the caller doesn't have to know the
 *   "what counts as a calendar event" rule)
 * @param {number} [args.now=Date.now()]
 * @returns {string}                       iCal-formatted string
 */
export function buildIcsFor({ crewId, crewName, member, tasks, now = Date.now() }) {
  if (typeof crewId !== 'string' || !crewId) {
    throw new TypeError('buildIcsFor: crewId required');
  }
  if (!Array.isArray(tasks)) {
    throw new TypeError('buildIcsFor: tasks[] required');
  }

  const cal = new ICAL.Component(['vcalendar', [], []]);
  cal.updatePropertyWithValue('prodid', `-//Tasks V2//${crewId}//EN`);
  cal.updatePropertyWithValue('version', '2.0');
  cal.updatePropertyWithValue('method', 'PUBLISH');
  cal.updatePropertyWithValue('x-wr-calname', `Tasks: ${crewName ?? crewId}`);

  for (const t of tasks) {
    if (!_isCalendarRelevant(t, member)) continue;
    cal.addSubcomponent(_buildVevent(t, now));
  }

  return cal.toString();
}

/**
 * Build a `METHOD:CANCEL` calendar containing only `UID`s — calendar
 * clients drop those events.
 *
 * @param {Array<{id: string}>} removed
 * @param {object} [args]
 * @param {string} [args.crewId='unknown']
 * @returns {string}
 */
export function buildCancellationIcs(removed, { crewId = 'unknown' } = {}) {
  if (!Array.isArray(removed) || removed.length === 0) return '';
  const cal = new ICAL.Component(['vcalendar', [], []]);
  cal.updatePropertyWithValue('prodid', `-//Tasks V2//${crewId}//EN`);
  cal.updatePropertyWithValue('version', '2.0');
  cal.updatePropertyWithValue('method', 'CANCEL');
  for (const r of removed) {
    if (typeof r?.id !== 'string') continue;
    const ev = new ICAL.Component('vevent');
    ev.updatePropertyWithValue('uid',     r.id);
    ev.updatePropertyWithValue('status',  'CANCELLED');
    ev.updatePropertyWithValue('summary', '(removed)');
    ev.updatePropertyWithValue('dtstart', ICAL.Time.fromJSDate(new Date(0), true));
    cal.addSubcomponent(ev);
  }
  return cal.toString();
}

/**
 * Compare two task lists and return the UIDs that disappeared. Used
 * by the wire helper to emit cancellations.
 */
export function diffRemoved(prev, next) {
  if (!Array.isArray(prev) || prev.length === 0) return [];
  const nextIds = new Set((next ?? []).map((t) => t?.id));
  return prev.filter((t) => t?.id && !nextIds.has(t.id)).map((t) => ({ id: t.id }));
}

// ── Internals ────────────────────────────────────────────────────────────────

function _isCalendarRelevant(t, member) {
  if (!t || typeof t !== 'object') return false;
  if (t.type === 'subtask-request') return false;
  if (typeof t.dueAt !== 'number' && typeof t.scheduledAt !== 'number') return false;
  // Only emit for tasks the member is involved with: assigned, mastered,
  // OR awaiting their approval. Other tasks would create noise in their
  // calendar.
  if (typeof member !== 'string' || !member) return true;     // unfiltered
  const masterOf  = (t.master ?? t.addedBy) === member;
  const assignedTo = t.assignee === member;
  const approverOf = t.approval === 'creator' && (t.master ?? t.addedBy) === member;
  return masterOf || assignedTo || approverOf;
}

function _buildVevent(t, now) {
  const ev = new ICAL.Component('vevent');
  ev.updatePropertyWithValue('uid', t.id);

  const title = String(t.text ?? '(no title)').slice(0, 80);
  ev.updatePropertyWithValue('summary', title);
  if (t.notes) ev.updatePropertyWithValue('description', String(t.notes));

  const startMs = t.scheduledAt ?? t.dueAt;
  const endMs   = startMs + ((t.estimateMinutes ?? DEFAULT_DURATION_MIN) * 60 * 1000);
  ev.updatePropertyWithValue('dtstart', ICAL.Time.fromJSDate(new Date(startMs), true));
  ev.updatePropertyWithValue('dtend',   ICAL.Time.fromJSDate(new Date(endMs),   true));

  const lastMod = Math.max(t.updatedAt ?? 0, t.completedAt ?? 0, t.addedAt ?? 0, 0) || now;
  ev.updatePropertyWithValue('last-modified', ICAL.Time.fromJSDate(new Date(lastMod), true));
  ev.updatePropertyWithValue('dtstamp',       ICAL.Time.fromJSDate(new Date(now), true));

  if (t.completedAt) ev.updatePropertyWithValue('status', 'COMPLETED');
  else               ev.updatePropertyWithValue('status', 'CONFIRMED');

  return ev;
}
