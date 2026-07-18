/**
 * availability hints (data class + skills).
 */

import { describe, it, expect } from 'vitest';

import { AvailabilityHints, isoWeekOf, halfDayOf } from '../src/availability/AvailabilityHints.js';
import { buildBundle } from '../src/storage/buildBundle.js';
import { createCircleAgent } from '../src/Circle.js';

const ANNE  = 'https://id.example/anne';
const FRITS = 'https://id.example/frits';
const KID   = 'https://id.example/kid';

// Skill-path tests must use the CURRENT ISO week: setMyAvailability /
// getMyAvailability call `pruneStale()` (drops hints older than 4 ISO weeks), so
// a hardcoded past week (the old '2026-W19') is pruned on write and reads back
// empty. Pure AvailabilityHints tests below don't prune, so they keep fixed weeks.
const THIS_WEEK = isoWeekOf(new Date());

const CIRCLE = {
  circleId:  'oss-tools',
  name:    'OSS Tools NL',
  kind:    'project',
  members: [
    { webid: ANNE,  displayName: 'Anne',  role: 'admin' },
    { webid: FRITS, displayName: 'the author', role: 'coordinator' },
    { webid: KID,   displayName: 'Kid',   role: 'member' },
  ],
  availabilityHints: { enabled: true, optedIn: [] },
};

function call(circle, name, data, from) {
  return circle.agent.skills.get(name).handler({
    parts: [{ type: 'DataPart', data: data ?? {} }],
    from,
    agent: circle.agent,
    envelope: null,
  });
}

async function setup(overrides = {}) {
  const bundle = buildBundle();
  const circle = await createCircleAgent({
    circleConfig:           { ...CIRCLE, ...overrides },
    localStoreBundle:     bundle,
    wireOnboardingSkills: false,
  });
  return { bundle, circle };
}

