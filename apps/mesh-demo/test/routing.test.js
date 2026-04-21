/**
 * Tests for Group E — peer-list skill and pullPeerList gossip.
 *
 * (setupRouting / RoutingStrategy integration is light-touch here —
 *  the heavy routing logic lives in @canopy/core and is tested there.)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { InternalBus, InternalTransport, DataPart, Parts,
         Agent, AgentConfig, AgentIdentity, VaultMemory } from '@canopy/core';
import { makeAgent, startAndConnect }                     from './helpers.js';
import { registerPeerListSkill, pullPeerList, setupRouting } from '../src/routing/setup.js';

let bus, agentA, agentB, agentC;

// Topology: A ↔ B ↔ C
// A and B are direct; B and C are direct; A does not know C directly.
beforeEach(async () => {
  bus    = new InternalBus();
  agentA = await makeAgent(bus, { label: 'A' });
  agentB = await makeAgent(bus, { label: 'B' });
  agentC = await makeAgent(bus, { label: 'C' });

  registerPeerListSkill(agentA);
  registerPeerListSkill(agentB);
  registerPeerListSkill(agentC);

  await startAndConnect(agentA, agentB, agentC);

  // B knows both A and C directly
  await agentB.peers.upsert({ type: 'native', pubKey: agentA.pubKey, label: 'A', reachable: true, hops: 0, transports: {} });
  await agentB.peers.upsert({ type: 'native', pubKey: agentC.pubKey, label: 'C', reachable: true, hops: 0, transports: {} });

  // A knows only B directly
  await agentA.peers.upsert({ type: 'native', pubKey: agentB.pubKey, label: 'B', reachable: true, hops: 0, transports: {} });
});

// ── peer-list skill ───────────────────────────────────────────────────────────

describe('peer-list skill', () => {
  it('returns B\'s direct peers when called by A', async () => {
    const result = await agentA.invoke(agentB.address, 'peer-list', []);
    const data   = Parts.data(result);
    expect(Array.isArray(data?.peers)).toBe(true);
    const pubKeys = data.peers.map(p => p.pubKey);
    expect(pubKeys).toContain(agentA.pubKey);
    expect(pubKeys).toContain(agentC.pubKey);
  });

  it('does not include unreachable peers', async () => {
    // Mark C as unreachable on B
    await agentB.peers.upsert({ type: 'native', pubKey: agentC.pubKey, reachable: false });

    const result = await agentA.invoke(agentB.address, 'peer-list', []);
    const pubKeys = Parts.data(result)?.peers?.map(p => p.pubKey) ?? [];
    expect(pubKeys).not.toContain(agentC.pubKey);
  });

  it('does not include private peers when caller is tier 0', async () => {
    await agentB.peers.upsert({
      type: 'native', pubKey: agentC.pubKey,
      reachable: true, visibility: 'private',
    });

    const result  = await agentA.invoke(agentB.address, 'peer-list', []);
    const pubKeys = Parts.data(result)?.peers?.map(p => p.pubKey) ?? [];
    // agentA is tier 0 (no TrustRegistry on agentB) → private peer hidden
    expect(pubKeys).not.toContain(agentC.pubKey);
  });

  it('does not include peers with discoverable: false', async () => {
    await agentB.peers.upsert({
      type: 'native', pubKey: agentC.pubKey,
      reachable: true, discoverable: false,
    });

    const result = await agentA.invoke(agentB.address, 'peer-list', []);
    const pubKeys = Parts.data(result)?.peers?.map(p => p.pubKey) ?? [];
    expect(pubKeys).not.toContain(agentC.pubKey);
  });
});

// ── pullPeerList gossip ───────────────────────────────────────────────────────

describe('pullPeerList', () => {
  it('adds C as an indirect peer (hops:1, via:B) in A\'s PeerGraph', async () => {
    await pullPeerList(agentA, agentB.pubKey);

    const record = await agentA.peers.get(agentC.pubKey);
    expect(record).not.toBeNull();
    expect(record.hops).toBe(1);
    expect(record.via).toBe(agentB.pubKey);
    expect(record.reachable).toBe(true);
    expect(record.discoveredVia).toBe('gossip');
  });

  it('does not downgrade a direct peer to indirect', async () => {
    // Give A a direct record for C first
    await agentA.peers.upsert({
      type: 'native', pubKey: agentC.pubKey,
      reachable: true, hops: 0, transports: {},
    });

    await pullPeerList(agentA, agentB.pubKey);

    const record = await agentA.peers.get(agentC.pubKey);
    expect(record.hops).toBe(0);   // still direct
  });

  it('does not add the calling agent itself', async () => {
    await pullPeerList(agentA, agentB.pubKey);

    // A should not have added itself
    const self = await agentA.peers.get(agentA.pubKey);
    expect(self).toBeNull();
  });

  it('does not add the relay peer itself (already direct)', async () => {
    await pullPeerList(agentA, agentB.pubKey);

    // B is already direct in A's graph from beforeEach — should not be overwritten with hops:1
    const record = await agentA.peers.get(agentB.pubKey);
    expect(record.hops ?? 0).toBe(0);
  });

  it('handles an empty peer list gracefully', async () => {
    // B has no peers → pullPeerList should not add anything or throw
    const emptyB = await makeAgent(bus, { label: 'empty' });
    registerPeerListSkill(emptyB);
    await emptyB.start();
    await agentA.hello(emptyB.address);

    const before = (await agentA.peers.all()).length;
    await pullPeerList(agentA, emptyB.pubKey);
    const after  = (await agentA.peers.all()).length;
    expect(after).toBe(before);   // nothing added

    await emptyB.stop();
  });
});

// ── setupRouting ──────────────────────────────────────────────────────────────

describe('setupRouting', () => {
  it('returns a RoutingStrategy and PeerDiscovery', () => {
    const { routing, discovery } = setupRouting(agentA);
    expect(routing).toBeTruthy();
    expect(discovery).toBeTruthy();
    discovery.stop();
  });

  it('builds transports map from agent transportNames', () => {
    const { routing } = setupRouting(agentA);
    // RoutingStrategy exposes its internals minimally; just check it doesn't throw
    expect(routing).toBeTruthy();
  });

  it('accepts custom ping and gossip intervals without throwing', () => {
    const { routing, discovery } = setupRouting(agentA, {
      pingIntervalMs:   5_000,
      gossipIntervalMs: 10_000,
    });
    expect(routing).toBeTruthy();
    expect(discovery).toBeTruthy();
    discovery.stop();
  });

  it('returns null discovery when agent has no PeerGraph', async () => {
    // Build a minimal agent without PeerGraph
    const bus2    = new InternalBus();
    const vault   = new VaultMemory();
    const id      = await AgentIdentity.generate(vault);
    const config  = new AgentConfig();
    const noPeers = new Agent({
      identity:  id,
      transport: new InternalTransport(bus2, id.pubKey),
      peers:     null,
      config,
    });
    const { discovery } = setupRouting(noPeers);
    expect(discovery).toBeNull();
  });
});
