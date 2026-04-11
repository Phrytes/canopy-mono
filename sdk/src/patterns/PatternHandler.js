import { Emitter } from '../Emitter.js';
import { P, mkEnvelope, isEnvelope } from './Envelope.js';

const DEFAULT_TIMEOUT = 30_000;
const ACK_TIMEOUT     = 10_000;

/**
 * PatternHandler wraps a Transport and maps raw envelopes to
 * interaction-pattern semantics.
 *
 * One PatternHandler per Transport per Agent.
 *
 * Emits:
 *   'message'   { from, payload, envelope }         — OW / AS inbound
 *   'request'   { from, payload, envelope, reply }  — RQ inbound
 *   'publish'   { topic, payload, from }             — PB inbound
 *   'envelope'  { from, envelope }                  — unknown / advanced patterns
 */
export class PatternHandler extends Emitter {
  #transport;
  #pending = new Map();   // _id -> { resolve, reject, timer }

  constructor(transport) {
    super();
    this.#transport = transport;
    transport.on('message', ({ from, envelope }) => this.#dispatch(from, envelope));
  }

  get transport() { return this.#transport; }

  // ── Outbound ──────────────────────────────────────────────────────────────

  /** One-Way: fire and forget — no reply expected. */
  async sendOneWay(to, payload) {
    await this.#transport._rawSend(to, mkEnvelope(P.OW, payload));
  }

  /**
   * Ack-Send: deliver and wait for the peer to acknowledge receipt.
   * @param {number} [timeout=10_000]
   */
  sendAck(to, payload, timeout = ACK_TIMEOUT) {
    const env = mkEnvelope(P.AS, payload);
    return this.#waitFor(env._id, timeout, () =>
      this.#transport._rawSend(to, env)
    );
  }

  /**
   * Request–Response: send a request and wait for the peer's reply.
   * @param {number} [timeout=30_000]
   */
  request(to, payload, timeout = DEFAULT_TIMEOUT) {
    const env = mkEnvelope(P.RQ, payload);
    return this.#waitFor(env._id, timeout, () =>
      this.#transport._rawSend(to, env)
    );
  }

  /** Send a response to an incoming request. */
  async respond(to, requestId, payload) {
    await this.#transport._rawSend(to, mkEnvelope(P.RS, payload, { _re: requestId }));
  }

  /**
   * Publish to a pub-sub topic.
   * Uses the transport's native publish if available, otherwise one-way send.
   */
  async publish(topic, data) {
    if (typeof this.#transport.publish === 'function') {
      this.#transport.publish(topic, data);
    } else {
      await this.#transport._rawSend(topic, mkEnvelope(P.PB, data, { _topic: topic }));
    }
  }

  /**
   * Subscribe to a pub-sub topic.
   * @returns {Function} unsubscribe function
   */
  subscribe(topic, handler) {
    if (typeof this.#transport.subscribe === 'function') {
      return this.#transport.subscribe(topic, handler);
    }
    // No native PubSub — listen for PB envelopes with this topic
    const listener = ({ from, envelope }) => {
      if (isEnvelope(envelope) && envelope._p === P.PB && envelope._topic === topic) {
        handler(envelope.payload, from);
      }
    };
    this.#transport.on('message', listener);
    return () => this.#transport.off('message', listener);
  }

  // ── Inbound dispatch ──────────────────────────────────────────────────────

  #dispatch(from, envelope) {
    if (!isEnvelope(envelope)) return;

    switch (envelope._p) {
      case P.OW:
        this.emit('message', { from, payload: envelope.payload, envelope });
        break;

      case P.AS:
        this.emit('message', { from, payload: envelope.payload, envelope });
        // Auto-acknowledge
        this.#transport._rawSend(from, mkEnvelope(P.AK, null, { _re: envelope._id }))
          .catch(() => {});
        break;

      case P.AK:
      case P.RS:
        this.#settle(envelope._re, envelope.payload);
        break;

      case P.RQ:
        this.emit('request', {
          from,
          payload: envelope.payload,
          envelope,
          reply: (payload) => this.respond(from, envelope._id, payload),
        });
        break;

      case P.PB:
        this.emit('publish', {
          topic:   envelope._topic ?? null,
          payload: envelope.payload,
          from,
        });
        break;

      default:
        // ST / SE / BT / SS — advanced patterns, emit raw for higher-layer handling
        this.emit('envelope', { from, envelope });
    }
  }

  // ── Promise management ────────────────────────────────────────────────────

  #waitFor(id, timeout, sendFn) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Pattern timeout (id: ${id})`));
      }, timeout);

      this.#pending.set(id, { resolve, reject, timer });

      sendFn().catch((err) => {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(err);
      });
    });
  }

  #settle(id, value) {
    const p = this.#pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.#pending.delete(id);
    p.resolve(value);
  }
}
