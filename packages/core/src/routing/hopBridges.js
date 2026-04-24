/**
 * hopBridges — bridge candidate selection for hop-aware calls.
 *
 * Extracted from callWithHop.js (Group CC) so the orchestrator stays
 * focused on flow and bridge selection can be tested in isolation.
 *
 * Two pieces:
 *   • buildBridgeList(agent, target, record):
 *       returns a deduped pubkey list of peers that may be willing /
 *       able to forward to `target`.  Oracle-claim peers (Group T)
 *       come first, then `record.via`, then any direct peer the agent
 *       still considers reachable.
 *   • bridgeSupportsTunnel(agent, bridgePubKey, opts):
 *       returns true iff that bridge advertises `tunnel: true` in its
 *       PeerGraph capabilities snapshot (delivered via hello.js — no
 *       per-call get-capabilities probe).  `opts.tunnel === false`
 *       lets a caller force the one-shot fallback.
 */

/**
 * Build a list of candidate bridges for `targetPubKey`, deduped.
 *
 * Order:
 *   1. Direct peers whose oracle claim (Group T) lists target as reachable.
 *   2. `record.via` (the indirect-record's currently-attributed bridge).
 *   3. Any other direct, reachable peer (last-resort probe).
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {string} targetPubKey
 * @param {object|null} record  — agent.peers.get(targetPubKey) result, or null
 * @returns {Promise<string[]>}
 */
export async function buildBridgeList(agent, targetPubKey, record) {
  const allPeers = (await agent.peers?.all?.()) ?? [];
  const now      = Date.now();

  const oracleBridges = allPeers
    .filter(p => p?.pubKey && p.pubKey !== targetPubKey)
    .filter(p => (p.hops ?? 0) === 0)
    .filter(p => p.reachable !== false)
    .filter(p => Array.isArray(p.knownPeers) && p.knownPeers.includes(targetPubKey))
    .filter(p => typeof p.knownPeersTs === 'number' && p.knownPeersTs > now)
    .map(p => p.pubKey)
    .sort();

  const bridges = [...oracleBridges];
  if (record?.via && !bridges.includes(record.via)) bridges.push(record.via);

  for (const p of allPeers) {
    if (!p?.pubKey || p.pubKey === targetPubKey) continue;
    if ((p.hops ?? 0) !== 0)        continue;
    if (p.reachable === false)      continue;
    if (bridges.includes(p.pubKey)) continue;
    bridges.push(p.pubKey);
  }

  return bridges;
}

/**
 * True iff this bridge advertises a hop-aware tunnel (Group CC).
 *
 * Capability discovery rides the hello handshake — hello.js stores the
 * peer's advertised `capabilities` on the PeerGraph record.  We do NOT
 * issue a per-call get-capabilities probe because that costs a round
 * trip per hop.  If a caller wants a live refresh they can call
 * get-capabilities manually; hello.js will upsert the result.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {string} bridgePubKey
 * @param {object} [opts]
 * @param {boolean} [opts.tunnel]  — pass `false` to force one-shot fallback
 * @returns {Promise<boolean>}
 */
export async function bridgeSupportsTunnel(agent, bridgePubKey, opts = {}) {
  if (opts.tunnel === false) return false;
  const record = await agent.peers?.get?.(bridgePubKey);
  return !!record?.capabilities?.tunnel;
}
