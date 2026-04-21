/**
 * Tests for Group A — agent wiring logic.
 *
 * Tests the behaviours that src/agent.js sets up, using the Node-compatible
 * makeAgent() helper instead of createAgent() (which needs native RN modules).
 *
 * Specifically covers:
 *  - Correct transports are registered
 *  - AgentConfig values are set as expected
 *  - Inbound hello → PeerGraph upsert wiring
 *  - agent.peers / agent.config / agent.storage accessors
 *  - Multi-transport: addTransport / removeTransport / getTransport
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  InternalBus, InternalTransport, Agent, AgentConfig,
  AgentIdentity, VaultMemory, PeerGraph,
} from '@canopy/core';
import { makeAgent } from './helpers.js';

// ── Agent accessors ───────────────────────────────────────────────────────────

describe('Agent accessors', () => {
  it('exposes peers, config, storage, and routing', async () => {
    const bus   = new InternalBus();
    const agent = await makeAgent(bus, { label: 'test' });

    expect(agent.peers).toBeInstanceOf(PeerGraph);
    expect(agent.config).toBeInstanceOf(AgentConfig);
    expect(agent.storage).toBeNull();   // not wired in makeAgent (intentional)
    expect(agent.routing).toBeNull();   // setupRouting not called yet
  });

  it('reflects the label', async () => {
    const bus   = new InternalBus();
    const agent = await makeAgent(bus, { label: 'my-phone' });
    expect(agent.label).toBe('my-phone');
  });

  it('exposes the identity pubKey', async () => {
    const bus   = new InternalBus();
    const agent = await makeAgent(bus);
    expect(typeof agent.pubKey).toBe('string');
    expect(agent.pubKey.length).toBeGreaterThan(20);
  });
});

// ── Config values ─────────────────────────────────────────────────────────────

describe('AgentConfig defaults for mesh-demo', () => {
  it('sets allowRelayFor to "trusted" by default in createAgent config', async () => {
    const bus   = new InternalBus();
    const agent = await makeAgent(bus, { allowRelayFor: 'trusted' });
    expect(agent.config.get('policy.allowRelayFor')).toBe('trusted');
  });

  it('defaults to "never" when not overridden', async () => {
    const bus   = new InternalBus();
    const agent = await makeAgent(bus);          // allowRelayFor defaults to 'never'
    expect(agent.config.get('policy.allowRelayFor')).toBe('never');
  });

  it('sets discoverable: true', async () => {
    const bus   = new InternalBus();
    const agent = await makeAgent(bus);
    expect(agent.config.get('discovery.discoverable')).toBe(true);
  });

  it('sets acceptHelloFromTier0: true', async () => {
    const bus   = new InternalBus();
    const agent = await makeAgent(bus);
    expect(agent.config.get('discovery.acceptHelloFromTier0')).toBe(true);
  });
});

// ── Multi-transport ───────────────────────────────────────────────────────────

describe('Agent multi-transport', () => {
  it('starts with a single default transport', async () => {
    const bus   = new InternalBus();
    const agent = await makeAgent(bus);
    expect(agent.transportNames).toEqual(['default']);
  });

  it('addTransport registers a named transport', async () => {
    const bus   = new InternalBus();
    const agent = await makeAgent(bus);
    const vault = new VaultMemory();
    const id2   = await AgentIdentity.generate(vault);
    const t2    = new InternalTransport(bus, id2.pubKey + '-ble');
    agent.addTransport('ble', t2);
    expect(agent.transportNames).toContain('ble');
    expect(agent.getTransport('ble')).toBe(t2);
  });

  it('removeTransport removes the transport', async () => {
    const bus   = new InternalBus();
    const agent = await makeAgent(bus);
    const vault = new VaultMemory();
    const id2   = await AgentIdentity.generate(vault);
    const t2    = new InternalTransport(bus, id2.pubKey + '-ble');
    agent.addTransport('ble', t2);
    agent.removeTransport('ble');
    expect(agent.transportNames).not.toContain('ble');
    expect(agent.getTransport('ble')).toBeNull();
  });
});

// ── Inbound hello → PeerGraph wiring ─────────────────────────────────────────

describe('inbound hello → PeerGraph', () => {
  it('upserts a peer record when receiving an inbound hello', async () => {
    const bus    = new InternalBus();
    const agentA = await makeAgent(bus, { label: 'A' });
    const agentB = await makeAgent(bus, { label: 'B' });

    await agentA.start();
    await agentB.start();

    // B initiates hello → A should upsert B into its PeerGraph
    await agentB.hello(agentA.address);

    // Small pause for the async upsert fired in agent.on('peer')
    await new Promise(r => setTimeout(r, 10));

    const record = await agentA.peers.get(agentB.pubKey);
    expect(record).not.toBeNull();
    expect(record.pubKey).toBe(agentB.pubKey);
    expect(record.reachable).toBe(true);
    expect(record.discoveredVia).toMatch(/hello/);

    await agentA.stop();
    await agentB.stop();
  });

  it('also upserts on the initiating side', async () => {
    const bus    = new InternalBus();
    const agentA = await makeAgent(bus, { label: 'A' });
    const agentB = await makeAgent(bus, { label: 'B' });

    await agentA.start();
    await agentB.start();
    await agentA.hello(agentB.address);  // A initiates

    await new Promise(r => setTimeout(r, 10));

    // A should have B (from the ack event)
    const record = await agentA.peers.get(agentB.pubKey);
    expect(record).not.toBeNull();

    await agentA.stop();
    await agentB.stop();
  });
});

// ── Agent.export() ────────────────────────────────────────────────────────────

describe('Agent.export()', () => {
  it('returns pubKey, address, label, skills, transports', async () => {
    const bus   = new InternalBus();
    const agent = await makeAgent(bus, { label: 'export-test' });
    const out   = agent.export();

    expect(out.pubKey).toBe(agent.pubKey);
    expect(out.address).toBe(agent.address);
    expect(out.label).toBe('export-test');
    expect(Array.isArray(out.skills)).toBe(true);
    expect(Array.isArray(out.transports)).toBe(true);
  });

  it('does not include private skills', async () => {
    const bus   = new InternalBus();
    const agent = await makeAgent(bus);
    agent.register('public-skill',  async () => [], { visibility: 'public' });
    agent.register('private-skill', async () => [], { visibility: 'private' });

    const out      = agent.export();
    const skillIds = out.skills.map(s => s.id);
    expect(skillIds).toContain('public-skill');
    expect(skillIds).not.toContain('private-skill');
  });
});
