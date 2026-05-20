/**
 * Characterization corpus — availability.html (week grid).
 *
 * The page renders a per-member weekly availability grid (open / tight /
 * unavailable). Backed by the buildAvailabilitySkills set
 * (setAvailabilityEnabled, setAvailabilityOptIn, setMyAvailability,
 * getMyAvailability, getCrewAvailability). Zero existing test coverage
 * for the page itself.
 *
 * Captures:
 *   - Page-serves test: 200 + non-empty HTML + `<html` substring.
 *   - Structural snapshot via `normaliseSnapshot` + `toMatchSnapshot`.
 *   - `getMyAvailability` returns without error on a fresh crew (the
 *     feature is disabled by default → enabled:false shape).
 *
 * Discipline: minimal assertions, no domain-state introspection. We
 * don't toggle setAvailabilityEnabled in this corpus pass — the
 * feature-flag lifecycle is its own characterization target.
 *
 * TODO (corpus-next): exercise setAvailabilityEnabled → opt-in →
 * setMyAvailability → getCrewAvailability and lock the grid-shape
 * output once owner confirms which fields are gold-standard.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  ANNE,
  buildCharacterizationFixture,
  normaliseSnapshot,
} from './setup.js';

let fixture;

beforeAll(async () => {
  fixture = await buildCharacterizationFixture({ actor: ANNE });
});

afterAll(async () => {
  await fixture?.teardown();
});

describe('characterization: availability.html', () => {
  it('serves the page (200 + non-empty HTML)', async () => {
    const html = await fixture.fetchPage('availability.html');
    expect(html.length).toBeGreaterThan(100);
    expect(html).toContain('<html');
  });

  it('initial HTML snapshot (feature-disabled default)', async () => {
    const html = await fixture.fetchPage('availability.html');
    const snap = normaliseSnapshot(html);
    expect(snap, 'availability.html structural baseline').toMatchSnapshot();
  });

  it('getMyAvailability returns the feature-disabled shape on a fresh crew', async () => {
    const r = await fixture.callSkill('getMyAvailability');
    expect(r).toBeTruthy();
    expect(r.error).toBeUndefined();
    // availabilityHints is OFF by default on a fresh crew →
    // skill returns {enabled:false, week:null, grid:{}}.
    expect(r.enabled).toBe(false);
  });
});
