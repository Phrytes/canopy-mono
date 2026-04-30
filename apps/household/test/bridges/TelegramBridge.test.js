/**
 * TelegramBridge.test.js — unit tests for the telegraf-backed
 * implementation of `MessagingBridge`.
 *
 * No real Telegram traffic.  We inject a fake telegraf instance via
 * the `telegrafFactory` constructor option (the test seam).  The
 * fake records the methods the bridge calls (setWebhook, launch,
 * stop, sendMessage, answerCbQuery) and exposes synthesised
 * `emitMessage` / `emitCallbackQuery` helpers that fire the
 * registered handlers — mirroring how the real telegraf would
 * deliver an update.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TelegramBridge } from '../../src/bridges/TelegramBridge.js';

// ---------------------------------------------------------------------
// Fake Telegraf
// ---------------------------------------------------------------------

/**
 * Build a fake Telegraf instance + a `factory` function suitable for
 * injection via `telegrafFactory`.  Returns `{ factory, getFake }`
 * — call `factory(token)` once (the bridge does it in its
 * constructor) and the fake becomes available via `getFake()`.
 */
function makeFakeTelegraf({
  botUsername = 'household_test_bot',
  botId       = 7777777,
} = {}) {
  /** @type {any} */
  let fake;

  const factory = (/** @type {string} */ token) => {
    /** @type {Record<string, Function[]>} */
    const handlers = {};

    /** @type {any} */
    const bot = {
      // Internal recordings — tests inspect these.
      _token:           token,
      _launched:        false,
      _launchOpts:      null,
      _stopped:         false,
      _stopReason:      null,
      _sentMessages:    [],
      _setWebhookCalls: [],
      _ackedQueries:    [],
      _handlers:        handlers,

      botInfo: { id: botId, username: botUsername, is_bot: true },

      on(event, fn) {
        const evts = Array.isArray(event) ? event : [event];
        for (const e of evts) {
          (handlers[e] ??= []).push(fn);
        }
      },

      launch(opts) {
        bot._launched   = true;
        bot._launchOpts = opts ?? null;
        // emulate telegraf's webhook side-effect: setWebhook is
        // called from inside launch().
        if (opts?.webhook) {
          const dom = opts.webhook.domain;
          bot._setWebhookCalls.push({
            url: 'https://' + dom + '/<path>',
            opts,
          });
        }
        return Promise.resolve();
      },

      stop(reason) {
        if (bot._stopped) {
          // mimic telegraf's "Bot is not running!" guard
          throw new Error('Bot is not running!');
        }
        bot._stopped    = true;
        bot._stopReason = reason ?? 'unspecified';
      },

      telegram: {
        async sendMessage(chatId, text, extra) {
          const recorded = { chatId, text, extra: extra ?? {} };
          bot._sentMessages.push(recorded);
          return {
            message_id: 1000 + bot._sentMessages.length,
            chat: { id: chatId },
            text,
          };
        },
        async setWebhook(url, opts) {
          bot._setWebhookCalls.push({ url, opts: opts ?? {} });
        },
        async getMe() {
          return { id: botId, username: botUsername, is_bot: true };
        },
      },

      // -----------------------------------------------------------
      // Test helpers — fire updates into registered handlers.
      // -----------------------------------------------------------

      /**
       * Fire a `text` update.
       * @param {object} update
       */
      async emitMessage(update) {
        const ctx = makeContextForMessage(update, bot);
        for (const h of handlers.text ?? []) {
          await h(ctx);
        }
      },

      /**
       * Fire a `callback_query` update.
       * @param {object} cb
       */
      async emitCallbackQuery(cb) {
        const ctx = makeContextForCallbackQuery(cb, bot);
        for (const h of handlers.callback_query ?? []) {
          await h(ctx);
        }
      },
    };

    fake = bot;
    return bot;
  };

  return { factory, getFake: () => fake };
}

/**
 * Build a Telegraf-like ctx for a text message update.
 */
function makeContextForMessage(update, bot) {
  const message = update.message;
  return {
    update,
    message,
    chat:    message.chat,
    from:    message.from,
    botInfo: bot.botInfo,
    async answerCbQuery() {},
  };
}

/**
 * Build a Telegraf-like ctx for a callback_query update.
 */
