/**
 * Characterization corpus — inbox.html (notifications feed).
 *
 * Inbox.html surfaces per-user notifications written cross-app via
 * the InAppInboxBridge (mem://user/inbox/<id>.json). Zero existing
 * test coverage today.
 *
 * Captures:
 *   - Page-serves test: 200 + non-empty HTML + `<html` substring.
 *   - Structural snapshot via `normaliseSnapshot` + `toMatchSnapshot`.
 *   - `listMyInbox` returns an items array on a fresh fixture.
 *   - `inboxBadgeCount` returns a count shape on a fresh fixture.
 *
 * Discipline: minimal assertions, no domain-state introspection.
 * We don't seed an inbox payload (cross-app authoring is the bridge's
 * job; this corpus just asserts the read-skills return well-formed
 * empty responses).
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

describe('characterization: inbox.html', () => {
  it('serves the page (200 + non-empty HTML)', async () => {
    const html = await fixture.fetchPage('inbox.html');
    expect(html.length).toBeGreaterThan(100);
    expect(html).toContain('<html');
  });

  it('initial HTML snapshot (empty inbox)', async () => {
    const html = await fixture.fetchPage('inbox.html');
    const snap = normaliseSnapshot(html);
    expect(snap, 'inbox.html structural baseline').toMatchSnapshot();
  });

  it('listMyInbox returns an empty items array on a fresh fixture', async () => {
    const r = await fixture.callSkill('listMyInbox');
    expect(r).toBeTruthy();
    expect(r.error).toBeUndefined();
    expect(Array.isArray(r.items)).toBe(true);
    expect(r.items.length).toBe(0);
  });

  it('inboxBadgeCount returns a count shape on a fresh fixture', async () => {
    const r = await fixture.callSkill('inboxBadgeCount');
    expect(r).toBeTruthy();
    expect(r.error).toBeUndefined();
    // Skill returns { count, totalCount }; both 0 on a fresh fixture.
    // TODO (corpus-next): exercise InAppInboxBridge to seed items and
    // assert clearInboxItem lifecycle. Cross-app authoring is the
    // bridge's job; the corpus avoids that for now.
    expect(typeof r.count).toBe('number');
    expect(typeof r.totalCount).toBe('number');
    expect(r.count).toBe(0);
    expect(r.totalCount).toBe(0);
  });
});
