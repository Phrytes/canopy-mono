/**
 * tasks-v0 — `local ≡ wire` equivalence + route-parity fitness test
 * (Workstream B, decision #5).
 *
 * Drives the shared, app-parameterized harness (`@canopy/sdk/testing`) with
 * tasks-v0's cores + manifest + Service:
 *   • LOCAL route  — `createTasksService().callSkill(op, args, ctx)` calls the
 *                    pure `(circle, args, ctx)` core in `TASK_CORES` DIRECTLY.
 *   • WIRE route   — the SAME core, wrapped by `wireSkill` + registered as a
 *                    `defineSkill` (via `buildSkills`), invoked over the
 *                    serialized `{parts:[DataPart], from, envelope}` path on a
 *                    real `@canopy/sdk` agent.
 *
 * The circles are built WITHOUT a restrictive rolePolicy so the per-route
 * caller identity (LOCAL uses a fixed webid; WIRE uses the agent's own key on a
 * self-invoke) never diverges the result — the harness normalizes those actor
 * fields away regardless, but this keeps the ops from being role-denied on one
 * route only.
 */
import { describe, it, expect } from 'vitest';

import { ItemStore } from '@canopy/item-store';
import { MemorySource } from '@canopy/core';
import { createAgent, Parts } from '@canopy/sdk';
// The `local ≡ wire` harness lives at the SDK layer (`@canopy/sdk/testing` once
// this branch is installed). Imported here by RELATIVE path to the worktree
// source because the pre-wired `node_modules/@canopy/sdk` symlink resolves to a
// sibling checkout that predates the export. Harness is dependency-free.
import { describeLocalWireFitness } from '../../../packages/sdk/src/testing/localWireFitness.js';

import { createTasksService } from '../src/Service.js';
import { buildSkills, TASK_CORES } from '../src/skills/index.js';
import { singleCircleResolver } from '../src/bundleResolver.js';
import { tasksManifest } from '../manifest.js';

const ACTOR = 'webid://anne';

/** A minimal, permissive CircleState — enough for the task-store cores. */
function buildCircle() {
  const itemStore = new ItemStore({
    dataSource:    new MemorySource(),
    rootContainer: 'mem://tasks/circles/fit/',
  });
  return { itemStore, liveCircle: Object.freeze({ circleId: 'fit', archived: false, paused: false }) };
}

/** LOCAL invoker: fresh Service → callSkill calls the core directly. */
function makeLocalInvoker() {
  const circle = buildCircle();
  const svc = createTasksService({ bundleResolver: singleCircleResolver(circle) });
  return (op, args = {}, ctx = {}) => svc.callSkill(op, args, { by: ACTOR, ...ctx });
}

/** WIRE invoker: fresh real agent with the wire skills; serialized invoke. */
async function makeWireInvoker() {
  const circle = buildCircle();
  const agent = await createAgent();
  for (const s of buildSkills({ bundleResolver: singleCircleResolver(circle) })) {
    agent.register(s.id, s.handler, { visibility: s.visibility });
  }
  return {
    invoke: async (op, args = {}) =>
      Parts.data(await agent.invoke(agent.address, op, Parts.wrap(args))),
    stop: () => agent.stop(),
  };
}

describeLocalWireFitness(
  {
    app:           'tasks-v0',
    coreIds:       Object.keys(TASK_CORES),
    registeredIds: buildSkills({ bundleResolver: singleCircleResolver(buildCircle()) }).map((s) => s.id),
    manifestOpIds: tasksManifest.operations.map((o) => o.id),
    makeLocalInvoker,
    makeWireInvoker,
    cases: [
      {
        name: 'addTask (create)',
        run:  (invoke) => invoke('addTask', { text: 'buy milk' }),
      },
      {
        name: 'listOpen (read, after two adds)',
        run:  async (invoke) => {
          await invoke('addTask', { text: 'alpha' });
          await invoke('addTask', { text: 'beta' });
          return invoke('listOpen', {});
        },
      },
      {
        name: 'claimTask (lifecycle, id chained from addTask)',
        run:  async (invoke) => {
          const { task } = await invoke('addTask', { text: 'gamma' });
          return invoke('claimTask', { id: task.id });
        },
      },
      {
        name: 'completeTask (lifecycle)',
        run:  async (invoke) => {
          const { task } = await invoke('addTask', { text: 'delta' });
          await invoke('claimTask', { id: task.id });
          return invoke('completeTask', { id: task.id });
        },
      },
    ],
  },
  { describe, it, expect },
);
