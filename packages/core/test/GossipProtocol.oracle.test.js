/**
 * GossipProtocol — oracle-claim pull during each gossip round.
 * See CODING-PLAN.md Group T6 and Design-v3/oracle-bridge-selection.md §5.
 */
import { describe, it, expect, vi } from 'vitest';
import { GossipProtocol }   from '../src/discovery/GossipProtocol.js';
import { PeerGraph }        from '../src/discovery/PeerGraph.js';
import { Emitter }          from '../src/Emitter.js';
import { DataPart }         from '../src/Parts.js';
import { signReachabilityClaim } from '../src/security/reachabilityClaim.js';
import { AgentIdentity }    from '../src/identity/AgentIdentity.js';
import { VaultMemory }      from '../src/identity/VaultMemory.js';

/**
 * Build a minimal agent-like shape (extends Emitter so
 * emit/on/off work) with controllable invoke behaviour.
 */
function makeAgentLike({ pubKey = 'me-pubkey', invokeImpl } = {}) {
  const agent = new Emitter();
  agent.pubKey = pubKey;
  agent.invoke = vi.fn(invokeImpl ?? (async () => [DataPart({ peers: [] })]));
  return agent;
}

async function seedBridge(graph, pubKey) {
  await graph.upsert({ pubKey, hops: 0, reachable: true, tier: 'authenticated' });
}

