/**
 * GossipProtocol — periodic peer-list exchange with random tier-1+ peers.
 *
 * Each round:
 *   1. Pick a random reachable peer with tier ≥ 'authenticated'.
 *   2. Call the 'peer-list' skill on that peer (OW request + response).
 *   3. For each card returned with discoverable: true → discoverByIntroduction.
 *
 * Privacy: we only share peers with discoverable: true when we respond to
 * peer-list requests.  The responder side lives in Agent skill registration
 * (see registerGossipSkill helper).
 */
import { Parts }                      from '../Parts.js';
import { verifyReachabilityClaim }     from '../security/reachabilityClaim.js';

export class GossipProtocol {
  #agent;
  #peerGraph;
  #discovery;   // PeerDiscovery (injected to avoid circular dep)
  #intervalMs;
  #maxPeersPerRound;
  #timer   = null;
  #running = false;

  /**
   * @param {object} opts
   * @param {import('../Agent.js').Agent}              opts.agent
   * @param {import('./PeerGraph.js').PeerGraph}       opts.peerGraph
   * @param {object}                                   opts.discovery     — PeerDiscovery
   * @param {number} [opts.intervalMs=60000]
   * @param {number} [opts.maxPeersPerRound=8]         — max cards to process per round
   */
  constructor({ agent, peerGraph, discovery, intervalMs = 60_000, maxPeersPerRound = 8 }) {
    this.#agent            = agent;
    this.#peerGraph        = peerGraph;
    this.#discovery        = discovery;
    this.#intervalMs       = intervalMs;
    this.#maxPeersPerRound = maxPeersPerRound;
  }

  /** Start the gossip loop. */
  start() {
    if (this.#running) return;
    this.#running = true;
    this.#schedule();
  }

  /** Stop the gossip loop. */
  stop() {
    this.#running = false;
    clearTimeout(this.#timer);
    this.#timer = null;
  }

  /**
   * Run one gossip round immediately.
   * Exported so tests can drive it synchronously.
   */
  async runRound() {
    const candidates = await this.#pickCandidates();
    if (candidates.length === 0) return;

    const target = candidates[Math.floor(Math.random() * candidates.length)];
    const peerId = target.pubKey ?? target.url;
    if (!peerId) return;

    let cards;
    try {
      const result = await this.#agent.invoke(peerId, 'peer-list', [], { timeout: 10_000 });
      // The peer-list skill returns [DataPart({ peers: [...] })].
      const data = Parts.data(result);
      cards = Array.isArray(data?.peers) ? data.peers : [];
    } catch {
      return;  // peer unreachable or skill absent
    }

    const toProcess = cards
      .filter(c => c && c.discoverable !== false)
      .slice(0, this.#maxPeersPerRound);

    for (const card of toProcess) {
      await this.#discovery.discoverByIntroduction(card, peerId).catch(() => {});
    }

    // Also pull the signed reachability claim so the oracle bridge-selection
    // path in invokeWithHop has a fresh cache for this peer. See Group T6.
    await this.#pullReachabilityClaim(peerId).catch(() => {});
  }

  /**
   * Pull `reachable-peers` from `peerId`, verify with the peer's
   * lastSeenSeq from the graph, and on success upsert knownPeers +
   * knownPeersTs + knownPeersSeq + knownPeersSig. Errors are emitted
   * as `reachability-claim-rejected` on the agent for telemetry —
   * never thrown.
   */
  async #pullReachabilityClaim(peerId) {
    let claim;
    try {
      const result = await this.#agent.invoke(peerId, 'reachable-peers', [], { timeout: 10_000 });
      claim        = Parts.data(result);
    } catch {
      return;  // peer doesn't expose the skill, or unreachable — both benign
    }

    const existing     = await this.#peerGraph.get(peerId);
    const lastSeenSeq  = existing?.knownPeersSeq;

    const res = verifyReachabilityClaim(claim, {
      expectedIssuer: peerId,
      lastSeenSeq,
    });

    if (!res.ok) {
      this.#agent.emit('reachability-claim-rejected', { issuer: peerId, reason: res.reason });
      return;
    }

    await this.#peerGraph.upsert({
      pubKey:         peerId,
      knownPeers:     [...claim.body.p],
      knownPeersTs:   Date.now() + claim.body.t,
      knownPeersSeq:  res.newLastSeq,
      knownPeersSig:  claim.sig,
    });
  }

  // ── Private ────────────────────────────────────────────────────────────────

  #schedule() {
    if (!this.#running) return;
    this.#timer = setTimeout(async () => {
      try { await this.runRound(); } catch { /* ignore */ }
      this.#schedule();
    }, this.#intervalMs);
  }

  async #pickCandidates() {
    const peers = await this.#peerGraph.reachable();
    // Filter to authenticated (tier 1+) peers only.
    return peers.filter(p => {
      const t = p.tier;
      if (!t) return true;  // unknown tier → optimistic
      return t === 'authenticated' || t === 'trusted' || t === 'private';
    });
  }
}
