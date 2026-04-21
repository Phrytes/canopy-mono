/**
 * pullPeerList — ask a direct peer for its peer-list and merge the response
 * into our PeerGraph as indirect (hops:1, via: directPeerPubKey) entries.
 *
 * Safe to call repeatedly:
 *   • Own pubKey and the direct peer itself are filtered out.
 *   • Records already direct (hops:0) are never downgraded to indirect.
 *   • Duplicate indirect entries are merged by PeerGraph.upsert.
 *
 * See EXTRACTION-PLAN.md §7 Group M.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {string}  directPeerPubKey
 * @param {object}  [opts]
 * @param {number}  [opts.timeout=5000]
 */
import { Parts } from '../Parts.js';

export async function pullPeerList(agent, directPeerPubKey, opts = {}) {
  if (!agent?.peers || !directPeerPubKey) return 0;

  const timeout = opts.timeout ?? 5_000;
  let resultParts;
  try {
    resultParts = await agent.invoke(directPeerPubKey, 'peer-list', [], { timeout });
  } catch {
    return 0; // peer unreachable or skill absent
  }

  const data = Parts.data(resultParts);
  if (!Array.isArray(data?.peers)) return 0;

  let added = 0;
  for (const card of data.peers) {
    if (!card?.pubKey)                    continue;
    if (card.pubKey === agent.pubKey)     continue;
    if (card.pubKey === directPeerPubKey) continue;

    const existing = await agent.peers.get(card.pubKey);
    // Never downgrade a direct (hops:0) record to indirect.
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
    added++;
  }

  return added;
}
