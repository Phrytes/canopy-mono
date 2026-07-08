/**
 * stoop — `local ≡ wire` equivalence + route-parity fitness test
 * (Workstream B, decision #5).
 *
 * Drives the shared, app-parameterized harness (`@canopy/sdk/testing`) with
 * stoop's cores + manifest + Service:
 *   • LOCAL route  — `createStoopService().callSkill(op, args, ctx)` calls the
 *                    pure `(scope, args, ctx)` core in `STOOP_CORES` DIRECTLY.
 *   • WIRE route   — the SAME cores, wrapped by `wireSkill` + registered as
 *                    `defineSkill`s (the `createStoopService().skills`), invoked
 *                    over the serialized `{parts:[DataPart], from, envelope}`
 *                    path on a real `@canopy/sdk` agent.
 *
 * The per-route caller identity differs by construction (LOCAL uses a fixed
 * webid; WIRE uses the agent's own key on a self-invoke) — the harness
 * normalizes those actor fields (plus ids / stamps / `_sync`) away.
 */
import { describe, it, expect } from 'vitest';

import { createAgent, Parts } from '@canopy/sdk';
// Harness lives at the SDK layer; imported by RELATIVE path to the worktree
// source (the pre-wired `node_modules/@canopy/sdk` symlink resolves to a
// sibling checkout that predates the `@canopy/sdk/testing` export).
import { describeLocalWireFitness } from '../../../packages/sdk/src/testing/localWireFitness.js';

import { createStoopService } from '../src/Service.js';
import { STOOP_CORES } from '../src/skills/index.js';
import { stoopManifest } from '../manifest.js';

const ACTOR = 'webid:alice';

/** LOCAL invoker: fresh Service → callSkill calls the core directly. */
function makeLocalInvoker() {
  const svc = createStoopService({ groupId: 'g1' });
  return (op, args = {}, ctx = {}) => svc.callSkill(op, args, { by: ACTOR, ...ctx });
}

/** WIRE invoker: fresh real agent registering the SAME buildSkills output; serialized invoke. */
async function makeWireInvoker() {
  const svc = createStoopService({ groupId: 'g1' });
  const agent = await createAgent();
  for (const s of svc.skills) {
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
    app:           'stoop',
    coreIds:       Object.keys(STOOP_CORES),
    registeredIds: createStoopService({ groupId: 'g1' }).skills.map((s) => s.id),
    manifestOpIds: stoopManifest.operations.map((o) => o.id),
    makeLocalInvoker,
    makeWireInvoker,
    cases: [
      {
        name: 'getGroupRules (read, no rules yet)',
        run:  (invoke) => invoke('getGroupRules', { groupId: 'g1' }),
      },
      {
        name: 'listGroupMembers (read, no member map)',
        run:  (invoke) => invoke('listGroupMembers', {}),
      },
      {
        name: 'listMyRequests (read, after a postRequest)',
        run:  async (invoke) => {
          await invoke('postRequest', { text: 'need a ladder', intent: 'ask' });
          return invoke('listMyRequests', {});
        },
        volatile: ['display'],   // author-hydration block carries per-route ids
      },
      {
        name: 'cancelRequest (mutate, id chained from postRequest)',
        run:  async (invoke) => {
          const posted = await invoke('postRequest', { text: 'borrow a tent', intent: 'ask' });
          return invoke('cancelRequest', { requestId: posted.requestId });
        },
      },
    ],
  },
  { describe, it, expect },
);
