/**
 * single meshAgent + multi-circle via bundleResolver.
 *
 * Asserts the contract:
 *   1. One `core.Agent` (process-level) serves N CircleStates.
 *   2. `multiCircleResolver` picks the right CircleState by `args.circleId`.
 *   3. Strict resolution — when neither `args.circleId` nor a topic
 *      envelope identifies a circle, skills return `{error: 'circleId required'}`.
 *   4. Cross-circle isolation — a call addressed to circle B never touches
 *      circle A's ItemStore.
 *
 * The test exercises the substrate composition end-to-end: builds
 * one meshAgent, two CircleStates, wires skills with `multiCircleResolver`,
 * and dispatches via the registered skill handlers.
 */

import { describe, it, expect } from 'vitest';

import { ItemStore } from '@onderling/item-store';
import { MemberMap } from '@onderling/identity-resolver';
import { MemorySource, DataPart } from '@onderling/core';

import { buildMeshAgent } from '../src/MeshAgent.js';
import { wireSkills } from '../src/wireSkills.js';
import { multiCircleResolver, singleCircleResolver } from '../src/bundleResolver.js';
import { buildStandardRolePolicy } from '../src/rolePolicy.js';

// ── Test fixtures ───────────────────────────────────────────────────────────

const ANNE  = 'webid://anne';
const BOB   = 'webid://bob';
const KID   = 'webid://kid';

const ROLES_A = { [ANNE]: 'admin', [BOB]: 'member' };
const ROLES_B = { [KID]: 'admin' };

