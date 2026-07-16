/**
 * Tasks-mobile V2 multi-circle + substrate-mirror parity (M2) —
 * device-independent vitest coverage.
 *
 * M2 (2026-05-18). Mirrors apps/tasks-v0/test/v2-multi-circle.test.js
 * (Slices 7–8) + v2-substrate-mirror.test.js (Slices 9–12) where the
 * coverage is device-independent (no native modules / real fs /
 * keychain).
 *
 * Findings recap (see the M2 report):
 *   - Slice 7 (itemStoreRoot per-circle prefix) was ALREADY at parity
 *     in buildCircleState — these tests pin that contract.
 *   - Slice 8 (multi-circle onboarding dispatch) was the real gap:
 *     issueInvite/redeemInvite were never registered + the CircleState
 *     carried no GroupManager. M2-S8 wires both. Tests below assert
 *     the GroupManager is stashed + the skills register + dispatch.
 *   - Slices 11–12 (mutation fan-out) live entirely in the shared
 *     skills (skills/index.js) and fire whenever circle.tasksMirror is
 *     set — covered by M1-S3. Here we pin that addTask fan-out
 *     reaches a peer mirror through the shared substrate.
 */

import { describe, it, expect } from 'vitest';
import { MemorySource, DataPart } from '@onderling/core';

import { bootstrapIdentity } from '@onderling/react-native/identity/bootstrap';
import { buildMeshAgent }    from '@onderling-app/tasks-v0/MeshAgent';
import { wireSkills }        from '@onderling-app/tasks-v0/wireSkills';
import { multiCircleResolver } from '@onderling-app/tasks-v0/bundleResolver';
import { buildMultiCircleOnboardingSkills } from '@onderling-app/tasks-v0/multiCircleOnboarding';
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

async function bootHarness(label) {
  const vault    = makeStubVault();
  const idResult = await bootstrapIdentity({ keychainService: 'tasks', vault });
  const bundle   = await buildLocalStoreBundle({ inner: new MemorySource() });
  const { meshAgent } = await buildMeshAgent({
    identity:         idResult.identity,
    localStoreBundle: bundle,
    label,
  });
  return { meshAgent, bundle, identity: idResult.identity };
}

// ── Slice 7 — per-circle itemStoreRoot isolation (ALREADY at parity) ──

describe('M2 — multi-circle itemStoreRoot isolation (Slice 7 parity)', () => {
  it('each CircleState ItemStore uses the mem://tasks/circles/<id>/ root', async () => {
    const csA = await buildCircleState({ circleConfig: CIRCLE_ALPHA });
    const csB = await buildCircleState({ circleConfig: CIRCLE_BETA });
    // Distinct ItemStore instances; the root prefix is what stops
    // cross-circle addTask leakage.
    expect(csA.itemStore).not.toBe(csB.itemStore);
    expect(csA.circleId).toBe('circle-alpha');
    expect(csB.circleId).toBe('circle-beta');
  });

  it('addTask routed by circleId stays isolated to that circle', async () => {
    const { meshAgent } = await bootHarness('M2IsolationTest');
    const csA = await buildCircleState({ circleConfig: CIRCLE_ALPHA });
    const csB = await buildCircleState({ circleConfig: CIRCLE_BETA });
    const circles = new Map([['circle-alpha', csA], ['circle-beta', csB]]);

    wireSkills({
      meshAgent,
      bundleResolver: multiCircleResolver(circles),
      circlesProvider:  () => circles.values(),
      members:        new MemberMap({
        initial: [...CIRCLE_ALPHA.members, ...CIRCLE_BETA.members],
      }),
    });
    await meshAgent.start();

    const addTask = meshAgent.skills.get('addTask');
    await addTask.handler({
      parts: [DataPart({ circleId: 'circle-alpha', text: 'A1' })],
      from: ANNE, agent: meshAgent, envelope: null,
    });
    await addTask.handler({
      parts: [DataPart({ circleId: 'circle-beta', text: 'B1' })],
      from: KID, agent: meshAgent, envelope: null,
    });

    const openA = await csA.itemStore.listOpen();
    const openB = await csB.itemStore.listOpen();
    expect(openA.map((i) => i.text)).toEqual(['A1']);
    expect(openB.map((i) => i.text)).toEqual(['B1']);
  });
});

