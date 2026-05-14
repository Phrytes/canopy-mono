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
import {
  AgentIdentity,
  VaultMemory,
  InternalBus,
  InternalTransport,
  DataPart,
} from '@canopy/core';
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
});
