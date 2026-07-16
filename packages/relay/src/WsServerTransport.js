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

export class WsServerTransport extends Transport {
  #wss  = null;
  #port;
  #offlineQueueTtl;

  // Map<address, WebSocket>
  #clients = new Map();

  // Map<address, Array<{ envelope, expiresAt }>>
  #queues = new Map();

  /**
   * @param {object} opts
   * @param {number} [opts.port=0]                — 0 = OS-assigned port
   * @param {string} opts.address                 — relay's own pubKey / address
   * @param {number} [opts.offlineQueueTtl=300000] — ms to buffer for offline peers
   */
  constructor({ port = 0, address, offlineQueueTtl = 300_000 } = {}) {
    if (!address) throw new Error('WsServerTransport requires address');
    super({ address });
    this.#port             = port;
    this.#offlineQueueTtl  = offlineQueueTtl;
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
    this.#forward(to, envelope);
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
        this.#drainQueue(peerAddress, ws);
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
          this.#forward(to, msg.envelope, ws);
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

  /** Forward an envelope to `to`. Buffers for offline peers. */
  #forward(to, envelope, senderWs = null) {
    const target = this.#clients.get(to);
    if (target && target.readyState === 1 /* OPEN */) {
      target.send(JSON.stringify({ type: 'message', envelope }));
      return;
    }

    // Peer offline — queue the message.
    this.#enqueue(to, envelope);

    // Notify sender that target is unknown/offline (if we have a sender socket).
    if (senderWs && senderWs.readyState === 1) {
      senderWs.send(JSON.stringify({ type: 'queued', to }));
    }
  }

  #enqueue(address, envelope) {
    if (!this.#queues.has(address)) this.#queues.set(address, []);
    const queue = this.#queues.get(address);

    // Purge expired entries before adding the new one.
    const now = Date.now();
    const live = queue.filter(e => e.expiresAt > now);
    live.push({ envelope, expiresAt: now + this.#offlineQueueTtl });
    this.#queues.set(address, live);
  }

  #drainQueue(address, ws) {
    const queue = this.#queues.get(address);
    if (!queue?.length) return;

    const now  = Date.now();
    const live = queue.filter(e => e.expiresAt > now);
    this.#queues.delete(address);

    for (const { envelope } of live) {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'message', envelope }));
      }
    }
  }
}
