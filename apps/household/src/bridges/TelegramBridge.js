/**
 * TelegramBridge — `telegraf`-backed implementation of
 * `MessagingBridge` (see `./MessagingBridge.js`).
 *
 * Phase 1 / Stream 1c — the real-world integration.  Wraps a single
 * Telegraf bot instance.  Supports BOTH webhook and long-polling
 * modes (Q-H2.3 lock); the caller picks at construction time.
 *
 * Q-H2.4 lock — addressed-only filter.  Incoming messages reach the
 * registered handler ONLY when they are:
 *
 *   1. In a private DM chat with the bot      (chat.type === 'private'), OR
 *   2. Prefixed with `@<botUsername>`         (case-insensitive), OR
 *   3. A reply to a message the bot itself authored.
 *
 * Anything else — e.g. random group chatter — is silently dropped.
 * The leading `@<botUsername>` mention (if any) is stripped before
 * handing the message to the agent so skill code never sees the
 * mention prefix.
 *
 * Inline-button taps come back to Telegraf as a `callback_query`
 * update.  We synthesise a fresh `IncomingMessage` whose `text` is
 * the button's `id` (i.e. its `callback_data`) and whose `replyTo`
 * points at the original bot message.  This funnels button presses
 * through the same regex/LLM dispatch path as plain text — a
 * uniform input model.  We always call `ctx.answerCbQuery()` so the
 * Telegram client doesn't leave the user staring at a spinner.
 *
 * The `telegrafFactory` constructor option is the test seam: it
 * receives the bot token and must return a Telegraf-like instance
 * exposing `on`, `launch`, `stop`, `telegram.{sendMessage,
 * setWebhook,getMe}`, plus a writable `botInfo`.  Production code
 * defaults to the real `Telegraf` constructor.
 *
 * Graceful shutdown mirrors the pattern from
 * `apps/folio/src/cli/serveCmd.js` (Folio v2.12 / commit f40086e):
 * call `bot.stop()`, then arm a 4-second `setTimeout(...).unref()`
 * as a hard-exit safety net so a stuck socket can't hang the
 * process indefinitely.
 */

import { Telegraf } from 'telegraf';

/**
 * @implements {import('./MessagingBridge.js').MessagingBridge}
 */
export class TelegramBridge {
  /** @type {string}  */                                                    #botToken;
  /** @type {'webhook'|'long-polling'} */                                   #mode;
  /** @type {string|undefined} */                                           #webhookUrl;
  /** @type {number} */                                                     #port;
  /** @type {string|null} */                                                #botUsername;
  /** @type {{ on: Function, launch: Function, stop: Function,
              telegram: { sendMessage: Function, setWebhook: Function,
                          getMe: Function },
              botInfo?: any }} */
  #bot;
  /** @type {boolean} */                                                    #started = false;
  /** @type {NodeJS.Timeout|null} */                                        #stopTimer = null;
  /** @type {((msg: import('../types.js').IncomingMessage) =>
              Promise<import('../types.js').Reply>) | null} */              #handler = null;

  /**
   * @param {object} args
   * @param {string} args.botToken
   * @param {'webhook'|'long-polling'} args.mode
   * @param {string} [args.webhookUrl]
   * @param {number} [args.port]
   * @param {string} [args.botUsername]
   * @param {(token: string) => any} [args.telegrafFactory]
   */
  constructor({
    botToken,
    mode,
    webhookUrl,
    port = 3000,
    botUsername,
    telegrafFactory,
  } = /** @type {any} */ ({})) {
    if (!botToken || typeof botToken !== 'string') {
      throw new Error('TelegramBridge: botToken (string) is required');
    }
    if (mode !== 'webhook' && mode !== 'long-polling') {
      throw new Error(
        "TelegramBridge: mode must be 'webhook' or 'long-polling'",
      );
    }
    if (mode === 'webhook' && (!webhookUrl || typeof webhookUrl !== 'string')) {
      throw new Error(
        "TelegramBridge: webhookUrl (string) is required when mode === 'webhook'",
      );
    }

    this.#botToken    = botToken;
    this.#mode        = mode;
    this.#webhookUrl  = webhookUrl;
    this.#port        = port;
    this.#botUsername = botUsername ?? null;

    const factory = telegrafFactory ?? ((/** @type {string} */ token) => new Telegraf(token));
    this.#bot = factory(botToken);

    // Wire the message + callback_query listeners eagerly — order
    // before start() so that even a synchronous test fake's `emit`
    // helper finds them registered.
    this.#bot.on('text',           (ctx) => this.#handleText(ctx));
    this.#bot.on('callback_query', (ctx) => this.#handleCallbackQuery(ctx));
  }

