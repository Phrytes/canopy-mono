import { describe, it, expect, vi } from 'vitest';
import { PeerDiscovery } from '../src/discovery/PeerDiscovery.js';
import { PeerGraph }     from '../src/discovery/PeerGraph.js';
import { Agent }         from '../src/Agent.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory }   from '../src/identity/VaultMemory.js';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { DataPart, Parts } from '../src/Parts.js';

async function makeAgent() {
  const bus = new InternalBus();
  const id  = await AgentIdentity.generate(new VaultMemory());
  const ag  = new Agent({ identity: id, transport: new InternalTransport(bus, id.pubKey) });
  await ag.start();
  return ag;
}

// ── discoverByQR ──────────────────────────────────────────────────────────────

describe('PeerDiscovery.discoverByQR', () => {
  it('parses a JSON QR with pubKey and address', async () => {
    const agent = await makeAgent();
    const graph = new PeerGraph();
    const pd    = new PeerDiscovery({ agent, peerGraph: graph, autoHello: false });

    const payload = JSON.stringify({
      pubKey: 'test-pub-key',
      address: 'wss://relay.example/test',
    });

    await pd.discoverByQR(payload);
    const record = await graph.get('test-pub-key');
    expect(record).not.toBeNull();
    expect(record.pubKey).toBe('test-pub-key');
  });

  it('parses a plain address string QR', async () => {
    const agent = await makeAgent();
    const graph = new PeerGraph();
    const pd    = new PeerDiscovery({ agent, peerGraph: graph, autoHello: false });

    await pd.discoverByQR('wss://relay.example/peer');
    // address becomes a relay transport entry
    const all = await graph.all();
    expect(all).toHaveLength(1);
  });

  it('throws for a URL-based QR (stub not implemented)', async () => {
    const agent = await makeAgent();
    const pd    = new PeerDiscovery({ agent, peerGraph: new PeerGraph(), autoHello: false });

    const payload = JSON.stringify({ url: 'https://agent.example.com' });
    await expect(pd.discoverByQR(payload)).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });

  it('throws for unrecognised QR payload', async () => {
    const agent = await makeAgent();
    const pd    = new PeerDiscovery({ agent, peerGraph: new PeerGraph(), autoHello: false });
    await expect(pd.discoverByQR(JSON.stringify({ foo: 'bar' }))).rejects.toThrow();
  });
});

// ── discoverByIntroduction ────────────────────────────────────────────────────

describe('PeerDiscovery.discoverByIntroduction', () => {
  it('upserts the card into the graph', async () => {
    const agent = await makeAgent();
    const graph = new PeerGraph();
    const pd    = new PeerDiscovery({ agent, peerGraph: graph, autoHello: false });

    const card = { pubKey: 'pk-alice', label: 'Alice', skills: ['echo'] };
    await pd.discoverByIntroduction(card, null);

    const r = await graph.get('pk-alice');
    expect(r.label).toBe('Alice');
    expect(r.skills).toContain('echo');
  });

  it('returns null for a card without pubKey or url', async () => {
    const agent = await makeAgent();
    const pd    = new PeerDiscovery({ agent, peerGraph: new PeerGraph(), autoHello: false });
    const r     = await pd.discoverByIntroduction({ label: 'Bad card' }, null);
    expect(r).toBeNull();
  });
});

// ── discoverByGroupBootstrap ──────────────────────────────────────────────────

describe('PeerDiscovery.discoverByGroupBootstrap', () => {
  it('discovers each member and returns records', async () => {
    const agent = await makeAgent();
    const graph = new PeerGraph();
    const pd    = new PeerDiscovery({ agent, peerGraph: graph, autoHello: false });

    const members = [
      { pubKey: 'pk1', label: 'Alice' },
      { pubKey: 'pk2', label: 'Bob'   },
    ];
    const results = await pd.discoverByGroupBootstrap(members, 'admin-key');
    expect(results).toHaveLength(2);
    expect(await graph.all()).toHaveLength(2);
  });

  it('skips malformed cards without crashing', async () => {
    const agent = await makeAgent();
    const graph = new PeerGraph();
    const pd    = new PeerDiscovery({ agent, peerGraph: graph, autoHello: false });

    const members = [
      { pubKey: 'pk1' },
      { label: 'bad card, no id' },   // should be skipped
    ];
    const results = await pd.discoverByGroupBootstrap(members, 'admin-key');
    expect(results).toHaveLength(1);
  });
});

// ── peer-list skill ───────────────────────────────────────────────────────────

describe('PeerDiscovery peer-list skill', () => {
  it('registers peer-list skill and returns discoverable peers', async () => {
    const bus    = new InternalBus();
    const pubId  = await AgentIdentity.generate(new VaultMemory());
    const subId  = await AgentIdentity.generate(new VaultMemory());
    const pub    = new Agent({ identity: pubId, transport: new InternalTransport(bus, pubId.pubKey) });
    const sub    = new Agent({ identity: subId, transport: new InternalTransport(bus, subId.pubKey) });

    pub.addPeer(sub.address, sub.pubKey);
    sub.addPeer(pub.address, pub.pubKey);
    await pub.start();
    await sub.start();

    const graph = new PeerGraph();
    await graph.upsert({ pubKey: 'pk-friend', discoverable: true,  skills: ['echo'] });
    await graph.upsert({ pubKey: 'pk-hidden', discoverable: false, skills: ['admin'] });

    const pd = new PeerDiscovery({ agent: pub, peerGraph: graph, autoHello: false });
    await pd.start();

    const result = await sub.invoke(pub.address, 'peer-list', []);
    const data   = Parts.data(result);
    expect(Array.isArray(data.peers)).toBe(true);
    expect(data.peers).toHaveLength(1);
    expect(data.peers[0].pubKey).toBe('pk-friend');
  }, 10_000);
});
