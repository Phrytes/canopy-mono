/**
 * Bundle H Phase 2 (#269) — calendar-invite handler coverage.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeHandleCalendarInvite } from '../../src/core/handlers/calendarInvite.js';

function deps(overrides = {}) {
  return {
    callSkill:     vi.fn(async () => ({ ok: true })),
    addMainBubble: vi.fn(),
    publishEvent:  vi.fn(),
    logger:        { info: () => {}, warn: () => {}, error: () => {} },
    ...overrides,
  };
}

describe('makeHandleCalendarInvite', () => {
  it('throws when required deps are missing', () => {
    expect(() => makeHandleCalendarInvite({})).toThrow(/callSkill required/);
    expect(() => makeHandleCalendarInvite({ callSkill: vi.fn() })).toThrow(/addMainBubble required/);
  });

  it('drops envelopes missing required event fields', async () => {
    const d = deps();
    const handle = makeHandleCalendarInvite(d);
    await handle('peer-A', null);
    await handle('peer-A', { event: { id: 'e1' } });
    await handle('peer-A', { event: { id: 'e1', title: 'X' } });
    expect(d.callSkill).not.toHaveBeenCalled();
    expect(d.addMainBubble).not.toHaveBeenCalled();
  });

  it('persists + renders time-card embed + publishes notification on a valid invite', async () => {
    const d = deps();
    const handle = makeHandleCalendarInvite(d);
    await handle('peer-A', {
      event: { id: 'e1', title: 'Dinner', startsAt: '2026-06-01T19:00:00Z' },
    });
    expect(d.callSkill).toHaveBeenCalledWith('calendar', 'addEvent', expect.objectContaining({
      id: 'e1', title: 'Dinner', when: '2026-06-01T19:00:00Z',
      _organiserAddr: 'peer-A',
    }));
    expect(d.addMainBubble).toHaveBeenCalledTimes(1);
    const bubble = d.addMainBubble.mock.calls[0][0];
    expect(bubble.kind).toBe('embed-card');
    expect(bubble.embed.kind).toBe('time-card');
    expect(bubble.embed.snapshot.title).toBe('Dinner');
    expect(d.publishEvent).toHaveBeenCalledWith(expect.objectContaining({
      app: 'calendar', type: 'notification',
    }));
  });

  it('skips rendering when callSkill throws', async () => {
    const error = vi.fn();
    const d = deps({
      callSkill: vi.fn(async () => { throw new Error('addEvent failed'); }),
      logger: { error, info: () => {}, warn: () => {} },
    });
    const handle = makeHandleCalendarInvite(d);
    await handle('peer-A', {
      event: { id: 'e1', title: 'X', startsAt: '2026-06-01T19:00:00Z' },
    });
    expect(d.addMainBubble).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });
});
