/**
 * PeerDiscovery — gossip-based peer discovery over any transport.
 *
 * Protocol:
 *   On connect   → send { type: 'peer_list_request' }
 *   On request   → reply { type: 'peer_list_response', peers: [...] }
 *   On response  → merge into AgentCache, optionally auto-connect to new peers
 *
 * This is intentionally minimal (Phase 2 scope). No permission checks yet —
 * every connected agent sees every known peer. Layered/group-gated discovery
 * is a future phase concern.
 */

export class PeerDiscovery {
  /**
   * @param {object} options
   * @param {AgentCache} options.cache
   * @param {function(id: string): Promise<void>} options.connect  — dial a new peer
   * @param {function(id: string, msg: object): void} options.send — send a message
   * @param {string} options.localId                               — our own peer id
   * @param {boolean} [options.autoConnect=true]                   — auto-dial discovered peers
   */
  constructor({ cache, connect, send, localId, autoConnect = true }) {
    this._cache       = cache;
    this._connect     = connect;
    this._send        = send;
    this._localId     = localId;
    this._autoConnect = autoConnect;
    this._connecting  = new Set();  // prevent duplicate dials
  }

  // ── Called by Agent when a new connection is established ─────────────────

  onConnected(peerId) {
    this._cache.setConnected(peerId, true);
    // Request the peer's known agents
    this._send(peerId, { type: 'peer_list_request' });
  }

  onDisconnected(peerId) {
    this._cache.setConnected(peerId, false);
  }

  // ── Handle incoming discovery messages ───────────────────────────────────

  async handle(fromId, msg) {
    switch (msg.type) {

      case 'peer_list_request':
        this._send(fromId, {
          type:  'peer_list_response',
          peers: this._cache.toShareable(fromId),   // don't send them themselves
        });
        break;

      case 'peer_list_response':
        await this._mergePeers(msg.peers ?? []);
        break;
    }
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  async _mergePeers(peers) {
    for (const { id, label, card } of peers) {
      if (!id || id === this._localId) continue;

      const isNew = !this._cache.has(id);
      this._cache.upsert(id, { label, card });

      if (isNew && this._autoConnect && !this._connecting.has(id)) {
        this._connecting.add(id);
        try {
          await this._connect(id);
          // Agent card will be fetched by the normal connect flow
        } catch {
          // Peer unreachable — keep in cache, just not connected
        } finally {
          this._connecting.delete(id);
        }
      }
    }
  }
}
