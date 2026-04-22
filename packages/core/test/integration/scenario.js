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
  RoutingStrategy,
  registerRelayReceiveSealed,
}                            from '../../src/index.js';

/**
 * Build the three agents with the correct topology and return them
 * plus handles that tests / the demo can use. Everything is already
 * `start()`-ed and skill-ready.
 */
/**
 * Build the three-agent mesh.
 *
 * @param {object}   [opts]
 * @param {function} [opts.log]         — optional logger (stdout channel).
 * @param {boolean}  [opts.rendezvous]  — when true, give Alice and Bob a
 *     RoutingStrategy and enable rendezvous on both, using their relay-bus
 *     transport as the signalling channel. Carol stays single-transport
 *     (she's the "BLE-only endpoint" in the phone analogue). Caller must
 *     also pass `rtcLib` so Node can drive WebRTC.
 * @param {object}   [opts.rtcLib]      — { RTCPeerConnection, RTCSessionDescription,
 *     RTCIceCandidate }. Required if `rendezvous: true`.
 */
export async function buildMesh({ log, rendezvous = false, rtcLib } = {}) {
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

  // When rendezvous is enabled, Alice and Bob need a RoutingStrategy so the
  // rendezvous transport can participate in transportFor(peer) once an upgrade
  // succeeds. Bob already had an inline routing strategy for its two-bus
  // topology; swap it for a proper RoutingStrategy that can also carry the
  // rendezvous preference when set.
  const alicePeers = new PeerGraph();
  const bobPeers   = new PeerGraph();
  const aliceRouting = rendezvous
    ? new RoutingStrategy({ transports: new Map([['relay', aliceRelay]]), peerGraph: alicePeers })
    : null;
  const bobRoutingFinal = rendezvous
    ? new RoutingStrategy({
        transports: new Map([['relay', bobRelay], ['loop', bobLoop]]),
        peerGraph:  bobPeers,
        // We still need address-based transport selection for Bob.
        // Wrap selectTransport below with a pre-check.
      })
    : bobRouting;

  const alice = new Agent({ identity: aliceId, transport: aliceRelay, peers: alicePeers, label: 'alice', routing: aliceRouting });
  const bob   = new Agent({ identity: bobId,   transport: bobRelay,   peers: bobPeers,   routing: bobRoutingFinal, label: 'bob'   });
  const carol = new Agent({ identity: carolId, transport: carolLoop,  peers: new PeerGraph(), label: 'carol' });

  // For the rendezvous flavour, teach Bob's RoutingStrategy the same
  // address-based split that the inline strategy does in the base scenario:
  // loop-bus for Carol, relay-bus for Alice.
  if (rendezvous) {
    const baseSelect = bobRoutingFinal.selectTransport.bind(bobRoutingFinal);
    bobRoutingFinal.selectTransport = async (peerId, opts2) => {
      if (peerId === aliceId.pubKey) return { name: 'relay', transport: bobRelay };
      if (peerId === carolId.pubKey) return { name: 'loop',  transport: bobLoop  };
      return baseSelect(peerId, opts2);
    };
  }

  bob.addTransport('loop', bobLoop);

  // Pre-register keys so we don't need to simulate transport-level
  // discovery events in the test; hello still runs to prove the
  // protocol, but without it we'd time out on first send.
  //
  // EXCEPTION: when rendezvous is enabled, skip pre-registration so
  // hello() actually exchanges HIs and fires the 'peer' event that
  // triggers auto-upgrade. Hello is strictly a superset of addPeer —
  // it registers the key AND delivers the capabilities payload.
  if (!rendezvous) {
    alice.addPeer(bobId.pubKey,   bobId.pubKey);
    bob.addPeer  (aliceId.pubKey, aliceId.pubKey);
    bob.addPeer  (carolId.pubKey, carolId.pubKey);
    carol.addPeer(bobId.pubKey,   bobId.pubKey);
  }

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
    agent.register('receive-message', async ({
      parts, from, originFrom, originVerified, relayedBy,
    }) => {
      const text = Parts.text(parts) ?? JSON.stringify(Parts.data(parts));
      received.push({
        text, from,
        originFrom:     originFrom ?? from,
        originVerified: !!originVerified,
        relayedBy,
      });
      return [DataPart({ ack: true })];
    }, { visibility: 'public' });
  };

  const aliceReceived = [];
  const bobReceived   = [];
  const carolReceived = [];
  registerReceiveMessage(alice, aliceReceived);
  registerReceiveMessage(bob,   bobReceived);
  registerReceiveMessage(carol, carolReceived);

  const warnings = { alice: [], bob: [], carol: [] };
  alice.on('security-warning', w => warnings.alice.push(w));
  bob  .on('security-warning', w => warnings.bob  .push(w));
  carol.on('security-warning', w => warnings.carol.push(w));

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

  // ── Optional: enable rendezvous on alice ↔ bob (Group AA) ─────────────────
  if (rendezvous) {
    if (!rtcLib) throw new Error('buildMesh: rendezvous=true requires rtcLib');
    alice.enableRendezvous({ signalingTransport: aliceRelay, rtcLib, auto: true });
    bob  .enableRendezvous({ signalingTransport: bobRelay,   rtcLib, auto: true });
  }

  // ── Group BB: the receiver skill is registered on everyone so any agent
  // can be the final hop of a blind-forward. enableSealedForwardFor is
  // per-call (test opts in explicitly); this just makes the receive side
  // always available.
  registerRelayReceiveSealed(alice);
  registerRelayReceiveSealed(bob);
  registerRelayReceiveSealed(carol);

  // Bridge tap: wrap bob.invoke so tests can see whether a forwarded
  // call targeted the raw skill (plaintext) or relay-receive-sealed
  // (blind), and whether the forwarded payload contained any plaintext.
  const bobOutbound = [];
  const origBobInvoke = bob.invoke.bind(bob);
  bob.invoke = async (peerId, skillId, input, opts) => {
    bobOutbound.push({
      peerId, skillId,
      payload: JSON.stringify(input),
    });
    return origBobInvoke(peerId, skillId, input, opts);
  };

  say('[scenario] mesh built — alice, bob, carol');

  return {
    alice, bob, carol,
    relayBus, loopBus,
    received: { alice: aliceReceived, bob: bobReceived, carol: carolReceived },
    warnings,
    bobOutbound,            // Group BB tap — see what Bob forwarded onwards
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
