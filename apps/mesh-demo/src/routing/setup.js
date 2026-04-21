/**
 * routing/setup — Group E.
 *
 * Two responsibilities:
 *
 * 1. registerPeerListSkill(agent)
 *    Registers the 'peer-list' skill so trusted peers can ask us for our
 *    directly-reachable peer list.  This is the gossip responder side.
 *
 * 2. pullPeerList(agent, directPeerPubKey)
 *    Asks a direct peer for its list and upserts any new indirect peers
 *    (hops:1, via: directPeerPubKey) into our PeerGraph.
 *    This is the gossip initiator side.
 *
 * 3. setupRouting(agent)
 *    Wires RoutingStrategy + PeerDiscovery.  Call after createAgent() once
 *    you want automatic gossip and routing.  Optional for Group A/C/D.
 *
 * No imports from @canopy/react-native — safe to test in Node.js.
 */
import { DataPart, Parts, RoutingStrategy, PeerDiscovery } from '@canopy/core';

// ── Gossip responder ──────────────────────────────────────────────────────────

/**
 * Register the 'peer-list' skill.
 * Returns the agent's directly-reachable peers to authenticated callers.
 *
 * @param {import('@canopy/core').Agent} agent
 */
export function registerPeerListSkill(agent) {
  agent.register('peer-list', async ({ from }) => {
    const tier = await agent.trustRegistry?.getTier(from) ?? 0;
    const all  = await agent.peers?.all() ?? [];

    const visible = all
      .filter(p => p.reachable)
      .filter(p => p.discoverable !== false)
      .filter(p => {
        // Private-visibility peers only shared with tier ≥ 1 callers
        if (p.visibility === 'private') return tier >= 1;
        return true;
      })
      .map(p => ({
        pubKey:     p.pubKey,
        label:      p.label    ?? null,
        transports: Object.keys(p.transports ?? {}),
      }));

    return [DataPart({ peers: visible })];
  }, {
    visibility:  'authenticated',
    description: 'Return list of directly reachable peers (gossip responder)',
  });
}

// ── Gossip initiator ──────────────────────────────────────────────────────────

/**
 * Ask a direct peer for its peer list and upsert any new entries as
 * indirect peers (hops: 1, via: directPeerPubKey) into our PeerGraph.
 *
 * Safe to call repeatedly — existing direct peers are never downgraded to
 * indirect, and duplicate indirect entries are merged by PeerGraph.upsert().
 *
 * @param {import('@canopy/core').Agent} agent
 * @param {string} directPeerPubKey
 */
export async function pullPeerList(agent, directPeerPubKey) {
  if (!agent.peers) return;

  const resultParts = await agent.invoke(directPeerPubKey, 'peer-list', [], { timeout: 5_000 });
  const data = Parts.data(resultParts);
  if (!Array.isArray(data?.peers)) return;

  for (const card of data.peers) {
    if (!card?.pubKey)                    continue;  // malformed
    if (card.pubKey === agent.pubKey)     continue;  // don't add ourselves
    if (card.pubKey === directPeerPubKey) continue;  // already direct

    const existing = await agent.peers.get(card.pubKey);
    // Never overwrite a direct (hops:0) record with an indirect one
    if (existing && (existing.hops ?? 0) === 0) continue;

    await agent.peers.upsert({
      type:          'native',
      pubKey:        card.pubKey,
      label:         card.label    ?? null,
      reachable:     true,
      hops:          1,
      via:           directPeerPubKey,
      discoveredVia: 'gossip',
      transports:    {},
      knownPeers:    [],
      discoverable:  true,
    });
  }
}

// ── RoutingStrategy + PeerDiscovery ───────────────────────────────────────────

/**
 * Wire RoutingStrategy and PeerDiscovery onto the agent.
 *
 * Returns { routing, discovery } for callers that need to stop() discovery
 * or inspect the routing table.
 *
 * @param {import('@canopy/core').Agent} agent
 * @param {object} [opts]
 * @param {number} [opts.pingIntervalMs=30000]
 * @param {number} [opts.gossipIntervalMs=60000]
 * @returns {{ routing: RoutingStrategy, discovery: PeerDiscovery|null }}
 */
export function setupRouting(agent, opts = {}) {
  // Build the transports map from whatever is attached to the agent
  const transports = Object.fromEntries(
    agent.transportNames.map(n => [n, agent.getTransport(n)])
  );

  const routing = new RoutingStrategy({
    transports,
    peerGraph: agent.peers ?? null,
    config:    agent.config?.snapshot().policy ?? {},
  });

  // Store on agent so transportFor() can use it
  // (Agent exposes agent.routing as a settable property via the constructor,
  // but there's no public setter — callers can pass routing: in the constructor
  // instead of calling this function.  For post-hoc wiring we set the internal
  // property directly here, which is an app-level decision.)
  agent._routing = routing;

  let discovery = null;
  if (agent.peers) {
    discovery = new PeerDiscovery({
      agent,
      peerGraph:       agent.peers,
      pingIntervalMs:  opts.pingIntervalMs  ?? 30_000,
      gossipIntervalMs: opts.gossipIntervalMs ?? 60_000,
    });
    discovery.start();
  }

  return { routing, discovery };
}
