/**
 * .3 — inbox.html migrated to NavModel + B.2.0 web-adapter
 * helpers (mirror of sliceB2_1-mine.test.js / sliceB2_2-review.test.js).
 *
 * Asserts:
 *   - The manifest now declares `listMyInbox` + `clearInboxItem` ops
 *     AND the `inbox` view (was off-manifest pre-B.2.3).
 *   - The manifest declares `'inbox-item'` as an app-local itemType
 *     (F-SP1-a) so the view can pin `type: 'inbox-item'` and the
 *     itemAction can gate on it.
 *   - renderWeb's NavModel projects the `inbox` section with the
 *     `clearInboxItem` itemAction (Dismiss button).
 *   - The page serves + carries the B.2.0 overlay imports
 *     (itemMatchesAppliesTo / applyPrefilledParams / fetchSectionItems).
 *   - `listMyInbox` round-trips via /tasks/send.
 *
 * Phase-1 scope (this slice): 2 new ops + 1 new view + 1 new itemType.
 * Deferred to B.2.3b (per-event-kind dispatch + bulk-clear CTA):
 *   - approveSubtaskRequest / declineSubtaskRequest
 *   - approveSubtaskProposal / declineSubtaskProposal
 *   - clearInbox (header "Clear all" CTA)
 *
 * Same harness as sliceB2_1 / sliceB2_2 + the characterization tests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { renderWeb } from '@onderling/app-manifest';

import { tasksManifest } from '../manifest.js';
import {
  ANNE, buildCharacterizationFixture,
} from './characterization/setup.js';

let fixture;

beforeAll(async () => {
  fixture = await buildCharacterizationFixture({ actor: ANNE });
});

afterAll(async () => {
  await fixture?.teardown();
});

describe('Slice B.2.3 — manifest delta (inbox.html data source + Dismiss)', () => {
  it('declares "inbox-item" as an app-local itemType', () => {
    expect(tasksManifest.itemTypes).toContain('inbox-item');
  });

  it('declares listMyInbox as a list op on type=inbox-item', () => {
    const op = tasksManifest.operations.find((o) => o.id === 'listMyInbox');
    expect(op).toBeTruthy();
    expect(op.verb).toBe('list');
    expect(op.appliesTo).toEqual({ type: 'inbox-item' });
    // Skill takes optional limit + since (epoch-ms).
    const names = op.params.map((p) => p.name).sort();
    expect(names).toEqual(['limit', 'since']);
    expect(op.surfaces?.chat?.hint).toBeTruthy();
    // No surfaces.ui — list ops are an implicit data source, not a button.
    expect(op.surfaces?.ui).toBeUndefined();
  });

  it('declares clearInboxItem as a remove op with a UI button', () => {
    const op = tasksManifest.operations.find((o) => o.id === 'clearInboxItem');
    expect(op).toBeTruthy();
    expect(op.verb).toBe('remove');
    expect(op.appliesTo).toEqual({ type: 'inbox-item' });
    const id = op.params.find((p) => p.name === 'id');
    expect(id?.required).toBe(true);
    expect(op.surfaces?.ui?.control).toBe('button');
    expect(op.surfaces?.ui?.label).toBe('Dismiss');
  });

  it('declares the inbox view backed by listMyInbox with limit prefilled', () => {
    const view = tasksManifest.views.find((v) => v.id === 'inbox');
    expect(view).toBeTruthy();
    expect(view.title).toBe('Notifications');
    expect(view.type).toBe('inbox-item');
    expect(view.dataSource).toEqual({
      skillId: 'listMyInbox',
      args:    { limit: 200 },
    });
  });

  it('renderWeb projects the inbox section with the clearInboxItem itemAction', () => {
    const nav = renderWeb(tasksManifest);
    const sec = nav.sections.find((s) => s.id === 'inbox');
    expect(sec, 'inbox section missing').toBeTruthy();
    expect(sec.itemType).toBe('inbox-item');
    expect(sec.dataSource).toEqual({
      skillId: 'listMyInbox',
      args:    { limit: 200 },
    });
    const opIds = sec.itemActions.map((a) => a.opId);
    expect(opIds).toContain('clearInboxItem');
    // The four task-domain DoD-lifecycle itemActions must NOT bleed
    // into the inbox section (they target type='task', not 'inbox-
    // item').  This is the manifest's matchOp gate at work.
    expect(opIds).not.toContain('approveTask');
    expect(opIds).not.toContain('claimTask');
    expect(opIds).not.toContain('submitTask');
  });

  it('clearInboxItem itemAction carries no state gate (any-state Dismiss)', () => {
    const nav = renderWeb(tasksManifest);
    const sec = nav.sections.find((s) => s.id === 'inbox');
    const dismiss = sec.itemActions.find((a) => a.opId === 'clearInboxItem');
    expect(dismiss).toBeTruthy();
    // No state field on inbox items — inbox notifications are stateless.
    expect(dismiss.appliesTo?.state).toBeUndefined();
  });

  // adoption (2026-05-20) — Tier C consent gate on clearInbox.
  it('clearInbox section-header CTA carries the Q27 confirm severity hint', () => {
    const nav = renderWeb(tasksManifest);
    const sec = nav.sections.find((s) => s.id === 'inbox');
    const clearAll = sec.sectionActions?.find((a) => a.opId === 'clearInbox');
    expect(clearAll).toBeTruthy();
    expect(clearAll.confirm).toEqual({
      severity: 'warn',
      message:  'Clear all inbox notifications?  Cannot be undone for this device.',
    });
  });
});

describe('Slice B.2.3 — inbox.html page integration', () => {
  it('serves /inbox.html with the V0.7 nav + the B.2.0 web-adapter imports', async () => {
    const html = await fixture.fetchPage('inbox.html');
    expect(html.length).toBeGreaterThan(100);
    expect(html).toContain('Inbox');                            // page title / nav
    expect(html).toContain('id="inbox-list"');
    expect(html).toContain('id="inbox-title"');                 // B.2.3 — manifest-projected h2
    // B.2.0 overlay imports — proof the page is wired through the
    // shared helpers, not the pre-B.2.3 inline copies.
    expect(html).toContain('/lib/web-adapter/itemMatchesAppliesTo.js');
    expect(html).toContain('/lib/web-adapter/applyPrefilledParams.js');
    expect(html).toContain('/lib/web-adapter/fetchSectionItems.js');
  });

  it('/navmodel.json includes the new inbox section', async () => {
    const nav = await fixture.fetchJson('/navmodel.json');
    const ids = nav.sections.map((s) => s.id);
    expect(ids).toContain('inbox');
    const sec = nav.sections.find((s) => s.id === 'inbox');
    expect(sec.title).toBe('Notifications');
    expect(sec.itemType).toBe('inbox-item');
    expect(sec.dataSource).toEqual({
      skillId: 'listMyInbox',
      args:    { limit: 200 },
    });
    // Dismiss itemAction reaches the projected NavModel.
    const opIds = sec.itemActions.map((a) => a.opId);
    expect(opIds).toContain('clearInboxItem');
  });

  it('listMyInbox round-trips via /tasks/send', async () => {
    const res = await fetch(`${fixture.baseUrl}/tasks/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        skillId: 'listMyInbox',
        message: { parts: [{ type: 'DataPart', data: { limit: 200 } }] },
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    const dp = (json.artifacts?.[0]?.parts ?? []).find((p) => p?.type === 'DataPart');
    // Reply shape is `{items: [...]}` — see src/skills/inbox.js →
    // defineSkill('listMyInbox').  On a fresh fixture the list is empty.
    expect(Array.isArray(dp?.data?.items)).toBe(true);
    expect(dp.data.items.length).toBe(0);
  });
});
