/**
 * Regression: concurrent `mirror.addPeer(samePubKey)` calls must
 * dedup atomically.
 *
 * Single-agent refactor (2026-05-08) bug:
 *   The mobile bundle calls mirror.addPeer for the same peer from
 *   THREE concurrent paths (initial peers list + PeerGraph seed loop +
 *   `agent.on('peer')` listener). The old check-then-await-then-set
 *   sequence raced — both calls saw `offs.has(pubKey) = false`, both
 *   ran `subscribe()`, both registered an `agent.on('publish', ...)`
 *   listener. Every inbound broadcast then fired the mirror handler
 *   twice; mirror's `if (open.some(requestId))` dedup raced too →
 *   duplicate items in the receiver's ItemStore.
 *
 *   Symptom: receiver phone showed every kaas / banana post twice.
 *
 * Fix: stash the in-flight Promise SYNCHRONOUSLY in `offs` before
 * awaiting `subscribe`, so concurrent callers hit `offs.has(pubKey)`
 * and return immediately. Verified here with a deliberately
 * concurrent addPeer × N + a publish that the receiver's mirror
 * MUST process exactly once.
 */

import { describe, it, expect } from 'vitest';
import { Agent, AgentIdentity, VaultMemory, InternalBus, InternalTransport, defineSkill } from '@canopy/core';
import { ItemStore }   from '@canopy/item-store';
import { MemorySource } from '@canopy/core';
import { wireGroupBroadcastMirror } from '../src/groupMirror.js';
import { publish }      from '@canopy/core';

async function makeAgent(name) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const bus = new InternalBus();
  const tx  = new InternalTransport(bus, id.pubKey);
  const agent = new Agent({ identity: id, transport: tx, label: name });
  await agent.start();
  return { agent, bus, identity: id };
}

describe('wireGroupBroadcastMirror.addPeer race-safety', () => {
  it('concurrent addPeer × N for the same peer registers exactly ONE subscription', async () => {
    // Set up two agents on a shared bus so publish actually crosses.
    const a = await AgentIdentity.generate(new VaultMemory());
    const b = await AgentIdentity.generate(new VaultMemory());
    const bus = new InternalBus();
    const txA = new InternalTransport(bus, a.pubKey);
    const txB = new InternalTransport(bus, b.pubKey);
    const agentA = new Agent({ identity: a, transport: txA, label: 'A' });
    const agentB = new Agent({ identity: b, transport: txB, label: 'B' });
    await agentA.start();
    await agentB.start();
    agentA.addPeer(b.pubKey, b.pubKey);
    agentB.addPeer(a.pubKey, a.pubKey);

    const dataSource = new MemorySource();
    const itemStore = new ItemStore({ dataSource, rootContainer: 'mem://test/' });

    const mirror = await wireGroupBroadcastMirror({
      agent: agentA,
      itemStore,
      group: 'g1',
      peers: [],
    });

    // Fire 5 concurrent addPeer calls for the same peer. Without the
    // race fix this would create 5 listeners on agent.on('publish').
    await Promise.all([
      mirror.addPeer(b.pubKey),
      mirror.addPeer(b.pubKey),
      mirror.addPeer(b.pubKey),
      mirror.addPeer(b.pubKey),
      mirror.addPeer(b.pubKey),
    ]);

    // Single publish from B → A should mirror to itemStore EXACTLY ONCE.
    await publish(agentB, 'g1/requests', [{ type: 'DataPart', data: {
      requestId: 'req-1',
      text:      'kaas',
      from:      'urn:b',
      kind:      'request',
    }}]);

    // Let microtasks drain.
    await new Promise(r => setTimeout(r, 10));

    const open = await itemStore.listOpen();
    const kaas = open.filter(i => i.text === 'kaas' || i.source?.requestId === 'req-1');
    expect(kaas).toHaveLength(1);

    await mirror.stop();
    await agentA.stop();
    await agentB.stop();
  });
});
