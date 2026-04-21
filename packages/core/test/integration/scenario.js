/**
 * Shared mesh scenario — consumed by both the vitest integration test
 * (test/integration/mesh-scenario.test.js) and the runnable demo
 * (examples/mesh-demo/index.js). Keeping the steps in one place means
 * the CI assertion and the human smoke test always exercise the same
 * code path.
 *
 * Topology:
 *   Alice  ──relay-bus──  Bob  ──loop-bus──  Carol
 *
 * Alice and Carol share no transport; the only path between them is Bob.
 */
import {
  Agent,
  AgentIdentity,
  VaultMemory,
  PeerGraph,
  DataPart,
  Parts,
  TextPart,
  InternalBus,
  InternalTransport,
}                            from '../../src/index.js';

/**
 * Build the three agents with the correct topology and return them
 * plus handles that tests / the demo can use. Everything is already
 * `start()`-ed and skill-ready.
 */
export async function buildMesh({ log } = {}) {
  const say = log ?? (() => {});

  const relayBus = new InternalBus();
  const loopBus  = new InternalBus();

  const aliceId = await AgentIdentity.generate(new VaultMemory());
  const bobId   = await AgentIdentity.generate(new VaultMemory());
  const carolId = await AgentIdentity.generate(new VaultMemory());

  // Transports.
  const aliceRelay = new InternalTransport(relayBus, aliceId.pubKey, { identity: aliceId });
  const bobRelay   = new InternalTransport(relayBus, bobId.pubKey,   { identity: bobId });
  const bobLoop    = new InternalTransport(loopBus,  bobId.pubKey,   { identity: bobId });
  const carolLoop  = new InternalTransport(loopBus,  carolId.pubKey, { identity: carolId });

  // Bob's routing: pick the transport by address.
  const bobRouting = {
    selectTransport: (peerId) => {
      if (peerId === aliceId.pubKey) return { transport: bobRelay };
      if (peerId === carolId.pubKey) return { transport: bobLoop };
      return null;   // default path
    },
  };

  const alice = new Agent({ identity: aliceId, transport: aliceRelay, peers: new PeerGraph(), label: 'alice' });
  const bob   = new Agent({ identity: bobId,   transport: bobRelay,   peers: new PeerGraph(), routing: bobRouting, label: 'bob'   });
  const carol = new Agent({ identity: carolId, transport: carolLoop,  peers: new PeerGraph(), label: 'carol' });

  bob.addTransport('loop', bobLoop);

  // Pre-register keys so we don't need to simulate transport-level
  // discovery events in the test; hello still runs to prove the
  // protocol, but without it we'd time out on first send.
  alice.addPeer(bobId.pubKey,   bobId.pubKey);
  bob.addPeer  (aliceId.pubKey, aliceId.pubKey);
  bob.addPeer  (carolId.pubKey, carolId.pubKey);
  carol.addPeer(bobId.pubKey,   bobId.pubKey);

  await alice.start(); await bob.start(); await carol.start();

  // Start the agent-owned graph in sync with known direct peers.
  const seedDirect = async (agent, peerPubKey) => {
    await agent.peers.upsert({ pubKey: peerPubKey, hops: 0, reachable: true });
  };
  await seedDirect(alice, bobId.pubKey);
  await seedDirect(bob,   aliceId.pubKey);
  await seedDirect(bob,   carolId.pubKey);
  await seedDirect(carol, bobId.pubKey);

  // Skills: relay-forward on Bob (policy 'always' for the demo), and
  // receive-message on everyone so responses work symmetrically.
  bob.enableRelayForward({ policy: 'always' });

  const registerReceiveMessage = (agent, received) => {
    agent.register('receive-message', async ({ parts, from, originFrom, relayedBy }) => {
      const text = Parts.text(parts) ?? JSON.stringify(Parts.data(parts));
      received.push({ text, from, originFrom: originFrom ?? from, relayedBy });
      return [DataPart({ ack: true })];
    }, { visibility: 'public' });
  };

  const aliceReceived = [];
  const bobReceived   = [];
  const carolReceived = [];
  registerReceiveMessage(alice, aliceReceived);
  registerReceiveMessage(bob,   bobReceived);
  registerReceiveMessage(carol, carolReceived);

  // Peer-list skill (simple version — does what PeerDiscovery would,
  // but without starting a ping loop since the scenario is synchronous).
  const registerPeerList = (agent) => {
    agent.register('peer-list', async ({ from }) => {
      const peers = (await agent.peers.all())
        .filter(p => p.pubKey && p.pubKey !== from)
        .filter(p => (p.hops ?? 0) === 0)
        .filter(p => p.reachable !== false)
        .map(p => ({ pubKey: p.pubKey, label: p.label ?? null, transports: {} }));
      return [DataPart({ peers })];
    });
  };
  registerPeerList(alice);
  registerPeerList(bob);
  registerPeerList(carol);

  say('[scenario] mesh built — alice, bob, carol');

  return {
    alice, bob, carol,
    relayBus, loopBus,
    received: { alice: aliceReceived, bob: bobReceived, carol: carolReceived },
    pubKeys: {
      alice: aliceId.pubKey,
      bob:   bobId.pubKey,
      carol: carolId.pubKey,
    },
    async teardown() {
      await alice.stop(); await bob.stop(); await carol.stop();
    },
  };
}

/**
 * Simple "one round of gossip" helper — Alice pulls Bob's peer list.
 * The real GossipProtocol picks randomly on a timer; for a deterministic
 * test we just invoke `peer-list` directly.
 *
 * Upserts any new peer from Bob's list as hops:1, via:bob.
 */
export async function gossipOnce(agent, bridgePubKey) {
  const parts = await agent.invoke(bridgePubKey, 'peer-list', [], { timeout: 5_000 });
  const data  = Parts.data(parts);
  if (!Array.isArray(data?.peers)) return 0;
  let added = 0;
  for (const card of data.peers) {
    if (!card?.pubKey)                        continue;
    if (card.pubKey === agent.pubKey)         continue;
    if (card.pubKey === bridgePubKey)         continue;
    const existing = await agent.peers.get(card.pubKey);
    if (existing && (existing.hops ?? 0) === 0) continue;
    await agent.peers.upsert({
      type:          'native',
      pubKey:        card.pubKey,
      label:         card.label ?? null,
      reachable:     true,
      hops:          1,
      via:           bridgePubKey,
      discoveredVia: 'gossip',
    });
    added++;
  }
  return added;
}

/** Pull a signed reachability claim from `bridgePubKey` and cache it. */
export async function gossipOracle(agent, bridgePubKey) {
  const { verifyReachabilityClaim } = await import('../../src/security/reachabilityClaim.js');

  let claim;
  try {
    const parts = await agent.invoke(bridgePubKey, 'reachable-peers', [], { timeout: 5_000 });
    claim       = Parts.data(parts);
  } catch {
    return false;
  }

  const existing    = await agent.peers.get(bridgePubKey);
  const lastSeenSeq = existing?.knownPeersSeq;

  const res = verifyReachabilityClaim(claim, { expectedIssuer: bridgePubKey, lastSeenSeq });
  if (!res.ok) return false;

  await agent.peers.upsert({
    pubKey:         bridgePubKey,
    knownPeers:     [...claim.body.p],
    knownPeersTs:   Date.now() + claim.body.t,
    knownPeersSeq:  res.newLastSeq,
    knownPeersSig:  claim.sig,
  });
  return true;
}

export { TextPart, Parts };