function makeContextForCallbackQuery(cb, bot) {
  return {
    update:        { callback_query: cb },
    callbackQuery: cb,
    chat:          cb.message?.chat,
    from:          cb.from,
    botInfo:       bot.botInfo,
    async answerCbQuery(text, opts) {
      bot._ackedQueries.push({ id: cb.id, text: text ?? null, opts: opts ?? null });
    },
  };
}

// ---------------------------------------------------------------------
// Update-builders
// ---------------------------------------------------------------------

let _msgIdSeq = 100;
function nextMsgId() { return _msgIdSeq++; }

function makeTextUpdate({
  text,
  chatType    = 'private',
  chatId      = -1001,
  fromId      = 12345,
  fromFirst   = 'Alice',
  fromLast    = 'Smith',
  fromUser    = 'alice',
  replyTo     = null,           // a sub-update.message-shape
  messageId   = nextMsgId(),
}) {
  return {
    update_id: 1,
    message: {
      message_id: messageId,
      date:       Math.floor(Date.now() / 1000),
      chat:       { id: chatId, type: chatType },
      from:       {
        id:         fromId,
        is_bot:     false,
        first_name: fromFirst,
        last_name:  fromLast,
        username:   fromUser,
      },
      text,
      reply_to_message: replyTo,
    },
  };
}

function makeCallbackUpdate({
  data,
  chatId      = -1001,
  fromId      = 12345,
  fromFirst   = 'Alice',
  origMsgId   = 555,
}) {
  return {
    id:        'cbq-' + Math.random().toString(36).slice(2, 8),
    from:      { id: fromId, is_bot: false, first_name: fromFirst },
    chat_instance: 'inst',
    data,
    message: {
      message_id: origMsgId,
      chat:       { id: chatId, type: 'group' },
      from:       { id: 7777777, is_bot: true, username: 'household_test_bot' },
      text:       'pick one',
    },
  };
}

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

