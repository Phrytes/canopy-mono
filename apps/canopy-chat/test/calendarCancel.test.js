/**
 * makeHandleCalendarCancel — the inbound (receive) side of the cross-peer cancel
 * fan-out. On a peer's calendar-cancel envelope, cancel the matching local event.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeHandleCalendarCancel } from '../src/core/handlers/calendarCancel.js';

describe('makeHandleCalendarCancel', () => {
  it('cancels the named event locally + emits a notification', async () => {
    const callSkill = vi.fn(async () => ({ ok: true }));
    const publishEvent = vi.fn();
    const handle = makeHandleCalendarCancel({ callSkill, publishEvent });
    await handle('peerAddr', { eventId: 'e-1', title: 'Lunch' });
    expect(callSkill).toHaveBeenCalledWith('calendar', 'cancelEvent', { id: 'e-1', actor: 'peerAddr' });
    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(publishEvent.mock.calls[0][0]).toMatchObject({ app: 'calendar', type: 'notification' });
  });

  it('ignores an envelope with no eventId', async () => {
    const callSkill = vi.fn(async () => ({ ok: true }));
    const handle = makeHandleCalendarCancel({ callSkill, logger: { warn: vi.fn() } });
    await handle('peerAddr', {});
    expect(callSkill).not.toHaveBeenCalled();
  });

  it('swallows a local cancel failure (no notification)', async () => {
    const callSkill = vi.fn(async () => { throw new Error('no such event'); });
    const publishEvent = vi.fn();
    const handle = makeHandleCalendarCancel({ callSkill, publishEvent, logger: { error: vi.fn() } });
    await handle('peerAddr', { eventId: 'e-1' });
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('requires a callSkill', () => {
    expect(() => makeHandleCalendarCancel({})).toThrow(/callSkill required/);
  });
});
