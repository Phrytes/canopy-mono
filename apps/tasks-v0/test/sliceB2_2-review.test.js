/**
 * .2 — review.html migrated to NavModel + B.2.0 web-adapter
 * helpers (mirror of sliceB2_1-mine.test.js).
 *
 * Asserts:
 *   - The manifest now declares the `listAwaitingApproval` op AND the
 *     `review` view (was off-manifest pre-B.2.2).
 *   - renderWeb's NavModel projects the `review` section with the
 *     expected DoD-lifecycle itemActions (approveTask /
 *     rejectTask / revokeTask gated by appliesTo.state).
 *   - The page serves + carries the imports the B.2.0 overlay
 *     provides (itemMatchesAppliesTo / applyPrefilledParams /
 *     fetchSectionItems).
 *   - `listAwaitingApproval` round-trips via /tasks/send.
 *
 * Same harness as sliceB2_1-mine.test.js + the dag.html
 * characterization tests.
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

describe('Slice B.2.2 — manifest delta (review.html data source)', () => {
  it('declares listAwaitingApproval as a list op on type=task', () => {
    const op = tasksManifest.operations.find((o) => o.id === 'listAwaitingApproval');
    expect(op).toBeTruthy();
    expect(op.verb).toBe('list');
    expect(op.appliesTo).toEqual({ type: 'task' });
    expect(op.params).toEqual([]);
    expect(op.surfaces?.chat?.hint).toBeTruthy();
    // No surfaces.ui — list ops are an implicit data source, not a button.
    expect(op.surfaces?.ui).toBeUndefined();
  });

  it('declares the review view backed by listAwaitingApproval', () => {
    const view = tasksManifest.views.find((v) => v.id === 'review');
    expect(view).toBeTruthy();
    expect(view.title).toBe('Awaiting approval');
    expect(view.type).toBe('task');
    expect(view.dataSource).toEqual({ skillId: 'listAwaitingApproval' });
  });

  it('renderWeb projects the review section with the V0.7 DoD itemActions', () => {
    const nav = renderWeb(tasksManifest);
    const sec = nav.sections.find((s) => s.id === 'review');
    expect(sec, 'review section missing').toBeTruthy();
    expect(sec.itemType).toBe('task');
    // Same itemActions surface as mine/mastered/claimable (all
    // DoD-lifecycle ops on type='task' with surfaces.ui).  The page
    // filters by appliesTo.state at render time.
    const opIds = sec.itemActions.map((a) => a.opId).sort();
    expect(opIds).toEqual(expect.arrayContaining([
      'approveTask', 'rejectTask', 'revokeTask',
    ]));
  });

  it('approveTask / rejectTask itemActions carry the F-SP3-a state gate', () => {
    const nav = renderWeb(tasksManifest);
    const review = nav.sections.find((s) => s.id === 'review');
    const approve = review.itemActions.find((a) => a.opId === 'approveTask');
    const reject  = review.itemActions.find((a) => a.opId === 'rejectTask');
    expect(approve).toBeTruthy();
    expect(reject).toBeTruthy();
    expect(approve.appliesTo.state).toEqual(['submitted']);
    expect(reject.appliesTo.state).toEqual(['submitted']);
  });
});

describe('Slice B.2.2 — review.html page integration', () => {
  it('serves /review.html with the B.2.0 web-adapter imports', async () => {
    const html = await fixture.fetchPage('review.html');
    expect(html.length).toBeGreaterThan(100);
    expect(html).toContain('Review');                          // page title / nav
    expect(html).toContain('id="awaiting-list"');
    // B.2.0 overlay imports — proof the page is wired through the
    // shared helpers, not the pre-B.2.2 inline copies.
    expect(html).toContain('/lib/web-adapter/itemMatchesAppliesTo.js');
    expect(html).toContain('/lib/web-adapter/applyPrefilledParams.js');
    expect(html).toContain('/lib/web-adapter/fetchSectionItems.js');
  });

  it('/navmodel.json includes the new review section', async () => {
    const nav = await fixture.fetchJson('/navmodel.json');
    const ids = nav.sections.map((s) => s.id);
    expect(ids).toContain('review');
    const review = nav.sections.find((s) => s.id === 'review');
    expect(review.title).toBe('Awaiting approval');
    expect(review.itemType).toBe('task');
    expect(review.dataSource).toEqual({ skillId: 'listAwaitingApproval' });
  });

  it('listAwaitingApproval round-trips via /tasks/send', async () => {
    const res = await fetch(`${fixture.baseUrl}/tasks/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        skillId: 'listAwaitingApproval',
        message: { parts: [{ type: 'DataPart', data: {} }] },
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    const dp = (json.artifacts?.[0]?.parts ?? []).find((p) => p?.type === 'DataPart');
    // Reply shape is `{items: [...], viewer: …}` — see
    // src/skills/workspace.js → defineSkill('listAwaitingApproval').
    // On a fresh fixture the list is empty.
    expect(Array.isArray(dp?.data?.items)).toBe(true);
  });
});
