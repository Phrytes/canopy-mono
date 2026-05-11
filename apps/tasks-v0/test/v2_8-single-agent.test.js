/**
 * V2.8 — single meshAgent + multi-crew via bundleResolver.
 *
 * Asserts the V2.8 contract:
 *   1. One `core.Agent` (process-level) serves N CrewStates.
 *   2. `multiCrewResolver` picks the right CrewState by `args.crewId`.
 *   3. Strict resolution — when neither `args.crewId` nor a topic
 *      envelope identifies a crew, skills return `{error: 'crewId required'}`.
 *   4. Cross-crew isolation — a call addressed to crew B never touches
 *      crew A's ItemStore.
 *
 * The test exercises the substrate composition end-to-end: builds
 * one meshAgent, two CrewStates, wires skills with `multiCrewResolver`,
 * and dispatches via the registered skill handlers.
 */

import { describe, it, expect } from 'vitest';

import { ItemStore } from '@canopy/item-store';
import { MemberMap } from '@canopy/identity-resolver';
import { MemorySource, DataPart } from '@canopy/core';

import { buildMeshAgent } from '../src/MeshAgent.js';
import { wireSkills } from '../src/wireSkills.js';
import { multiCrewResolver, singleCrewResolver } from '../src/bundleResolver.js';
import { buildStandardRolePolicy } from '../src/rolePolicy.js';

// ── Test fixtures ───────────────────────────────────────────────────────────

const ANNE  = 'webid://anne';
const BOB   = 'webid://bob';
const KID   = 'webid://kid';

const ROLES_A = { [ANNE]: 'admin', [BOB]: 'member' };
const ROLES_B = { [KID]: 'admin' };

function buildCrewState(crewId, members, roles) {
  const dataSource = new MemorySource();
  const itemStore = new ItemStore({
    dataSource,
    rootContainer: `mem://tasks/crews/${crewId}/`,
    rolePolicy:    buildStandardRolePolicy(roles),
    enforceDependencies: true,
  });
  let liveCrew = Object.freeze({
    crewId, name: crewId, kind: 'household',
    members: members.map((webid) => ({ webid, role: roles[webid] ?? 'member' })),
    customRoles: [],
  });
  return {
    get crewId() { return liveCrew.crewId; },
    get liveCrew() { return liveCrew; },
    crewMutator(patch) { liveCrew = Object.freeze({ ...liveCrew, ...patch }); },
    roles,
    itemStore,
    dataSource,
    members: new MemberMap({ initial: members.map((webid) => ({ webid })) }),
    chatController: null,
    botAgentRegistry: null,
    metricsTracker: null,
    notifierChannels: null,
    onCalendarEmissionChange: null,
    onCompensationChange: null,
  };
}

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

