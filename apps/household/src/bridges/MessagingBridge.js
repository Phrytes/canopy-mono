/**
 * MessagingBridge — the contract every messaging platform must
 * satisfy.  jsdoc-only (no runtime code).
 *
 * Q-H2.5 lock: even though Telegram is the only platform shipping
 * in v0, we define + use the abstraction so the agent code stays
 * platform-agnostic from day one.  Matrix is the natural second
 * platform (federated + open-source + ethos-aligned).  Signal fits
 * the interface but with a clunkier underlying integration.
 *
 * Two implementations land in Phase 1:
 *   - bridges/MockBridge.js     — the test seam (Stream 1a)
 *   - bridges/TelegramBridge.js — the real-world integration (Stream 1c)
 *
 * Both implement the typedef below.  Consumers (HouseholdAgent and
 * tests) talk only to this interface — they never reach into
 * `telegraf` or `MockBridge`'s private state directly.
 */

/**
 * @typedef {object} MessagingBridge
 * @property {() => Promise<void>} start
 *   Begin listening for messages.  For Telegram: starts long-polling
 *   or starts the webhook server.  Idempotent.
 * @property {() => Promise<void>} stop
 *   Stop listening; release any held resources (sockets, timers,
 *   webhook server).  Idempotent.
 * @property {(args: SendReplyArgs) => Promise<void>} sendReply
 *   Post a message to a chat.  May include inline buttons; the
 *   bridge maps them to its platform's native UI primitive.
 * @property {(handler: (msg: import('../types.js').IncomingMessage) => Promise<import('../types.js').Reply>) => void} onMessage
 *   Register the handler called when a message arrives.  Calling
 *   `onMessage` more than once REPLACES the handler (no broadcast).
 * @property {string} bridgeId
 *   Stable identifier — 'telegram' | 'signal' | 'matrix' | 'mock' | …
 */

/**
 * @typedef {object} SendReplyArgs
 * @property {string}                                                chatId
 *   Platform-scoped chat id (whatever the bridge gave us in the
 *   incoming message).
 * @property {string}                                               [replyTo]
 *   Message id this reply quotes / threads to.  Optional.  Bridges
 *   without a thread concept (Signal) may ignore this.
 * @property {string}                                                text
 * @property {Array<import('../types.js').Button>}                  [buttons]
 *   Inline action buttons.  When the user taps one, the bridge
 *   synthesises a fresh `IncomingMessage` whose `text` is the
 *   button's `id` and whose `replyTo` points at the original.
 */

// Empty export so this file is a real ES module.
export const __interface__ = true;
