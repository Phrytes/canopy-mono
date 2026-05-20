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

import { tasksManifest } from '@canopy-app/tasks-v0/manifest';

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
