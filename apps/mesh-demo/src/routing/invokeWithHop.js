/**
 * invokeWithHop — Group C.
 *
 * Hop-aware invoke: tries direct first, then looks for a relay peer that
 * knows the target (via knownPeers in the PeerGraph record), and asks it
 * to forward via the 'relay-forward' skill.
 *
 * Usage:
 *   import { invokeWithHop } from './routing/invokeWithHop';
 *   const result = await invokeWithHop(agent, phoneBPubKey, 'echo', [TextPart('hi')]);
 *
 * Replace agent.invoke() calls with invokeWithHop() anywhere the target may
 * not be directly reachable.  Once Group E (RoutingStrategy) is wired, this
 * helper can be retired in favour of transparent routing.
 *
 * No imports from @canopy/react-native — safe to test in Node.js.
 */
import { DataPart, Parts } from '@canopy/core';

/**
 * Invoke a skill on targetPubKey, routing via a relay hop if needed.
 *
 * @param {import('@canopy/core').Agent} agent
 * @param {string}  targetPubKey
 * @param {string}  skillId
 * @param {Array}   parts
 * @param {object}  [opts]
 * @param {number}  [opts.timeout]
 * @returns {Promise<import('@canopy/core').Parts[]>}
 */
export async function invokeWithHop(agent, targetPubKey, skillId, parts = [], opts = {}) {
  // ── 1. Try direct ──────────────────────────────────────────────────────────
  const direct = await agent.peers?.get(targetPubKey);
  if (direct?.reachable) {
    return agent.invoke(targetPubKey, skillId, parts, opts);
  }

  // ── 2. Find a relay peer that lists the target in its knownPeers ───────────
  const allPeers = await agent.peers?.all() ?? [];
  const relayPeers = allPeers.filter(
    p => p.reachable && p.pubKey !== targetPubKey && (p.knownPeers ?? []).includes(targetPubKey)
  );

  if (relayPeers.length === 0) {
    throw new Error(
      `No route to ${targetPubKey.slice(0, 12)}… ` +
      `— not reachable directly and no relay peer knows the target`
    );
  }

  // Pick the relay with the lowest hop count (prefer one that's already direct)
  const relay = relayPeers.sort((a, b) => (a.hops ?? 0) - (b.hops ?? 0))[0];

  // ── 3. Ask relay to forward ────────────────────────────────────────────────
  const relayResult = await agent.invoke(
    relay.pubKey,
    'relay-forward',
    [DataPart({
      targetPubKey,
      skill:   skillId,
      payload: parts,
      timeout: opts.timeout,
    })],
    { timeout: (opts.timeout ?? 10_000) + 2_000 },  // extra margin for the hop
  );

  const data = Parts.data(relayResult);

  if (data?.error) {
    throw new Error(`Relay hop via ${relay.pubKey.slice(0, 12)}… failed: ${data.error}`);
  }

  // relay-forward returns DataPart({ forwarded: true, parts: <original Part[]> })
  // data.parts is the forwarded result as a plain-object array (JSON-round-tripped).
  if (data?.forwarded) return data.parts ?? [];
  return relayResult;
}