describe('TelegramBridge — construction + lifecycle', () => {
  it('constructs in long-polling mode without throwing', () => {
    const { factory } = makeFakeTelegraf();
    const bridge = new TelegramBridge({
      botToken:        'TEST-TOKEN',
      mode:            'long-polling',
      botUsername:     'household_test_bot',
      telegrafFactory: factory,
    });
    expect(bridge.bridgeId).toBe('telegram');
  });

  it('constructs in webhook mode without throwing', () => {
    const { factory } = makeFakeTelegraf();
    const bridge = new TelegramBridge({
      botToken:        'TEST-TOKEN',
      mode:            'webhook',
      webhookUrl:      'https://example.com/tg',
      port:            8443,
      botUsername:     'household_test_bot',
      telegrafFactory: factory,
    });
    expect(bridge.bridgeId).toBe('telegram');
  });

  it('throws when mode is invalid', () => {
    const { factory } = makeFakeTelegraf();
    expect(() => new TelegramBridge({
      botToken:        'TEST-TOKEN',
      // @ts-expect-error
      mode:            'pigeon',
      telegrafFactory: factory,
    })).toThrow(/mode must be/i);
  });

  it('throws when webhook mode is missing webhookUrl', () => {
    const { factory } = makeFakeTelegraf();
    expect(() => new TelegramBridge({
      botToken:        'TEST-TOKEN',
      mode:            'webhook',
      telegrafFactory: factory,
    })).toThrow(/webhookUrl/i);
  });

  it('start() in long-polling mode calls bot.launch() with no webhook config', async () => {
    const { factory, getFake } = makeFakeTelegraf();
    const bridge = new TelegramBridge({
      botToken:        'TEST-TOKEN',
      mode:            'long-polling',
      botUsername:     'household_test_bot',
      telegrafFactory: factory,
    });
    await bridge.start();
    const fake = getFake();
    expect(fake._launched).toBe(true);
    expect(fake._launchOpts == null || fake._launchOpts.webhook == null).toBe(true);
  });

  it('start() in webhook mode calls launch with a webhook config and triggers setWebhook', async () => {
    const { factory, getFake } = makeFakeTelegraf();
    const bridge = new TelegramBridge({
      botToken:        'TEST-TOKEN',
      mode:            'webhook',
      webhookUrl:      'https://example.com/tg',
      port:            8443,
      botUsername:     'household_test_bot',
      telegrafFactory: factory,
    });
    await bridge.start();
    const fake = getFake();
    expect(fake._launched).toBe(true);
    expect(fake._launchOpts?.webhook).toBeTruthy();
    expect(fake._launchOpts.webhook.port).toBe(8443);
    expect(fake._launchOpts.webhook.domain).toBe('example.com');
    expect(fake._setWebhookCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('start() is idempotent (second call is a no-op)', async () => {
    const { factory, getFake } = makeFakeTelegraf();
    const bridge = new TelegramBridge({
      botToken:        'TEST-TOKEN',
      mode:            'long-polling',
      botUsername:     'household_test_bot',
      telegrafFactory: factory,
    });
    await bridge.start();
    const fake = getFake();
    fake._launched = false; // reset our flag — bridge should not re-launch
    await bridge.start();
    expect(fake._launched).toBe(false);
  });

  it('stop() calls bot.stop() and resolves cleanly', async () => {
    const { factory, getFake } = makeFakeTelegraf();
    const bridge = new TelegramBridge({
      botToken:        'TEST-TOKEN',
      mode:            'long-polling',
      botUsername:     'household_test_bot',
      telegrafFactory: factory,
    });
    await bridge.start();
    await expect(bridge.stop()).resolves.toBeUndefined();
    const fake = getFake();
    expect(fake._stopped).toBe(true);
  });

  it('stop() before start() is a benign no-op', async () => {
    const { factory, getFake } = makeFakeTelegraf();
    const bridge = new TelegramBridge({
      botToken:        'TEST-TOKEN',
      mode:            'long-polling',
      botUsername:     'household_test_bot',
      telegrafFactory: factory,
    });
    await expect(bridge.stop()).resolves.toBeUndefined();
    expect(getFake()._stopped).toBe(false);
  });

  it('auto-detects botUsername via telegram.getMe() when not provided', async () => {
    const { factory, getFake } = makeFakeTelegraf({ botUsername: 'auto_bot_99' });
    const bridge = new TelegramBridge({
      botToken:        'TEST-TOKEN',
      mode:            'long-polling',
      // no botUsername
      telegrafFactory: factory,
    });
    await bridge.start();

    // Drive a group message that mentions @auto_bot_99 — should be
    // handled (proves auto-detection wired the filter correctly).
    let seen = null;
    bridge.onMessage(async (msg) => {
      seen = msg;
      return { replies: [], stateUpdates: [] };
    });

    await getFake().emitMessage(
      makeTextUpdate({
        text:     '@auto_bot_99 add bread',
        chatType: 'group',
      }),
    );
    expect(seen).not.toBeNull();
    expect(seen.text).toBe('add bread');
  });
});

// ---------------------------------------------------------------------
// sendReply
// ---------------------------------------------------------------------

describe('TelegramBridge — sendReply', () => {
  /** @type {ReturnType<typeof makeFakeTelegraf>} */
  let h;
  /** @type {TelegramBridge} */
  let bridge;

  beforeEach(() => {
    h = makeFakeTelegraf();
    bridge = new TelegramBridge({
      botToken:        'TEST-TOKEN',
      mode:            'long-polling',
      botUsername:     'household_test_bot',
      telegrafFactory: h.factory,
    });
  });

  it('sends a plain message with chatId + text', async () => {
    await bridge.sendReply({ chatId: 'c-1', text: 'hello' });
    const sent = h.getFake()._sentMessages;
    expect(sent).toHaveLength(1);
    expect(sent[0].chatId).toBe('c-1');
    expect(sent[0].text).toBe('hello');
    expect(sent[0].extra).toEqual({});
  });

  it('passes reply_to_message_id when replyTo is set', async () => {
    await bridge.sendReply({
      chatId:  'c-1',
      replyTo: '42',
      text:    'in-thread',
    });
    const sent = h.getFake()._sentMessages;
    expect(sent[0].extra.reply_to_message_id).toBe('42');
  });

  it('builds an inline_keyboard from buttons[]', async () => {
    await bridge.sendReply({
      chatId:  'c-1',
      text:    'pick one',
      buttons: [
        { id: 'yes', label: 'Yes' },
        { id: 'no',  label: 'No'  },
      ],
    });
    const sent = h.getFake()._sentMessages;
    expect(sent[0].extra.reply_markup).toEqual({
      inline_keyboard: [[
        { text: 'Yes', callback_data: 'yes' },
        { text: 'No',  callback_data: 'no'  },
      ]],
    });
  });

  it('omits reply_markup when buttons array is empty', async () => {
    await bridge.sendReply({
      chatId:  'c-1',
      text:    'hi',
      buttons: [],
    });
    const sent = h.getFake()._sentMessages;
    expect(sent[0].extra.reply_markup).toBeUndefined();
  });
});

// ---------------------------------------------------------------------
// Incoming filter — Q-H2.4 addressed-only
// ---------------------------------------------------------------------

describe('TelegramBridge — addressed-only filter (Q-H2.4)', () => {
  /** @type {ReturnType<typeof makeFakeTelegraf>} */
  let h;
  /** @type {TelegramBridge} */
  let bridge;
  /** @type {Array<import('../../src/types.js').IncomingMessage>} */
  let inbox;

  beforeEach(async () => {
    h = makeFakeTelegraf({ botUsername: 'household_test_bot', botId: 7777777 });
    bridge = new TelegramBridge({
      botToken:        'TEST-TOKEN',
      mode:            'long-polling',
      botUsername:     'household_test_bot',
      telegrafFactory: h.factory,
    });
    inbox = [];
    bridge.onMessage(async (m) => {
      inbox.push(m);
      return { replies: [], stateUpdates: [] };
    });
    await bridge.start();
  });

  it('DM message → handler called; isAddressed=true; sender mapped', async () => {
    await h.getFake().emitMessage(
      makeTextUpdate({
        text:     'hi bot',
        chatType: 'private',
        chatId:   42,
        fromId:   123,
        fromFirst:'Alice',
        fromLast: 'Smith',
      }),
    );
    expect(inbox).toHaveLength(1);
    expect(inbox[0].bridgeId).toBe('telegram');
    expect(inbox[0].chatId).toBe('42');
    expect(inbox[0].text).toBe('hi bot');
    expect(inbox[0].isAddressed).toBe(true);
    expect(inbox[0].sender.displayName).toBe('Alice Smith');
    expect(inbox[0].sender.bridgeUid).toBe('123');
    expect(inbox[0].sender.webid).toBeNull();
  });

  it('group message with @-mention → handled; mention stripped', async () => {
    await h.getFake().emitMessage(
      makeTextUpdate({
        text:     '@household_test_bot add bread',
        chatType: 'group',
      }),
    );
    expect(inbox).toHaveLength(1);
    expect(inbox[0].text).toBe('add bread');
    expect(inbox[0].isAddressed).toBe(true);
  });

  it('@-mention is matched case-insensitively', async () => {
    await h.getFake().emitMessage(
      makeTextUpdate({
        text:     '@HOUSEHOLD_TEST_BOT list shopping',
        chatType: 'supergroup',
      }),
    );
    expect(inbox).toHaveLength(1);
    expect(inbox[0].text).toBe('list shopping');
  });

  it('group message WITHOUT mention → handler NOT called (silently dropped)', async () => {
    await h.getFake().emitMessage(
      makeTextUpdate({
        text:     'just chatting in the group',
        chatType: 'group',
      }),
    );
    expect(inbox).toHaveLength(0);
  });

  it('reply-to-bot message → handler IS called (treated as addressed)', async () => {
    const botMessage = {
      message_id: 555,
      chat:       { id: -1001, type: 'group' },
      from:       { id: 7777777, is_bot: true, username: 'household_test_bot' },
      text:       'previous bot reply',
    };
    await h.getFake().emitMessage(
      makeTextUpdate({
        text:     'thanks',
        chatType: 'group',
        replyTo:  botMessage,
      }),
    );
    expect(inbox).toHaveLength(1);
    expect(inbox[0].text).toBe('thanks');
    expect(inbox[0].replyTo).toBe('555');
  });

  it('reply to a NON-bot user → handler NOT called', async () => {
    const otherUserMessage = {
      message_id: 555,
      chat:       { id: -1001, type: 'group' },
      from:       { id: 99999, is_bot: false, username: 'bob' },
      text:       'something bob said',
    };
    await h.getFake().emitMessage(
      makeTextUpdate({
        text:     'agreed',
        chatType: 'group',
        replyTo:  otherUserMessage,
      }),
    );
    expect(inbox).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
// Inline button / callback_query → synthesised IncomingMessage
// ---------------------------------------------------------------------

describe('TelegramBridge — inline buttons (callback_query)', () => {
  /** @type {ReturnType<typeof makeFakeTelegraf>} */
  let h;
  /** @type {TelegramBridge} */
  let bridge;
  /** @type {Array<import('../../src/types.js').IncomingMessage>} */
  let inbox;

  beforeEach(async () => {
    h = makeFakeTelegraf();
    bridge = new TelegramBridge({
      botToken:        'TEST-TOKEN',
      mode:            'long-polling',
      botUsername:     'household_test_bot',
      telegrafFactory: h.factory,
    });
    inbox = [];
    bridge.onMessage(async (m) => {
      inbox.push(m);
      return { replies: [], stateUpdates: [] };
    });
    await bridge.start();
  });

  it('callback_query → synthesises IncomingMessage with text=button-id, replyTo=original-msg', async () => {
    await h.getFake().emitCallbackQuery(makeCallbackUpdate({
      data:      'mark-done:item-7',
      chatId:    -1001,
      fromId:    123,
      fromFirst: 'Alice',
      origMsgId: 555,
    }));

    expect(inbox).toHaveLength(1);
    expect(inbox[0].bridgeId).toBe('telegram');
    expect(inbox[0].text).toBe('mark-done:item-7');
    expect(inbox[0].replyTo).toBe('555');
    expect(inbox[0].chatId).toBe('-1001');
    expect(inbox[0].isAddressed).toBe(true);
    expect(inbox[0].sender.bridgeUid).toBe('123');
  });

  it('callback_query → answerCbQuery is invoked', async () => {
    await h.getFake().emitCallbackQuery(makeCallbackUpdate({
      data:      'option-a',
      origMsgId: 999,
    }));
    expect(h.getFake()._ackedQueries).toHaveLength(1);
  });

  it('callback_query is acked even when the handler throws', async () => {
    bridge.onMessage(async () => { throw new Error('handler-boom'); });
    await expect(
      h.getFake().emitCallbackQuery(makeCallbackUpdate({ data: 'x' })),
    ).rejects.toThrow('handler-boom');
    expect(h.getFake()._ackedQueries).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------
// Non-text messages
// ---------------------------------------------------------------------

describe('TelegramBridge — non-text messages', () => {
  it('a photo update (no .text) in a group is silently dropped', async () => {
    const h = makeFakeTelegraf();
    const bridge = new TelegramBridge({
      botToken:        'TEST-TOKEN',
      mode:            'long-polling',
      botUsername:     'household_test_bot',
      telegrafFactory: h.factory,
    });
    /** @type {Array<any>} */
    const inbox = [];
    bridge.onMessage(async (m) => {
      inbox.push(m);
      return { replies: [], stateUpdates: [] };
    });
    await bridge.start();

    // Telegraf actually fires 'photo' for photos, not 'text', so we
    // pump a malformed/text-free update through the 'text' handler
    // to prove the bridge's own type-guard discards it.  In real
    // life a photo never reaches the 'text' handler.
    const fake = h.getFake();
    const ctx = {
      update:  {},
      message: {
        message_id: 9,
        chat:       { id: -1001, type: 'group' },
        from:       { id: 1, first_name: 'A' },
        photo:      [{ file_id: 'X' }],
        // no .text
      },
      chat:    { id: -1001, type: 'group' },
      from:    { id: 1, first_name: 'A' },
      botInfo: fake.botInfo,
      async answerCbQuery() {},
    };
    for (const fn of fake._handlers.text ?? []) await fn(ctx);

    expect(inbox).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
// Structural conformance
// ---------------------------------------------------------------------

describe('TelegramBridge — MessagingBridge structural conformance', () => {
  it('exposes the full MessagingBridge surface', () => {
    const { factory } = makeFakeTelegraf();
    const bridge = new TelegramBridge({
      botToken:        'TEST-TOKEN',
      mode:            'long-polling',
      botUsername:     'household_test_bot',
      telegrafFactory: factory,
    });
    expect(typeof bridge.start).toBe('function');
    expect(typeof bridge.stop).toBe('function');
    expect(typeof bridge.sendReply).toBe('function');
    expect(typeof bridge.onMessage).toBe('function');
    expect(bridge.bridgeId).toBe('telegram');
  });
});