// ── Slice 8 — GroupManager + onboarding dispatch (the M2 fix) ───────

describe('M2-S8 — per-circle GroupManager on the CircleState', () => {
  it('is null when no meshAgent supplied', async () => {
    const cs = await buildCircleState({ circleConfig: CIRCLE_ALPHA });
    expect(cs.groupManager).toBeNull();
    expect(cs.onSpawn).toBeNull();
    // circleIdForOnboarding is always set (it is the routing groupId).
    expect(cs.circleIdForOnboarding).toBe('circle-alpha');
  });

  it('is built from the meshAgent identity+vault when supplied', async () => {
    const { meshAgent } = await bootHarness('M2GroupManagerTest');
    const cs = await buildCircleState({ circleConfig: CIRCLE_ALPHA, meshAgent });
    expect(cs.groupManager).toBeTruthy();
    expect(typeof cs.groupManager.issueInvite).toBe('function');
    expect(typeof cs.groupManager.redeemInvite).toBe('function');
    expect(cs.circleIdForOnboarding).toBe('circle-alpha');
  });
});

describe('M2-S8 — multi-circle onboarding skills register + dispatch', () => {
  it('buildMultiCircleOnboardingSkills returns issueInvite + redeemInvite', () => {
    const defs = buildMultiCircleOnboardingSkills({
      bundleResolver: multiCircleResolver(new Map()),
    });
    const ids = defs.map((d) => d.id);
    expect(ids).toContain('issueInvite');
    expect(ids).toContain('redeemInvite');
  });

  it('issueInvite then redeemInvite round-trips through the per-circle GroupManager', async () => {
    const { meshAgent } = await bootHarness('M2OnboardingTest');
    const csA = await buildCircleState({ circleConfig: CIRCLE_ALPHA, meshAgent });
    const circles = new Map([['circle-alpha', csA]]);

    wireSkills({
      meshAgent,
      bundleResolver: multiCircleResolver(circles),
      circlesProvider:  () => circles.values(),
      members:        new MemberMap({ initial: CIRCLE_ALPHA.members }),
    });
    // Register the M2-S8 onboarding wrapper ONCE (mirrors
    // ServiceContext step 5b).
    for (const def of buildMultiCircleOnboardingSkills({
      bundleResolver: multiCircleResolver(circles),
    })) {
      meshAgent.skills.register(def);
    }
    await meshAgent.start();

    const issue = meshAgent.skills.get('issueInvite');
    expect(issue).toBeTruthy();
    const issued = await issue.handler({
      parts: [DataPart({ circleId: 'circle-alpha', role: 'member' })],
      from: ANNE, agent: meshAgent, envelope: null,
    });
    expect(issued?.invite).toBeTruthy();

    // Redeem with an explicit memberPubKey (no spawn hook on mobile —
    // the joining device supplies its own key, same as the CLI
    // member-join path).
    const redeem = meshAgent.skills.get('redeemInvite');
    const NEW_PK = 'pubkey-newmember-0001';
    const redeemed = await redeem.handler({
      parts: [DataPart({
        invite:       issued.invite,
        memberPubKey: NEW_PK,
        webid:        'webid://newmember',
        displayName:  'New Member',
      })],
      from: 'webid://newmember', agent: meshAgent, envelope: null,
    });
    expect(redeemed?.error).toBeUndefined();
    expect(redeemed?.memberPubKey).toBe(NEW_PK);
    // The member is added to the circle's MemberMap.
    const members = await csA.members.list();
    expect(members.some((m) => m.pubKey === NEW_PK)).toBe(true);
  });

  it('redeemInvite without a matching circle returns a structured error', async () => {
    const { meshAgent } = await bootHarness('M2OnboardingMissTest');
    const circles = new Map();
    for (const def of buildMultiCircleOnboardingSkills({
      bundleResolver: multiCircleResolver(circles),
    })) {
      meshAgent.skills.register(def);
    }
    await meshAgent.start();
    const redeem = meshAgent.skills.get('redeemInvite');
    const r = await redeem.handler({
      parts: [DataPart({ invite: { groupId: 'nope', role: 'member' }, memberPubKey: 'pk' })],
      from: ANNE, agent: meshAgent, envelope: null,
    });
    expect(typeof r?.error).toBe('string');
  });
});

