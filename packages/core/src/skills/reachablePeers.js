/**
 * reachablePeers skill — exposes this agent's signed reachability claim.
 *
 * Every call to `reachable-peers` returns { body, sig } for the current
 * direct-peer set. The producer caches the claim in memory and only
 * re-signs when:
 *   (a) the cached direct-peer set no longer matches reality, OR
 *   (b) the cached claim's TTL has less than `refreshBeforeMs` left, OR
 *   (c) there is no cached claim yet.
 *
 * See Design-v3/oracle-bridge-selection.md §3 and CODING-PLAN.md Group T3.
 */
import { DataPart }                        from '../Parts.js';
import { signReachabilityClaim }            from '../security/reachabilityClaim.js';

export const DEFAULT_TTL_MS             = 5 * 60_000;
export const DEFAULT_REFRESH_BEFORE_MS  = 60_000;
export const DEFAULT_MAX_PEERS          = 256;

/**
 * Register the `reachable-peers` skill on `agent`.
 *
 * Resolution for each option: explicit arg → `agent.config.get('oracle.<name>')`
 * → built-in default.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {object}  [opts]
 * @param {number}  [opts.ttlMs]
 * @param {number}  [opts.refreshBeforeMs]
 * @param {number}  [opts.maxPeers]
 * @param {object}  [opts.seqStore]          — forwarded to signReachabilityClaim
 */
export function registerReachablePeersSkill(agent, opts = {}) {
  if (agent.skills.get('reachable-peers')) return;  // idempotent

  const resolve = (key, fallback) => {
    if (opts[key] !== undefined)                    return opts[key];
    const fromCfg = agent.config?.get?.(`oracle.${key}`);
    if (fromCfg !== undefined && fromCfg !== null)  return fromCfg;
    return fallback;
  };

  const ttlMs           = resolve('ttlMs',           DEFAULT_TTL_MS);
  const refreshBeforeMs = resolve('refreshBeforeMs', DEFAULT_REFRESH_BEFORE_MS);
  const maxPeers        = resolve('maxPeers',        DEFAULT_MAX_PEERS);
  const seqStore        = opts.seqStore;   // undefined → helper's default store

  /** @type {{ claim: object, signedAt: number, peerSetKey: string } | null} */
  let cache = null;

  agent.register('reachable-peers', async () => {
    const peers    = await _directPeerPubKeys(agent, maxPeers);
    const setKey   = peers.join(',');
    const now      = Date.now();
    const ageLimit = ttlMs - refreshBeforeMs;

    const stale =
      !cache
      || cache.peerSetKey !== setKey
      || (now - cache.signedAt) >= ageLimit;

    if (stale) {
      const claim = await signReachabilityClaim(
        agent.identity,
        peers,
        { ttlMs, seqStore },
      );
      cache = { claim, signedAt: now, peerSetKey: setKey };
    }

    return [DataPart(cache.claim)];
  }, {
    visibility:  'authenticated',
    description: 'Return a signed list of directly reachable peers',
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Read the current direct-peer pubKey set from the PeerGraph, sorted and
 * truncated to `maxPeers`. Self is implicitly excluded (agent's own pubkey
 * is never in its own PeerGraph).
 */
async function _directPeerPubKeys(agent, maxPeers) {
  if (!agent.peers) return [];
  const all = await agent.peers.all();
  const pks = all
    .filter(p => p.pubKey && p.pubKey !== agent.pubKey)
    .filter(p => (p.hops ?? 0) === 0)
    .filter(p => p.reachable !== false)
    .map(p => p.pubKey);
  pks.sort();
  return pks.slice(0, maxPeers);
}
