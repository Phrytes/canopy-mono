/**
 * WsServerTransport — WebSocket relay server.
 *
 * Acts as the relay's own Transport AND as a message broker for connected peers.
 *
 * Protocol (matches RelayTransport client):
 *   Client → Server: { type: 'register', address: '<pubKey>' }
 *   Server → Client: { type: 'registered' }
 *   Client → Server: { type: 'send', to: '<address>', envelope: {...} }
 *   Server → Client: { type: 'message', envelope: {...} }
 *   Server → Client: { type: 'error', message: '<reason>' }
 *
 * Routing:
 *   _to === relay's own address  → _receive() (dispatch to RelayAgent)
 *   _to === connected peer       → forward to that peer's WebSocket
 *   _to === offline peer         → buffer in queue (up to offlineQueueTtl ms)
 *
 * WebRTC signaling envelopes are forwarded as-is (no special handling needed).
 */
import { WebSocketServer } from 'ws';

// Transport is a peer dependency resolved from @onderling/core.
import { Transport } from '@onderling/core';

import { ForwardQueue } from './ForwardQueue.js';

export class WsServerTransport extends Transport {
  #wss  = null;
  #port;

  // Map<address, WebSocket>
  #clients = new Map();

  // The single relay hold-and-forward owner (shared with server.js). This
  // broker's shape: one bucket per address, no topics, no caps, expiry
  // purged lazily on enqueue + filtered again at drain.
  #forward;

  /**
   * @param {object} opts
   * @param {number} [opts.port=0]                — 0 = OS-assigned port
   * @param {string} opts.address                 — relay's own pubKey / address
   * @param {number} [opts.offlineQueueTtl=300000] — ms to buffer for offline peers
   */
  constructor({ port = 0, address, offlineQueueTtl = 300_000 } = {}) {
    if (!address) throw new Error('WsServerTransport requires address');
    super({ address });
    this.#port    = port;
    this.#forward = new ForwardQueue({
      ttlMs:        offlineQueueTtl,
      topicAware:   false,
      evictOnWrite: true,
    });
  }

  /** Actual bound port (available after start()). */
  get port() { return this.#wss?.address()?.port ?? null; }

  /** Addresses of currently connected peers (excludes the relay itself). */
  getConnectedPeers() { return [...this.#clients.keys()]; }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start() {
    this.#wss = new WebSocketServer({ port: this.#port });

    await new Promise((resolve, reject) => {
      this.#wss.once('listening', resolve);
      this.#wss.once('error', reject);
    });

    this.#wss.on('connection', ws => this.#onConnection(ws));
  }

  async stop() {
    for (const ws of this.#clients.values()) ws.close();
    this.#clients.clear();
    await new Promise(resolve => this.#wss.close(resolve));
    this.#wss = null;
  }

  // ── Transport._put — called when RelayAgent sends a message ──────────────

  async _put(to, envelope) {
    if (to === this.address) {
      // Self-delivery: message addressed to the relay agent itself.
      this._receive(envelope);
      return;
    }
    this.#route(to, envelope);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  #onConnection(ws) {
    let peerAddress = null;

    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === 'register') {
        peerAddress = msg.address;
        this.#clients.set(peerAddress, ws);
        ws.send(JSON.stringify({ type: 'registered' }));
        this.#forward.drain(peerAddress, ws, { evictFirst: true });
        this.emit('peer-connected', peerAddress);
        // Notify all other connected clients that a new peer joined
        const joined = JSON.stringify({ type: 'peer-joined', address: peerAddress });
        for (const [addr, client] of this.#clients) {
          if (addr !== peerAddress && client.readyState === 1) client.send(joined);
        }
        return;
      }

      if (msg.type === 'send' && msg.envelope) {
        const to = msg.to ?? msg.envelope?._to;
        if (!to) return;

        if (to === this.address) {
          // Message addressed to the relay itself — dispatch to RelayAgent.
          this._receive(msg.envelope);
        } else {
          this.#route(to, msg.envelope, ws);
        }
        return;
      }
    });

    ws.on('close', () => {
      if (peerAddress) {
        this.#clients.delete(peerAddress);
        this.emit('peer-disconnected', peerAddress);
      }
    });

    ws.on('error', () => {
      if (peerAddress) this.#clients.delete(peerAddress);
    });
  }

  /**
   * Forward an envelope to `to`, buffering for offline peers via the shared
   * ForwardQueue. On a buffered delivery, notify the sender (`{type:'queued'}`)
   * — the one wire behaviour unique to this broker, kept here because it needs
   * the sender socket.
   */
  #route(to, envelope, senderWs = null) {
    const outcome = this.#forward.deliverOrEnqueue(to, envelope, {
      socket: this.#clients.get(to) ?? null,
    });
    if (outcome === 'queued' && senderWs && senderWs.readyState === 1) {
      senderWs.send(JSON.stringify({ type: 'queued', to }));
    }
  }
}
