/**
 * MockBridge — synchronous in-memory implementation of the
 * `MessagingBridge` contract (see `./MessagingBridge.js`).
 *
 * Phase 1 / Stream 1a — the test seam.  Used by unit tests across
 * the household app to drive messages in (`emit`) and inspect
 * recorded replies out (`pop` / `peek` / `size` / `clear`).  Has
 * no network, no platform SDK, no async I/O — everything happens
 * synchronously in JS objects, which keeps tests fast and
 * deterministic.
 *
 * The class implements every method on `MessagingBridge`:
 *
 *   - `start()` / `stop()` are no-ops; nothing is being listened to.
 *   - `sendReply(args)` records the args (FIFO) on an internal list.
 *   - `onMessage(handler)` REPLACES any previously registered
 *      handler (mirrors the contract in `MessagingBridge`).
 *   - `bridgeId` is the literal `'mock'`.
 *
 * Tests get four extra hooks not part of the public interface:
 *
 *   - `emit(msg)`  pushes `msg` through the registered handler and
 *      returns whatever it returned (commonly a `Reply`).  Throws
 *      if no handler has been registered.  If the handler throws,
 *      the error propagates.
 *   - `pop()`      removes + returns the next recorded `sendReply`
 *      args; returns `null` when the queue is empty.
 *   - `peek()`     returns the next recorded args without popping;
 *      `null` when empty.
 *   - `size()`     number of recorded replies waiting.
 *   - `clear()`    discards all recorded replies.
 */

/**
 * @implements {import('./MessagingBridge.js').MessagingBridge}
 */
export class MockBridge {
  /** @type {Array<import('./MessagingBridge.js').SendReplyArgs>} */
  #recorded = [];

  /**
   * @type {((msg: import('../types.js').IncomingMessage) =>
   *         (Promise<import('../types.js').Reply> |
   *          import('../types.js').Reply)) | null}
   */
  #handler = null;

  // -----------------------------------------------------------------
  // MessagingBridge surface
  // -----------------------------------------------------------------

  /** Begin listening — no-op for the mock.  Idempotent. */
  async start() {
    // nothing to do
  }

  /** Stop listening — no-op for the mock.  Idempotent. */
  async stop() {
    // nothing to do
  }

  /**
   * Record an outgoing reply on the internal FIFO queue.  No
   * network, no rendering — tests retrieve via `pop` / `peek`.
   *
   * @param {import('./MessagingBridge.js').SendReplyArgs} args
   * @returns {Promise<void>}
   */
  async sendReply(args) {
    this.#recorded.push(args);
  }

  /**
   * Register the handler invoked by `emit`.  Calling more than once
   * REPLACES the previous handler (no broadcast), per the
   * `MessagingBridge` contract.
   *
   * @param {(msg: import('../types.js').IncomingMessage) =>
   *          Promise<import('../types.js').Reply>} handler
   */
  onMessage(handler) {
    this.#handler = handler;
  }

  /** @returns {string} */
  get bridgeId() {
    return 'mock';
  }

  // -----------------------------------------------------------------
  // Test helpers (NOT part of MessagingBridge)
  // -----------------------------------------------------------------

  /**
   * Push a message through the registered handler and return what
   * the handler returned.  Throws if no handler is registered.  If
   * the handler throws (sync) or rejects (async), the error
   * propagates to the caller.
   *
   * @param {import('../types.js').IncomingMessage} incomingMessage
   * @returns {Promise<import('../types.js').Reply>}
   */
  async emit(incomingMessage) {
    if (!this.#handler) {
      throw new Error(
        'MockBridge.emit: no handler registered — call onMessage(h) first',
      );
    }
    return await this.#handler(incomingMessage);
  }

  /**
   * Remove + return the oldest recorded `sendReply` args.
   *
   * @returns {import('./MessagingBridge.js').SendReplyArgs | null}
   */
  pop() {
    if (this.#recorded.length === 0) return null;
    return this.#recorded.shift() ?? null;
  }

  /**
   * Return the oldest recorded `sendReply` args without removing it.
   *
   * @returns {import('./MessagingBridge.js').SendReplyArgs | null}
   */
  peek() {
    if (this.#recorded.length === 0) return null;
    return this.#recorded[0];
  }

  /** Number of recorded replies waiting in the queue. */
  size() {
    return this.#recorded.length;
  }

  /** Discard all recorded replies. */
  clear() {
    this.#recorded.length = 0;
  }
}

export default MockBridge;
