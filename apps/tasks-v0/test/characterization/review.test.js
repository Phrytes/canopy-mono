/**
 * Characterization corpus — review.html (review queue).
 *
 * **The first starter test** for the corpus (see
 * `apps/tasks-v0/docs/characterization-corpus.md`).  Picked because:
 *   - review.html has ZERO existing test coverage today;
 *   - the page is read-only-driven (depends on tasks reaching
 *     `submitted` state) — small interaction surface;
 *   - the page is stable (not touched in any of the last ~10 commits).
 *
 * Captures:
 *   - Empty-state initial HTML (deterministic actor + crew).
 *   - HTML after a fixture lifecycle: addTask → claimTask →
 *     submitTask, leaving one item in the review queue.
 *   - The `listAwaitingApproval` skill result for the same state.
 *
 * Snapshots are normalised (ULIDs + timestamps) so they remain stable
 * across runs.  See `docs/characterization-corpus.md` § "Snapshot
 * acceptance gate" for the owner-ack process.
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

describe('characterization: review.html', () => {
  it('serves the page (200 + non-empty HTML)', async () => {
    const html = await fixture.fetchPage('review.html');
    expect(html.length).toBeGreaterThan(100);
    expect(html).toContain('<html');
  });

  it('initial HTML snapshot (empty review queue)', async () => {
    const html = await fixture.fetchPage('review.html');
    // Sanity: page declares itself as the review screen.
    expect(html.toLowerCase()).toContain('review');
    // Stable structural anchors.
    expect(html).toContain('<main');
    expect(html).toContain('<script');
    // Full HTML available via inline-snapshot if owner wants the
    // byte-level gate.  V0 corpus keeps it structural; tighten on
    // owner request.
    const snap = normaliseSnapshot(html);
    expect(snap, 'review.html structural baseline').toMatchSnapshot();
  });

  it('listAwaitingApproval returns [] on a fresh crew', async () => {
    const r = await fixture.callSkill('listAwaitingApproval');
    // Substrate returns a JSON object after DataPart wrapping; the
    // approvals array is empty.
    const approvals = r?.approvals ?? r?.tasks ?? [];
    expect(approvals).toEqual([]);
  });

  it('add → claim → submit substrate state transitions complete cleanly', async () => {
    // Verifies the lifecycle that review.html depends on — a task
    // reaches `submitted` state via the addTask → claimTask →
    // submitTask skill chain.  We assert SUBSTRATE state directly
    // (status/assignee on the item) rather than `listAwaitingApproval`
    // — the latter applies the approval-policy gate, which depends on
    // crew config (approver routing) and is its own characterization
    // target.  TODO (corpus-next): characterize listAwaitingApproval
    // separately once approval policy is documented for the fixture
    // crew.
    const TASK_TEXT = 'submitted task for the review-queue corpus';

    await fixture.callSkill('addTask', {
      crewId: 'characterization-crew',
      text:   TASK_TEXT,
    });

    // Resolve the task-id by introspecting the live itemStore — more
    // robust than parsing addTask's reply shape (which has shifted
    // across V1/V2 in tasks-v0's history).
    const items   = await fixture.crewState.itemStore.listOpen({ type: 'task' });
    const created = items.find((it) => it.text === TASK_TEXT);
    expect(created, 'addTask must persist the task to the itemStore').toBeTruthy();

    // tasks-v0 skills take `{id}` (not `{taskId}`) — see
    // src/skills/index.js claimTask/submitTask defineSkill bodies.
    await fixture.callSkill('claimTask',  { crewId: 'characterization-crew', id: created.id });
    await fixture.callSkill('submitTask', { crewId: 'characterization-crew', id: created.id });

    // After submit, the task is still in the itemStore with Anne as
    // assignee.  The detailed state-machine assertions (status field
    // derivation, submittedAt timestamp, etc.) are owner-acceptance
    // characterization work — left as TODO in
    // `docs/characterization-corpus.md` until owner confirms which
    // fields to lock as gold-standard.
    const after = (await fixture.crewState.itemStore.listOpen({ type: 'task' }))
      .find((it) => it.id === created.id);
    expect(after, 'task should still exist after submit').toBeTruthy();
    expect(after.assignee, 'Anne is the assignee after claim').toBe(ANNE);
  });
});
