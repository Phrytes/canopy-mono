/**
 * §1b op→atom dispatch adapter for tasks-v0 (PLAN-capability-arc §1b · #65b).
 *
 * Proves `createTasksService().callCapability(atom, noun, args, ctx)` invokes a task op by its ATOM + NOUN
 * (the stable vocabulary) instead of the bespoke op-id — BESPOKE-OP-FIRST, over the REAL tasks skills, with no
 * change to any per-op logic. tasks-v0 isn't store-dissolved, so this rides the legacy DataPart/bundleResolver
 * path (crew construction mirrors v2_8-single-agent.test.js).
 */
import { describe, it, expect } from 'vitest';

import { ItemStore } from '@canopy/item-store';
import { MemberMap } from '@canopy/identity-resolver';
import { MemorySource, DataPart } from '@canopy/core';

import { createTasksService } from '../src/Service.js';
import { singleCrewResolver } from '../src/bundleResolver.js';
import { buildStandardRolePolicy } from '../src/rolePolicy.js';

const ANNE = 'webid://anne';
const BOB  = 'webid://bob';

function buildCrewState(crewId, roles) {
  const dataSource = new MemorySource();
  const itemStore = new ItemStore({
    dataSource,
    rootContainer: `mem://tasks/crews/${crewId}/`,
    rolePolicy:    buildStandardRolePolicy(roles),
    enforceDependencies: true,
  });
  let liveCrew = Object.freeze({
    crewId, name: crewId, kind: 'household',
    members: Object.keys(roles).map((webid) => ({ webid, role: roles[webid] })),
    customRoles: [],
  });
  return {
    get crewId() { return liveCrew.crewId; },
    get liveCrew() { return liveCrew; },
    crewMutator(patch) { liveCrew = Object.freeze({ ...liveCrew, ...patch }); },
    roles, itemStore, dataSource,
    members: new MemberMap({ initial: Object.keys(roles).map((webid) => ({ webid })) }),
    chatController: null, botAgentRegistry: null, metricsTracker: null,
    notifierChannels: null, onCalendarEmissionChange: null, onCompensationChange: null,
  };
}

const mk = () => {
  const crew = buildCrewState('crew-a', { [ANNE]: 'admin', [BOB]: 'member' });
  const svc = createTasksService({ bundleResolver: singleCrewResolver(crew) });
  return { crew, svc, ctx: { crewId: 'crew-a', by: ANNE } };
};

describe('tasks-v0 §1b callCapability (op→atom adapter)', () => {
  it('add·task routes THROUGH the bespoke addTask op and really stores', async () => {
    const { crew, svc, ctx } = mk();
    const r = await svc.callCapability('add', 'task', { text: 'buy milk' }, ctx);
    expect(r).toMatchObject({ ok: true, via: 'op', opId: 'addTask' });
    expect((await crew.itemStore.listOpen()).map((t) => t.text)).toContain('buy milk');
  });

  it('an alias atom canonicalises to the same op (create→add→addTask)', async () => {
    const { crew, svc, ctx } = mk();
    const r = await svc.callCapability('create', 'task', { text: 'sweep' }, ctx);
    expect(r).toMatchObject({ ok: true, via: 'op', opId: 'addTask' });
    expect((await crew.itemStore.listOpen()).map((t) => t.text)).toContain('sweep');
  });

  it('lifecycle atoms route to their bespoke ops (claim→claimTask, complete→completeTask)', async () => {
    const { crew, svc, ctx } = mk();
    await svc.callCapability('add', 'task', { text: 'mow lawn' }, ctx);
    const [task] = await crew.itemStore.listOpen();

    const claimed = await svc.callCapability('claim', 'task', { id: task.id }, ctx);
    expect(claimed).toMatchObject({ ok: true, via: 'op', opId: 'claimTask' });

    const done = await svc.callCapability('complete', 'task', { id: task.id }, ctx);
    expect(done).toMatchObject({ ok: true, via: 'op', opId: 'completeTask' });
    expect(await crew.itemStore.listOpen()).toEqual([]);   // completed → off the open list
  });

  it('an undeclared/unimplemented (atom×noun) is reported, never silently run', async () => {
    const { svc, ctx } = mk();
    expect(await svc.callCapability('archive', 'task', {}, ctx)).toMatchObject({ ok: false, code: 'unimplemented' });
    expect(await svc.callCapability('add', 'ghost', {}, ctx)).toMatchObject({ ok: false, code: 'unimplemented' });
  });

  it('backward-compat: callCapability(add·task) == the legacy handler invoked directly', async () => {
    // via the adapter
    const a = mk();
    const viaCap = await a.svc.callCapability('add', 'task', { text: 'parity' }, a.ctx);
    // via the raw skill handler (the legacy path), same crew shape
    const b = mk();
    const viaSkill = await b.svc.callSkill('addTask', { text: 'parity' }, b.ctx);
    expect(viaCap.result.task.text).toBe('parity');
    expect(viaSkill.task.text).toBe('parity');
    expect(viaCap.result.task.type).toBe(viaSkill.task.type);   // identical op behaviour
  });

  it('guards: unknown op on callSkill throws; bundleResolver is required', async () => {
    const { svc } = mk();
    await expect(svc.callSkill('nopeOp', {}, { crewId: 'crew-a', by: ANNE })).rejects.toThrow(/unknown op/);
    expect(() => createTasksService({})).toThrow(/bundleResolver/);
  });
});