describe('V2.3 — AvailabilityHints (pure)', () => {
  it('round-trips through serialize/deserialize', () => {
    const h = new AvailabilityHints();
    h.set({ week: '2026-W19', day: 'mon', half: 'am', state: 'open' });
    h.set({ week: '2026-W19', day: 'tue', half: 'pm', state: 'tight' });
    const snap = h.serialize();
    const r = AvailabilityHints.deserialize(snap);
    expect(r.get({ week: '2026-W19', day: 'mon', half: 'am' })).toBe('open');
    expect(r.get({ week: '2026-W19', day: 'tue', half: 'pm' })).toBe('tight');
    expect(r.get({ week: '2026-W19', day: 'fri', half: 'pm' })).toBe('unknown');
  });

  it('rotates through the four states', () => {
    const h = new AvailabilityHints();
    for (const s of ['open', 'tight', 'unavailable']) {
      h.set({ week: '2026-W19', day: 'mon', half: 'am', state: s });
      expect(h.get({ week: '2026-W19', day: 'mon', half: 'am' })).toBe(s);
    }
    h.set({ week: '2026-W19', day: 'mon', half: 'am', state: 'unknown' });
    expect(h.get({ week: '2026-W19', day: 'mon', half: 'am' })).toBe('unknown');
  });

  it('rejects malformed inputs', () => {
    const h = new AvailabilityHints();
    expect(() => h.set({ week: 'bad', day: 'mon', half: 'am', state: 'open' })).toThrow(/week/);
    expect(() => h.set({ week: '2026-W19', day: 'XYZ', half: 'am', state: 'open' })).toThrow(/day/);
    expect(() => h.set({ week: '2026-W19', day: 'mon', half: 'eve', state: 'open' })).toThrow(/half/);
    expect(() => h.set({ week: '2026-W19', day: 'mon', half: 'am', state: 'busy' })).toThrow(/state/);
  });

  it('isoWeekOf produces the input shape', () => {
    expect(isoWeekOf(new Date('2026-05-08'))).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('halfDayOf returns the current cell', () => {
    const r = halfDayOf(new Date('2026-05-08T15:30:00'));
    expect(r).toMatchObject({ half: 'pm' });
    expect(r.day).toMatch(/mon|tue|wed|thu|fri|sat|sun/);
    expect(r.week).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('pruneStale drops weeks older than 4 weeks', () => {
    const h = new AvailabilityHints();
    h.set({ week: '2020-W01', day: 'mon', half: 'am', state: 'open' });
    h.set({ week: isoWeekOf(new Date()), day: 'mon', half: 'am', state: 'open' });
    h.pruneStale();
    expect(h.get({ week: '2020-W01', day: 'mon', half: 'am' })).toBe('unknown');
    expect(h.get({ week: isoWeekOf(new Date()), day: 'mon', half: 'am' })).toBe('open');
  });
});

describe('V2.3 — availability skills', () => {
  it('member must opt in before setting availability', async () => {
    const { circle } = await setup();
    const r = await call(circle, 'setMyAvailability',
      { week: '2026-W19', day: 'mon', half: 'am', state: 'open' }, KID);
    expect(r.error).toMatch(/not opted in/);
    await circle.close();
  });

  it('opt in → set → read own grid', async () => {
    const { circle } = await setup();
    expect((await call(circle, 'setAvailabilityOptIn', { optedIn: true }, KID)).ok).toBe(true);
    const r = await call(circle, 'setMyAvailability',
      { week: THIS_WEEK, day: 'mon', half: 'am', state: 'open' }, KID);
    expect(r.ok).toBe(true);
    const own = await call(circle, 'getMyAvailability', { week: THIS_WEEK }, KID);
    expect(own.grid).toEqual({ 'mon-am': 'open' });
    await circle.close();
  });

  it('coordinator sees full circle grid; member sees only own', async () => {
    const { circle } = await setup();
    await call(circle, 'setAvailabilityOptIn', { optedIn: true }, KID);
    await call(circle, 'setMyAvailability',
      { week: THIS_WEEK, day: 'tue', half: 'pm', state: 'tight' }, KID);
    const coordView = await call(circle, 'getCircleAvailability', { week: THIS_WEEK }, FRITS);
    expect(coordView.members).toHaveLength(3);
    const kidEntry = coordView.members.find((m) => m.webid === KID);
    expect(kidEntry.grid).toEqual({ 'tue-pm': 'tight' });
    // Member is denied.
    const denied = await call(circle, 'getCircleAvailability', { week: '2026-W19' }, KID);
    expect(denied.error).toMatch(/admin or coordinator/);
    await circle.close();
  });

  it('opted-out member shows empty grid to coordinator (no opt-in disclosure)', async () => {
    const { circle } = await setup();
    // Only Kid opts in.
    await call(circle, 'setAvailabilityOptIn', { optedIn: true }, KID);
    const view = await call(circle, 'getCircleAvailability', { week: '2026-W19' }, ANNE);
    const annieEntry = view.members.find((m) => m.webid === ANNE);
    expect(annieEntry.grid).toEqual({});      // indistinguishable from opted-in-but-empty
    await circle.close();
  });

  it('disabling circle-wide rejects all set/opt-in calls', async () => {
    const { circle } = await setup();
    await call(circle, 'setAvailabilityEnabled', { enabled: false }, ANNE);
    expect((await call(circle, 'setAvailabilityOptIn', { optedIn: true }, KID)).error).toMatch(/disabled/);
    expect((await call(circle, 'setMyAvailability',
      { week: '2026-W19', day: 'mon', half: 'am', state: 'open' }, KID)).error).toMatch(/disabled/);
    await circle.close();
  });

  it('non-admin denied on setAvailabilityEnabled', async () => {
    const { circle } = await setup();
    expect((await call(circle, 'setAvailabilityEnabled', { enabled: false }, FRITS)).error).toMatch(/admin/);
    await circle.close();
  });

  it('opting out clears persisted hints', async () => {
    const { circle, bundle } = await setup();
    await call(circle, 'setAvailabilityOptIn', { optedIn: true }, KID);
    await call(circle, 'setMyAvailability',
      { week: '2026-W19', day: 'mon', half: 'am', state: 'open' }, KID);
    const path = `mem://tasks/circles/oss-tools/availability/${encodeURIComponent(KID)}.json`;
    expect(await bundle.cache.read(path)).toBeTruthy();
    await call(circle, 'setAvailabilityOptIn', { optedIn: false }, KID);
    expect(await bundle.cache.read(path)).toBeNull();
    await circle.close();
  });
});
