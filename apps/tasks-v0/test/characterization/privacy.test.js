/**
 * Characterization corpus — privacy.html (closed-beta privacy notice).
 *
 * A small, mostly-static settings page. The corpus today checks the
 * page serves and snapshots the structural HTML; one skill assertion
 * probes `getPrivacyNotice` (the only privacy-adjacent skill in the
 * registry) returns a localised item list without error.
 *
 * Discipline: minimal assertions. No assertions on the prose content
 * itself — that's owner-managed copy, characterized by the snapshot.
 *
 * TODO (corpus-next): expand to assert language-fallback behaviour
 * (lang='xx' → English) once owner confirms the supported-language
 * matrix as gold-standard.
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

describe('characterization: privacy.html', () => {
  it('serves the page (200 + non-empty HTML)', async () => {
    const html = await fixture.fetchPage('privacy.html');
    expect(html.length).toBeGreaterThan(100);
    expect(html).toContain('<html');
  });

  it('initial HTML snapshot (static privacy notice)', async () => {
    const html = await fixture.fetchPage('privacy.html');
    const snap = normaliseSnapshot(html);
    expect(snap, 'privacy.html structural baseline').toMatchSnapshot();
  });

  it('getPrivacyNotice returns a localised item list without error', async () => {
    const r = await fixture.callSkill('getPrivacyNotice');
    expect(r).toBeTruthy();
    expect(r.error).toBeUndefined();
    expect(typeof r.lang).toBe('string');
    expect(Array.isArray(r.items)).toBe(true);
  });
});
