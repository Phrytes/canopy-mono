import { describe, it, expect, vi } from 'vitest';
import { GossipProtocol } from '../src/discovery/GossipProtocol.js';
import { PeerGraph }      from '../src/discovery/PeerGraph.js';
import { DataPart }       from '../src/Parts.js';

function makeGossip({ peers = [], invokeFn = null } = {}) {
  const graph = new PeerGraph();

  const agent = {
    invoke: invokeFn ?? vi.fn().mockResolvedValue([DataPart({ peers: [] })]),
  };

  const discovery = {
    discoverByIntroduction: vi.fn().mockResolvedValue(null),
  };

  const gossip = new GossipProtocol({
    agent,
    peerGraph:      graph,
    discovery,
    intervalMs:     60_000,
    maxPeersPerRound: 5,
  });

  return { gossip, graph, agent, discovery };
}

describe('GossipProtocol', () => {
  it('runRound does nothing when no reachable peers', async () => {
    const { gossip, agent } = makeGossip();
    await gossip.runRound();
    expect(agent.invoke).not.toHaveBeenCalled();
  });

  it('runRound calls peer-list skill on a reachable peer', async () => {
    const { gossip, graph, agent } = makeGossip();
    await graph.upsert({ pubKey: 'pk1', reachable: true });
    await gossip.runRound();
    expect(agent.invoke).toHaveBeenCalledWith('pk1', 'peer-list', [], expect.anything());
  });

  it('runRound calls discoverByIntroduction for returned cards', async () => {
    const cards = [
      { pubKey: 'pk2', discoverable: true },
      { pubKey: 'pk3', discoverable: true },
    ];
    const invokeFn = vi.fn().mockResolvedValue([DataPart({ peers: cards })]);
    const { gossip, graph, discovery } = makeGossip({ invokeFn });

    await graph.upsert({ pubKey: 'pk1', reachable: true });
    await gossip.runRound();

    expect(discovery.discoverByIntroduction).toHaveBeenCalledTimes(2);
    expect(discovery.discoverByIntroduction).toHaveBeenCalledWith(cards[0], 'pk1');
    expect(discovery.discoverByIntroduction).toHaveBeenCalledWith(cards[1], 'pk1');
  });

  it('filters out cards with discoverable = false', async () => {
    const cards = [
      { pubKey: 'pk2', discoverable: true  },
      { pubKey: 'pk3', discoverable: false },
    ];
    const invokeFn = vi.fn().mockResolvedValue([DataPart({ peers: cards })]);
    const { gossip, graph, discovery } = makeGossip({ invokeFn });

    await graph.upsert({ pubKey: 'pk1', reachable: true });
    await gossip.runRound();

    expect(discovery.discoverByIntroduction).toHaveBeenCalledTimes(1);
    expect(discovery.discoverByIntroduction).toHaveBeenCalledWith(cards[0], 'pk1');
  });

  it('honours maxPeersPerRound cap', async () => {
    const cards = Array.from({ length: 20 }, (_, i) => ({ pubKey: `pk${i + 10}`, discoverable: true }));
    const invokeFn = vi.fn().mockResolvedValue([DataPart({ peers: cards })]);
    const { gossip, graph, discovery } = makeGossip({ invokeFn });

    await graph.upsert({ pubKey: 'pk1', reachable: true });
    await gossip.runRound();

    expect(discovery.discoverByIntroduction).toHaveBeenCalledTimes(5);
  });

  it('runRound is resilient to invoke failure', async () => {
    const invokeFn = vi.fn().mockRejectedValue(new Error('timeout'));
    const { gossip, graph } = makeGossip({ invokeFn });

    await graph.upsert({ pubKey: 'pk1', reachable: true });
    await expect(gossip.runRound()).resolves.toBeUndefined();
  });

  it('start() and stop() do not throw', () => {
    const { gossip } = makeGossip();
    expect(() => gossip.start()).not.toThrow();
    expect(() => gossip.stop()).not.toThrow();
  });

  it('stop() clears the scheduled timer', async () => {
    const { gossip, graph, agent } = makeGossip();
    await graph.upsert({ pubKey: 'pk1' });

    gossip.start();
    gossip.stop();
    await new Promise(r => setTimeout(r, 100));
    expect(agent.invoke).not.toHaveBeenCalled();
  });
});
