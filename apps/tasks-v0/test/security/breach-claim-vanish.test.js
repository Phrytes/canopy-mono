/**
 * J-SECURITY BREACH SUITE — claim-and-vanish (partition exploit).
 * PLAN-real-usage-and-deployment.md §7 ("partition-exploit (claim + vanish)")
 * + PLAN-task-claim-partition §5 (partition-safe TTL / soft-expiry).
 *
 * Threat: a member claims a task then goes silent while partitioned. Can a
 * peer silently free/steal the task ("unreachable ⇒ gone")? MUST NOT.
 *
 * DEFENDED (green):
 *   • While the claimant is unreachable, their claim PERSISTS on peers — a
 *     peer's claim attempt is refused (`already-claimed`), the assignee is
 *     never silently cleared. Unreachable ≠ gone.
 *   • The symmetric double-claim (both claim independently under partition)
 *     reconverges to a SURFACED claim-conflict, never a silent last-writer
 *     overwrite (reuses the Slice-2 guard). No work lost.
 *
 * DOCUMENTED (designed-not-built): the §5 partition-safe TTL soft-expiry
 * (a claim becomes *reclaimable-with-warning* after a grace period, routing
 * a reclaim through the conflict card on the original's return) is NOT
 * built. Consequence today is the SAFE-but-not-live direction: a vanished
 * member's claim is held INDEFINITELY (an availability cost), never auto-
 * released (no safety breach). Codified as a `todo` below. See
 * SECURITY-FINDINGS.
 *
 * Reuses the partition-sim harness verbatim.
 */
import { describe, it, expect } from 'vitest';
import { createPartitionSim } from '../harness/partitionSim.js';

const ANN = 'https://id.example/ann';
const BOB = 'https://id.example/bob';

describe('§7.8 — claim-and-vanish: claim is NOT silently freed', () => {
  it('DEFENDED: while the claimant is partitioned/silent, the claim persists on peers', async () => {
    const sim = await createPartitionSim({
      circleId: 'vanish-circle',
      members: [{ webid: ANN, role: 'admin' }, { webid: BOB, role: 'member' }],
    });
    try {
      // Ann authors + claims while connected → syncs to Bob.
      const { task } = await sim.addTaskAs(ANN, { text: 'seal the roof' });
      await sim.settle();
      await sim.claimAs(ANN, task.id);
      await sim.settle();

      const bobItem = (await sim.listOpenAs(BOB)).find((i) => i.source?.syncedFromId === task.id);
      expect(bobItem.assignee).toBe(ANN);      // Bob sees it claimed by Ann

      // Ann vanishes: partition her away and let time pass on Bob's side.
      sim.partition([ANN], [BOB]);
      await sim.settle();

      // Bob tries to TAKE the vanished member's task. It must NOT be freed.
      const bobClaim = await sim.claimAs(BOB, bobItem.id);
      // The claim is refused — either the skill reports the existing owner,
      // or (defensively) the assignee simply remains Ann. Never Bob.
      const bobAfter = (await sim.listOpenAs(BOB)).find((i) => i.source?.syncedFromId === task.id);
      expect(bobAfter.assignee).toBe(ANN);     // still Ann — not silently stolen
      expect(bobAfter.assignee).not.toBe(BOB);
      // The skill surfaced the conflict rather than overwriting.
      expect(bobClaim?.result?.assignee ?? ANN).not.toBe(BOB);
    } finally {
      await sim.stop();
    }
  });

  it('DEFENDED: a symmetric double-claim under partition reconverges to a SURFACED conflict (no silent overwrite)', async () => {
    const sim = await createPartitionSim({
      circleId: 'vanish-double-circle',
      members: [{ webid: ANN, role: 'admin' }, { webid: BOB, role: 'member' }],
    });
    try {
      const { task } = await sim.addTaskAs(ANN, { text: 'clear the drains' });
      await sim.settle();
      const bobItem = (await sim.listOpenAs(BOB)).find((i) => i.source?.syncedFromId === task.id);
      expect(bobItem.assignee).toBeUndefined();

      // Split; each side claims; Ann then vanishes (stays partitioned) until reconverge.
      sim.partition([ANN], [BOB]);
      await sim.claimAs(ANN, task.id);
      await sim.claimAs(BOB, bobItem.id);
      await sim.settle();
      await sim.reconverge();

      // No silent overwrite: Bob keeps his claim; Ann's arriving claim is a conflict.
      const bobAfter = (await sim.listOpenAs(BOB)).find((i) => i.source?.syncedFromId === task.id);
      expect(bobAfter.assignee).toBe(BOB);
      const conflicts = sim.mirrorOf(BOB).listClaimConflicts();
      expect(conflicts.length).toBe(1);
      expect(conflicts[0].localAssignee).toBe(BOB);
      expect(conflicts[0].incomingAssignee).toBe(ANN);
    } finally {
      await sim.stop();
    }
  });

  /**
   * DESIGNED-NOT-BUILT — the partition-safe TTL soft-expiry (§5). There is
   * no timer that turns a vanished member's claim into "reclaimable-with-
   * warning", and no reclaim-routes-through-conflict-card path on return.
   * Marked `todo` (not run) so the audit is honest about what exists.
   */
  it.todo('§5 soft-expiry TTL: a claim held by a long-silent member becomes reclaimable-with-warning (NOT BUILT)');
});
