/**
 * Core types for @onderling/notifier.  jsdoc only.
 */

/**
 * A notifier channel IS L1c chat-agent's `MessagingBridge` — the two
 * substrates share an interface so the same bridge implementation
 * (`TelegramBridge`, `InMemoryBridge`, …) works for both chat-agent's
 * reply path AND notifier's digest delivery.  The substrate ships
 * additional channels (`NoopChannel`, `PushChannel`) that implement
 * the same surface for non-chat targets.
 *
 * Surface (mirrored from `@onderling/chat-agent`'s `MessagingBridge`):
 *   - `id: string`                                       stable channel id
 *   - `sendReply({chatId, text, buttons?, replyTo?})`    outbound delivery
 *
 * `start()` / `stop()` / `onMessage()` from `MessagingBridge` are the
 * inbound chat lifecycle — notifier ignores those (it only sends).
 *
 * The `chatId` field is opaque to the notifier — its meaning is
 * determined by the channel.  ChatChannel/MessagingBridge bridges
 * interpret it as a platform chat id; PushChannel interprets it as a
 * device push token; future EmailChannel would interpret it as an
 * email address.  webid → identifier resolution is the consuming
 * app's responsibility (typically via L1h identity-resolver).
 *
 * @typedef {import('@onderling/chat-agent').MessagingBridge} Channel
 */

/**
 * @typedef {import('@onderling/chat-agent').SendReplyArgs} ChannelDeliverArgs
 *   Deprecated alias kept for one release; new code should use
 *   `SendReplyArgs` from `@onderling/chat-agent` directly.
 */

/**
 * @typedef {object} ScheduleStore
 *
 * @property {(job: Job) => Promise<void>} put
 * @property {(jobId: string) => Promise<Job|null>} get
 * @property {() => Promise<Job[]>} listAll
 * @property {(jobId: string) => Promise<void>} remove
 * @property {(cancelKey: string) => Promise<void>} removeByCancelKey
 */

/**
 * @typedef {object} Job
 *
 * @property {string} jobId
 * @property {'recurring'|'once'} kind
 * @property {string} channelId
 * @property {string} recipient
 * @property {Cadence} [cadence]                   when kind='recurring'
 * @property {number} [triggerAt]                  when kind='once'
 * @property {() => Promise<{text: string, buttons?: Array, meta?: object}>} builder
 * @property {string} [cancelKey]
 * @property {number} [lastFiredAt]
 * @property {number} [nextFireAt]
 * @property {object} [metadata]
 */

/**
 * @typedef {object} Cadence
 * @property {'daily'|'hourly'|'interval'} kind
 * @property {string} [timeLocal]                  'HH:MM' (daily)
 * @property {string} [tz]                         IANA TZ (daily) — default 'UTC'
 * @property {number} [intervalMs]                 (interval)
 */

// Empty export so this file is a real ES module.
export const __types__ = true;
