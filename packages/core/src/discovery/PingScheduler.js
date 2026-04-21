/**
 * PingScheduler — periodically pings all reachable peers and updates the
 * PeerGraph's reachability and latency data.
 *
 * On consecutive failures an exponential backoff is applied so that a
 * persistently unreachable peer is pinged less frequently over time.
 *
 * Backoff sequence (in units of the base interval):
 *   failures: 0 → 1 → 2 → 4 → 8 → 16 → … (capped at maxBackoffMs)
 */
export class PingScheduler {
  #agent;
  #peerGraph;
  #intervalMs;
  #maxBackoffMs;
  #timer        = null;
  #running      = false;

  /** consecutive-failure count per peer */
  #failures = new Map();
  /** unix-ms timestamp: next ping allowed for peer */
  #nextPing = new Map();

  /**
   * @param {object} opts
   * @param {import('../Agent.js').Agent}              opts.agent
   * @param {import('./PeerGraph.js').PeerGraph}       opts.peerGraph
   * @param {number} [opts.intervalMs=30000]           — base ping interval
   * @param {number} [opts.maxBackoffMs=3600000]       — cap for exponential backoff (1h)
   */
  constructor({ agent, peerGraph, intervalMs = 30_000, maxBackoffMs = 3_600_000 }) {
    this.#agent        = agent;
    this.#peerGraph    = peerGraph;
    this.#intervalMs   = intervalMs;
    this.#maxBackoffMs = maxBackoffMs;
  }

  /** Start the background ping loop. */
  start() {
    if (this.#running) return;
    this.#running = true;
    this.#schedule();
  }

  /** Stop the background ping loop. */
  stop() {
    this.#running = false;
    clearTimeout(this.#timer);
    this.#timer = null;
  }

  /**
   * Ping all reachable peers now (ignoring backoff timers).
   * Called automatically by the scheduler; can also be called manually.
   */
  async pingAll() {
    const peers = await this.#peerGraph.all();
    const now   = Date.now();

    await Promise.allSettled(peers.map(peer => this.#pingOne(peer, now)));
  }

  // ── Private ────────────────────────────────────────────────────────────────

  #schedule() {
    if (!this.#running) return;
    this.#timer = setTimeout(async () => {
      try { await this.pingAll(); } catch { /* ignore */ }
      this.#schedule();
    }, this.#intervalMs);
  }

  async #pingOne(peer, now) {
    const id = peer.pubKey ?? peer.url;
    if (!id) return;

    // Backoff: skip if the peer is in its wait window.
    const next = this.#nextPing.get(id) ?? 0;
    if (now < next) return;

    let latencyMs = null;
    if (typeof this.#agent.transport?.ping === 'function') {
      try {
        const t0  = Date.now();
        await this.#agent.transport.ping(id);
        latencyMs = Date.now() - t0;
      } catch {
        // Transport-level ping failed — fall through to protocol ping.
      }
    }

    if (latencyMs === null) {
      const { ping } = await import('../protocol/ping.js');
      try {
        const t0  = Date.now();
        await ping(this.#agent, id, 5_000);
        latencyMs = Date.now() - t0;
      } catch {
        latencyMs = null;
      }
    }

    if (latencyMs !== null) {
      // Success — reset failures and update graph.
      const wasUnreachable = peer.reachable === false;
      this.#failures.set(id, 0);
      this.#nextPing.delete(id);
      await this.#peerGraph.updateLatency(id, this.#agent.transport?.name ?? 'default', latencyMs);
      if (wasUnreachable) await this.#peerGraph.setReachable(id, true);
    } else {
      // Failure — increment counter and back off.
      const failures = (this.#failures.get(id) ?? 0) + 1;
      this.#failures.set(id, failures);
      const backoff  = Math.min(
        this.#intervalMs * Math.pow(2, failures - 1),
        this.#maxBackoffMs,
      );
      this.#nextPing.set(id, now + backoff);
      if (peer.reachable !== false) await this.#peerGraph.setReachable(id, false);
    }
  }
}