  // -------------------------------------------------------------------
  // MessagingBridge surface
  // -------------------------------------------------------------------

  /**
   * Begin listening.  Idempotent — calling twice is a no-op.
   *
   *   - 'long-polling': `bot.launch()` (telegraf default).
   *   - 'webhook':      `bot.launch({ webhook: { domain, port } })`,
   *                     which internally calls `setWebhook` for us.
   *
   * @returns {Promise<void>}
   */
  async start() {
    if (this.#started) return;

    if (!this.#botUsername) {
      // Auto-detect username from the bot's own profile so the
      // @-mention filter works without the caller having to type it.
      try {
        const me = await this.#bot.telegram.getMe();
        if (me?.username) this.#botUsername = me.username;
        if (!this.#bot.botInfo) this.#bot.botInfo = me;
      } catch (_err) {
        // best-effort: a missing username just means @-mention
        // filtering will silently fail for groups; DMs + replies
        // still work.
      }
    }

    if (this.#mode === 'long-polling') {
      // Don't await — `launch()` resolves only when polling stops in
      // some telegraf versions; we want `start()` to return as soon
      // as the loop is up.  Telegraf's API matches both shapes
      // (returns a Promise that resolves on shutdown).  Tests use
      // the seam to make this synchronous-ish.
      this.#bot.launch();
    } else {
      // webhook: telegraf's launch with a `webhook` config calls
      // setWebhook internally and starts an HTTP server on `port`.
      const url = new URL(this.#webhookUrl ?? '');
      this.#bot.launch({
        webhook: {
          domain: url.host,
          port:   this.#port,
        },
      });
    }

    this.#started = true;
  }

  /**
   * Graceful shutdown.  Idempotent.
   *
   * Calls `bot.stop()` and arms a 4-second hard-exit safety net via
   * `setTimeout(..., 4000).unref()` so a stuck socket can't hang
   * the process.  The `.unref()` lets Node exit cleanly if
   * everything else closes in time — the timer never holds the
   * loop open by itself.
   *
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.#started) return;
    this.#started = false;

    try {
      this.#bot.stop('shutdown');
    } catch (_err) {
      // already stopped — fine
    }

    // Safety net — mirrors apps/folio v2.12 / commit f40086e.
    const t = setTimeout(() => {
      // istanbul ignore next — only reached if shutdown hangs
      try { process.exit(0); } catch { /* ignore */ }
    }, 4000);
    if (typeof t.unref === 'function') t.unref();
    this.#stopTimer = t;
  }

  /**
   * Send a message.  Inline buttons (if any) become a single-row
   * `inline_keyboard`; the button `id` is its `callback_data`.
   *
   * @param {import('./MessagingBridge.js').SendReplyArgs} args
   * @returns {Promise<void>}
   */
  async sendReply({ chatId, replyTo, text, buttons } = /** @type {any} */ ({})) {
    /** @type {Record<string, any>} */
    const extra = {};
    if (replyTo != null) {
      extra.reply_to_message_id = replyTo;
    }
    if (Array.isArray(buttons) && buttons.length > 0) {
      extra.reply_markup = {
        inline_keyboard: [
          buttons.map((b) => ({ text: b.label, callback_data: b.id })),
        ],
      };
    }
    await this.#bot.telegram.sendMessage(chatId, text, extra);
  }

  /**
   * Register the handler invoked on every (addressed) incoming
   * message.  Calling more than once REPLACES the previous handler,
   * matching the `MessagingBridge` contract.
   *
   * @param {(msg: import('../types.js').IncomingMessage) =>
   *           Promise<import('../types.js').Reply>} handler
   */
  onMessage(handler) {
    this.#handler = handler;
  }

  /** @returns {string} */
  get bridgeId() {
    return 'telegram';
  }

  // -------------------------------------------------------------------
  // Internal — incoming-update plumbing
  // -------------------------------------------------------------------

  /**
   * Handle a `text` update from telegraf.
   *
   * @param {any} ctx Telegraf-like context.
   */
  async #handleText(ctx) {
    if (!this.#handler) return;
    if (!ctx?.message || typeof ctx.message.text !== 'string') return;

    const addressed = this.#isAddressed(ctx);
    if (!addressed) return;

    const text = this.#stripMention(ctx.message.text);
    /** @type {import('../types.js').IncomingMessage} */
    const msg = {
      bridgeId:    'telegram',
      chatId:      String(ctx.chat.id),
      messageId:   String(ctx.message.message_id),
      text,
      replyTo:     ctx.message.reply_to_message
        ? String(ctx.message.reply_to_message.message_id)
        : null,
      sender:      this.#mapSender(ctx),
      isAddressed: true,
    };
    await this.#handler(msg);
  }

  /**
   * Handle a `callback_query` update — synthesise an
   * `IncomingMessage` whose text is the button id, then ack so the
   * client UI doesn't hang.
   *
   * @param {any} ctx Telegraf-like context.
   */
  async #handleCallbackQuery(ctx) {
    if (!this.#handler) {
      // still ack so the user's spinner clears
      try { await ctx.answerCbQuery?.(); } catch { /* ignore */ }
      return;
    }
    const cb = ctx.callbackQuery ?? ctx.update?.callback_query;
    if (!cb || typeof cb.data !== 'string') {
      try { await ctx.answerCbQuery?.(); } catch { /* ignore */ }
      return;
    }

    /** @type {import('../types.js').IncomingMessage} */
    const msg = {
      bridgeId:    'telegram',
      chatId:      String(ctx.chat?.id ?? cb.message?.chat?.id ?? ''),
      messageId:   String(cb.message?.message_id ?? ''),
      text:        cb.data,
      replyTo:     cb.message ? String(cb.message.message_id) : null,
      sender:      this.#mapSender(ctx),
      isAddressed: true,
    };

    try {
      await this.#handler(msg);
    } finally {
      try { await ctx.answerCbQuery?.(); } catch { /* ignore */ }
    }
  }

  /**
   * Q-H2.4 addressed-only filter.  See class jsdoc for the rules.
   *
   * @param {any} ctx
   * @returns {boolean}
   */
  #isAddressed(ctx) {
    const chatType = ctx?.chat?.type;
    if (chatType === 'private') return true;

    const text = ctx?.message?.text;
    if (typeof text === 'string' && this.#botUsername) {
      const prefix = '@' + this.#botUsername.toLowerCase();
      if (text.toLowerCase().startsWith(prefix)) return true;
    }

    const replyTo = ctx?.message?.reply_to_message;
    if (replyTo) {
      const fromUid = String(replyTo.from?.id ?? '');
      const botUid  = String(ctx?.botInfo?.id ?? this.#bot?.botInfo?.id ?? '');
      if (botUid && fromUid && fromUid === botUid) return true;
      // Username fallback (the test fake may not set the numeric id)
      const fromUser = (replyTo.from?.username ?? '').toLowerCase();
      if (this.#botUsername && fromUser === this.#botUsername.toLowerCase()) {
        return true;
      }
    }

    return false;
  }

  /**
   * Strip a leading `@<botUsername>` mention (case-insensitive,
   * any following whitespace also collapsed) so the agent's regex
   * / LLM path sees `add bread` instead of `@bot add bread`.
   *
   * @param {string} text
   * @returns {string}
   */
  #stripMention(text) {
    if (!this.#botUsername) return text;
    const prefix = '@' + this.#botUsername;
    const lower  = text.toLowerCase();
    if (lower.startsWith(prefix.toLowerCase())) {
      return text.slice(prefix.length).replace(/^\s+/, '');
    }
    return text;
  }

  /**
   * @param {any} ctx
   * @returns {import('../types.js').Sender}
   */
  #mapSender(ctx) {
    const from = ctx?.from ?? ctx?.update?.callback_query?.from ?? {};
    const first = from.first_name ?? '';
    const last  = from.last_name  ? ' ' + from.last_name : '';
    return {
      displayName: (first + last).trim() || from.username || String(from.id ?? ''),
      bridgeUid:   String(from.id ?? ''),
      webid:       null, // resolved later in Phase 2
    };
  }
}

export default TelegramBridge;
