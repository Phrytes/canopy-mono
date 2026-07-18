/**
 * calendar-rsvp handler coverage.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeHandleCalendarRsvp } from '../../src/core/handlers/calendarRsvp.js';

function deps(overrides = {}) {
  return {
    callSkill:    vi.fn(async () => ({ ok: true })),
    publishEvent: vi.fn(),
    logger:       { info: () => {}, warn: () => {}, error: () => {} },
    ...overrides,
  };
}

describe('makeHandleCalendarRsvp', () => {
  it('throws when callSkill is missing', () => {
    expect(() => makeHandleCalendarRsvp({})).toThrow(/callSkill required/);
  });

  it.each(['accepted', 'declined', 'tentative'])(
    'routes %s to the matching rsvp* skill',
    async (response) => {
      const d = deps();
      const handle = makeHandleCalendarRsvp(d);
      await handle('peer-A', { eventId: 'e1', response });
      const expectedSkill =
        response === 'accepted'  ? 'rsvpAccept' :
        response === 'declined'  ? 'rsvpDecline' : 'rsvpTentative';
      expect(d.callSkill).toHaveBeenCalledWith('calendar', expectedSkill, {
        id: 'e1', actor: 'peer-A',
      });
      expect(d.publishEvent).toHaveBeenCalled();
    },
  );

  it('drops invalid response values', async () => {
    const warn = vi.fn();
    const d = deps({ logger: { warn, info: () => {}, error: () => {} } });
    const handle = makeHandleCalendarRsvp(d);
    await handle('peer-A', { eventId: 'e1', response: 'maybe' });
    expect(d.callSkill).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('drops envelopes missing eventId', async () => {
    const d = deps();
    const handle = makeHandleCalendarRsvp(d);
    await handle('peer-A', { response: 'accepted' });
    expect(d.callSkill).not.toHaveBeenCalled();
  });
});
