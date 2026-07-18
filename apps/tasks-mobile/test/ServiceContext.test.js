/**
 * ServiceContext primitives — exercises the boot pipeline without
 * actually rendering the React tree. Mirrors the
 * apps/stoop-mobile/test/bootstrapBundle.test.js pattern + the
 * apps/tasks-v0/test/v2_8-single-agent.test.js pattern.
 *
 * Phase 41.2.7 (2026-05-09).
 *
 * The ServiceContext provider chains these primitives:
 *   1. bootstrapIdentity (substrate Phase 41.0.b A3)
 *   2. buildLocalStoreBundle (mobile-local helper)
 *   3. buildMeshAgent (V2.8 — apps/tasks-v0/src/MeshAgent.js)
 *   4. buildCircleState per joined circle (mobile-local helper)
 *   5. wireSkills(meshAgent, multiCircleResolver(circles))
 *
 * Verifying the chain end-to-end here gives us strong confidence that
 * the React-state wiring on top is just glue. (RN-side rendering is
 * verified by Phase 41.16's real-device pass.)
 */

import { describe, it, expect } from 'vitest';
import { MemorySource, DataPart } from '@onderling/core';

import { bootstrapIdentity } from '@onderling/react-native/identity/bootstrap';
import { buildMeshAgent }    from '@onderling-app/tasks/MeshAgent';
import { wireSkills }        from '@onderling-app/tasks/wireSkills';
import { multiCircleResolver } from '@onderling-app/tasks/bundleResolver';
import { MemberMap }         from '@onderling/identity-resolver';

import { buildLocalStoreBundle } from '../src/lib/buildLocalStoreBundle.js';
import { buildCircleState }        from '../src/lib/buildCircleState.js';

const ANNE = 'webid://anne';
const BOB  = 'webid://bob';
const KID  = 'webid://kid';

const CIRCLE_ALPHA = {
  circleId: 'circle-alpha',
  name:   'Alpha',
  kind:   'household',
  members: [
    { webid: ANNE, displayName: 'Anne', role: 'admin' },
    { webid: BOB,  displayName: 'Bob',  role: 'member' },
  ],
};

const CIRCLE_BETA = {
  circleId: 'circle-beta',
  name:   'Beta',
  kind:   'project',
  members: [
    { webid: KID, displayName: 'Kid', role: 'admin' },
  ],
};

function makeStubVault() {
  const store = new Map();
  return {
    get:    async (k) => store.get(k) ?? null,
    set:    async (k, v) => { store.set(k, v); },
    delete: async (k) => { store.delete(k); },
    has:    async (k) => store.has(k),
    _store: store,
  };
}

describe('bootstrapIdentity (substrate, exercised through ServiceContext\'s call shape)', () => {
  it('generates a fresh identity on first call', async () => {
    const vault = makeStubVault();
    const r = await bootstrapIdentity({ keychainService: 'tasks', vault });
    expect(r.isFresh).toBe(true);
    expect(typeof r.identity.pubKey).toBe('string');
    expect(r.identity.pubKey.length).toBeGreaterThan(0);
  });

  it('returns the same identity on the second call', async () => {
    const vault = makeStubVault();
    const a = await bootstrapIdentity({ keychainService: 'tasks', vault });
    const b = await bootstrapIdentity({ keychainService: 'tasks', vault });
    expect(b.isFresh).toBe(false);
    expect(b.identity.pubKey).toBe(a.identity.pubKey);
  });
});

describe('buildLocalStoreBundle', () => {
  it('returns the bundle shape buildMeshAgent expects', async () => {
    const inner = new MemorySource();
    const bundle = await buildLocalStoreBundle({ inner });
    expect(typeof bundle.cache.read).toBe('function');
    expect(typeof bundle.cache.write).toBe('function');
    expect(bundle.cadence).toBeNull();
    expect(typeof bundle.attachInner).toBe('function');
    expect(typeof bundle.detachInner).toBe('function');
  });
});

