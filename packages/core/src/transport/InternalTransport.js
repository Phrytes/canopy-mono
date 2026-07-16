/**
 * InternalTransport — in-process EventEmitter bus.
 *
 * Two InternalTransport instances share a single InternalBus object.
 * Delivery is asynchronous (microtask) to prevent synchronous call-stack
 * overflow in tests while keeping latency near-zero.
 *
 * Used for:
 *   - Unit tests (no network)
 *   - Multiple agents within the same JS process / browser tab
 */
import { Transport } from './Transport.js';
import { Emitter }   from '../Emitter.js';

/** Shared message bus. Pass the same instance to all InternalTransports that
 *  should be able to reach each other. */
export class InternalBus extends Emitter {}

/**
 * In-process transport: all instances sharing one InternalBus can reach each other.
 * Delivery is deferred by a microtask, so it is asynchronous but near-instant. Used in
 * unit tests and for running multiple agents inside the same JS process or browser tab.
 */
export class InternalTransport extends Transport {
  #bus;
  #listener;

  /**
   * @param {InternalBus} bus
   * @param {string}      address  — this transport's address (usually agent pubKey)
   * @param {object}      [opts]   — forwarded to Transport constructor (identity, etc.)
   */
  constructor(bus, address, opts = {}) {
    super({ address, ...opts });
    this.#bus = bus;
    // Bind once so we can remove the exact same reference in disconnect().
    this.#listener = (envelope) => this._receive(envelope);
  }

  /**
   * Expose the shared bus so callers that want to spin up additional
   * in-process agents (e.g. cap-token-bound bot agents in Tasks V1.5)
   * can attach a fresh InternalTransport without threading the bus
   * through multiple call layers.
   */
  get bus() { return this.#bus; }

  /**
   * Look up a sibling InternalTransport on the SAME bus by address (or null).
   * Populated on connect(); lets the B★ in-process fast-path
   * (protocol/taskExchange.callSkill) resolve the target agent — via
   * `peerTransport(addr)._ownerAgent` — without a bus hop. Best-effort: an
   * unknown / not-yet-connected peer returns null and the caller falls back to
   * the wire path.
   *
   * @param {string} address
   * @returns {InternalTransport|null}
   */
  peerTransport(address) {
    return this.#bus.__peers?.get(address) ?? null;
  }

  async connect() {
    (this.#bus.__peers ??= new Map()).set(this.address, this);
    this.#bus.on(`msg:${this.address}`, this.#listener);
    this.emit('connect', { address: this.address });
  }

  async disconnect() {
    this.#bus.__peers?.delete(this.address);
    this.#bus.off(`msg:${this.address}`, this.#listener);
    this.emit('disconnect');
  }

  async _put(to, envelope) {
    // Microtask delay: makes delivery async without setTimeout overhead.
    await Promise.resolve();
    this.#bus.emit(`msg:${to}`, envelope);
  }
}
