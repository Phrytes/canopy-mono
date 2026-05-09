/**
 * nativeCalendar — diff coverage.
 *
 * Phase 41.12 (2026-05-09).
 */

import { describe, it, expect, vi } from 'vitest';
import { diffEvents, applyDiff, _internal } from '../../src/lib/nativeCalendar.js';

const MS_2026_06_01_09 = Date.UTC(2026, 5, 1, 9, 0);
const MS_2026_06_02_09 = Date.UTC(2026, 5, 2, 9, 0);
const MS_2026_06_03_10 = Date.UTC(2026, 5, 3, 10, 0);

describe('diffEvents — create/update/remove split', () => {
  it('emits create for new tasks with a date', () => {
    const next = [{ taskId: 'A', text: 'Buy milk', dueAt: MS_2026_06_01_09 }];
    const r = diffEvents({ prev: [], next, eventIdByTask: {} });
    expect(r.create).toHaveLength(1);
    expect(r.create[0].taskId).toBe('A');
    expect(r.update).toHaveLength(0);
    expect(r.remove).toHaveLength(0);
  });

  it('skips dateless tasks', () => {
    const next = [{ taskId: 'A', text: 'No date' }];
    const r = diffEvents({ prev: [], next, eventIdByTask: {} });
    expect(r.create).toHaveLength(0);
  });

  it('emits update when fields change', () => {
    const prev = [{ taskId: 'A', text: 'Buy milk',  dueAt: MS_2026_06_01_09 }];
    const next = [{ taskId: 'A', text: 'Buy bread', dueAt: MS_2026_06_01_09 }];
    const r = diffEvents({ prev, next, eventIdByTask: { A: 'cal-evt-1' } });
    expect(r.update).toHaveLength(1);
    expect(r.update[0]).toMatchObject({ taskId: 'A', eventId: 'cal-evt-1' });
    expect(r.create).toHaveLength(0);
    expect(r.remove).toHaveLength(0);
  });

  it('skips update when fields are stable', () => {
    const prev = [{ taskId: 'A', text: 'Buy milk', dueAt: MS_2026_06_01_09 }];
    const next = [{ taskId: 'A', text: 'Buy milk', dueAt: MS_2026_06_01_09 }];
    const r = diffEvents({ prev, next, eventIdByTask: { A: 'cal-evt-1' } });
    expect(r.update).toHaveLength(0);
  });

  it('emits remove when a previously-emitted task drops off', () => {
    const prev = [{ taskId: 'A', dueAt: MS_2026_06_01_09 }];
    const r = diffEvents({ prev, next: [], eventIdByTask: { A: 'cal-evt-1' } });
    expect(r.remove).toHaveLength(1);
    expect(r.remove[0]).toEqual({ taskId: 'A', eventId: 'cal-evt-1' });
  });

  it('prefers scheduledAt over dueAt for the start time', () => {
    const ev = _internal._toEvent({
      taskId: 'A', text: 'X',
      dueAt: MS_2026_06_03_10, scheduledAt: MS_2026_06_01_09,
    });
    expect(ev.startDate.getTime()).toBe(MS_2026_06_01_09);
  });
});

describe('applyDiff — calendar API + storage map', () => {
  it('creates events + persists eventIds', async () => {
    const stored = new Map();
    const storage = {
      getItem:    async (k) => stored.get(k) ?? null,
      setItem:    async (k, v) => { stored.set(k, v); },
      removeItem: async (k) => { stored.delete(k); },
    };
    const Calendar = {
      createEventAsync: vi.fn(async (calId, ev) => `evt-${ev.title}`),
      updateEventAsync: vi.fn(async () => true),
      deleteEventAsync: vi.fn(async () => true),
    };
    const diff = {
      create: [{ taskId: 'A', ev: { title: 'A1' } }],
      update: [],
      remove: [],
    };
    const next = await applyDiff({
      CalendarModule: Calendar, calendarId: 'cal-1', diff, eventIdByTask: {}, storage,
    });
    expect(Calendar.createEventAsync).toHaveBeenCalledOnce();
    expect(next.A).toBe('evt-A1');
    const persisted = JSON.parse(stored.get(_internal.STORAGE_KEY));
    expect(persisted.A).toBe('evt-A1');
  });

  it('drops eventIds from the map when removing', async () => {
    const stored = new Map();
    const storage = {
      getItem:    async (k) => stored.get(k) ?? null,
      setItem:    async (k, v) => { stored.set(k, v); },
      removeItem: async (k) => { stored.delete(k); },
    };
    const Calendar = {
      createEventAsync: vi.fn(),
      updateEventAsync: vi.fn(),
      deleteEventAsync: vi.fn(async () => true),
    };
    const diff = { create: [], update: [], remove: [{ taskId: 'A', eventId: 'evt-1' }] };
    const next = await applyDiff({
      CalendarModule: Calendar, calendarId: 'cal-1', diff,
      eventIdByTask: { A: 'evt-1' }, storage,
    });
    expect(next).not.toHaveProperty('A');
    expect(Calendar.deleteEventAsync).toHaveBeenCalledWith('evt-1');
  });
});