describe('buildCircleState', () => {
  it('produces the V2.8 CircleState shape', async () => {
    const cs = await buildCircleState({ circleConfig: CIRCLE_ALPHA });
    expect(cs.circleId).toBe('circle-alpha');
    expect(cs.liveCircle.kind).toBe('household');
    expect(cs.roles).toEqual({ [ANNE]: 'admin', [BOB]: 'member' });
    expect(cs.itemStore).toBeTruthy();
    expect(cs.members).toBeTruthy();
    expect(cs.dataSource).toBeTruthy();
    // V1+ enrichment slots reserved as null:
    expect(cs.chatController).toBeNull();
    expect(cs.botAgentRegistry).toBeNull();
    expect(cs.metricsTracker).toBeNull();
  });

  it('circleMutator updates liveCircle immutably', async () => {
    const cs = await buildCircleState({ circleConfig: CIRCLE_ALPHA });
    const before = cs.liveCircle;
    cs.circleMutator({ paused: true });
    expect(cs.liveCircle.paused).toBe(true);
    // Old reference is unchanged (frozen-copy pattern).
    expect(before.paused).toBeUndefined();
    expect(Object.isFrozen(cs.liveCircle)).toBe(true);
  });

  it('honours the kind\'s default subtasksAdminApprovalDepth', async () => {
    const cs = await buildCircleState({ circleConfig: { ...CIRCLE_ALPHA, subtasksAdminApprovalDepth: undefined, kind: 'project' } });
    expect(cs.liveCircle.subtasksAdminApprovalDepth).toBe(4); // project default
  });
});

describe('end-to-end — meshAgent + multi-circle dispatch', () => {
  it('one meshAgent serves N circles; addTask via the registered handler routes to the right ItemStore', async () => {
    const vault = makeStubVault();
    const idResult = await bootstrapIdentity({ keychainService: 'tasks', vault });
    const bundle = await buildLocalStoreBundle({ inner: new MemorySource() });
    const { meshAgent } = await buildMeshAgent({
      identity:         idResult.identity,
      localStoreBundle: bundle,
      label:            'TasksMobileTest',
    });

    const csA = await buildCircleState({ circleConfig: CIRCLE_ALPHA });
    const csB = await buildCircleState({ circleConfig: CIRCLE_BETA });
    const circles = new Map([
      ['circle-alpha', csA],
      ['circle-beta',  csB],
    ]);

    const allMembers = new MemberMap({
      initial: [...CIRCLE_ALPHA.members, ...CIRCLE_BETA.members],
    });

    wireSkills({
      meshAgent,
      bundleResolver: multiCircleResolver(circles),
      circlesProvider:  () => circles.values(),
      members:        allMembers,
    });
    await meshAgent.start();

    const addTask = meshAgent.skills.get('addTask');
    expect(addTask).toBeTruthy();

    // Add a task to circle-alpha via circleId arg.
    const r1 = await addTask.handler({
      parts:    [DataPart({ circleId: 'circle-alpha', text: 'A1' })],
      from:     ANNE,
      agent:    meshAgent,
      envelope: null,
    });
    expect(r1?.task?.text).toBe('A1');

    // Add to circle-beta. KID is admin there.
    const r2 = await addTask.handler({
      parts:    [DataPart({ circleId: 'circle-beta', text: 'B1' })],
      from:     KID,
      agent:    meshAgent,
      envelope: null,
    });
    expect(r2?.task?.text).toBe('B1');

    // Isolation — each ItemStore holds only its own task.
    const openA = await csA.itemStore.listOpen();
    const openB = await csB.itemStore.listOpen();
    expect(openA.map((i) => i.text)).toEqual(['A1']);
    expect(openB.map((i) => i.text)).toEqual(['B1']);
  });
});

describe('end-to-end — joinCircle flow (re-reading the live circles Map)', () => {
  it('a circle added after wireSkills is reachable by the resolver', async () => {
    const vault = makeStubVault();
    const idResult = await bootstrapIdentity({ keychainService: 'tasks', vault });
    const bundle = await buildLocalStoreBundle({ inner: new MemorySource() });
    const { meshAgent } = await buildMeshAgent({
      identity:         idResult.identity,
      localStoreBundle: bundle,
      label:            'TasksMobileJoinTest',
    });

    const circles = new Map();
    wireSkills({
      meshAgent,
      bundleResolver: multiCircleResolver(circles),
      circlesProvider:  () => circles.values(),
      members:        new MemberMap({ initial: [] }),
    });
    await meshAgent.start();

    // Initially no circles — addTask without circleId returns the strict-null error.
    const addTask = meshAgent.skills.get('addTask');
    const noCircle = await addTask.handler({
      parts:    [DataPart({ text: 'X' })],
      from:     ANNE,
      agent:    meshAgent,
      envelope: null,
    });
    expect(noCircle?.error).toBe('circleId required');

    // Now "join" — mutate the live Map (this is what ServiceContext's
    // joinCircle does behind the scenes; resolver picks it up on next dispatch).
    const csA = await buildCircleState({ circleConfig: CIRCLE_ALPHA });
    circles.set('circle-alpha', csA);

    const r = await addTask.handler({
      parts:    [DataPart({ circleId: 'circle-alpha', text: 'A1' })],
      from:     ANNE,
      agent:    meshAgent,
      envelope: null,
    });
    expect(r?.task?.text).toBe('A1');
  });
});
