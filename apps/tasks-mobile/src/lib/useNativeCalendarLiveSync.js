/**
 * useNativeCalendarLiveSync — Phase 41.18.5 (2026-05-10).
 *
 * Auto-applies `nativeCalendar.diffEvents` + `applyDiff` whenever
 * the active circle's task list changes — closing the gap noted in
 * Phase 41.12 where the Settings screen had a manual "Sync now"
 * button but no listener that fired on agent events.
 *
 * Wires:
 *   1. `useSkillResult('listMine')` to source the assigned + master
 *      tasks the user wants on their phone calendar (mirrors the
 *      desktop's V2.1 ICS feed).
 *   2. `useAgentEvent('taskListChanged')` to refresh the list when
 *      a peer claims / submits / completes / revokes.
 *   3. Persisted `eventIdByTask` map via AsyncStorage (the lib
 *      already owns the key).
 *
 * The hook is opt-in: call sites pass `enabled: true` only when
 * `calendarSyncMethod` is `'native'` or `'both'`.
 *
 * @param {object} args
 * @param {boolean} args.enabled
 * @param {object}  [args.CalendarModule]   — expo-calendar (injected for tests)
 * @param {object}  [args.storage]          — AsyncStorage (injected for tests)
 * @param {string}  [args.calendarName]     — defaults to 'Tasks'
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  diffEvents, applyDiff, loadEventIdMap, getOrCreateTasksCalendar,
} from './nativeCalendar.js';
import { useSkillResult, useAgentEvent } from './useSkill.js';

export function useNativeCalendarLiveSync({
  enabled,
  CalendarModule,
  storage,
  calendarName = 'Tasks',
} = {}) {
  const list = useSkillResult('listMine', {}, [enabled]);
  const arrived = useAgentEvent('taskListChanged');

  const calendarIdRef = useRef(null);
  const eventIdMapRef = useRef({});
  const prevTasksRef  = useRef([]);
  const [lastSyncMs,  setLastSyncMs]  = useState(null);
  const [error,       setError]       = useState(null);

  // Refresh the list when the agent emits a change event.
  useEffect(() => {
    if (!enabled) return;
    if (arrived != null) {
      list.refresh().catch(() => {});
    }
  }, [enabled, arrived, list]);

  // One-time bootstrap — find/create the Tasks calendar + load the
  // persisted eventIdMap.
  useEffect(() => {
    if (!enabled || !CalendarModule) return;
    let cancelled = false;
    (async () => {
      try {
        const id = await getOrCreateTasksCalendar({ CalendarModule, name: calendarName });
        if (cancelled) return;
        calendarIdRef.current = id;
        const map = await loadEventIdMap({ storage });
        if (cancelled) return;
        eventIdMapRef.current = map;
      } catch (err) {
        setError(err?.message ?? String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, CalendarModule, storage, calendarName]);

  // Live-diff whenever the task list changes.
  useEffect(() => {
    if (!enabled) return;
    if (!CalendarModule || !calendarIdRef.current) return;
    const items = Array.isArray(list?.data?.items) ? list.data.items : [];
    let cancelled = false;
    (async () => {
      try {
        const diff = diffEvents({
          prev: prevTasksRef.current,
          next: items,
          eventIdByTask: eventIdMapRef.current,
        });
        const empty = (diff.create.length + diff.update.length + diff.remove.length) === 0;
        if (empty) return;
        const nextMap = await applyDiff({
          CalendarModule,
          calendarId:    calendarIdRef.current,
          diff,
          eventIdByTask: eventIdMapRef.current,
          storage,
        });
        if (cancelled) return;
        eventIdMapRef.current = nextMap;
        prevTasksRef.current = items;
        setLastSyncMs(Date.now());
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err?.message ?? String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, CalendarModule, storage, list?.data]);

  // Manual trigger (Settings → "Sync now" still uses this; the live
  // path renders it mostly redundant but keeps a debug affordance).
  const triggerSync = useCallback(async () => {
    if (!enabled || !CalendarModule || !calendarIdRef.current) return;
    await list.refresh().catch(() => {});
  }, [enabled, CalendarModule, list]);

  return { lastSyncMs, error, triggerSync };
}