describe('GossipProtocol — oracle claim pull', () => {

  it('populates knownPeers + knownPeersTs + knownPeersSeq on success', async () => {
    const graph       = new PeerGraph();
    const bridgeId    = await AgentIdentity.generate(new VaultMemory());
    await seedBridge(graph, bridgeId.pubKey);

    const claim = await signReachabilityClaim(
      bridgeId,
      ['target-a', 'target-b'],
      { ttlMs: 60_000 },
    );

    const agent = makeAgentLike({
      invokeImpl: async (peerId, skillId) => {
        if (skillId === 'peer-list')       return [DataPart({ peers: [] })];
        if (skillId === 'reachable-peers') return [DataPart(claim)];
        throw new Error('unexpected skill ' + skillId);
      },
    });

    const gp = new GossipProtocol({
      agent,
      peerGraph: graph,
      discovery: { discoverByIntroduction: async () => null },
    });

    await gp.runRound();

    const rec = await graph.get(bridgeId.pubKey);
    expect(rec.knownPeers).toEqual(['target-a', 'target-b']);
    expect(rec.knownPeersSeq).toBe(claim.body.s);
    expect(rec.knownPeersSig).toBe(claim.sig);
    expect(rec.knownPeersTs).toBeGreaterThan(Date.now());
    expect(rec.knownPeersTs - Date.now()).toBeLessThanOrEqual(60_000);
  });

  it('is benign when the peer does not expose reachable-peers', async () => {
    const graph       = new PeerGraph();
    const bridgeId    = await AgentIdentity.generate(new VaultMemory());
    await seedBridge(graph, bridgeId.pubKey);

    const agent = makeAgentLike({
      invokeImpl: async (peerId, skillId) => {
        if (skillId === 'peer-list')       return [DataPart({ peers: [] })];
        if (skillId === 'reachable-peers') throw new Error('Unknown skill: reachable-peers');
        throw new Error('unexpected');
      },
    });

    const gp = new GossipProtocol({
      agent,
      peerGraph: graph,
      discovery: { discoverByIntroduction: async () => null },
    });

    await expect(gp.runRound()).resolves.toBeUndefined();

    const rec = await graph.get(bridgeId.pubKey);
    expect(rec.knownPeers).toBeUndefined();
    expect(rec.knownPeersSeq).toBeUndefined();
  });

  it('emits reachability-claim-rejected and does not mutate on a malformed claim', async () => {
    const graph       = new PeerGraph();
    const bridgeId    = await AgentIdentity.generate(new VaultMemory());
    const otherId     = await AgentIdentity.generate(new VaultMemory());
    await seedBridge(graph, bridgeId.pubKey);

    // Sign a claim with a DIFFERENT identity so the issuer mismatch fires.
    const fraudulent = await signReachabilityClaim(
      otherId,
      ['target-a'],
      { ttlMs: 60_000 },
    );

    const agent = makeAgentLike({
      invokeImpl: async (peerId, skillId) => {
        if (skillId === 'peer-list')       return [DataPart({ peers: [] })];
        if (skillId === 'reachable-peers') return [DataPart(fraudulent)];
      },
    });

    const rejections = [];
    agent.on('reachability-claim-rejected', e => rejections.push(e));

    const gp = new GossipProtocol({
      agent,
      peerGraph: graph,
      discovery: { discoverByIntroduction: async () => null },
    });

    await gp.runRound();

    expect(rejections).toHaveLength(1);
    expect(rejections[0].issuer).toBe(bridgeId.pubKey);
    expect(rejections[0].reason).toMatch(/issuer mismatch/);

    const rec = await graph.get(bridgeId.pubKey);
    expect(rec.knownPeers).toBeUndefined();
  });

  it('rejects a replay (same s as lastSeenSeq) without mutating the graph', async () => {
    const graph    = new PeerGraph();
    const bridgeId = await AgentIdentity.generate(new VaultMemory());
    await seedBridge(graph, bridgeId.pubKey);

    // First, legitimately cache a claim.
    const first = await signReachabilityClaim(
      bridgeId,
      ['target-a'],
      { ttlMs: 60_000 },
    );

    // Seed the graph as if we'd just verified it.
    await graph.upsert({
      pubKey:         bridgeId.pubKey,
      knownPeers:     ['target-a'],
      knownPeersTs:   Date.now() + 60_000,
      knownPeersSeq:  first.body.s,
      knownPeersSig:  first.sig,
    });

    // Now simulate the same claim being re-served (replay).
    const agent = makeAgentLike({
      invokeImpl: async (peerId, skillId) => {
        if (skillId === 'peer-list')       return [DataPart({ peers: [] })];
        if (skillId === 'reachable-peers') return [DataPart(first)];
      },
    });

    const rejections = [];
    agent.on('reachability-claim-rejected', e => rejections.push(e));

    const gp = new GossipProtocol({
      agent,
      peerGraph: graph,
      discovery: { discoverByIntroduction: async () => null },
    });

    await gp.runRound();

    expect(rejections).toHaveLength(1);
    expect(rejections[0].reason).toMatch(/replay/);

    // knownPeersSeq must not have moved.
    const rec = await graph.get(bridgeId.pubKey);
    expect(rec.knownPeersSeq).toBe(first.body.s);
  });

  it('accepts a strictly newer claim and upgrades knownPeersSeq', async () => {
    const graph    = new PeerGraph();
    const bridgeId = await AgentIdentity.generate(new VaultMemory());
    await seedBridge(graph, bridgeId.pubKey);

    // Sign two claims in sequence so s2 > s1.
    const c1 = await signReachabilityClaim(bridgeId, ['target-a'],           { ttlMs: 60_000 });
    const c2 = await signReachabilityClaim(bridgeId, ['target-a', 'target-b'], { ttlMs: 60_000 });
    expect(c2.body.s).toBeGreaterThan(c1.body.s);

    // Graph already has c1's data.
    await graph.upsert({
      pubKey:         bridgeId.pubKey,
      knownPeers:     [...c1.body.p],
      knownPeersTs:   Date.now() + 60_000,
      knownPeersSeq:  c1.body.s,
    });

    const agent = makeAgentLike({
      invokeImpl: async (peerId, skillId) => {
        if (skillId === 'peer-list')       return [DataPart({ peers: [] })];
        if (skillId === 'reachable-peers') return [DataPart(c2)];
      },
    });

    const gp = new GossipProtocol({
      agent,
      peerGraph: graph,
      discovery: { discoverByIntroduction: async () => null },
    });

    await gp.runRound();

    const rec = await graph.get(bridgeId.pubKey);
    expect(rec.knownPeers).toEqual(['target-a', 'target-b']);
    expect(rec.knownPeersSeq).toBe(c2.body.s);
  });
});