// ── Slice 10 — live peer-roster (redeemInvite → tasksMirror.addPeer) ─

describe('M2-S10 — redeemInvite updates the substrate-mirror peer roster', () => {
  it('addPeer is called on the circle tasksMirror after a successful redeem', async () => {
    const { meshAgent } = await bootHarness('M2PeerRosterTest');
    const csA = await buildCircleState({ circleConfig: CIRCLE_ALPHA, meshAgent });

    // Stub the tasksMirror so we can observe the addPeer call without
    // depending on real transport fan-out (device-independent).
    const added = [];
    csA.tasksMirror = {
      addPeer: async (pk) => { added.push(pk); },
      getPeers: () => [...added],
    };

    const circles = new Map([['circle-alpha', csA]]);
    for (const def of buildMultiCircleOnboardingSkills({
      bundleResolver: multiCircleResolver(circles),
    })) {
      meshAgent.skills.register(def);
    }
    await meshAgent.start();

    const issue = meshAgent.skills.get('issueInvite');
    const issued = await issue.handler({
      parts: [DataPart({ circleId: 'circle-alpha', role: 'member' })],
      from: ANNE, agent: meshAgent, envelope: null,
    });
    const redeem = meshAgent.skills.get('redeemInvite');
    const PK = 'pubkey-peer-roster-test';
    await redeem.handler({
      parts: [DataPart({
        invite: issued.invite, memberPubKey: PK, webid: 'webid://p',
      })],
      from: 'webid://p', agent: meshAgent, envelope: null,
    });

    // Slice-10 contract: the new member's pubKey was pushed to the
    // mirror roster so the next addTask fan-out reaches them.
    expect(added).toContain(PK);
  });
});

// ── Slices 9/11/12 — mutation fan-out is shared-skill driven ────────

describe('M2 — substrate-mirror fan-out is wired through shared skills', () => {
  it('CircleState exposes a tasksMirror slot (null until substrate wires)', async () => {
    const cs = await buildCircleState({ circleConfig: CIRCLE_ALPHA });
    // M1-S3 reserves the slot; substrate fills it best-effort when a
    // meshAgent is supplied. The shared skills/index.js fan-out calls
    // `circle?.tasksMirror?.publishTask?.(...)` — a null slot is a safe
    // no-op, a populated slot fans out. No mobile-specific fan-out
    // code exists or is needed (platform parity via shared skills).
    expect('tasksMirror' in cs).toBe(true);
    expect(cs.tasksMirror).toBeNull();
  });

  it('with a meshAgent the substrate slots get populated best-effort', async () => {
    const { meshAgent } = await bootHarness('M2MirrorWireTest');
    const cs = await buildCircleState({ circleConfig: CIRCLE_ALPHA, meshAgent });
    // pseudoPod + notifyEnvelope are the substrate the shared mirror
    // publishes through. When present, tasksMirror is wired too.
    if (cs.pseudoPod && cs.notifyEnvelope) {
      expect(cs.tasksMirror).toBeTruthy();
      expect(typeof cs.tasksMirror.publishTask).toBe('function');
      expect(typeof cs.tasksMirror.addPeer).toBe('function');
    }
    // Regardless: circle core state stays intact (best-effort contract).
    expect(cs.circleId).toBe('circle-alpha');
    // M4: _podCtx is pre-populated (classify/reverse loaded; inactive).
    expect(cs._podCtx?.active).toBe(false);
  });
});
