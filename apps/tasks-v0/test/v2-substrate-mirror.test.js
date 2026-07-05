/**
 * Tasks V2 Phase 52.9.3 — substrate-mirror fan-out.
 *
 * Verifies the addTask cross-device fan-out path:
 *   1. Two crew bundles on separate agents (Anne + Bob), peered to
 *      each other on a shared InternalBus.
 *   2. Anne calls addTask; the task lands in Anne's itemStore.
 *   3. The notifyEnvelope publish reaches Bob's bundle; Bob's
 *      substrate-mirror handles the inbound 'task' envelope and
 *      writes the task into Bob's itemStore.
 *   4. Bob's listOpen sees the task with `source.synced: true`.
 *   5. URI-prefix filter: a task envelope from a DIFFERENT crewId is
 *      silently dropped on the receive side.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@canopy/core';
import { VaultMemory } from '@canopy/vault';
import { createCrewAgent } from '../src/Crew.js';
import { buildBundle } from '../src/storage/buildBundle.js';

const ANNE = 'https://id.example/anne';
const BOB  = 'https://id.example/bob';

const CREW_CONFIG = {
  crewId:  'fan-out-crew',
  name:    'Fan-out Test Crew',
  kind:    'project',
  members: [
    { webid: ANNE, displayName: 'Anne', role: 'admin'  },
    { webid: BOB,  displayName: 'Bob',  role: 'member' },
  ],
};

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

async function buildPeeredBundles() {
  // Shared bus so the two InternalTransports can reach each other.
  const bus  = new InternalBus();
  const lsA  = buildBundle();
  const lsB  = buildBundle();

  const idA = await AgentIdentity.generate(new VaultMemory());
  const idB = await AgentIdentity.generate(new VaultMemory());
  const txA = new InternalTransport(bus, idA.pubKey);
  const txB = new InternalTransport(bus, idB.pubKey);

  const anneBundle = await createCrewAgent({
    crewConfig:       CREW_CONFIG,
    localStoreBundle: lsA,
    identity:         idA,
    transport:        txA,
    label:            'Anne',
  });
  const bobBundle = await createCrewAgent({
    crewConfig:       CREW_CONFIG,
    localStoreBundle: lsB,
    identity:         idB,
    transport:        txB,
    label:            'Bob',
  });

  // Cross-register pubKeys at the SecurityLayer (otherwise sends
  // would be rejected with UNKNOWN_RECIPIENT).
  anneBundle.agent.addPeer(idB.pubKey, idB.pubKey);
  bobBundle.agent.addPeer(idA.pubKey, idA.pubKey);

  // Tell each side's mirror about the other's pubKey so the publish
  // recipients set is non-empty.
  await anneBundle.tasksMirror?.addPeer(idB.pubKey);
  await bobBundle.tasksMirror?.addPeer(idA.pubKey);

  return { bus, anneBundle, bobBundle, idA, idB };
}

describe('Tasks V2 Phase 52.9.3 — substrate-mirror fan-out', () => {
  it('addTask on Anne replicates to Bob via the substrate', async () => {
    const { anneBundle, bobBundle } = await buildPeeredBundles();

    const r = await callSkill(anneBundle.agent, 'addTask', {
      crewId: 'fan-out-crew',
      text:   'shared task',
    }, ANNE);
    expect(r?.task?.text).toBe('shared task');

    // Allow notify-envelope's microtask publish to settle.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const bobItems = await bobBundle.itemStore.listOpen();
    expect(bobItems.map(i => i.text)).toContain('shared task');
    const syncedItem = bobItems.find(i => i.text === 'shared task');
    expect(syncedItem?.source?.synced).toBe(true);
  });

  it('inbound envelope from a different crewId is silently dropped', async () => {
    const { anneBundle, bobBundle } = await buildPeeredBundles();

    // Manually publish a task envelope tagged for a DIFFERENT crew.
    // Bob's substrate-mirror should NOT mirror it into his itemStore.
    const fakeUri = `pseudo-pod://${anneBundle.substrateDeviceId}/tasks/crews/some-other-crew/tasks/abc`;
    const fakePayload = {
      id:   'fake-task',
      text: 'wrong-crew-task',
      type: 'task',
    };

    await anneBundle.notifyEnvelope.publish({
      type:       'task',
      ref:        fakeUri,
      payload:    fakePayload,
      recipients: [/* bob */ bobBundle.agent.address],
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const bobItems = await bobBundle.itemStore.listOpen();
    expect(bobItems.map(i => i.text)).not.toContain('wrong-crew-task');
  });

  it('A2-equivalent — fetch-resource is registered with groupCheck on every crew bundle', async () => {
    const { anneBundle, idB } = await buildPeeredBundles();
    const fetchDef = anneBundle.agent.skills.get('fetch-resource');
    expect(fetchDef).toBeTruthy();

    // Write a task locally + try fetching via the skill from Bob's
    // pubKey (a known peer) and from a stranger pubKey (denied).
    const uri = anneBundle.tasksMirror.urlFor('test-task-id');
    await anneBundle.pseudoPod.write(uri, { id: 'test-task-id', text: 'a' });

    // Member: served.
    const peerOk = await fetchDef.handler({
      parts:    [DataPart({ uri })],
      from:     idB.pubKey,
      agent:    anneBundle.agent,
      envelope: null,
    });
    expect(peerOk[0].data.bytes).toEqual({ id: 'test-task-id', text: 'a' });

    // Non-member: FORBIDDEN.
    await expect(fetchDef.handler({
      parts:    [DataPart({ uri })],
      from:     'pubkey:stranger',
      agent:    anneBundle.agent,
      envelope: null,
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('the mirror dedupes — re-publishing the same task is a no-op on the receiver', async () => {
    const { anneBundle, bobBundle, idB } = await buildPeeredBundles();
    void idB; // pubKey only used for routing above

    await callSkill(anneBundle.agent, 'addTask', {
      crewId: 'fan-out-crew',
      text:   'idempotent task',
    }, ANNE);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Bob now has the task. Publish the SAME task again from Anne's
    // side and verify Bob's count doesn't change.
    const bobBefore = (await bobBundle.itemStore.listOpen()).length;
    const anneItems = await anneBundle.itemStore.listOpen();
    const annesTask = anneItems.find(i => i.text === 'idempotent task');

    await anneBundle.notifyEnvelope.publish({
      type:       'task',
      ref:        anneBundle.tasksMirror.urlFor(annesTask.id),
      payload:    annesTask,
      recipients: [bobBundle.agent.address],
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const bobAfter = (await bobBundle.itemStore.listOpen()).length;
    expect(bobAfter).toBe(bobBefore);
  });

  it('stale-peer auto-heal — older writeFromPeer triggers a republish to the stale peer', async () => {
    const { anneBundle, idB } = await buildPeeredBundles();
    const published = [];
    // Capture publishes by wrapping notifyEnvelope.publish.
    const original = anneBundle.notifyEnvelope.publish.bind(anneBundle.notifyEnvelope);
    anneBundle.notifyEnvelope.publish = async (args) => {
      published.push(args);
      return original(args);
    };

    // Write a task locally at _v=2 (two writes → _v increments to 2).
    const uri = anneBundle.tasksMirror.urlFor('stale-task');
    const firstWrite  = await anneBundle.pseudoPod.write(uri, { id: 'stale-task', text: 'v1' });
    expect(firstWrite._v).toBe(1);
    const secondWrite = await anneBundle.pseudoPod.write(uri, { id: 'stale-task', text: 'v2' });
    expect(secondWrite._v).toBe(2);

    // Now simulate Bob's peer arriving with an OLDER _v=1. The
    // pseudoPod runs the 3-way compare + emits 'stale-peer' with our
    // fresher local copy. The wireTasksSubstrateMirror handler
    // catches that and republishes to Bob.
    const peerResult = await anneBundle.pseudoPod.writeFromPeer(
      uri,
      { id: 'stale-task', text: 'older from bob' },
      '"v-bob-1"',
      1,
      { fromActor: idB.pubKey },
    );
    expect(peerResult.status).toBe('stale-peer');

    // Auto-heal fires synchronously after emit; allow microtasks.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const heal = published.find(p => p.recipients?.[0] === idB.pubKey);
    expect(heal).toBeTruthy();
    expect(heal.type).toBe('task');
    expect(heal.payload).toEqual({ id: 'stale-task', text: 'v2' });
    expect(heal._v).toBe(2);
  });
});

describe('Tasks V2 Phase 52.9.3 sub-slice 1 — mutation fan-out', () => {
  it('claimTask state replicates to the peer', async () => {
    const { anneBundle, bobBundle } = await buildPeeredBundles();

    const addRes = await callSkill(anneBundle.agent, 'addTask', {
      crewId: 'fan-out-crew',
      text:   'task to claim',
    }, ANNE);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Bob has the task; Anne claims it. The claim should sync to Bob.
    await callSkill(anneBundle.agent, 'claimTask', {
      crewId: 'fan-out-crew',
      id:     addRes.task.id,
    }, ANNE);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const bobItems = await bobBundle.itemStore.listOpen();
    const synced = bobItems.find((i) => i.source?.syncedFromId === addRes.task.id);
    expect(synced).toBeTruthy();
    expect(synced.assignee).toBe(ANNE);
    expect(synced.claimedAt).toBeTypeOf('number');
  });

  it('completeTask replicates and moves the item to closed on the peer', async () => {
    const { anneBundle, bobBundle } = await buildPeeredBundles();

    const addRes = await callSkill(anneBundle.agent, 'addTask', {
      crewId: 'fan-out-crew',
      text:   'task to complete',
    }, ANNE);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Claim then complete.
    await callSkill(anneBundle.agent, 'claimTask', {
      crewId: 'fan-out-crew', id: addRes.task.id,
    }, ANNE);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await callSkill(anneBundle.agent, 'completeTask', {
      crewId: 'fan-out-crew', id: addRes.task.id,
    }, ANNE);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const bobOpen   = await bobBundle.itemStore.listOpen();
    const bobClosed = await bobBundle.itemStore.listClosed();
    expect(bobOpen.some((i) => i.source?.syncedFromId === addRes.task.id)).toBe(false);
    const synced = bobClosed.find((i) => i.source?.syncedFromId === addRes.task.id);
    expect(synced).toBeTruthy();
    expect(synced.completedAt).toBeTypeOf('number');
  });

  it('submit → reject → submit → approve replicates the full lifecycle to the peer', async () => {
    const { anneBundle, bobBundle } = await buildPeeredBundles();

    // Anne adds, claims, and submits with `approval: 'creator'` so
    // BOB is the approver (Anne created the task → master=Anne but
    // approval=creator means the issuer signs off; in our 2-member
    // crew, that's still Anne. To make Bob the approver, use
    // explicit approval=<bob>). For this test we just exercise the
    // state-machine replication on Anne's side and check Bob sees
    // it: Anne is the assignee + approver.
    const addRes = await callSkill(anneBundle.agent, 'addTask', {
      crewId:   'fan-out-crew',
      text:     'lifecycle task',
      approval: 'creator',
    }, ANNE);
    await new Promise((resolve) => setTimeout(resolve, 50));

    await callSkill(anneBundle.agent, 'claimTask', {
      crewId: 'fan-out-crew', id: addRes.task.id,
    }, ANNE);
    await new Promise((resolve) => setTimeout(resolve, 50));

    await callSkill(anneBundle.agent, 'submitTask', {
      crewId:      'fan-out-crew',
      id:          addRes.task.id,
      deliverable: { kind: 'url', ref: 'https://example/proof' },
    }, ANNE);
    await new Promise((resolve) => setTimeout(resolve, 50));

    let bobOpen = await bobBundle.itemStore.listOpen();
    let synced = bobOpen.find((i) => i.source?.syncedFromId === addRes.task.id);
    expect(synced).toBeTruthy();
    expect(synced.deliverable?.kind).toBe('url');
    expect(synced.reviewLog?.some((r) => r.decision === 'submit')).toBe(true);

    await callSkill(anneBundle.agent, 'rejectTask', {
      crewId: 'fan-out-crew', id: addRes.task.id, note: 'try again',
    }, ANNE);
    await new Promise((resolve) => setTimeout(resolve, 50));

    bobOpen = await bobBundle.itemStore.listOpen();
    synced = bobOpen.find((i) => i.source?.syncedFromId === addRes.task.id);
    expect(synced.reviewLog?.some((r) => r.decision === 'reject')).toBe(true);

    await callSkill(anneBundle.agent, 'submitTask', {
      crewId: 'fan-out-crew', id: addRes.task.id,
    }, ANNE);
    await callSkill(anneBundle.agent, 'approveTask', {
      crewId: 'fan-out-crew', id: addRes.task.id,
    }, ANNE);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const bobClosed = await bobBundle.itemStore.listClosed();
    const finalSynced = bobClosed.find((i) => i.source?.syncedFromId === addRes.task.id);
    expect(finalSynced).toBeTruthy();
    expect(finalSynced.completedAt).toBeTypeOf('number');
    expect(finalSynced.reviewLog?.some((r) => r.decision === 'approve')).toBe(true);
  });

  it('reassignTask replicates the new assignee', async () => {
    // Reassign is admin/coordinator-gated. Build a config where Anne is
    // admin so she can reassign; Bob still admin so the receive-side
    // applySync doesn't get policy-checked.
    const bus = new InternalBus();
    const lsA = buildBundle(); const lsB = buildBundle();
    const idA = await AgentIdentity.generate(new VaultMemory());
    const idB = await AgentIdentity.generate(new VaultMemory());
    const txA = new InternalTransport(bus, idA.pubKey);
    const txB = new InternalTransport(bus, idB.pubKey);
    const cfg = {
      crewId:  'reassign-crew',
      name:    'Reassign Test',
      kind:    'project',
      members: [
        { webid: ANNE, role: 'admin' },
        { webid: BOB,  role: 'admin' },
      ],
    };
    const anneBundle = await createCrewAgent({ crewConfig: cfg, localStoreBundle: lsA, identity: idA, transport: txA });
    const bobBundle  = await createCrewAgent({ crewConfig: cfg, localStoreBundle: lsB, identity: idB, transport: txB });
    anneBundle.agent.addPeer(idB.pubKey, idB.pubKey);
    bobBundle.agent.addPeer(idA.pubKey, idA.pubKey);
    await anneBundle.tasksMirror?.addPeer(idB.pubKey);
    await bobBundle.tasksMirror?.addPeer(idA.pubKey);

    const addRes = await callSkill(anneBundle.agent, 'addTask', {
      crewId: 'reassign-crew', text: 'reassignable',
    }, ANNE);
    await new Promise((resolve) => setTimeout(resolve, 50));

    await callSkill(anneBundle.agent, 'claimTask', {
      crewId: 'reassign-crew', id: addRes.task.id,
    }, ANNE);
    await new Promise((resolve) => setTimeout(resolve, 50));

    await callSkill(anneBundle.agent, 'reassignTask', {
      crewId: 'reassign-crew', id: addRes.task.id, newAssignee: BOB,
    }, ANNE);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const bobItems = await bobBundle.itemStore.listOpen();
    const synced = bobItems.find((i) => i.source?.syncedFromId === addRes.task.id);
    expect(synced).toBeTruthy();
    expect(synced.assignee).toBe(BOB);
  });

  it('revokeTask clears the assignee on the peer', async () => {
    const { anneBundle, bobBundle } = await buildPeeredBundles();

    const addRes = await callSkill(anneBundle.agent, 'addTask', {
      crewId: 'fan-out-crew', text: 'revokable',
    }, ANNE);
    await new Promise((resolve) => setTimeout(resolve, 50));

    await callSkill(anneBundle.agent, 'claimTask', {
      crewId: 'fan-out-crew', id: addRes.task.id,
    }, ANNE);
    await new Promise((resolve) => setTimeout(resolve, 50));

    await callSkill(anneBundle.agent, 'revokeTask', {
      crewId: 'fan-out-crew', id: addRes.task.id, reason: 'changed mind',
    }, ANNE);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const bobItems = await bobBundle.itemStore.listOpen();
    const synced = bobItems.find((i) => i.source?.syncedFromId === addRes.task.id);
    expect(synced).toBeTruthy();
    expect(synced.assignee).toBeUndefined();
  });

  it('removeTask hard-deletes the synced copy on the peer', async () => {
    // Need admin on both sides for removeTask. Use a config where
    // both ANNE and BOB are admins.
    const bus = new InternalBus();
    const lsA = buildBundle(); const lsB = buildBundle();
    const idA = await AgentIdentity.generate(new VaultMemory());
    const idB = await AgentIdentity.generate(new VaultMemory());
    const txA = new InternalTransport(bus, idA.pubKey);
    const txB = new InternalTransport(bus, idB.pubKey);
    const adminConfig = {
      crewId:  'remove-crew',
      name:    'Removal Test',
      kind:    'project',
      members: [
        { webid: ANNE, role: 'admin' },
        { webid: BOB,  role: 'admin' },
      ],
    };
    const anneBundle = await createCrewAgent({
      crewConfig: adminConfig, localStoreBundle: lsA, identity: idA, transport: txA, label: 'Anne',
    });
    const bobBundle = await createCrewAgent({
      crewConfig: adminConfig, localStoreBundle: lsB, identity: idB, transport: txB, label: 'Bob',
    });
    anneBundle.agent.addPeer(idB.pubKey, idB.pubKey);
    bobBundle.agent.addPeer(idA.pubKey, idA.pubKey);
    await anneBundle.tasksMirror?.addPeer(idB.pubKey);
    await bobBundle.tasksMirror?.addPeer(idA.pubKey);

    const addRes = await callSkill(anneBundle.agent, 'addTask', {
      crewId: 'remove-crew',
      text:   'task to delete',
    }, ANNE);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await bobBundle.itemStore.listOpen()).some((i) => i.text === 'task to delete')).toBe(true);

    await callSkill(anneBundle.agent, 'removeTask', {
      crewId: 'remove-crew', id: addRes.task.id,
    }, ANNE);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const bobOpen   = await bobBundle.itemStore.listOpen();
    const bobClosed = await bobBundle.itemStore.listClosed();
    expect(bobOpen.some((i) => i.source?.syncedFromId === addRes.task.id)).toBe(false);
    expect(bobClosed.some((i) => i.source?.syncedFromId === addRes.task.id)).toBe(false);
  });
});

describe('Tasks V2 Phase 52.9.3 sub-slice 4 — live peer-roster updates', () => {
  it('redeemInvite adds the new member to the substrate-mirror roster', async () => {
    const { anneBundle } = await buildPeeredBundles();

    // Provision + spawn a sibling crew on Anne's side, then redeem
    // an invite for a brand-new member; verify the mirror's peers set
    // gained the new pubKey.
    //
    // Single-crew mode here: invites go to the running crew. We
    // use the existing per-crew onboarding skill (which createCrewAgent
    // registered in single-crew mode via wireOnboardingSkills:true).
    const issuedInvite = await callSkill(anneBundle.agent, 'issueInvite', {
      role: 'member',
    }, ANNE);
    expect(issuedInvite?.invite).toBeTruthy();

    const newMemberId = await AgentIdentity.generate(new VaultMemory());
    const before = anneBundle.tasksMirror.getPeers();
    expect(before).not.toContain(newMemberId.pubKey);

    // V1 (single-crew) redeemInvite is bound per-crew. Multi-crew
    // dispatch + tasksMirror.addPeer integration is the more general
    // path. This test verifies the wiring exists at the multi-crew
    // wrapper level — we exercise that path explicitly:
    const { buildMultiCrewOnboardingSkills } = await import('../src/skills/multiCrewOnboarding.js');
    const mockResolver = () => anneBundle._crewState;
    const skills = buildMultiCrewOnboardingSkills({ bundleResolver: mockResolver });
    const redeem = skills.find(s => s.id === 'redeemInvite');
    const r = await redeem.handler({
      parts: [DataPart({
        invite:       issuedInvite.invite,
        webid:        'https://id.example/newcomer',
        displayName:  'Newcomer',
        memberPubKey: newMemberId.pubKey,
      })],
      from:     ANNE,
      agent:    anneBundle.agent,
      envelope: null,
    });
    expect(r?.groupProof).toBeTruthy();

    // Mirror's roster now includes the new pubKey.
    const after = anneBundle.tasksMirror.getPeers();
    expect(after).toContain(newMemberId.pubKey);
  });
});
