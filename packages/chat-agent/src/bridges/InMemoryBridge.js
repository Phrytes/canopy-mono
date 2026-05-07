/**
 * InMemoryBridge — MessagingBridge for testing.
 *
 * Records `sendReply` calls and exposes a `simulateIncoming` method
 * to inject messages into the agent.
 */

export class InMemoryBridge {
  #handler = null;
  #started = false;

  /** @type {Array<import('../types.js').SendReplyArgs>} */
  outbox = [];

  constructor({ id = 'memory' } = {}) {
    this.id = id;
  }

  async start() { this.#started = true; }
  async stop()  { this.#started = false; }

  onMessage(handler) {
    this.#handler = handler;
  }

  async sendReply(args) {
    this.outbox.push(args);
  }

  /**
   * Inject an incoming message.  The agent's onMessage handler runs
   * synchronously up to the first await.
   *
   * @param {Partial<import('../types.js').IncomingMessage>} partial
   */
  async simulateIncoming(partial) {
    if (!this.#started) throw new Error('InMemoryBridge: not started');
    if (!this.#handler) throw new Error('InMemoryBridge: no handler registered');
    const msg = {
      bridgeId:    this.id,
      chatId:      'chat-1',
      messageId:   `msg-${Date.now()}-${Math.random()}`,
      isAddressed: true,
      ...partial,
      sender: {
        bridgeUid:   'user-1',
        displayName: 'Test User',
        ...partial.sender,
      },
    };
    return this.#handler(msg);
  }

  /**
   * Test helper: clear recorded outbox.
   */
  clearOutbox() { this.outbox.length = 0; }
}
