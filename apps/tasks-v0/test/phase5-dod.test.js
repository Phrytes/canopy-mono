/**
 * Phase 5 — app-side DoD lifecycle skills + role-policy gating.
 *
 * Substrate-level lifecycle is covered in
 * `packages/item-store/test/ItemStore.dod.test.js`. This file
 * proves the Tasks app wiring:
 *   - skill registration (submitTask / approveTask / rejectTask /
 *     revokeTask / setApprovalMode are reachable via agent.skills)
 *   - role-policy gates (admin/coord override; member-only-own-tasks;
 *     observer denied)
 *   - default approval = 'self-mark' (legacy V0 path unchanged)
 *   - approval = 'creator' end-to-end (claim → submit → approve)
 *   - approval = 'webid:X' end-to-end
 *   - revoke flow (mandatory reason; previousAssignee in event)
 *
 * Plus a couple of DAG-status sanity checks: the dependents-flip-on-
 * complete property holds when approval is required (dependents stay
 * 'waiting' until approve, not just 'submit').
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { DataPart } from '@onderling/core';

import { createTasksAgent } from '../src/Agent.js';
import { computeStatus, detectCycle } from '../src/dag.js';

const ANNE  = 'https://id.example/anne';
const FRITS = 'https://id.example/frits';
const KID   = 'https://id.example/kid';
const OBS   = 'https://id.example/obs';

const ROLES = {
  [ANNE]:  'admin',
  [FRITS]: 'coordinator',
  [KID]:   'member',
  [OBS]:   'observer',
};
const MEMBERS = [
  { webid: ANNE,  displayName: 'Anne',  role: 'admin' },
  { webid: FRITS, displayName: 'the author', role: 'coordinator' },
  { webid: KID,   displayName: 'Kid',   role: 'member' },
  { webid: OBS,   displayName: 'Obs',   role: 'observer' },
];

let bundle;
beforeEach(async () => {
  bundle = await createTasksAgent({ roles: ROLES, members: MEMBERS });
});

async function callSkill(agent, skillId, args, fromWebid) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
    agent,
    envelope: null,
  });
}

async function add(args, from = ANNE) {
  return callSkill(bundle.agent, 'addTask', args, from);
}
async function claim(id, from) {
  return callSkill(bundle.agent, 'claimTask', { id }, from);
}

describe('Phase 5 — skill registration', () => {
  it('registers the five new DoD skills on every tasks agent', () => {
    expect(bundle.agent.skills.has('submitTask')).toBe(true);
    expect(bundle.agent.skills.has('approveTask')).toBe(true);
    expect(bundle.agent.skills.has('rejectTask')).toBe(true);
    expect(bundle.agent.skills.has('revokeTask')).toBe(true);
    expect(bundle.agent.skills.has('setApprovalMode')).toBe(true);
  });
});

describe('Phase 5 — default self-mark path (V0 backward compat)', () => {
  it('a task with no explicit approval works through markComplete unchanged', async () => {
    const { task } = await add({ text: 'Take out the trash' });
    await claim(task.id, KID);
    const completedRes = await callSkill(bundle.agent, 'completeTask', { id: task.id }, KID);
    expect(completedRes.task.completedAt).toBeGreaterThan(0);
    expect(completedRes.task.completedBy).toBe(KID);
  });
});

describe('Phase 5 — approval = "creator" (issuer signs off)', () => {
  it('claim → submit → approve flow', async () => {
    const { task } = await add({
      text:     'Paint the fence',
      approval: 'creator',
      definitionOfDone: 'fence painted, 3 photos uploaded',
    });
    await claim(task.id, KID);

    // Kid (assignee) submits with a deliverable.
    const submitRes = await callSkill(bundle.agent, 'submitTask', {
      id:          task.id,
      deliverable: { kind: 'pod-resource', ref: 'pod://kid.../photos/' },
      note:        'done — 3 photos uploaded',
    }, KID);
    expect(submitRes.task.deliverable.kind).toBe('pod-resource');
    expect(submitRes.task.reviewLog).toHaveLength(1);

    // Anne (creator/master) approves.
    const approveRes = await callSkill(bundle.agent, 'approveTask', {
      id:   task.id,
      note: 'looks good',
    }, ANNE);
    expect(approveRes.task.completedAt).toBeGreaterThan(0);
    expect(approveRes.task.completedBy).toBe(ANNE);
    expect(approveRes.task.reviewLog.map((r) => r.decision)).toEqual(['submit', 'approve']);
  });

  it('non-approver cannot approve (kid tries to approve own submission)', async () => {
    const { task } = await add({ text: 'Paint', approval: 'creator' });
    await claim(task.id, KID);
    await callSkill(bundle.agent, 'submitTask', { id: task.id }, KID);
    // Kid is the assignee, NOT the creator's master — kid cannot approve.
    await expect(callSkill(bundle.agent, 'approveTask', { id: task.id }, KID))
      .rejects.toThrow(/permission denied/i);
  });

  it('admin override: admin (anne) can approve even when not the designated approver', async () => {
    // the author creates the task with himself as approver-equivalent.
    const { task } = await add({ text: 'Plumb', approval: 'creator' }, FRITS);
    await claim(task.id, KID);
    await callSkill(bundle.agent, 'submitTask', { id: task.id }, KID);
    const approveRes = await callSkill(bundle.agent, 'approveTask', { id: task.id }, ANNE);
    expect(approveRes.task.completedAt).toBeGreaterThan(0);
  });

  it('reject flow: returns to claimed-but-rejected; assignee re-submits', async () => {
    const { task } = await add({ text: 'Paint', approval: 'creator' });
    await claim(task.id, KID);
    await callSkill(bundle.agent, 'submitTask', { id: task.id }, KID);

    const rejectRes = await callSkill(bundle.agent, 'rejectTask', {
      id:   task.id,
      note: 'photo of the side missing',
    }, ANNE);
    expect(rejectRes.task.completedAt).toBeUndefined();
    expect(rejectRes.task.reviewLog.map((r) => r.decision)).toEqual(['submit', 'reject']);

    // Re-submit succeeds.
    const submit2 = await callSkill(bundle.agent, 'submitTask', {
      id:          task.id,
      deliverable: { kind: 'note', ref: '4 photos this time' },
    }, KID);
    expect(submit2.task.reviewLog.map((r) => r.decision)).toEqual(['submit', 'reject', 'submit']);
  });

  it('rejectTask without note throws', async () => {
    const { task } = await add({ text: 'Paint', approval: 'creator' });
    await claim(task.id, KID);
    await callSkill(bundle.agent, 'submitTask', { id: task.id }, KID);
    await expect(callSkill(bundle.agent, 'rejectTask', { id: task.id }, ANNE))
      .rejects.toThrow(/note/i);
  });
});

describe('Phase 5 — approval = "webid:X" (third-party approver)', () => {
  it('the designated webid is the only approver (besides admin)', async () => {
    const { task } = await add({
      text:     'Order planks',
      approval: `webid:${FRITS}`,
    });
    await claim(task.id, KID);
    await callSkill(bundle.agent, 'submitTask', { id: task.id }, KID);

    // Kid can't approve own work.
    await expect(callSkill(bundle.agent, 'approveTask', { id: task.id }, KID))
      .rejects.toThrow(/permission denied/i);

    // the author (designated approver) succeeds.
    const ok = await callSkill(bundle.agent, 'approveTask', { id: task.id }, FRITS);
    expect(ok.task.completedAt).toBeGreaterThan(0);
  });
});

describe('Phase 5 — revokeTask (master-only, mandatory reason)', () => {
  it('master (default = addedBy) revokes; previousAssignee in returned task; mandatory reason', async () => {
    const { task } = await add({ text: 'Build planter' }, ANNE);
    await claim(task.id, KID);

    await expect(callSkill(bundle.agent, 'revokeTask', { id: task.id }, ANNE))
      .rejects.toThrow(/reason/i);

    const res = await callSkill(bundle.agent, 'revokeTask', {
      id:     task.id,
      reason: 'pushing forward, doing it myself',
    }, ANNE);
    expect(res.task.assignee).toBeUndefined();
    expect(res.task.master).toBe(ANNE);
    expect(res.task.reviewLog[0].decision).toBe('revoke');
    expect(res.task.reviewLog[0].note).toBe('pushing forward, doing it myself');
  });

  it('non-master / non-admin cannot revoke', async () => {
    const { task } = await add({ text: 'Order planks' }, FRITS); // master = the author
    await claim(task.id, KID);
    // Kid (assignee, not master, not admin) cannot revoke.
    await expect(callSkill(bundle.agent, 'revokeTask',
      { id: task.id, reason: 'just because' }, KID))
      .rejects.toThrow(/permission denied/i);
  });

  it('admin can revoke any task even if not master', async () => {
    const { task } = await add({ text: 'Plumb' }, FRITS); // master = the author, NOT Anne
    await claim(task.id, KID);
    const ok = await callSkill(bundle.agent, 'revokeTask',
      { id: task.id, reason: 'admin override' }, ANNE);
    expect(ok.task.assignee).toBeUndefined();
    expect(ok.task.master).toBe(FRITS);
  });
});

describe('Phase 5 — setApprovalMode', () => {
  it('coordinator / admin can flip mode; member with editBody-on-own can flip own task', async () => {
    const { task } = await add({ text: 'Mow lawn' }, KID);
    // Kid edits own task → allowed (canEditBody for member returns true on own tasks).
    const r = await callSkill(bundle.agent, 'setApprovalMode',
      { id: task.id, mode: 'creator' }, KID);
    expect(r.task.approval).toBe('creator');
  });

  it('observer cannot flip approval mode', async () => {
    const { task } = await add({ text: 'Mow lawn' }, KID);
    await expect(callSkill(bundle.agent, 'setApprovalMode',
      { id: task.id, mode: 'creator' }, OBS))
      .rejects.toThrow(/permission denied/i);
  });
});

describe('Phase 5 — DAG dependents flip when complete (not when submitted)', () => {
  it('dependent stays waiting until parent transitions to complete via approve', async () => {
    const { task: parent } = await add({ text: 'Parent', approval: 'creator' });
    const { task: child  } = await add({ text: 'Child', dependencies: [parent.id] });

    // Both visible.
    const open0 = await bundle.itemStore.listOpen();
    const closed0 = await bundle.itemStore.listClosed();
    expect(computeStatus(child, open0, closed0)).toBe('waiting');

    // Parent claimed + submitted — child STILL waiting (parent isn't complete yet).
    await claim(parent.id, KID);
    await callSkill(bundle.agent, 'submitTask', { id: parent.id }, KID);
    const open1 = await bundle.itemStore.listOpen();
    const closed1 = await bundle.itemStore.listClosed();
    expect(computeStatus(child, open1, closed1)).toBe('waiting');

    // Parent approved — child now ready.
    await callSkill(bundle.agent, 'approveTask', { id: parent.id }, ANNE);
    const open2 = await bundle.itemStore.listOpen();
    const closed2 = await bundle.itemStore.listClosed();
    expect(computeStatus(child, open2, closed2)).toBe('ready');
  });

  it('self-mark approval: dependent flips immediately on completeTask (V0 path)', async () => {
    const { task: parent } = await add({ text: 'Parent self-mark' });    // default self-mark
    const { task: child  } = await add({ text: 'Child', dependencies: [parent.id] });
    await claim(parent.id, KID);
    await callSkill(bundle.agent, 'completeTask', { id: parent.id }, KID);
    const open  = await bundle.itemStore.listOpen();
    const closed = await bundle.itemStore.listClosed();
    expect(computeStatus(child, open, closed)).toBe('ready');
    // sanity-check helper: cycle detection still works on the new schema
    expect(detectCycle({ id: 'X', dependencies: [parent.id] }, [parent, child])).toBeNull();
  });
});
