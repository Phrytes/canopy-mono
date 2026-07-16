/**
 * Test helpers — Node.js-compatible agent factory.
 *
 * Mirrors what createAgent() does in src/agent.js but uses only
 * @onderling/core classes so tests run without React Native native modules.
 *
 * The relay / routing logic under test (relaySkill, invokeWithHop, setup)
 * only depends on the Agent API, not on which transports it runs, so this
 * substitution is valid.
 */
import { Agent, AgentConfig, AgentIdentity, InternalBus, InternalTransport, PeerGraph, TrustRegistry } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

/**
 * Create a test agent pair sharing an InternalBus.
 * Both agents can exchange messages immediately after start().
 *
 * @param {InternalBus} bus
 * @param {object}      [opts]
 * @param {string}      [opts.label]
 * @param {string}      [opts.allowRelayFor='never']
 * @param {boolean}     [opts.withTrustRegistry=false]
 * @returns {Promise<Agent>}
 */
export async function makeAgent(bus, {
  label          = 'agent',
  allowRelayFor  = 'never',
  withTrustRegistry = false,
} = {}) {
  const vault    = new VaultMemory();
  const identity = await AgentIdentity.generate(vault);
  const transport = new InternalTransport(bus, identity.pubKey);
  const peers     = new PeerGraph();
  const config    = new AgentConfig({
    overrides: {
      discovery: { discoverable: true, acceptHelloFromTier0: true },
      policy:    { allowRelayFor },
    },
  });

  const trustRegistry = withTrustRegistry ? new TrustRegistry(vault) : null;

  const agent = new Agent({
    identity,
    transport,
    peers,
    config,
    label,
    ...(trustRegistry ? { trustRegistry } : {}),
  });

  // Wire inbound hellos into PeerGraph (mirrors src/agent.js behaviour)
  agent.on('peer', ({ address, pubKey, label: peerLabel }) => {
    if (!pubKey) return;
    peers.upsert({
      type:          'native',
      pubKey,
      label:         peerLabel ?? null,
      reachable:     true,
      lastSeen:      Date.now(),
      discoveredVia: 'hello',
      transports:    { default: { address, lastSeen: Date.now() } },
    }).catch(() => {});
  });

  return agent;
}

/**
 * Start multiple agents and perform hello handshakes between adjacent pairs.
 * Returns the agents in the same order they were passed.
 *
 * @param {...Agent} agents
 * @returns {Promise<Agent[]>}
 */
export async function startAndConnect(...agents) {
  await Promise.all(agents.map(a => a.start()));
  // Connect each adjacent pair
  for (let i = 0; i < agents.length - 1; i++) {
    await agents[i].hello(agents[i + 1].address);
  }
  return agents;
}
