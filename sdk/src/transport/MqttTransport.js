import { Transport, PATTERNS } from './Transport.js';

/**
 * MQTT transport — universal browser/Node transport over WebSocket.
 *
 * Expects the `mqtt` global (loaded from CDN: unpkg.com/mqtt/dist/mqtt.min.js).
 * In Node.js / tests, pass the library via options: `{ mqttLib: require('mqtt') }`.
 *
 * Each agent has a stable logical address (8-byte hex string).
 * Messages are published to topic `canopy/agent/<address>`.
 * The `_from` field is added to every outgoing envelope so the receiver
 * can identify the sender even without transport-level metadata.
 */
export class MqttTransport extends Transport {
  #client  = null;
  #address;
  #opts;
  #subs = new Map();   // topic -> Set<handler>

  static TOPIC = (addr) => `canopy/agent/${addr}`;

  constructor(options = {}) {
    super();
    // Stable address — developer passes it or we generate a fresh one.
    const addr = options.address ?? MqttTransport.#randomAddress();
    this.#address = addr;
    this.#opts = {
      brokerUrl:       'wss://broker.hivemq.com:8884/mqtt',
      clientId:        'canopy-' + Math.random().toString(16).slice(2, 10),
      reconnectPeriod: 5_000,
      ...options,
      address: addr,   // normalise back so options stays consistent
    };
  }

  get address() { return this.#address; }

  canDo(pattern) {
    return [
      PATTERNS.ONE_WAY,
      PATTERNS.ACK_SEND,
      PATTERNS.REQUEST_RESPONSE,
      PATTERNS.PUB_SUB,
    ].includes(pattern);
  }

  async connect() {
    const lib = this.#opts.mqttLib
      ?? (typeof mqtt !== 'undefined' ? mqtt : null);   // eslint-disable-line no-undef
    if (!lib) {
      throw new Error(
        'MQTT library not found. Load from CDN or pass options.mqttLib.'
      );
    }

    return new Promise((resolve, reject) => {
      this.#client = lib.connect(this.#opts.brokerUrl, {
        clientId:        this.#opts.clientId,
        clean:           true,
        reconnectPeriod: this.#opts.reconnectPeriod,
      });

      this.#client.on('connect', () => {
        const myTopic = MqttTransport.TOPIC(this.#address);
        this.#client.subscribe(myTopic, (err) => {
          if (err) return reject(err);
          this.emit('connect', { address: this.#address });
          resolve();
        });
      });

      this.#client.on('message', (topic, rawPayload) => {
        let envelope;
        try { envelope = JSON.parse(rawPayload.toString()); } catch { return; }

        // Deliver to any explicit topic subscribers first
        const handlers = this.#subs.get(topic);
        if (handlers) {
          const from = envelope._from ?? topic;
          for (const h of handlers) h(envelope.payload ?? envelope, from);
        }

        // Forward direct messages (our address topic) up to the pattern layer
        if (topic === MqttTransport.TOPIC(this.#address)) {
          const from = envelope._from ?? topic;
          this._receive(from, envelope);
        }
      });

      this.#client.on('error',   (e) => this.emit('error', e));
      this.#client.on('offline', () => this.emit('warn', 'MQTT offline — reconnecting…'));
    });
  }

  async disconnect() {
    this.#client?.end();
    this.#client  = null;
    this.emit('disconnect');
  }

  async _rawSend(to, envelope) {
    if (!this.#client?.connected) throw new Error('MqttTransport: not connected');
    // Inject _from so the receiver can identify us
    const payload = JSON.stringify({ ...envelope, _from: this.#address });
    return new Promise((resolve, reject) => {
      this.#client.publish(
        MqttTransport.TOPIC(to),
        payload,
        { qos: 1 },
        (err) => err ? reject(err) : resolve()
      );
    });
  }

  // ── Native PubSub ──────────────────────────────────────────────────────────

  /**
   * Subscribe to a pub-sub topic.
   * @returns {Function} unsubscribe function
   */
  subscribe(topic, handler) {
    if (!this.#subs.has(topic)) {
      this.#subs.set(topic, new Set());
      this.#client?.subscribe(topic);
    }
    this.#subs.get(topic).add(handler);
    return () => this.#subs.get(topic)?.delete(handler);
  }

  /** Publish to a pub-sub topic (QoS 0, fire-and-forget). */
  publish(topic, data) {
    if (!this.#client?.connected) return;
    const payload = JSON.stringify({ _from: this.#address, payload: data });
    this.#client.publish(topic, payload, { qos: 0 });
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  static #randomAddress() {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      return [...crypto.getRandomValues(new Uint8Array(8))]
        .map(b => b.toString(16).padStart(2, '0')).join('');
    }
    return Math.random().toString(16).slice(2, 18).padEnd(16, '0');
  }
}
