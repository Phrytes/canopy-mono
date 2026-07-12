/**
 * Slice 3 (PLAN-task-claim-partition) — surface + resolve.
 *
 * `listClaimConflicts` reads the recorded double-claims; `resolveClaim`
 * (yours/theirs/both) writes a causally-later claim that clears the conflict.
 * `both` keeps the local claimant AND mints a fresh task (distinct id) for the
 * other claimant → both products survive. Resolution is gated by the existing
 * reassign/revoke role policy (admin/coordinator).
 */
import { describe, it, expect } from 'vitest';
import { createPartitionSim, callSkill } from './harness/partitionSim.js';

const ANN  = 'https://id.example/ann';
const BOB  = 'https://id.example/bob';
const CARA = 'https://id.example/cara';

/** Drive a partition→merge double-claim; the conflict lands on Bob's node
 *  (an admin, so Bob can resolve it). Returns the sim + Bob's local task id. */
async function makeConflict() {
  const sim = await createPartitionSim({
    circleId: 'resolve-circle',
    members: [
      { webid: ANN,  role: 'admin' },
      { webid: BOB,  role: 'admin' },
      { webid: CARA, role: 'member' },
    ],
  });
  const { task } = await sim.addTaskAs(ANN, { text: 'fix the fence' });
  await sim.settle();
  const bobItem = (await sim.listOpenAs(BOB)).find((i) => i.source?.syncedFromId === task.id);
  sim.partition([ANN], [BOB, CARA]);
  await sim.claimAs(ANN, task.id);
  await sim.claimAs(BOB, bobItem.id);
  await sim.settle();
  await sim.reconverge();
  return { sim, bobTaskId: bobItem.id };
}

describe('Slice 3 — claim-conflict surface + resolve', () => {
  it('listClaimConflicts surfaces the double-claim', async () => {
    const { sim, bobTaskId } = await makeConflict();
    try {
      const res = await sim.call(BOB, 'listClaimConflicts', {});
      expect(res.conflicts.length).toBe(1);
      expect(res.conflicts[0].taskId).toBe(bobTaskId);
      expect(res.conflicts[0].localAssignee).toBe(BOB);
      expect(res.conflicts[0].incomingAssignee).toBe(ANN);
    } finally { await sim.stop(); }
  });

  it("resolveClaim 'yours' keeps the local claimant + clears the conflict", async () => {
    const { sim, bobTaskId } = await makeConflict();
    try {
      const r = await sim.call(BOB, 'resolveClaim', { taskId: bobTaskId, decision: 'yours' });
      expect(r.resolved.assignee).toBe(BOB);
      const task = (await sim.listOpenAs(BOB)).find((i) => i.id === bobTaskId);
      expect(task.assignee).toBe(BOB);
      expect(sim.mirrorOf(BOB).listClaimConflicts().length).toBe(0);
    } finally { await sim.stop(); }
  });

  it("resolveClaim 'theirs' takes the incoming claimant + clears the conflict", async () => {
    const { sim, bobTaskId } = await makeConflict();
    try {
      const r = await sim.call(BOB, 'resolveClaim', { taskId: bobTaskId, decision: 'theirs' });
      expect(r.resolved.assignee).toBe(ANN);
      const task = (await sim.listOpenAs(BOB)).find((i) => i.id === bobTaskId);
      expect(task.assignee).toBe(ANN);
      expect(sim.mirrorOf(BOB).listClaimConflicts().length).toBe(0);
    } finally { await sim.stop(); }
  });

  it("resolveClaim 'both' keeps BOTH products with distinct ids", async () => {
    const { sim, bobTaskId } = await makeConflict();
    try {
      const r = await sim.call(BOB, 'resolveClaim', { taskId: bobTaskId, decision: 'both' });
      expect(r.resolved.assignee).toBe(BOB);
      expect(r.alsoKept.assignee).toBe(ANN);
      expect(r.alsoKept.id).not.toBe(bobTaskId);         // distinct id

      const open = await sim.listOpenAs(BOB);
      const original = open.find((i) => i.id === bobTaskId);
      const minted   = open.find((i) => i.id === r.alsoKept.id);
      expect(original.assignee).toBe(BOB);
      expect(minted.assignee).toBe(ANN);                 // both survive
      expect(sim.mirrorOf(BOB).listClaimConflicts().length).toBe(0);
    } finally { await sim.stop(); }
  });

  it('resolveClaim is gated — a plain member cannot resolve', async () => {
    const { sim, bobTaskId } = await makeConflict();
    try {
      // Call on Bob's node (which holds the conflict) but AS Cara (a member).
      const r = await callSkill(
        sim.bundleOf(BOB).agent, 'resolveClaim',
        { circleId: 'resolve-circle', taskId: bobTaskId, decision: 'yours' },
        CARA,
      );
      expect(r.error).toBe('permission-denied');
      expect(sim.mirrorOf(BOB).listClaimConflicts().length).toBe(1);   // untouched
    } finally { await sim.stop(); }
  });
});
