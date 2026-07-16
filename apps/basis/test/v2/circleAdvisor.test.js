import { describe, it, expect } from 'vitest';
import {
  COMPLAINT_TYPES, ADVISOR_DEFAULTS, makeTooBusyEvent, computeAdvice,
} from '../../src/v2/circleAdvisor.js';

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const ago = (d) => NOW - d * DAY;

// helper to build a too-busy complaint event in a circle at `d` days ago
const complaint = (id, d, circleId = 'c1', type = 'too-busy') =>
  ({ id, ts: ago(d), app: 'basis', type, payload: { circleId } });

describe('makeTooBusyEvent', () => {
  it('mints a too-busy event tagged with the circle', () => {
    const e = makeTooBusyEvent({ circleId: 'c1', actor: 'me', now: NOW });
    expect(e.type).toBe('too-busy');
    expect(e.payload.circleId).toBe('c1');
    expect(e.ts).toBe(NOW);
    expect(COMPLAINT_TYPES).toContain('too-busy');
  });
});

describe('computeAdvice', () => {
  it('advises when ≥3 complaints in 14d AND activity is growing', () => {
    // 3 complaints in the recent 7d, none before → growing.
    const events = [complaint('a', 1), complaint('b', 2), complaint('c', 3)];
    const advice = computeAdvice({ events, circleId: 'c1', now: NOW, lastShownAt: null });
    expect(advice).not.toBeNull();
    expect(advice).toMatchObject({ kind: 'too-busy', circleId: 'c1', complaints: 3, growing: true });
  });

  it('does NOT advise with fewer than 3 complaints', () => {
    const events = [complaint('a', 1), complaint('b', 2)];
    expect(computeAdvice({ events, circleId: 'c1', now: NOW })).toBeNull();
  });

  it('does NOT advise when complaints are old / activity is not growing', () => {
    // 3 complaints, all in the PRIOR 7-14d window → recent(0) <= prior(3).
    const events = [complaint('a', 8), complaint('b', 9), complaint('c', 10)];
    expect(computeAdvice({ events, circleId: 'c1', now: NOW })).toBeNull();
  });

  it('honours the monthly cooldown (lastShownAt within 30d)', () => {
    const events = [complaint('a', 1), complaint('b', 2), complaint('c', 3)];
    expect(computeAdvice({ events, circleId: 'c1', now: NOW, lastShownAt: ago(10) })).toBeNull();
    // …but advises again once the cooldown has elapsed.
    expect(computeAdvice({ events, circleId: 'c1', now: NOW, lastShownAt: ago(31) })).not.toBeNull();
  });

  it('scopes complaints to the circle — other circles do not count', () => {
    const events = [
      complaint('a', 1, 'other'),
      complaint('b', 2, 'other'),
      complaint('c', 3, 'c1'),
    ];
    expect(computeAdvice({ events, circleId: 'c1', now: NOW })).toBeNull(); // only 1 in c1
  });

  it('counts disputes as complaints too', () => {
    const events = [
      complaint('a', 1, 'c1', 'dispute'),
      complaint('b', 2, 'c1', 'too-busy'),
      complaint('c', 3, 'c1', 'complaint'),
    ];
    expect(computeAdvice({ events, circleId: 'c1', now: NOW })).not.toBeNull();
  });

  it('exposes tunable defaults', () => {
    expect(ADVISOR_DEFAULTS.minComplaints).toBe(3);
    expect(ADVISOR_DEFAULTS.cooldownDays).toBe(30);
  });
});
