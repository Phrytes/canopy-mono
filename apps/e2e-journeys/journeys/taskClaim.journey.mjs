// Task-claim under partition — the hard distributed case: a circle shares a task,
// the mesh SPLITS, both halves claim the SAME task, the mesh RECONVERGES — and
// the double-claim is ALWAYS surfaced as a conflict (never a silent
// last-writer-wins overwrite), with no work lost.
//
// HERMETIC BY NECESSITY: this uses the in-process partitionable transport
// (buffers cross-half envelopes, flushes on reconverge) — you cannot tell a real
// relay to partition on command, so `relayUrl` is intentionally unused here. It
// reuses the REAL tasks-v0 claim + substrate-mirror conflict machinery
// (apps/tasks-v0/test/harness/partitionSim.js).
import { createPartitionSim } from '../../tasks-v0/test/harness/partitionSim.js';
import { checker } from './_util.mjs';

export const name = 'task-claim under partition (conflict surfaced)';

const ANN = 'https://id.example/ann';
const BOB = 'https://id.example/bob';

export async function run() {
  const { results, check } = checker();

  // ── Scenario 1: partition → both claim → reconverge → conflict surfaced ──────
  const sim = await createPartitionSim({
    circleId: 'e2e-partition-circle',
    members: [{ webid: ANN, role: 'admin' }, { webid: BOB, role: 'member' }],
  });
  try {
    const { task } = await sim.addTaskAs(ANN, { text: 'shovel the path' });
    await sim.settle();
    const bobItem = (await sim.listOpenAs(BOB)).find((i) => i.source?.syncedFromId === task.id);
    check('task authored by Ann fans out to Bob (open before the split)', !!bobItem && bobItem.assignee === undefined);

    // Split the mesh; each side claims independently — local CAS succeeds each side.
    sim.partition([ANN], [BOB]);
    const annClaim = await sim.claimAs(ANN, task.id);
    const bobClaim = await sim.claimAs(BOB, bobItem?.id);
    check('under partition, each side\'s local claim succeeds', annClaim.result?.assignee === ANN && bobClaim.result?.assignee === BOB);
    await sim.settle();

    // Reconverge + drain the buffered claim envelopes.
    await sim.reconverge();

    const bobAfter = (await sim.listOpenAs(BOB)).find((i) => i.source?.syncedFromId === task.id);
    check('NO silent overwrite — Bob\'s assignee is still Bob after Ann\'s claim arrives', bobAfter?.assignee === BOB);

    const conflicts = sim.mirrorOf(BOB).listClaimConflicts();
    const c = conflicts[0];
    check('the double-claim is SURFACED as exactly one claim-conflict', conflicts.length === 1);
    check('NO work lost — the conflict record carries BOTH claimants\' snapshots',
      c?.localAssignee === BOB && c?.incomingAssignee === ANN && c?.local?.assignee === BOB && c?.incoming?.assignee === ANN);
  } finally {
    await sim.stop();
  }

  // ── Scenario 2: surgical — a normal claim onto an OPEN task still syncs ──────
  const sim2 = await createPartitionSim({
    circleId: 'e2e-normal-claim-circle',
    members: [{ webid: ANN, role: 'admin' }, { webid: BOB, role: 'member' }],
  });
  try {
    const { task } = await sim2.addTaskAs(ANN, { text: 'sweep' });
    await sim2.settle();
    await sim2.claimAs(ANN, task.id);      // claimed while everyone is connected; Bob has NOT claimed
    await sim2.settle();
    const bobItem = (await sim2.listOpenAs(BOB)).find((i) => i.source?.syncedFromId === task.id);
    check('a normal claim onto an open task still syncs (no false conflict)',
      bobItem?.assignee === ANN && sim2.mirrorOf(BOB).listClaimConflicts().length === 0);
  } finally {
    await sim2.stop();
  }

  return results;
}
