/**
 * V2.7 — hard subtask dependencies (app-level).
 *
 * Asserts:
 *   - completeTask returns {error, openDeps} when parent has open deps.
 *   - approveTask gated symmetrically on creator-mode parents.
 *   - forceCompleteTask: admin-only, mandatory reason, bypasses gate, audit logged.
 *   - No-cascade: forceComplete leaves sub-tasks open.
 *   - addSubtask on a submitted parent rejects with proposalRequired: true.
 *   - proposeSubtask: master/coord-only.
 *   - approveSubtaskProposal spawns + walks parent submitted → claimed.
 *   - declineSubtaskProposal closes proposal; submission stays valid.
 *   - forceSpawnSubtask: admin-only, mandatory reason.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { buildBundle } from '../src/storage/buildBundle.js';
import { createCrewAgent } from '../src/Crew.js';

const ANNE  = 'https://id.example/anne';
const FRITS = 'https://id.example/frits';
const KID   = 'https://id.example/kid';

const CREW = {
  crewId:  'oss-tools',
  name:    'OSS Tools NL',
  kind:    'project',
  members: [
    { webid: ANNE,  displayName: 'Anne',  role: 'admin' },
    { webid: FRITS, displayName: 'the author', role: 'coordinator' },
    { webid: KID,   displayName: 'Kid',   role: 'member' },
  ],
};

function call(crew, name, data, from) {
  return crew.agent.skills.get(name).handler({
    parts: [{ type: 'DataPart', data: data ?? {} }],
    from,
    agent: crew.agent,
    envelope: null,
  });
}

async function setup() {
  const bundle = buildBundle();
  const crew = await createCrewAgent({
    crewConfig:           CREW,
    localStoreBundle:     bundle,
    wireOnboardingSkills: false,
  });
  return { bundle, crew };
}

describe('V2.7 — hard subtask dependencies', () => {
  let crew;

  beforeEach(async () => {
    ({ crew } = await setup());
  });

  it('completeTask returns {error, openDeps} when parent has open subtasks', async () => {
    const p = await call(crew, 'addTask', { text: 'Parent' }, ANNE);
    const c = await call(crew, 'addSubtask', { parentTaskId: p.task.id, text: 'Child' }, ANNE);
    expect(c.task?.id).toBeTruthy();
    await call(crew, 'claimTask', { id: p.task.id }, ANNE);
    const r = await call(crew, 'completeTask', { id: p.task.id }, ANNE);
    expect(r.error).toBe('has-open-dependencies');
    expect(r.openDeps).toEqual([c.task.id]);
  });

  it('completing the child first lets the parent close', async () => {
    const p = await call(crew, 'addTask', { text: 'Parent' }, ANNE);
    const c = await call(crew, 'addSubtask', { parentTaskId: p.task.id, text: 'Child' }, ANNE);
    await call(crew, 'claimTask',    { id: c.task.id }, ANNE);
    await call(crew, 'completeTask', { id: c.task.id }, ANNE);
    await call(crew, 'claimTask',    { id: p.task.id }, ANNE);
    const r = await call(crew, 'completeTask', { id: p.task.id }, ANNE);
    expect(r.task?.completedAt).toBeGreaterThan(0);
  });

  it('approveTask gated symmetrically when parent has open deps', async () => {
    const p = await call(crew, 'addTask', { text: 'Parent', approval: 'creator' }, ANNE);
    await call(crew, 'addSubtask', { parentTaskId: p.task.id, text: 'Child' }, ANNE);
    await call(crew, 'claimTask',    { id: p.task.id }, KID);
    await call(crew, 'submitTask',   { id: p.task.id }, KID);
    const r = await call(crew, 'approveTask', { id: p.task.id }, ANNE);
    expect(r.error).toBe('has-open-dependencies');
  });

  it('forceCompleteTask admin-only with mandatory reason; bypasses gate; audit logged', async () => {
    const p = await call(crew, 'addTask', { text: 'Parent' }, ANNE);
    const c = await call(crew, 'addSubtask', { parentTaskId: p.task.id, text: 'Child' }, ANNE);

    // Member denied.
    expect((await call(crew, 'forceCompleteTask', { id: p.task.id, reason: 'foo' }, KID)).error).toMatch(/admin/);
    // Mandatory reason.
    expect((await call(crew, 'forceCompleteTask', { id: p.task.id }, ANNE)).error).toMatch(/reason/);
    // Bypasses gate; audit log gets a `force-complete` entry.
    const ok = await call(crew, 'forceCompleteTask', { id: p.task.id, reason: 'project cancelled' }, ANNE);
    expect(ok.ok).toBe(true);
    const log = await crew.itemStore.auditLog({ itemId: p.task.id });
    const force = log.find((e) => e.action === 'force-complete');
    expect(force).toBeTruthy();
    expect(force.details?.reason).toBe('project cancelled');

    // No cascade — child stays open.
    const child = await crew.itemStore.getById(c.task.id);
    expect(child.completedAt).toBeUndefined();
  });

  it('addSubtask on a submitted parent rejects with proposalRequired', async () => {
    // Set up: parent in creator-approval mode, claimed + submitted by KID.
    const p = await call(crew, 'addTask', { text: 'Parent', approval: 'creator' }, ANNE);
    await call(crew, 'claimTask',    { id: p.task.id }, KID);
    await call(crew, 'submitTask',   { id: p.task.id }, KID);

    // Anne (master/admin) tries to add a sub-task → blocked.
    const r = await call(crew, 'addSubtask', { parentTaskId: p.task.id, text: 'late add' }, ANNE);
    expect(r.error).toBe('parent-submitted');
    expect(r.proposalRequired).toBe(true);
    expect(r.assignee).toBe(KID);
  });

  it('proposeSubtask master/coord-only; non-master member denied', async () => {
    const p = await call(crew, 'addTask', { text: 'P', approval: 'creator' }, ANNE);
    await call(crew, 'claimTask',  { id: p.task.id }, KID);
    await call(crew, 'submitTask', { id: p.task.id }, KID);

    const denied = await call(crew, 'proposeSubtask',
      { parentTaskId: p.task.id, text: 'late' }, KID);     // KID is the assignee + member; not master; denied
    expect(denied.error).toMatch(/master|admin|coordinator/);

    // But the author (coord) can propose.
    const ok = await call(crew, 'proposeSubtask',
      { parentTaskId: p.task.id, text: 'late from coord' }, FRITS);
    expect(ok.queued).toBe(true);
    expect(ok.assignee).toBe(KID);
  });

  it('approveSubtaskProposal spawns subtask + rolls parent submitted → claimed', async () => {
    const p = await call(crew, 'addTask', { text: 'P', approval: 'creator' }, ANNE);
    await call(crew, 'claimTask',  { id: p.task.id }, KID);
    await call(crew, 'submitTask', { id: p.task.id }, KID);
    const prop = await call(crew, 'proposeSubtask',
      { parentTaskId: p.task.id, text: 'extra scope' }, ANNE);
    expect(prop.proposalId).toBeTruthy();

    const ok = await call(crew, 'approveSubtaskProposal',
      { proposalId: prop.proposalId }, KID);
    expect(ok.ok).toBe(true);
    expect(ok.parentRolledBack).toBe(true);
    expect(ok.task?.id).toBeTruthy();

    // Parent's submission should be in reviewLog with the auto-rollback note.
    const parent = await crew.itemStore.getById(p.task.id);
    expect(parent.assignee).toBe(KID);
    const log = parent.reviewLog ?? [];
    const submit = log.find((e) => e.decision === 'submit');
    const reject = log.find((e) => e.decision === 'reject');
    expect(submit).toBeTruthy();   // original submit preserved
    expect(reject?.note).toMatch(/auto-rollback/);
    expect(parent.dependencies).toContain(ok.task.id);
  });

  it('declineSubtaskProposal closes proposal; parent submission stays valid', async () => {
    const p = await call(crew, 'addTask', { text: 'P', approval: 'creator' }, ANNE);
    await call(crew, 'claimTask',  { id: p.task.id }, KID);
    await call(crew, 'submitTask', { id: p.task.id }, KID);
    const prop = await call(crew, 'proposeSubtask',
      { parentTaskId: p.task.id, text: 'extra scope' }, ANNE);

    const r = await call(crew, 'declineSubtaskProposal',
      { proposalId: prop.proposalId, note: 'not now' }, KID);
    expect(r.ok).toBe(true);

    // Parent should still be approvable (no new deps).
    const ap = await call(crew, 'approveTask', { id: p.task.id }, ANNE);
    expect(ap.task?.completedAt).toBeGreaterThan(0);
  });

  it('only the parent\'s assignee can approve / decline a proposal', async () => {
    const p = await call(crew, 'addTask', { text: 'P', approval: 'creator' }, ANNE);
    await call(crew, 'claimTask',  { id: p.task.id }, KID);
    await call(crew, 'submitTask', { id: p.task.id }, KID);
    const prop = await call(crew, 'proposeSubtask',
      { parentTaskId: p.task.id, text: 'late' }, ANNE);

    const wrong = await call(crew, 'approveSubtaskProposal',
      { proposalId: prop.proposalId }, FRITS);
    expect(wrong.error).toMatch(/assignee/);

    const wrong2 = await call(crew, 'declineSubtaskProposal',
      { proposalId: prop.proposalId, note: 'no' }, ANNE);
    expect(wrong2.error).toMatch(/assignee/);
  });

  it('forceSpawnSubtask admin-only; mandatory reason; audit logged', async () => {
    const p = await call(crew, 'addTask', { text: 'P', approval: 'creator' }, ANNE);
    await call(crew, 'claimTask',  { id: p.task.id }, KID);
    await call(crew, 'submitTask', { id: p.task.id }, KID);

    expect((await call(crew, 'forceSpawnSubtask',
      { parentTaskId: p.task.id, text: 'forced', reason: 'r' }, FRITS)).error).toMatch(/admin/);
    expect((await call(crew, 'forceSpawnSubtask',
      { parentTaskId: p.task.id, text: 'forced' }, ANNE)).error).toMatch(/reason/);

    const ok = await call(crew, 'forceSpawnSubtask',
      { parentTaskId: p.task.id, text: 'forced add', reason: 'unreachable assignee' }, ANNE);
    expect(ok.ok).toBe(true);
    expect(ok.task?.id).toBeTruthy();
    const log = await crew.itemStore.auditLog({ itemId: ok.task.id });
    const force = log.find((e) => e.action === 'force-spawn');
    expect(force).toBeTruthy();
    expect(force.details?.reason).toBe('unreachable assignee');
  });

  it('assignee can self-spawn during their own submission (no proposal required)', async () => {
    // Assignee adding their own scope to their own task is still allowed —
    // they're the gate themselves.
    const p = await call(crew, 'addTask', { text: 'P', approval: 'creator' }, ANNE);
    await call(crew, 'claimTask',  { id: p.task.id }, KID);
    await call(crew, 'submitTask', { id: p.task.id }, KID);
    const r = await call(crew, 'addSubtask',
      { parentTaskId: p.task.id, text: 'self-add' }, KID);
    expect(r.task?.id).toBeTruthy();
  });
});
