/**
 * PeerDiscovery peer-list filter — Group M addition.
 *
 * Ensures the skill returns only direct (hops:0), reachable peers and
 * doesn't echo the caller's own pubKey back.
 */
import { describe, it, expect } from 'vitest';
import { Agent }           from '../src/Agent.js';
import { AgentIdentity }   from '../src/identity/AgentIdentity.js';
import { VaultMemory }     from '../src/identity/VaultMemory.js';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { PeerGraph }       from '../src/discovery/PeerGraph.js';
import { PeerDiscovery }   from '../src/discovery/PeerDiscovery.js';
import { Parts }           from '../src/Parts.js';

async function buildAgents() {
  const bus    = new InternalBus();
  const pubId  = await AgentIdentity.generate(new VaultMemory());
  const subId  = await AgentIdentity.generate(new VaultMemory());
  const pub    = new Agent({ identity: pubId, transport: new InternalTransport(bus, pubId.pubKey) });
  const sub    = new Agent({ identity: subId, transport: new InternalTransport(bus, subId.pubKey) });
  pub.addPeer(sub.address, sub.pubKey);
  sub.addPeer(pub.address, pub.pubKey);
  await pub.start();
  await sub.start();
  return { pub, sub };
}

describe('PeerDiscovery peer-list skill — filters', () => {

  it('excludes indirect peers (hops > 0)', async () => {
    const { pub, sub } = await buildAgents();
    const graph = new PeerGraph();
    await graph.upsert({ pubKey: 'direct-1', hops: 0, reachable: true });
    await graph.upsert({ pubKey: 'indirect', hops: 1, via: 'direct-1', reachable: true });

    const pd = new PeerDiscovery({ agent: pub, peerGraph: graph, autoHello: false });
    await pd.start();

    const result = await sub.invoke(pub.address, 'peer-list', []);
    const { peers } = Parts.data(result);
    const pubKeys = peers.map(p => p.pubKey);

    expect(pubKeys).toContain('direct-1');
    expect(pubKeys).not.toContain('indirect');
  }, 10_000);

  it('excludes unreachable peers', async () => {
    const { pub, sub } = await buildAgents();
    const graph = new PeerGraph();
    await graph.upsert({ pubKey: 'online',  hops: 0, reachable: true  });
    await graph.upsert({ pubKey: 'offline', hops: 0, reachable: false });

    const pd = new PeerDiscovery({ agent: pub, peerGraph: graph, autoHello: false });
    await pd.start();

    const { peers } = Parts.data(await sub.invoke(pub.address, 'peer-list', []));
    const pubKeys = peers.map(p => p.pubKey);

    expect(pubKeys).toContain('online');
    expect(pubKeys).not.toContain('offline');
  }, 10_000);

  it("does not echo the caller's own pubKey back", async () => {
    const { pub, sub } = await buildAgents();
    const graph = new PeerGraph();
    // Simulate that pub's graph has sub as a known peer.
    await graph.upsert({ pubKey: sub.pubKey, hops: 0, reachable: true });
    await graph.upsert({ pubKey: 'someone-else', hops: 0, reachable: true });

    const pd = new PeerDiscovery({ agent: pub, peerGraph: graph, autoHello: false });
    await pd.start();

    const { peers } = Parts.data(await sub.invoke(pub.address, 'peer-list', []));
    const pubKeys = peers.map(p => p.pubKey);

    expect(pubKeys).not.toContain(sub.pubKey);
    expect(pubKeys).toContain('someone-else');
  }, 10_000);

  it('honours discoverable:false', async () => {
    const { pub, sub } = await buildAgents();
    const graph = new PeerGraph();
    await graph.upsert({ pubKey: 'vis',   hops: 0, reachable: true, discoverable: true  });
    await graph.upsert({ pubKey: 'hide',  hops: 0, reachable: true, discoverable: false });

    const pd = new PeerDiscovery({ agent: pub, peerGraph: graph, autoHello: false });
    await pd.start();

    const { peers } = Parts.data(await sub.invoke(pub.address, 'peer-list', []));
    const pubKeys = peers.map(p => p.pubKey);

    expect(pubKeys).toContain('vis');
    expect(pubKeys).not.toContain('hide');
  }, 10_000);
});
