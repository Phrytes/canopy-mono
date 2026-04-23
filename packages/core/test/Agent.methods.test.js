/**
 * Agent API ergonomics — Group N.
 *
 * Covers agent.invokeWithHop, agent.enableRelayForward, agent.startDiscovery.
 * See EXTRACTION-PLAN.md §7 Group N and CODING-PLAN.md Group N.
 */
import { describe, it, expect, vi } from 'vitest';
import { Agent }         from '../src/Agent.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory }   from '../src/identity/VaultMemory.js';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { PeerGraph }     from '../src/discovery/PeerGraph.js';
import { AgentConfig }   from '../src/config/AgentConfig.js';
import { DataPart, Parts } from '../src/Parts.js';

async function makeAgent({ peers, config } = {}) {
  const bus      = new InternalBus();
  const identity = await AgentIdentity.generate(new VaultMemory());
  const agent    = new Agent({
    identity,
    transport: new InternalTransport(bus, identity.pubKey),
    peers:     peers ?? new PeerGraph(),
    config,
  });
  await agent.start();
  return agent;
}

describe('agent.invokeWithHop', () => {
  it('delegates through callWithHop and returns the peer\'s parts', async () => {
    const peers = new PeerGraph();
    await peers.upsert({ pubKey: 'peer-X', hops: 0, reachable: true });

    const agent = await makeAgent({ peers });

    // Stub the underlying direct-call so we don't need a real remote peer.
    // After Group CC3, the direct path goes through agent.call (which
    // returns a Task) rather than agent.invoke; callWithHop is the actual
    // entry point so that streaming/IR/cancel work on the direct leg.
    const { Task } = await import('../src/protocol/Task.js');
    agent.call = vi.fn((peer, skill) => {
      const t = new Task({ taskId: 'stub-1', skillId: skill, agent, peerId: peer, state: 'working' });
      queueMicrotask(() => t._transition('completed', { parts: [DataPart({ ok: 'hop' })] }));
      return t;
    });

    const out = await agent.invokeWithHop('peer-X', 'echo', []);
    expect(Parts.data(out)).toEqual({ ok: 'hop' });
    expect(agent.call).toHaveBeenCalledTimes(1);
    expect(agent.call.mock.calls[0][0]).toBe('peer-X');
    expect(agent.call.mock.calls[0][1]).toBe('echo');
  });
});

describe('agent.enableRelayForward', () => {
  it('registers the relay-forward skill', async () => {
    const agent = await makeAgent();
    expect(agent.skills.get('relay-forward')).toBeFalsy();

    agent.enableRelayForward();

    expect(agent.skills.get('relay-forward')).toBeTruthy();
  });

  it('is idempotent — calling twice does not double-register', async () => {
    const agent = await makeAgent();
    agent.enableRelayForward();
    const firstSkill = agent.skills.get('relay-forward');
    agent.enableRelayForward();
    const secondSkill = agent.skills.get('relay-forward');
    expect(secondSkill).toBe(firstSkill);
  });

  it('applies the policy override into AgentConfig when provided', async () => {
    const config = new AgentConfig({});
    const agent  = await makeAgent({ config });

    agent.enableRelayForward({ policy: 'authenticated' });

    expect(config.get('policy.allowRelayFor')).toBe('authenticated');
  });

  it('returns the agent for chaining', async () => {
    const agent = await makeAgent();
    expect(agent.enableRelayForward()).toBe(agent);
  });
});

describe('agent.startDiscovery', () => {
  it('creates a PeerDiscovery and exposes it via agent.discovery', async () => {
    const agent = await makeAgent();
    expect(agent.discovery).toBeNull();

    const discovery = agent.startDiscovery({ pingIntervalMs: 1_000_000, gossipIntervalMs: 1_000_000 });

    expect(discovery).not.toBeNull();
    expect(agent.discovery).toBe(discovery);

    // Stop so the background timers don't keep the test alive.
    await discovery.stop();
  });

  it('is idempotent — second call returns the same instance', async () => {
    const agent = await makeAgent();
    const a = agent.startDiscovery({ pingIntervalMs: 1_000_000, gossipIntervalMs: 1_000_000 });
    const b = agent.startDiscovery({ pingIntervalMs: 1_000_000, gossipIntervalMs: 1_000_000 });
    expect(a).toBe(b);
    await a.stop();
  });

  it('registers the peer-list skill as a side effect of starting', async () => {
    const agent = await makeAgent();
    expect(agent.skills.get('peer-list')).toBeFalsy();

    const discovery = agent.startDiscovery({ pingIntervalMs: 1_000_000, gossipIntervalMs: 1_000_000 });

    expect(agent.skills.get('peer-list')).toBeTruthy();
    await discovery.stop();
  });
});