describe('V2.8 — single meshAgent, multi-crew via bundleResolver', () => {
  it('one meshAgent serves two CrewStates with isolated ItemStores', async () => {
    const { meshAgent } = await buildMeshAgent({ label: 'TestMesh' });

    const crewA = buildCrewState('crew-a', [ANNE, BOB], ROLES_A);
    const crewB = buildCrewState('crew-b', [KID], ROLES_B);

    const crews = new Map([
      ['crew-a', crewA],
      ['crew-b', crewB],
    ]);
    const allMembers = new MemberMap({
      initial: [{ webid: ANNE }, { webid: BOB }, { webid: KID }],
    });

    wireSkills({
      meshAgent,
      bundleResolver: multiCrewResolver(crews),
      crewsProvider:  () => crews.values(),
      members:        allMembers,
    });
    await meshAgent.start();

    // addTask with crewId='crew-a' lands in crewA's store.
    const r1 = await callSkill(meshAgent, 'addTask', { crewId: 'crew-a', text: 'A1' }, ANNE);
    expect(r1.task.text).toBe('A1');
    expect((await crewA.itemStore.listOpen()).length).toBe(1);
    expect((await crewB.itemStore.listOpen()).length).toBe(0);

    // addTask with crewId='crew-b' lands in crewB's store only.
    const r2 = await callSkill(meshAgent, 'addTask', { crewId: 'crew-b', text: 'B1' }, KID);
    expect(r2.task.text).toBe('B1');
    expect((await crewA.itemStore.listOpen()).length).toBe(1);
    expect((await crewB.itemStore.listOpen()).length).toBe(1);
  });

  it('strict resolution — call without crewId returns {error:"crewId required"}', async () => {
    const { meshAgent } = await buildMeshAgent({ label: 'TestMesh2' });
    const crewA = buildCrewState('crew-a', [ANNE], { [ANNE]: 'admin' });
    const crewB = buildCrewState('crew-b', [BOB],  { [BOB]: 'admin' });
    const crews = new Map([['crew-a', crewA], ['crew-b', crewB]]);
    const allMembers = new MemberMap({ initial: [{ webid: ANNE }, { webid: BOB }] });

    wireSkills({
      meshAgent,
      bundleResolver: multiCrewResolver(crews),
      crewsProvider:  () => crews.values(),
      members:        allMembers,
    });
    await meshAgent.start();

    // No crewId in args, no topic envelope → strict null → 'crewId required'.
    const r = await callSkill(meshAgent, 'addTask', { text: 'no-crew' }, ANNE);
    expect(r.error).toBe('crewId required');
  });

  it('mobile React-bindings _scope path resolves to the right crew', async () => {
    // Reproduces the Phase 41.18 follow-up bug:
    // `packages/sync-engine-rn/src/react/createReactBindings.js`
    // injects `_scope: activeBundle.groupId` into every skill call.
    // The multiCrewResolver must read `_scope` (in addition to
    // `args.crewId`) so mobile dispatches succeed without each
    // screen having to plumb crewId through manually.
    const { meshAgent } = await buildMeshAgent({ label: 'TestMeshScope' });
    const crewA = buildCrewState('crew-a', [ANNE], { [ANNE]: 'admin' });
    const crewB = buildCrewState('crew-b', [BOB],  { [BOB]: 'admin' });
    const crews = new Map([['crew-a', crewA], ['crew-b', crewB]]);
    const allMembers = new MemberMap({ initial: [{ webid: ANNE }, { webid: BOB }] });

    wireSkills({
      meshAgent,
      bundleResolver: multiCrewResolver(crews),
      crewsProvider:  () => crews.values(),
      members:        allMembers,
    });
    await meshAgent.start();

    // _scope alone is enough — no explicit crewId arg.
    const rA = await callSkill(meshAgent, 'addTask', { text: 'A-via-scope', _scope: 'crew-a' }, ANNE);
    expect(rA.task.text).toBe('A-via-scope');

    const rB = await callSkill(meshAgent, 'addTask', { text: 'B-via-scope', _scope: 'crew-b' }, BOB);
    expect(rB.task.text).toBe('B-via-scope');

    // Cross-crew check: tasks from crew-a stay in crew-a's listing.
    const listA = await callSkill(meshAgent, 'listOpen', { _scope: 'crew-a' }, ANNE);
    expect(listA.items.map((it) => it.text)).toContain('A-via-scope');
    expect(listA.items.map((it) => it.text)).not.toContain('B-via-scope');
  });

  it('explicit crewId wins over _scope when both are present', async () => {
    const { meshAgent } = await buildMeshAgent({ label: 'TestMeshScopeWin' });
    const crewA = buildCrewState('crew-a', [ANNE, BOB], { [ANNE]: 'admin', [BOB]: 'admin' });
    const crewB = buildCrewState('crew-b', [ANNE, BOB], { [ANNE]: 'admin', [BOB]: 'admin' });
    const crews = new Map([['crew-a', crewA], ['crew-b', crewB]]);
    const allMembers = new MemberMap({ initial: [{ webid: ANNE }, { webid: BOB }] });

    wireSkills({
      meshAgent,
      bundleResolver: multiCrewResolver(crews),
      crewsProvider:  () => crews.values(),
      members:        allMembers,
    });
    await meshAgent.start();

    // crewId='crew-b' + _scope='crew-a' → crewId wins; the task
    // lands in crew-b's store.
    const r = await callSkill(meshAgent, 'addTask', {
      text: 'override', crewId: 'crew-b', _scope: 'crew-a',
    }, ANNE);
    expect(r.task.text).toBe('override');

    const listA = await callSkill(meshAgent, 'listOpen', { _scope: 'crew-a' }, ANNE);
    const listB = await callSkill(meshAgent, 'listOpen', { _scope: 'crew-b' }, ANNE);
    expect(listA.items.map((it) => it.text)).not.toContain('override');
    expect(listB.items.map((it) => it.text)).toContain('override');
  });

  it('singleCrewResolver always returns its crew (back-compat for single-crew launches)', async () => {
    const { meshAgent } = await buildMeshAgent({ label: 'TestMeshSingle' });
    const crewA = buildCrewState('crew-a', [ANNE], { [ANNE]: 'admin' });
    const allMembers = new MemberMap({ initial: [{ webid: ANNE }] });

    wireSkills({
      meshAgent,
      bundleResolver: singleCrewResolver(crewA),
      members:        allMembers,
    });
    await meshAgent.start();

    // No crewId in args — single-crew resolver returns crewA anyway.
    const r = await callSkill(meshAgent, 'addTask', { text: 'no-arg-crew' }, ANNE);
    expect(r.task.text).toBe('no-arg-crew');
  });

  it('cross-crew isolation — role-restricted skill rejects when caller has no role in resolved crew', async () => {
    const { meshAgent } = await buildMeshAgent({ label: 'TestMeshIso' });
    const crewA = buildCrewState('crew-a', [ANNE], { [ANNE]: 'admin' });
    const crewB = buildCrewState('crew-b', [BOB],  { [BOB]: 'admin' });
    const crews = new Map([['crew-a', crewA], ['crew-b', crewB]]);
    const allMembers = new MemberMap({ initial: [{ webid: ANNE }, { webid: BOB }] });

    wireSkills({
      meshAgent,
      bundleResolver: multiCrewResolver(crews),
      crewsProvider:  () => crews.values(),
      members:        allMembers,
    });
    await meshAgent.start();

    // pauseCrew is admin/coord-only and looks up the role on
    // crew.roles. ANNE is admin in crew-a but NOT a member of crew-b
    // → calling pauseCrew with crewId='crew-b' from ANNE returns the
    // role-required error and crew-b stays unpaused.
    const r = await callSkill(meshAgent, 'pauseCrew', { crewId: 'crew-b' }, ANNE);
    expect(r.error).toMatch(/admin or coordinator required/i);
    expect(crewB.liveCrew.paused).toBeFalsy();
  });

  it('topic-envelope resolution — `<crewId>/...` envelope topic resolves the right crew', async () => {
    const { meshAgent } = await buildMeshAgent({ label: 'TestMeshTopic' });
    const crewA = buildCrewState('crew-a', [ANNE], { [ANNE]: 'admin' });
    const crewB = buildCrewState('crew-b', [BOB],  { [BOB]: 'admin' });
    const crews = new Map([['crew-a', crewA], ['crew-b', crewB]]);
    const allMembers = new MemberMap({ initial: [{ webid: ANNE }, { webid: BOB }] });

    wireSkills({
      meshAgent,
      bundleResolver: multiCrewResolver(crews),
      crewsProvider:  () => crews.values(),
      members:        allMembers,
    });
    await meshAgent.start();

    // No crewId in args, but envelope.topic='crew-b/something' → resolver
    // picks crew-b. Tested by hand-invoking the registered handler with
    // a synthesized envelope.
    const def = meshAgent.skills.get('addTask');
    const r = await def.handler({
      parts:    [DataPart({ text: 'B-via-topic' })],
      from:     BOB,
      agent:    meshAgent,
      envelope: { topic: 'crew-b/messages' },
    });
    expect(r.task.text).toBe('B-via-topic');
    expect((await crewB.itemStore.listOpen()).length).toBe(1);
    expect((await crewA.itemStore.listOpen()).length).toBe(0);
  });
});
