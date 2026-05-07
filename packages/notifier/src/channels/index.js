/**
 * Notifier ships only the non-chat channels (`NoopChannel`, `PushChannel`).
 *
 * Chat-shaped channels are L1c `MessagingBridge` instances (e.g.
 * `TelegramBridge`, `InMemoryBridge` from `@canopy/chat-agent`) —
 * apps pass them directly into `notifier.channels`.  See
 * `packages/notifier/src/types.js` for the `Channel = MessagingBridge`
 * alias and `Project Files/Substrates/L1f-notifier.md` for rationale.
 *
 * The pre-refactor `ChatChannel` + `RecordingChannel` are gone:
 *   - `ChatChannel` was a 4-line lambda adapter from `deliver` →
 *     `MessagingBridge.sendReply`.  Removed; pass the bridge directly.
 *   - `RecordingChannel` was an in-process outbox; replaced by L1c's
 *     `InMemoryBridge` (same shape, single test-fake source of truth).
 */

/**
 * NoopChannel — accepts every `sendReply` call without doing anything.
 * Useful for "send nothing right now" scenarios + tests where you
 * only care that the scheduler ticked.
 */
export class NoopChannel {
  constructor({ id = 'noop' } = {}) { this.id = id; }
  async start() { /* no inbound */ }
  async stop()  { /* no inbound */ }
  onMessage()   { /* no inbound */ }
  async sendReply() { /* nothing */ }
}

/**
 * PushChannel — wakes a recipient device via a `PushSender`.
 *
 * Composes `relay.PushSender` (the abstract; default concrete is
 * `relay.ExpoPushSender`).  The `chatId` field passed to `sendReply`
 * is interpreted as a **device push token** (whatever
 * `MobilePushBridge.register()` returned and the app stored —
 * typically in `relay.PushTokenRegistry` keyed by relay address, or in
 * an app-level resolver keyed by webid).  Webid → token resolution is
 * the consuming app's responsibility (typically via L1h
 * identity-resolver).
 *
 * Payload shape follows `MobilePushBridge`'s convention so digest →
 * push → wake-and-process is coherent end-to-end:
 *
 *   { skillId: 'wake-and-notify', parts: [{type:'TextPart', text}] }
 *
 * Apps that want a **visible** notification on the device should pass
 * `{title, body}` via `meta.payload`; apps that want to dispatch to a
 * specific skill should pass `meta.payload.skillId`.  Anything in
 * `meta.payload` overrides the default `{skillId, parts}`.
 *
 * Example:
 *
 *   import { ExpoPushSender } from '@canopy/relay';
 *   import { PushChannel }     from '@canopy/notifier';
 *
 *   const channel = new PushChannel({
 *     pushSender: new ExpoPushSender(),
 *   });
 *   notifier = new Notifier({ channels: { push: channel } });
 *
 *   await notifier.scheduleOnce({
 *     triggerAt: ..., recipient: 'ExponentPushToken[abc...]',
 *     channel: 'push',
 *     builder: async () => ({ text: 'Daily digest ready' }),
 *   });
 */
export class PushChannel {
  /** @type {{send: (token: string, payload: object, opts?: object) => Promise<{ok: boolean, error?: string}>}} */
  #pushSender;
  /** @type {string} */
  #defaultSkillId;
  /** @type {string} */
  #defaultPlatform;

  /**
   * @param {object} args
   * @param {{send: Function}} args.pushSender    relay.PushSender (or compat)
   * @param {string} [args.id='push']
   * @param {string} [args.defaultSkillId='wake-and-notify']
   * @param {string} [args.defaultPlatform='unknown']
   */
  constructor({ pushSender, id = 'push', defaultSkillId = 'wake-and-notify', defaultPlatform = 'unknown' } = {}) {
    if (!pushSender || typeof pushSender.send !== 'function') {
      throw new TypeError('PushChannel: pushSender with .send() required');
    }
    this.id = id;
    this.#pushSender      = pushSender;
    this.#defaultSkillId  = defaultSkillId;
    this.#defaultPlatform = defaultPlatform;
  }

  // MessagingBridge inbound surface — push is send-only.
  async start() { /* no inbound */ }
  async stop()  { /* no inbound */ }
  onMessage()   { /* no inbound */ }

  /**
   * @param {object} args
   * @param {string} args.chatId                       device push token
   * @param {string} args.text                         body text (default skill payload)
   * @param {Array}  [args.buttons]                    informational; included in payload
   * @param {object} [args.meta]
   * @param {object} [args.meta.payload]               full push payload (overrides default)
   * @param {string} [args.meta.platform]              'ios'|'android'|'web' — informational
   * @param {string} [args.meta.priority]              'default'|'high'
   */
  async sendReply({ chatId, text, buttons, meta }) {
    if (!chatId || typeof chatId !== 'string') {
      throw new TypeError('PushChannel.sendReply: chatId (push token) required');
    }
    const payload = meta?.payload ?? {
      skillId: this.#defaultSkillId,
      parts:   [{ type: 'TextPart', text }],
      ...(buttons ? { buttons } : {}),
    };
    const opts = {
      platform: meta?.platform ?? this.#defaultPlatform,
      ...(meta?.priority ? { priority: meta.priority } : {}),
    };
    const res = await this.#pushSender.send(chatId, payload, opts);
    if (res && res.ok === false) {
      throw new Error(`PushChannel.sendReply: ${res.error ?? 'push failed'}`);
    }
  }
}
