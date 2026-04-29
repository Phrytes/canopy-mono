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
 *   1. ReachabilityOracle (push-side) pick — if `agent.reachabilityOracle`
 *      is wired and `bridgeFor(target)` returns a non-null bridge, that
 *      bridge is tried first (Track G1 / Q-G.1).
 *   2. Direct peers whose oracle claim (PeerGraph pull-side) lists target.
 *   3. `record.via` (the indirect-record's currently-attributed bridge).
 *   4. Any other direct, reachable peer (last-resort probe-retry).
 *
 * The oracle is opt-in: when `agent.reachabilityOracle` is unset OR
 * `bridgeFor` returns null (silent oracle), behaviour is unchanged from
 * the pre-G1 substrate — pull-side oracle entries from PeerGraph followed
 * by record.via and the probe-retry fallback.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {string} targetPubKey
 * @param {object|null} record  — agent.peers.get(targetPubKey) result, or null
 * @returns {Promise<string[]>}
 */
export async function buildBridgeList(agent, targetPubKey, record) {
  const allPeers = (await agent.peers?.all?.()) ?? [];
  const now      = Date.now();

  const bridges = [];

  // 1. Push-side oracle (Track G1): the ReachabilityOracle wraps the agent
  //    with a TTL-cached map of signed claims received via pubsub gossip.
  //    Prepend its pick so we try it first — but only if it points to a
  //    direct, reachable peer that isn't the target itself.
  const oracle = agent.reachabilityOracle ?? null;
  if (oracle && typeof oracle.bridgeFor === 'function') {
    try {
      const pick = oracle.bridgeFor(targetPubKey);
      if (pick?.bridge && pick.bridge !== targetPubKey) {
        const direct = allPeers.find(p => p?.pubKey === pick.bridge);
        const isDirect = direct
          ? ((direct.hops ?? 0) === 0 && direct.reachable !== false)
          : true;  // unknown peers are tolerated — first-attempt may still work
        if (isDirect) bridges.push(pick.bridge);
      }
    } catch { /* oracle is best-effort — never fatal */ }
  }

  // 2. Pull-side oracle (existing path): peers whose verified knownPeers
  //    list contains the target and whose entry is still fresh.
  const pullOracleBridges = allPeers
    .filter(p => p?.pubKey && p.pubKey !== targetPubKey)
    .filter(p => (p.hops ?? 0) === 0)
    .filter(p => p.reachable !== false)
    .filter(p => Array.isArray(p.knownPeers) && p.knownPeers.includes(targetPubKey))
    .filter(p => typeof p.knownPeersTs === 'number' && p.knownPeersTs > now)
    .map(p => p.pubKey)
    .sort();

  for (const pk of pullOracleBridges) {
    if (!bridges.includes(pk)) bridges.push(pk);
  }

  // 3. record.via — the bridge the peer was last attributed through.
  if (record?.via && !bridges.includes(record.via)) bridges.push(record.via);

  // 4. Last-resort probe-retry fallback.
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
