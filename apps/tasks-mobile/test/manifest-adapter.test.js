/**
 * Slice C.1 (2026-05-20) — NavModel adapter for tasks-mobile.
 *
 * Locks the wire-shape of `createNavModelAdapter(tasksManifest,
 * {callSkill})` so RN screens (WorkspaceScreen first, then the rest
 * of Phase-1 in `docs/screen-inventory.md` § 5) can consume the
 * manifest the same way `apps/tasks-v0/web/mine.html` already does.
 *
 * Pure-JS — no RN imports needed (the adapter is platform-neutral on
 * purpose; cross-surface parity = web + mobile share the gate).
 */

import { describe, it, expect, vi } from 'vitest';

import { tasksManifest } from '@onderling-app/tasks/manifest';

import { createNavModelAdapter } from '../src/manifest-adapter.js';

describe('Slice C.1: createNavModelAdapter(tasksManifest, {callSkill})', () => {
  const callSkill = vi.fn(async () => ({ items: [] }));
  const adapter   = createNavModelAdapter(tasksManifest, { callSkill });

  it('exposes a NavModel that surfaces the V0.2 task views', () => {
    // tasks-v0's manifest is the source-of-truth for view ordering;
    // the canonical assertion lives in
    // `apps/tasks-v0/test/sliceB1-navmodel.test.js`.  Here we assert
    // the adapter passes the manifest's views through verbatim (no
    // mobile-side filtering); we check INCLUSION rather than exact
    // order so concurrent slice work in the manifest (B.2.2 review,
    // future Phase-1 lifts) doesn't ripple here.
    expect(adapter.navModel.app).toBe('tasks');
    const ids = adapter.navModel.sections.map((s) => s.id);
    for (const expected of ['open', 'mine', 'mastered', 'claimable', 'dag']) {
      expect(ids).toContain(expected);
    }
  });

  it('getSection("open") resolves the workspace tab section', () => {
    const open = adapter.getSection('open');
    expect(open).toBeTruthy();
    expect(open.id).toBe('open');
    expect(open.title).toBe('Open');
    expect(open.itemType).toBe('task');
    // V0.2 Q7 dataSource — explicit listOpen({type:'task'}).
    expect(open.dataSource).toEqual({ skillId: 'listOpen', args: { type: 'task' } });
  });

  it('getSection("nope") returns undefined for unknown sections', () => {
    expect(adapter.getSection('nope')).toBeUndefined();
  });

  it('fetchSection(open) calls callSkill via the section\'s dataSource', async () => {
    callSkill.mockReset();
    callSkill.mockResolvedValueOnce({ items: [{ id: 't1', type: 'task' }] });

    const open  = adapter.getSection('open');
    const reply = await adapter.fetchSection(open);

    expect(callSkill).toHaveBeenCalledTimes(1);
    expect(callSkill).toHaveBeenCalledWith('listOpen', { type: 'task' });
    expect(reply).toEqual({ items: [{ id: 't1', type: 'task' }] });
  });

  it('fetchSection(mine) dispatches the listMine skill (Q7 dataSource)', async () => {
    callSkill.mockReset();
    callSkill.mockResolvedValueOnce({ items: [] });

    const mine = adapter.getSection('mine');
    await adapter.fetchSection(mine);

    // V0.2 — listMine declared without `args`, so fetchSectionItems
    // calls it with the empty default ({}). This is the gate that
    // would catch a regression where the helper fell through to the
    // Q6 rule-b fallback (which would call listOpen).
    expect(callSkill).toHaveBeenCalledWith('listMine', {});
  });

  /*
   * Slice C.2 (2026-05-20) — MyWorkScreen consumer.  Three sections
   * resolve via the adapter; each must call the right skill id via
   * its manifest dataSource (Q7).  Mirrors the WorkspaceScreen
   * `open`-section gate above, extended for the three-section RN
   * screen so a regression in any section's dataSource is caught
   * here (not at runtime via a broken pull-to-refresh).
   */
  describe('Slice C.2: MyWorkScreen sections (mine / mastered / claimable)', () => {
    it('getSection("mastered") resolves the listMyMasteredTasks dataSource', () => {
      const mastered = adapter.getSection('mastered');
      expect(mastered).toBeTruthy();
      expect(mastered.id).toBe('mastered');
      expect(mastered.itemType).toBe('task');
      // V0.2 Q7 dataSource — explicit listMyMasteredTasks (no args).
      expect(mastered.dataSource).toEqual({ skillId: 'listMyMasteredTasks' });
    });

    it('getSection("claimable") resolves the listClaimable dataSource', () => {
      const claimable = adapter.getSection('claimable');
      expect(claimable).toBeTruthy();
      expect(claimable.id).toBe('claimable');
      expect(claimable.itemType).toBe('task');
      // V0.2 Q7 dataSource — explicit listClaimable (no args).
      expect(claimable.dataSource).toEqual({ skillId: 'listClaimable' });
    });

    it('fetchSection(mastered) dispatches listMyMasteredTasks via callSkill', async () => {
      callSkill.mockReset();
      callSkill.mockResolvedValueOnce({ items: [] });

      const mastered = adapter.getSection('mastered');
      await adapter.fetchSection(mastered);

      expect(callSkill).toHaveBeenCalledTimes(1);
      expect(callSkill).toHaveBeenCalledWith('listMyMasteredTasks', {});
    });

    it('fetchSection(claimable) dispatches listClaimable via callSkill', async () => {
      callSkill.mockReset();
      callSkill.mockResolvedValueOnce({ items: [] });

      const claimable = adapter.getSection('claimable');
      await adapter.fetchSection(claimable);

      expect(callSkill).toHaveBeenCalledTimes(1);
      expect(callSkill).toHaveBeenCalledWith('listClaimable', {});
    });

    it('all three MyWork sections dispatch their own skill (no cross-talk)', async () => {
      // Stronger gate than the per-section tests above — proves that
      // resolving section A doesn't accidentally hand the screen
      // section B's dataSource.  This is the regression the V0.2 Q7
      // lift was designed to prevent (pre-V0.2 the mapping was
      // inline per-page; one accidental refactor could swap them).
      callSkill.mockReset();
      callSkill.mockResolvedValue({ items: [] });

      await adapter.fetchSection(adapter.getSection('mine'));
      await adapter.fetchSection(adapter.getSection('mastered'));
      await adapter.fetchSection(adapter.getSection('claimable'));

      const calls = callSkill.mock.calls.map((c) => c[0]);
      expect(calls).toEqual(['listMine', 'listMyMasteredTasks', 'listClaimable']);
    });
  });

  /*
   * Slice C.3 (2026-05-20) — ReviewScreen consumer.  The reviewer
   * queue is a single section (`review`) backed by
   * `listAwaitingApproval` (B.2.2-declared); per-row Approve/Reject
   * buttons come from `renderItemActions(section, item)` filtered by
   * the manifest's V0.7 DoD-lifecycle `appliesTo.state: ['submitted']`
   * gate.  Mirrors sliceB2_2-review.test.js's web-side coverage,
   * extended for the RN adapter consumer so a regression in the
   * `review` section's data source OR the action set's state gate is
   * caught here (not at runtime via a missing button).
   *
   * This is the first RN consumer of `renderItemActions` end-to-end —
   * Workspace + MyWork only exercise the dataSource path (sections
   * carry itemActions[] but no RN screen rendered them pre-C.3).
   */
  describe('Slice C.3: ReviewScreen section + per-row actions (review)', () => {
    it('getSection("review") resolves the listAwaitingApproval dataSource', () => {
      const review = adapter.getSection('review');
      expect(review).toBeTruthy();
      expect(review.id).toBe('review');
      expect(review.title).toBe('Awaiting approval');
      expect(review.itemType).toBe('task');
      // V0.2 Q7 dataSource — explicit listAwaitingApproval (no args).
      expect(review.dataSource).toEqual({ skillId: 'listAwaitingApproval' });
    });

    it('fetchSection(review) dispatches listAwaitingApproval via callSkill', async () => {
      callSkill.mockReset();
      callSkill.mockResolvedValueOnce({ items: [] });

      const review = adapter.getSection('review');
      await adapter.fetchSection(review);

      expect(callSkill).toHaveBeenCalledTimes(1);
      expect(callSkill).toHaveBeenCalledWith('listAwaitingApproval', {});
    });

    it('renderItemActions(review, submitted) surfaces approve + reject + revoke', () => {
      const review = adapter.getSection('review');
      // V2.7 — listAwaitingApproval stamps `status: 'submitted'` on
      // every returned item (server-side effectiveStatus); the
      // adapter's deriveItemState honours the explicit status.
      const submitted = {
        id: 't-submitted',
        type: 'task',
        assignee: 'webid:#alice',
        status: 'submitted',
        reviewLog: [{ decision: 'submit', by: 'webid:#alice', at: 1717000000000 }],
      };
      const actions = adapter.renderItemActions(review, submitted);
      const ids = actions.map((a) => a.opId).sort();

      // Mandatory set — sliceB2_2-review.test.js's web-side assertion.
      expect(ids).toEqual(expect.arrayContaining(['approveTask', 'rejectTask', 'revokeTask']));
      // Negatives — state gate must reject lifecycle ops on submitted.
      expect(ids).not.toContain('claimTask');     // state:['open']
      expect(ids).not.toContain('submitTask');    // state:['claimed','rejected']
      expect(ids).not.toContain('completeTask');  // state:['claimed']
    });

    it('renderItemActions(review, claimed) does NOT surface approve/reject (defensive)', () => {
      // Defensive: listAwaitingApproval should only return submitted
      // items, but if a stale/concurrent claimed item leaks through
      // the adapter's state gate must still hide approve/reject (they
      // would 4xx server-side).
      const review = adapter.getSection('review');
      const claimed = {
        id: 't-claimed',
        type: 'task',
        assignee: 'webid:#alice',
        status: 'claimed',
      };
      const actions = adapter.renderItemActions(review, claimed);
      const ids = actions.map((a) => a.opId);
      expect(ids).not.toContain('approveTask');
      expect(ids).not.toContain('rejectTask');
      // revokeTask still surfaces (its appliesTo.state covers
      // claimed/submitted/rejected) — same gate the web review page
      // honours.
      expect(ids).toContain('revokeTask');
    });

    it('approve/reject actions carry {opId, label, args:{id}} ready for dispatch', () => {
      const review = adapter.getSection('review');
      const submitted = {
        id: 't-99',
        type: 'task',
        assignee: 'webid:#alice',
        status: 'submitted',
        reviewLog: [{ decision: 'submit', by: 'webid:#alice', at: 1717000000000 }],
      };
      const actions = adapter.renderItemActions(review, submitted);
      const approve = actions.find((a) => a.opId === 'approveTask');
      const reject  = actions.find((a) => a.opId === 'rejectTask');

      expect(approve).toBeTruthy();
      expect(approve.label).toBe('Approve');
      expect(approve.args).toEqual({ id: 't-99' });

      expect(reject).toBeTruthy();
      expect(reject.label).toBe('Reject');
      // The note param is mandatory but the adapter prefills only
      // {id}; the screen merges {note} before dispatch (see
      // ReviewScreen.jsx — reject hand-off to TaskDetailScreen).
      expect(reject.args).toEqual({ id: 't-99' });
    });
  });

  /*
   * Slice C.4 (2026-05-20) — InboxScreen consumer.  The inbox queue
   * (`inbox` section, V0.2 dataSource `listMyInbox`) is the first RN
   * screen to consume BOTH the V0.4 generic appliesTo gate (per-kind
   * dispatch via `appliesTo.kind`) AND the V0.4 Q19 section-header
   * CTAs (`section.sectionActions[]` for clearInbox).  This block
   * locks both substrate features end-to-end + a happy-path for the
   * adapter's new `renderSectionActions` helper.
   *
   * Mirror of the web's sliceB2_3-inbox.test.js (B.2.3b coverage —
   * 538f9d2) extended for the RN adapter consumer.  A regression in
   * the inbox section's dataSource OR per-kind gate OR section CTA
   * surfaces here, not via a broken Pressable at runtime.
   */
  describe('Slice C.4: InboxScreen section + per-kind actions + clearInbox CTA', () => {
    it('getSection("inbox") resolves the listMyInbox dataSource with {limit:200}', () => {
      const inbox = adapter.getSection('inbox');
      expect(inbox).toBeTruthy();
      expect(inbox.id).toBe('inbox');
      expect(inbox.title).toBe('Notifications');
      expect(inbox.itemType).toBe('inbox-item');
      // V0.2 Q7 dataSource — explicit listMyInbox + limit pin.
      expect(inbox.dataSource).toEqual({ skillId: 'listMyInbox', args: { limit: 200 } });
    });

    it('renderItemActions on a subtask-proposal event surfaces approve+decline+clear (per-kind gate)', () => {
      const inbox = adapter.getSection('inbox');
      // The screen tags raw inbox events with {type: 'inbox-item',
      // kind}; pass a pre-tagged event here (mirrors what
      // InboxScreen.tagInboxItem produces).  Without the tag the
      // appliesTo.type === 'inbox-item' gate would fail — see the
      // tagInboxItem docblock in InboxScreen.jsx.
      const proposal = {
        id: 'evt-prop-1',
        type: 'inbox-item',
        kind: 'subtask-proposal',
      };
      const ids = adapter.renderItemActions(inbox, proposal).map((a) => a.opId).sort();

      // V0.4 generic appliesTo: kind:'subtask-proposal' gates these.
      expect(ids).toContain('approveSubtaskProposal');
      expect(ids).toContain('declineSubtaskProposal');
      // clearInboxItem has no `kind` gate — surfaces on every event.
      expect(ids).toContain('clearInboxItem');
      // Negatives — the request-kind ops MUST NOT surface on a
      // proposal-kind event (per-kind gate is the whole point of
      // V0.4's generic appliesTo).
      expect(ids).not.toContain('approveSubtaskRequest');
      expect(ids).not.toContain('declineSubtaskRequest');
      // clearInbox is a section-header CTA, NOT a per-row op.
      expect(ids).not.toContain('clearInbox');
    });

    it('renderItemActions on a subtask-request event surfaces approve+decline+clear (per-kind gate)', () => {
      const inbox = adapter.getSection('inbox');
      const request = {
        id: 'evt-req-1',
        type: 'inbox-item',
        kind: 'subtask-request',
      };
      const ids = adapter.renderItemActions(inbox, request).map((a) => a.opId).sort();

      expect(ids).toContain('approveSubtaskRequest');
      expect(ids).toContain('declineSubtaskRequest');
      expect(ids).toContain('clearInboxItem');
      // Negatives — the proposal-kind ops MUST NOT cross over.
      expect(ids).not.toContain('approveSubtaskProposal');
      expect(ids).not.toContain('declineSubtaskProposal');
    });

    it('renderItemActions on a generic (unknown-kind) event surfaces ONLY clearInboxItem', () => {
      const inbox = adapter.getSection('inbox');
      // E.g. a `task-completed` notification — has no `kind` in the
      // four-subtask set; only the kind-agnostic clearInboxItem op
      // should surface.
      const generic = {
        id: 'evt-gen-1',
        type: 'inbox-item',
        kind: 'task-completed',
      };
      const ids = adapter.renderItemActions(inbox, generic).map((a) => a.opId);

      expect(ids).toEqual(['clearInboxItem']);
    });

    it('renderSectionActions(inbox) surfaces clearInbox (Q19 section-header CTA)', () => {
      const inbox = adapter.getSection('inbox');
      const actions = adapter.renderSectionActions(inbox);
      const ids = actions.map((a) => a.opId);

      // clearInbox declares `surfaces.ui.placement: 'section-header'`;
      // renderWeb projects it into section.sectionActions[] (Q19).
      expect(ids).toEqual(['clearInbox']);
      expect(actions[0]).toMatchObject({
        opId:  'clearInbox',
        label: 'Clear all',
      });
      // V0 sectionActions take no per-item args — the screen
      // dispatches `clearInbox({})`.  applyPrefilledParams produces
      // an empty object when no prefills are declared.
      expect(actions[0].args).toEqual({});
    });

    it('renderSectionActions returns [] for sections without section-header ops', () => {
      // `open` is the workspace tab; none of its ops carry
      // `placement: 'section-header'`.  renderWeb only sets
      // section.sectionActions when at least one matched (forward-
      // additive — keeps the NavModel JSON minimal); the adapter
      // must tolerate the absent field.
      const open = adapter.getSection('open');
      expect(adapter.renderSectionActions(open)).toEqual([]);
    });

    it('renderSectionActions returns [] for a falsy section (no crash)', () => {
      expect(adapter.renderSectionActions(undefined)).toEqual([]);
      expect(adapter.renderSectionActions(null)).toEqual([]);
    });
  });

  describe('renderItemActions(section, item) — state-gated buttons', () => {
    const open = adapter.getSection('open');

    it('open task → only `claim` surfaces (appliesTo.state:["open"])', () => {
      // `derivedItemState` reads from raw substrate fields (no
      // assignee + no completedAt = "open"). The web shells gate the
      // same way — see itemMatchesAppliesTo.js docblock.
      const item = { id: 't-open', type: 'task' /* no assignee */ };
      const actions = adapter.renderItemActions(open, item);

      const ids = actions.map((a) => a.opId);
      expect(ids).toContain('claimTask');
      expect(ids).not.toContain('submitTask');     // state:['claimed','rejected']
      expect(ids).not.toContain('completeTask');   // state:['claimed']
      expect(ids).not.toContain('approveTask');    // state:['submitted']
      expect(ids).not.toContain('rejectTask');     // state:['submitted']
      expect(ids).not.toContain('revokeTask');     // state:['claimed','submitted','rejected']
    });

    it('claimed task → submit + complete + revoke surface', () => {
      const item = { id: 't-claimed', type: 'task', assignee: 'webid:#alice' };
      const actions = adapter.renderItemActions(open, item);

      const ids = actions.map((a) => a.opId);
      expect(ids).toContain('submitTask');         // state:['claimed','rejected']
      expect(ids).toContain('completeTask');       // state:['claimed']
      expect(ids).toContain('revokeTask');         // state:['claimed','submitted','rejected']
      // Negatives — the lifecycle gate must reject these.
      expect(ids).not.toContain('claimTask');      // state:['open']
      expect(ids).not.toContain('approveTask');    // state:['submitted']
      // `reassignTask` + `removeTask` have NO surfaces.ui — they're
      // intentionally absent from NavModel (Q6 rule c: non-creative
      // verbs need `surfaces.ui` to surface).  TaskDetailScreen's
      // admin-CTAs still call the skills directly; lifting them into
      // the manifest's web surface is a separate slice (Phase 1 +
      // 4 of `screen-inventory.md` § 5).
      expect(ids).not.toContain('reassignTask');
      expect(ids).not.toContain('removeTask');
    });

    it('submitted task → approve + reject + revoke surface', () => {
      // `deriveItemState` reads the reviewLog tail (see
      // packages/web-adapter/src/deriveItemState.js docblock):
      // the last decision wins.  `submit` → 'submitted'.
      const item = {
        id: 't-submitted',
        type: 'task',
        assignee: 'webid:#alice',
        reviewLog: [{ decision: 'submit', by: 'webid:#alice', at: 1717000000000 }],
      };
      const actions = adapter.renderItemActions(open, item);

      const ids = actions.map((a) => a.opId);
      expect(ids).toContain('approveTask');
      expect(ids).toContain('rejectTask');
      expect(ids).toContain('revokeTask');
      expect(ids).not.toContain('claimTask');
      expect(ids).not.toContain('completeTask');   // state:['claimed']
      expect(ids).not.toContain('submitTask');     // state:['claimed','rejected']
    });

    it('every action carries {opId, label, args:{id}} for the screen to dispatch', () => {
      const item = { id: 't-claimed', type: 'task', assignee: 'webid:#alice' };
      const actions = adapter.renderItemActions(open, item);
      expect(actions.length).toBeGreaterThan(0);
      for (const a of actions) {
        expect(typeof a.opId).toBe('string');
        expect(typeof a.label).toBe('string');
        expect(a.args).toEqual({ id: 't-claimed' });   // V0 tasks ops have no prefilledParams
      }
    });

    it('returns [] for a falsy section or item (no crash)', () => {
      expect(adapter.renderItemActions(undefined, { id: 't' })).toEqual([]);
      expect(adapter.renderItemActions(open,      undefined  )).toEqual([]);
    });
  });

  it('rejects malformed construction args', () => {
    expect(() => createNavModelAdapter(null, { callSkill: vi.fn() })).toThrow();
    expect(() => createNavModelAdapter(tasksManifest, {})).toThrow();
  });
});
