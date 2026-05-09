/**
 * nativeCalendar — sync Tasks task list into a per-app calendar via
 * `expo-calendar`.
 *
 * Phase 41.12 (2026-05-09).
 *
 * Owns:
 *   - diffEvents({prev, next}) — pure-fn that returns
 *     `{create[], update[], remove[]}` of taskIds. The caller maps
 *     each to the matching expo-calendar API call.
 *   - applyDiff({CalendarModule, calendarId, diff, prev, storage}) —
 *     applies the diff via Calendar.{create,update,delete}EventAsync,
 *     persists `taskId → eventId` map in AsyncStorage.
 *   - getOrCreateTasksCalendar({CalendarModule, name}) — finds the
 *     Tasks-owned writable calendar (per Tasks's per-app calendar
 *     discipline) or creates one.
 *
 * The actual permission request lives in `PermissionRationale` →
 * Calendar.requestCalendarPermissionsAsync; SettingsScreen wires it.
 */

const STORAGE_KEY = 'tasks:nativeCalendar:eventIdMap';

/**
 * Pure-fn diff. `prev` and `next` are arrays of `{taskId, dueAt?,
 * scheduledAt?, ...}`. Tasks without a date drop out.
 *
 * Returns:
 *   - create: [{taskId, ev}]   — new event payload to create
 *   - update: [{taskId, eventId, ev}]
 *   - remove: [{taskId, eventId}]
 *
 * The caller hands `eventIdByTask` (the persisted map) so update
 * decisions know which existing eventId to point at.
 *
 * @param {Array<object>} prev   tasks that were previously emitted
 * @param {Array<object>} next   current tasks to emit
 * @param {Object<string, string>} eventIdByTask
 * @returns {{ create: Array, update: Array, remove: Array }}
 */
export function diffEvents({ prev = [], next = [], eventIdByTask = {} } = {}) {
  const prevMap = new Map();
  for (const t of prev) {
    if (t?.taskId) prevMap.set(t.taskId, t);
  }
  const nextMap = new Map();
  for (const t of next) {
    if (!t?.taskId) continue;
    if (!_eventStart(t)) continue; // skip dateless tasks
    nextMap.set(t.taskId, t);
  }

  const create = [];
  const update = [];
  const remove = [];

  for (const [taskId, t] of nextMap) {
    const ev = _toEvent(t);
    if (eventIdByTask[taskId]) {
      // Update existing — only when the relevant fields changed.
      const before = prevMap.get(taskId);
      if (!before || _changed(before, t)) {
        update.push({ taskId, eventId: eventIdByTask[taskId], ev });
      }
    } else {
      create.push({ taskId, ev });
    }
  }
  for (const [taskId] of prevMap) {
    if (!nextMap.has(taskId) && eventIdByTask[taskId]) {
      remove.push({ taskId, eventId: eventIdByTask[taskId] });
    }
  }
  return { create, update, remove };
}

/**
 * Apply a diff: create/update/delete events + persist the new map.
 *
 * @param {object} args
 * @param {object} args.CalendarModule    expo-calendar — inject for tests
 * @param {string} args.calendarId        target calendar
 * @param {{create: Array, update: Array, remove: Array}} args.diff
 * @param {Object<string, string>} args.eventIdByTask
 * @param {object} args.storage           AsyncStorage-shaped {get,set,remove}
 * @returns {Promise<Object<string, string>>}   updated eventIdByTask map
 */
export async function applyDiff({
  CalendarModule, calendarId, diff, eventIdByTask = {}, storage,
} = {}) {
  if (!CalendarModule) throw new Error('applyDiff: CalendarModule required');
  if (!calendarId)     throw new Error('applyDiff: calendarId required');

  const next = { ...eventIdByTask };

  for (const { taskId, ev } of diff.create ?? []) {
    try {
      const id = await CalendarModule.createEventAsync(calendarId, ev);
      next[taskId] = String(id);
    } catch { /* swallow per-event */ }
  }
  for (const { taskId, eventId, ev } of diff.update ?? []) {
    try {
      await CalendarModule.updateEventAsync(eventId, ev);
    } catch { /* swallow */ }
  }
  for (const { taskId, eventId } of diff.remove ?? []) {
    try {
      await CalendarModule.deleteEventAsync(eventId);
    } catch { /* swallow */ }
    delete next[taskId];
  }

  if (storage?.setItem) {
    try { await storage.setItem(STORAGE_KEY, JSON.stringify(next)); }
    catch { /* swallow — next pass will recompute */ }
  }
  return next;
}

/**
 * Read the persisted map from AsyncStorage.
 */
export async function loadEventIdMap({ storage } = {}) {
  if (!storage?.getItem) return {};
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Find the Tasks-owned writable calendar; create one if absent.
 *
 * @param {object} args
 * @param {object} args.CalendarModule
 * @param {string} [args.name='Tasks']
 * @returns {Promise<string>}   calendarId
 */
export async function getOrCreateTasksCalendar({ CalendarModule, name = 'Tasks' } = {}) {
  if (!CalendarModule) throw new Error('getOrCreateTasksCalendar: CalendarModule required');
  const cals = await CalendarModule.getCalendarsAsync(CalendarModule.EntityTypes?.EVENT ?? 'event');
  const existing = (cals ?? []).find(
    (c) => c?.title === name && c?.allowsModifications,
  );
  if (existing) return existing.id;

  const sources = await CalendarModule.getSourcesAsync?.() ?? [];
  const localSource = sources.find((s) => s.type === 'local')
                   ?? sources.find((s) => s.isLocalAccount)
                   ?? sources[0];

  const id = await CalendarModule.createCalendarAsync({
    title:        name,
    color:        '#0d9488',
    entityType:   CalendarModule.EntityTypes?.EVENT ?? 'event',
    sourceId:     localSource?.id,
    source:       localSource,
    name,
    ownerAccount: localSource?.name ?? name,
    accessLevel:  CalendarModule.CalendarAccessLevel?.OWNER ?? 'owner',
  });
  return String(id);
}

// ── Internals ──────────────────────────────────────────────────────

function _eventStart(t) {
  return Number.isFinite(t?.scheduledAt) ? t.scheduledAt
       : Number.isFinite(t?.dueAt)        ? t.dueAt
       : null;
}

function _toEvent(t) {
  const start = _eventStart(t);
  const end   = start + (Number.isFinite(t?.estimateMinutes)
    ? t.estimateMinutes * 60 * 1000
    : 30 * 60 * 1000);
  return {
    title:     t.title ?? t.text ?? '(task)',
    notes:     t.notes ?? undefined,
    startDate: new Date(start),
    endDate:   new Date(end),
    timeZone:  t.timeZone ?? undefined,
    alarms:    Array.isArray(t.alarms) ? t.alarms : undefined,
  };
}

function _changed(a, b) {
  return _eventStart(a) !== _eventStart(b)
      || (a?.text ?? a?.title) !== (b?.text ?? b?.title)
      || (a?.estimateMinutes ?? null) !== (b?.estimateMinutes ?? null);
}

export const _internal = { _eventStart, _toEvent, _changed, STORAGE_KEY };
