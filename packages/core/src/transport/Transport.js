/**
 * Transport base class.
 *
 * Provides the four interaction primitives as default envelope-based
 * implementations. Subclasses implement only _put(to, envelope).
 *
 * SecurityLayer is applied around _put (outbound) and _receive (inbound).
 * It is optional in Phase 1 tests but mandatory in production agents.
 *
 * Auto-ACK: AS (AckSend) envelopes are automatically acknowledged at the
 * transport level — the receiver's transport sends AK before dispatching
 * the payload to the application layer.
 */
import { Emitter }               from '../Emitter.js';
import { mkEnvelope, P, REPLY_CODES } from '../Envelope.js';

const ACK_TIMEOUT = 10_000;  // ms
const REQ_TIMEOUT = 30_000;  // ms

export class Transport extends Emitter {
  #address;
  #identity;
  #securityLayer  = null;
  #receiveHandler = null;
  #pending        = new Map();  // envelopeId → { resolve, reject, timer }

  /**
   * @param {object} opts
   * @param {string} opts.address  — this transport's address (pubKey or NKN addr)
   * @param {object} [opts.identity] — AgentIdentity instance (optional in tests)
   */
  constructor({ address, identity } = {}) {
    super();
    this.#address  = address;
    this.#identity = identity;
  }

  /** This agent's address on this transport. */
  get address() { return this.#address; }

  /** The AgentIdentity backing this transport. */
  get identity() { return this.#identity; }

  // Allow subclasses to set address after construction (e.g. after connect()).
  _setAddress(addr) { this.#address = addr; }

  // ── Security layer ──────────────────────────────────────────────────────────

  /** Attach a SecurityLayer (or A2ATLSLayer for A2ATransport). */
  useSecurityLayer(layer) { this.#securityLayer = layer; }

  get securityLayer() { return this.#securityLayer; }

  // ── Inbound handler ─────────────────────────────────────────────────────────

  /**
   * Register the inbound dispatch function (called by Agent in Phase 2).
   * If not set, unhandled envelopes are emitted as 'envelope' events.
   */
  setReceiveHandler(fn) { this.#receiveHandler = fn; }

  // ── Lifecycle (subclasses override) ────────────────────────────────────────

  async connect()    {}
  async disconnect() {}

  /**
   * Drop any per-peer state this transport caches (e.g. deduped discovery
   * entries).  Called by Agent.forget() so a forgotten peer can be
   * re-discovered if they're still reachable.  Default: no-op.
   */
  forgetPeer(_address) {}

  // ── Four primitives ─────────────────────────────────────────────────────────

  /**
   * OW — fire-and-forget. No reply expected.
   */
  async sendOneWay(to, payload) {
    await this._send(to, mkEnvelope(P.OW, this.#address, to, payload));
  }

  /**
   * AS — deliver and wait for AK (delivery confirmation).
   * Resolves with the AK envelope on success, rejects on timeout.
   */
  async sendAck(to, payload, timeout = ACK_TIMEOUT) {
    const env = mkEnvelope(P.AS, this.#address, to, payload);
    return this._awaitReply(env._id, timeout, () => this._send(to, env));
  }

  /**
   * RQ — send request and wait for RS (response with result).
   * Resolves with the RS envelope on success, rejects on timeout.
   */
  async request(to, payload, timeout = REQ_TIMEOUT) {
    const env = mkEnvelope(P.RQ, this.#address, to, payload);
    return this._awaitReply(env._id, timeout, () => this._send(to, env));
  }

  /**
   * RS — send a reply to a previous RQ.
   */
  async respond(to, replyToId, payload) {
    await this._send(to, mkEnvelope(P.RS, this.#address, to, payload, { re: replyToId }));
  }

  /**
   * HI — announce self to a peer (signed plaintext, no encryption).
   * Fire-and-forget; SecurityLayer on the receiving end auto-registers the sender.
   * Use agent.hello() to do a bidirectional introduction.
   */
  async sendHello(to, payload) {
    await this._send(to, mkEnvelope(P.HI, this.#address, to, payload));
  }

  // ── Wire primitive — subclasses MUST implement ──────────────────────────────

  /**
   * Send an envelope on the wire. Called after SecurityLayer has encrypted it.
   * @param {string} to       — recipient address
   * @param {object} envelope — encrypted (or HI plaintext) envelope
   */
  async _put(to, envelope) {  // eslint-disable-line no-unused-vars
    throw new Error(`${this.constructor.name} must implement _put()`);
  }

  // ── Inbound — subclasses call this when a raw envelope arrives ──────────────

  /**
   * Process an incoming envelope.
   *  1. SecurityLayer.decryptAndVerify (if set)
   *  2. Auto-ACK for AS envelopes
   *  3. Resolve pending promise for reply codes (AK, RS)
   *  4. Dispatch remaining envelopes to receiveHandler or 'envelope' event
   *
   * @param {object} rawEnvelope — as received from the network
   */
  _receive(rawEnvelope) {
    let envelope;
    try {
      envelope = this.#securityLayer
        ? this.#securityLayer.decryptAndVerify(rawEnvelope)
        : rawEnvelope;
    } catch (err) {
      this.emit('security-error', err, rawEnvelope);
      return;
    }

    // Tag with the receiving transport so inbound handlers can reply on the
    // same channel without guessing from routing tables.
    envelope._transport = this;

    // Transport-level delivery acknowledgment for AS envelopes.
    // Sent before the application layer sees the envelope.
    if (envelope._p === P.AS) {
      const ack = mkEnvelope(P.AK, this.#address, envelope._from, {}, { re: envelope._id });
      this._send(envelope._from, ack).catch(err => this.emit('error', err));
      // fall through — also dispatch AS to the application
    }

    // Reply codes resolve pending outbound promises.
    if (REPLY_CODES.has(envelope._p) && envelope._re) {
      const pending = this.#pending.get(envelope._re);
      if (pending) {
        clearTimeout(pending.timer);
        this.#pending.delete(envelope._re);
        pending.resolve(envelope);
        return; // don't dispatch reply envelopes to the application
      }
    }

    // Everything else goes to the Agent layer (or falls back to 'envelope' event).
    if (this.#receiveHandler) {
      try { this.#receiveHandler(envelope); } catch (err) { this.emit('error', err); }
    } else {
      this.emit('envelope', envelope);
    }
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  /** Apply SecurityLayer (if set) and call _put. */
  async _send(to, envelope) {
    const outgoing = this.#securityLayer
      ? this.#securityLayer.encrypt(envelope)
      : envelope;
    await this._put(to, outgoing);
  }

  /** Register a pending-reply promise, call send(), return the promise. */
  _awaitReply(id, timeout, send) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Timeout waiting for reply to ${id}`));
      }, timeout);

      this.#pending.set(id, { resolve, reject, timer });

      send().catch(err => {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(err);
      });
    });
  }
}
