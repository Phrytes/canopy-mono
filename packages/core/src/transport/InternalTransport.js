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

  async connect() {
    this.#bus.on(`msg:${this.address}`, this.#listener);
    this.emit('connect', { address: this.address });
  }

  async disconnect() {
    this.#bus.off(`msg:${this.address}`, this.#listener);
    this.emit('disconnect');
  }

  async _put(to, envelope) {
    // Microtask delay: makes delivery async without setTimeout overhead.
    await Promise.resolve();
    this.#bus.emit(`msg:${to}`, envelope);
  }
}