function buildCircleState(circleId, members, roles) {
  const dataSource = new MemorySource();
  const itemStore = new ItemStore({
    dataSource,
    rootContainer: `mem://tasks/circles/${circleId}/`,
    rolePolicy:    buildStandardRolePolicy(roles),
    enforceDependencies: true,
  });
  let liveCircle = Object.freeze({
    circleId, name: circleId, kind: 'household',
    members: members.map((webid) => ({ webid, role: roles[webid] ?? 'member' })),
    customRoles: [],
  });
  return {
    get circleId() { return liveCircle.circleId; },
    get liveCircle() { return liveCircle; },
    circleMutator(patch) { liveCircle = Object.freeze({ ...liveCircle, ...patch }); },
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

describe('V2.8 — single meshAgent, multi-circle via bundleResolver', () => {
  it('one meshAgent serves two CircleStates with isolated ItemStores', async () => {
    const { meshAgent } = await buildMeshAgent({ label: 'TestMesh' });

    const circleA = buildCircleState('circle-a', [ANNE, BOB], ROLES_A);
    const circleB = buildCircleState('circle-b', [KID], ROLES_B);

    const circles = new Map([
      ['circle-a', circleA],
      ['circle-b', circleB],
    ]);
    const allMembers = new MemberMap({
      initial: [{ webid: ANNE }, { webid: BOB }, { webid: KID }],
    });

    wireSkills({
      meshAgent,
      bundleResolver: multiCircleResolver(circles),
      circlesProvider:  () => circles.values(),
      members:        allMembers,
    });
    await meshAgent.start();

    // addTask with circleId='circle-a' lands in circleA's store.
    const r1 = await callSkill(meshAgent, 'addTask', { circleId: 'circle-a', text: 'A1' }, ANNE);
    expect(r1.task.text).toBe('A1');
    expect((await circleA.itemStore.listOpen()).length).toBe(1);
    expect((await circleB.itemStore.listOpen()).length).toBe(0);

    // addTask with circleId='circle-b' lands in circleB's store only.
    const r2 = await callSkill(meshAgent, 'addTask', { circleId: 'circle-b', text: 'B1' }, KID);
    expect(r2.task.text).toBe('B1');
    expect((await circleA.itemStore.listOpen()).length).toBe(1);
    expect((await circleB.itemStore.listOpen()).length).toBe(1);
  });

  it('strict resolution — call without circleId returns {error:"circleId required"}', async () => {
    const { meshAgent } = await buildMeshAgent({ label: 'TestMesh2' });
    const circleA = buildCircleState('circle-a', [ANNE], { [ANNE]: 'admin' });
    const circleB = buildCircleState('circle-b', [BOB],  { [BOB]: 'admin' });
    const circles = new Map([['circle-a', circleA], ['circle-b', circleB]]);
    const allMembers = new MemberMap({ initial: [{ webid: ANNE }, { webid: BOB }] });

    wireSkills({
      meshAgent,
      bundleResolver: multiCircleResolver(circles),
      circlesProvider:  () => circles.values(),
      members:        allMembers,
    });
    await meshAgent.start();

    // No circleId in args, no topic envelope → strict null → 'circleId required'.
    const r = await callSkill(meshAgent, 'addTask', { text: 'no-circle' }, ANNE);
    expect(r.error).toBe('circleId required');
  });

  it('mobile React-bindings _scope path resolves to the right circle', async () => {
    // Reproduces the Phase 41.18 follow-up bug:
    // `packages/sync-engine-rn/src/react/createReactBindings.js`
    // injects `_scope: activeBundle.groupId` into every skill call.
    // The multiCircleResolver must read `_scope` (in addition to
    // `args.circleId`) so mobile dispatches succeed without each
    // screen having to plumb circleId through manually.
    const { meshAgent } = await buildMeshAgent({ label: 'TestMeshScope' });
    const circleA = buildCircleState('circle-a', [ANNE], { [ANNE]: 'admin' });
    const circleB = buildCircleState('circle-b', [BOB],  { [BOB]: 'admin' });
    const circles = new Map([['circle-a', circleA], ['circle-b', circleB]]);
    const allMembers = new MemberMap({ initial: [{ webid: ANNE }, { webid: BOB }] });

    wireSkills({
      meshAgent,
      bundleResolver: multiCircleResolver(circles),
      circlesProvider:  () => circles.values(),
      members:        allMembers,
    });
    await meshAgent.start();

    // _scope alone is enough — no explicit circleId arg.
    const rA = await callSkill(meshAgent, 'addTask', { text: 'A-via-scope', _scope: 'circle-a' }, ANNE);
    expect(rA.task.text).toBe('A-via-scope');

    const rB = await callSkill(meshAgent, 'addTask', { text: 'B-via-scope', _scope: 'circle-b' }, BOB);
    expect(rB.task.text).toBe('B-via-scope');

    // Cross-circle check: tasks from circle-a stay in circle-a's listing.
    const listA = await callSkill(meshAgent, 'listOpen', { _scope: 'circle-a' }, ANNE);
    expect(listA.items.map((it) => it.text)).toContain('A-via-scope');
    expect(listA.items.map((it) => it.text)).not.toContain('B-via-scope');
  });

  it('explicit circleId wins over _scope when both are present', async () => {
    const { meshAgent } = await buildMeshAgent({ label: 'TestMeshScopeWin' });
    const circleA = buildCircleState('circle-a', [ANNE, BOB], { [ANNE]: 'admin', [BOB]: 'admin' });
    const circleB = buildCircleState('circle-b', [ANNE, BOB], { [ANNE]: 'admin', [BOB]: 'admin' });
    const circles = new Map([['circle-a', circleA], ['circle-b', circleB]]);
    const allMembers = new MemberMap({ initial: [{ webid: ANNE }, { webid: BOB }] });

    wireSkills({
      meshAgent,
      bundleResolver: multiCircleResolver(circles),
      circlesProvider:  () => circles.values(),
      members:        allMembers,
    });
    await meshAgent.start();

    // circleId='circle-b' + _scope='circle-a' → circleId wins; the task
    // lands in circle-b's store.
    const r = await callSkill(meshAgent, 'addTask', {
      text: 'override', circleId: 'circle-b', _scope: 'circle-a',
    }, ANNE);
    expect(r.task.text).toBe('override');

    const listA = await callSkill(meshAgent, 'listOpen', { _scope: 'circle-a' }, ANNE);
    const listB = await callSkill(meshAgent, 'listOpen', { _scope: 'circle-b' }, ANNE);
    expect(listA.items.map((it) => it.text)).not.toContain('override');
    expect(listB.items.map((it) => it.text)).toContain('override');
  });

  it('singleCircleResolver always returns its circle (back-compat for single-circle launches)', async () => {
    const { meshAgent } = await buildMeshAgent({ label: 'TestMeshSingle' });
    const circleA = buildCircleState('circle-a', [ANNE], { [ANNE]: 'admin' });
    const allMembers = new MemberMap({ initial: [{ webid: ANNE }] });

    wireSkills({
      meshAgent,
      bundleResolver: singleCircleResolver(circleA),
      members:        allMembers,
    });
    await meshAgent.start();

    // No circleId in args — single-circle resolver returns circleA anyway.
    const r = await callSkill(meshAgent, 'addTask', { text: 'no-arg-circle' }, ANNE);
    expect(r.task.text).toBe('no-arg-circle');
  });

  it('cross-circle isolation — role-restricted skill rejects when caller has no role in resolved circle', async () => {
    const { meshAgent } = await buildMeshAgent({ label: 'TestMeshIso' });
    const circleA = buildCircleState('circle-a', [ANNE], { [ANNE]: 'admin' });
    const circleB = buildCircleState('circle-b', [BOB],  { [BOB]: 'admin' });
    const circles = new Map([['circle-a', circleA], ['circle-b', circleB]]);
    const allMembers = new MemberMap({ initial: [{ webid: ANNE }, { webid: BOB }] });

    wireSkills({
      meshAgent,
      bundleResolver: multiCircleResolver(circles),
      circlesProvider:  () => circles.values(),
      members:        allMembers,
    });
    await meshAgent.start();

    // pauseCircle is admin/coord-only and looks up the role on
    // circle.roles. ANNE is admin in circle-a but NOT a member of circle-b
    // → calling pauseCircle with circleId='circle-b' from ANNE returns the
    // role-required error and circle-b stays unpaused.
    const r = await callSkill(meshAgent, 'pauseCircle', { circleId: 'circle-b' }, ANNE);
    expect(r.error).toMatch(/admin or coordinator required/i);
    expect(circleB.liveCircle.paused).toBeFalsy();
  });

  it('topic-envelope resolution — `<circleId>/...` envelope topic resolves the right circle', async () => {
    const { meshAgent } = await buildMeshAgent({ label: 'TestMeshTopic' });
    const circleA = buildCircleState('circle-a', [ANNE], { [ANNE]: 'admin' });
    const circleB = buildCircleState('circle-b', [BOB],  { [BOB]: 'admin' });
    const circles = new Map([['circle-a', circleA], ['circle-b', circleB]]);
    const allMembers = new MemberMap({ initial: [{ webid: ANNE }, { webid: BOB }] });

    wireSkills({
      meshAgent,
      bundleResolver: multiCircleResolver(circles),
      circlesProvider:  () => circles.values(),
      members:        allMembers,
    });
    await meshAgent.start();

    // No circleId in args, but envelope.topic='circle-b/something' → resolver
    // picks circle-b. Tested by hand-invoking the registered handler with
    // a synthesized envelope.
    const def = meshAgent.skills.get('addTask');
    const r = await def.handler({
      parts:    [DataPart({ text: 'B-via-topic' })],
      from:     BOB,
      agent:    meshAgent,
      envelope: { topic: 'circle-b/messages' },
    });
    expect(r.task.text).toBe('B-via-topic');
    expect((await circleB.itemStore.listOpen()).length).toBe(1);
    expect((await circleA.itemStore.listOpen()).length).toBe(0);
  });
});
