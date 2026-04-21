import { Transport, PATTERNS } from './Transport.js';

/**
 * PeerJS transport — browser P2P via WebRTC DataChannels + PeerJS signaling.
 *
 * Expects the `Peer` global (loaded from CDN).
 * In Node.js / tests, pass the class via options: `{ peerLib: Peer }`.
 *
 * Good for same-LAN or same-network peers (low latency, no broker).
 * For cross-network peers prefer NknTransport or MqttTransport.
 */

const DEFAULT_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export class PeerJSTransport extends Transport {
  #peer        = null;
  #address     = null;
  #connections = new Map();   // peerId -> DataConnection
  #opts;

  constructor(options = {}) {
    super();
    this.#opts = options;
  }

  get address() { return this.#address; }

  canDo(pattern) {
    return [
      PATTERNS.ONE_WAY,
      PATTERNS.ACK_SEND,
      PATTERNS.REQUEST_RESPONSE,
      PATTERNS.STREAMING,
      PATTERNS.BULK_TRANSFER,
    ].includes(pattern);
  }

  async connect() {
    const PeerClass = this.#opts.peerLib
      ?? (typeof Peer !== 'undefined' ? Peer : null);   // eslint-disable-line no-undef
    if (!PeerClass) {
      throw new Error(
        'PeerJS not found. Load from CDN or pass options.peerLib.'
      );
    }

    return new Promise((resolve, reject) => {
      this.#peer = new PeerClass({
        ...this.#opts,
        config: { iceServers: this.#opts.iceServers ?? DEFAULT_ICE },
      });

      this.#peer.on('open', (id) => {
        this.#address = id;
        this.emit('connect', { address: id });
        resolve();
      });

      this.#peer.on('error', (err) => {
        this.emit('error', err);
        if (!this.#address) reject(err);
      });

      this.#peer.on('connection', (conn) => this.#wire(conn));
    });
  }

  async disconnect() {
    this.#peer?.destroy();
    this.#peer    = null;
    this.#address = null;
    this.#connections.clear();
    this.emit('disconnect');
  }

  async _rawSend(to, envelope) {
    if (!this.#peer) throw new Error('PeerJSTransport: not connected');
    let conn = this.#connections.get(to);
    if (!conn || !conn.open) conn = await this.#dial(to);
    conn.send(JSON.stringify(envelope));
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  #wire(conn) {
    this.#connections.set(conn.peer, conn);

    conn.on('data', (data) => {
      let envelope;
      try {
        const raw = typeof data === 'string' ? data : JSON.stringify(data);
        envelope = JSON.parse(raw);
      } catch { return; }
      this._receive(conn.peer, envelope);
    });

    conn.on('close', () => this.#connections.delete(conn.peer));
    conn.on('error', () => this.#connections.delete(conn.peer));
    return conn;
  }

  #dial(peerId) {
    return new Promise((resolve, reject) => {
      const conn  = this.#peer.connect(peerId, { reliable: true, serialization: 'json' });
      const timer = setTimeout(
        () => reject(new Error(`PeerJSTransport: connect to ${peerId} timed out`)),
        15_000
      );
      conn.on('open',  () => { clearTimeout(timer); resolve(this.#wire(conn)); });
      conn.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
  }
}
