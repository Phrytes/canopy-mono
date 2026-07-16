/**
 * #219 — editTask skill (2026-05-24).
 *
 * Tasks-v0 had primitives for every state transition (claim / submit /
 * approve / reject / complete) but no way to patch a task's body
 * fields after it was added.  Real users edit titles all the time
 * (typos, scope clarifications, re-prioritising), so basis
 * needed a substrate skill to wire to its [Edit] row button.
 *
 * Covers:
 *   - happy path: text + notes patch persists, returns updated task
 *   - dueAt + estimateMinutes patch (multiple fields in one call)
 *   - forbidden field rejection (cannot patch claimedAt / assignee /
 *     completedAt / id / addedBy via this skill — those have
 *     dedicated lifecycle primitives that gate properly)
 *   - missing id → error
 *   - empty patch (no allowed fields supplied) → error
 *   - not-found id → error: 'not-found'
 *   - dependency cycle re-check on edit
 *   - paused / archived circle blocks edit (same gate as addTask)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataPart } from '@onderling/core';

import { buildBundle } from '../src/storage/buildBundle.js';
import { createCircleAgent } from '../src/Circle.js';

const ANNE  = 'https://id.example/anne';
const FRITS = 'https://id.example/frits';
const KID   = 'https://id.example/kid';

const CIRCLE = {
  circleId:  'edit-task-test-circle',
  name:    'Edit-Task Test',
  kind:    'project',
  members: [
    { webid: ANNE,  displayName: 'Anne',         role: 'admin' },
    { webid: FRITS, displayName: 'the author',   role: 'coordinator' },
    { webid: KID,   displayName: 'Kid',          role: 'member' },
  ],
};

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

describe('#219 — editTask skill', () => {
  let lsBundle;
  let circle;
  let taskA;
  let taskB;

  beforeEach(async () => {
    lsBundle = buildBundle();
    circle = await createCircleAgent({
      circleConfig:           CIRCLE,
      localStoreBundle:     lsBundle,
      wireOnboardingSkills: false,
    });
    const a = await callSkill(circle.agent, 'addTask', { text: 'Buy groceries' }, ANNE);
    const b = await callSkill(circle.agent, 'addTask', { text: 'Take out trash' }, ANNE);
    taskA = a.task;
    taskB = b.task;
    expect(taskA?.id).toBeTruthy();
    expect(taskB?.id).toBeTruthy();
  });

  afterEach(async () => {
    await circle?.close?.();
  });

  it('patches text + notes; returns updated task', async () => {
    const r = await callSkill(circle.agent, 'editTask', {
      id:    taskA.id,
      text:  'Buy groceries (Saturday)',
      notes: 'Lidl + AH; veg-only',
    }, ANNE);
    expect(r.error).toBeUndefined();
    expect(r.task?.id).toBe(taskA.id);
    expect(r.task.text).toBe('Buy groceries (Saturday)');
    expect(r.task.notes).toBe('Lidl + AH; veg-only');
    // attribution preserved (NOT clobbered).
    expect(r.task.addedBy).toBe(ANNE);
    expect(r.task.addedAt).toBe(taskA.addedAt);
  });

  it('patches multiple fields in one call (dueAt + estimateMinutes)', async () => {
    const due = '2026-06-01T12:00:00Z';
    const r = await callSkill(circle.agent, 'editTask', {
      id:               taskA.id,
      dueAt:            due,
      estimateMinutes:  45,
    }, ANNE);
    expect(r.error).toBeUndefined();
    expect(r.task.dueAt).toBe(due);
    expect(r.task.estimateMinutes).toBe(45);
  });

  it('silently drops forbidden lifecycle / attribution field patches', async () => {
    // assignee / claimedAt / completedAt / addedBy / id / reviewLog /
    // deliverable / approval — these all have dedicated primitives
    // (claim/submit/approve/complete). The skill whitelists allowed
    // fields, so supplying ONLY a forbidden field is the same as
    // supplying an empty patch.
    const r1 = await callSkill(circle.agent, 'editTask', {
      id: taskA.id, assignee: KID,
    }, ANNE);
    expect(r1.error).toBe('no fields to update');

    const r2 = await callSkill(circle.agent, 'editTask', {
      id: taskA.id, completedAt: Date.now(),
    }, ANNE);
    expect(r2.error).toBe('no fields to update');

    // Mixed patch: forbidden field silently dropped, allowed field
    // still applied.  Verifies the filter is a per-field whitelist,
    // not an all-or-nothing reject.
    const r3 = await callSkill(circle.agent, 'editTask', {
      id: taskA.id, assignee: KID, text: 'Renamed legitimately',
    }, ANNE);
    expect(r3.error).toBeUndefined();
    expect(r3.task.text).toBe('Renamed legitimately');
    expect(r3.task.assignee).toBeUndefined(); // assignee dropped
  });

  it('errors on missing id', async () => {
    const r = await callSkill(circle.agent, 'editTask', { text: 'no id' }, ANNE);
    expect(r.error).toBe('id required');
  });

  it('errors on empty patch (only id supplied, no fields)', async () => {
    const r = await callSkill(circle.agent, 'editTask', { id: taskA.id }, ANNE);
    expect(r.error).toBe('no fields to update');
  });

  it('returns error:not-found for unknown id', async () => {
    const r = await callSkill(circle.agent, 'editTask', {
      id: '01ZZZNOTREAL', text: 'whatever',
    }, ANNE);
    expect(r.error).toBe('not-found');
  });

  it('paused circle rejects edit with error:circle-paused', async () => {
    await callSkill(circle.agent, 'pauseCircle', {}, ANNE);
    const r = await callSkill(circle.agent, 'editTask', {
      id: taskA.id, text: 'During pause',
    }, ANNE);
    expect(r.error).toBe('circle-paused');
  });

  it('archived circle rejects edit with error:circle-archived', async () => {
    await callSkill(circle.agent, 'archiveCircle', {}, ANNE);
    const r = await callSkill(circle.agent, 'editTask', {
      id: taskA.id, text: 'During archive',
    }, ANNE);
    expect(r.error).toBe('circle-archived');
  });

  it('dependency cycle re-check: setting deps that form a cycle is rejected', async () => {
    // Make A depend on B first (legal — DAG: B → A).
    const ok = await callSkill(circle.agent, 'editTask', {
      id: taskA.id, dependencies: [taskB.id],
    }, ANNE);
    expect(ok.error).toBeUndefined();

    // Now try to make B depend on A — would close the cycle A→B→A.
    await expect(callSkill(circle.agent, 'editTask', {
      id: taskB.id, dependencies: [taskA.id],
    }, ANNE)).rejects.toThrow(/cycle/i);
  });
});
