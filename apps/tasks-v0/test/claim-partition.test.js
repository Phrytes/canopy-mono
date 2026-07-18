/**
 * (PLAN-task-claim-partition) — the acceptance bar.
 *
 * Scenario (the plan's partition→merge walkthrough): a circle shares a task;
 * the mesh splits; both halves claim the SAME task; both do work; the mesh
 * reconverges. The property under test:
 *
 *   NO WORK LOST + THE DOUBLE-CLAIM IS ALWAYS SURFACED — never a silent
 *   last-writer-wins overwrite of `assignee`.
 *
 * The red baseline this locks in: BEFORE the guard, when Ann's
 * claim envelope arrived at Bob (who had claimed locally under partition),
 * the tasks mirror's `applySync` WHOLESALE-OVERWROTE Bob's `assignee` → Ann,
 * silently, decided purely by arrival order, with NOTHING surfaced. The
 * assertions below (`assignee` NOT overwritten + a claim-conflict recorded)
 * FAILED at that point — that failure is the acceptance baseline.
 *
 * This file (now GREEN): the mirror's surgical claim-vs-claim guard
 * records a `claim-conflict` carrying BOTH claimants instead of overwriting.
 *
 * The collision surfaces on the mirrorer's (Bob's) node — that is exactly the
 * side the silent overwrite used to destroy (the arriving author-claim would
 * clobber the mirrorer's local claim). Central-pod one-winner (etag-CAS) is
 * (`packages/item-store/test/claim-cas.test.js`); the P2P
 * pseudo-pod-only mesh is here. P2P multi-value merge is v2.
 */
import { describe, it, expect } from 'vitest';
import { createPartitionSim } from './harness/partitionSim.js';

const ANN = 'https://id.example/ann';
const BOB = 'https://id.example/bob';

describe('Slice 0/2 — task-claim under partition (P2P mesh)', () => {
  it('partition → both claim → reconverge: no silent overwrite, conflict surfaced, both products kept', async () => {
    const sim = await createPartitionSim({
      circleId: 'partition-circle',
      members: [{ webid: ANN, role: 'admin' }, { webid: BOB, role: 'member' }],
    });
    try {
      // Ann authors a task; it fans out to Bob's mirror.
      const { task } = await sim.addTaskAs(ANN, { text: 'shovel the path' });
      await sim.settle();
      const bobItem = (await sim.listOpenAs(BOB)).find((i) => i.source?.syncedFromId === task.id);
      expect(bobItem).toBeTruthy();
      expect(bobItem.assignee).toBeUndefined();       // open on Bob before the split

      // Split the mesh: Ann | Bob. Each claims on their own side.
      sim.partition([ANN], [BOB]);
      const annClaim = await sim.claimAs(ANN, task.id);
      const bobClaim = await sim.claimAs(BOB, bobItem.id);
      expect(annClaim.result?.assignee).toBe(ANN);    // local CAS succeeds each side
      expect(bobClaim.result?.assignee).toBe(BOB);
      await sim.settle();

      // Reconverge + drain the buffered claim envelopes.
      await sim.reconverge();

      // ── ACCEPTANCE ──────────────────────────────────────────────────────
      // (a) NO SILENT OVERWRITE: Bob's assignee is still Bob — Ann's arriving
      //     claim did NOT clobber it (red → green).
      const bobAfter = (await sim.listOpenAs(BOB)).find((i) => i.source?.syncedFromId === task.id);
      expect(bobAfter.assignee).toBe(BOB);

      // (b) DOUBLE-CLAIM SURFACED: a claim-conflict exists on Bob's mirror.
      const conflicts = sim.mirrorOf(BOB).listClaimConflicts();
      expect(conflicts.length).toBe(1);
      const conflict = conflicts[0];

      // (c) NO WORK LOST: the record carries BOTH claimants' full task
      //     snapshots (the loser's product is retrievable from the record).
      expect(conflict.localAssignee).toBe(BOB);
      expect(conflict.incomingAssignee).toBe(ANN);
      expect(conflict.local.assignee).toBe(BOB);
      expect(conflict.incoming.assignee).toBe(ANN);
      expect(conflict.taskId).toBe(bobAfter.id);
    } finally {
      await sim.stop();
    }
  });

  it('SURGICAL — a normal claim onto an OPEN task still syncs (no false conflict)', async () => {
    const sim = await createPartitionSim({
      circleId: 'normal-claim-circle',
      members: [{ webid: ANN, role: 'admin' }, { webid: BOB, role: 'member' }],
    });
    try {
      const { task } = await sim.addTaskAs(ANN, { text: 'sweep' });
      await sim.settle();
      // Ann claims while everyone is connected; Bob has NOT claimed.
      await sim.claimAs(ANN, task.id);
      await sim.settle();

      const bobItem = (await sim.listOpenAs(BOB)).find((i) => i.source?.syncedFromId === task.id);
      expect(bobItem.assignee).toBe(ANN);                       // normal sync applied
      expect(sim.mirrorOf(BOB).listClaimConflicts().length).toBe(0);   // no false positive
    } finally {
      await sim.stop();
    }
  });
});
