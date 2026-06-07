// TelegramChannelAdapter — the real "post-receipt" surface (architecture §1.3). Telegram
// and our bot service see the raw message before any floor runs, so `floorsTrust` is
// 'post-receipt' (the honest label) and the floor runs HERE, in the bot service, not on
// the participant's device. Everything past the floor is the channel-agnostic dispatcher.
//
// The adapter is deliberately decoupled from the substrate: it talks to a minimal `bridge`
// with one method — `sendReply({ chatId, replyTo?, text, buttons? })` — which the real
// @canopy/chat-agent TelegramBridge satisfies, and which a fake bridge satisfies in tests.
// So this file (and the app's tests) carry NO @canopy build dependency.

import { floorMessage } from '../floors/index.js';
import { getStrings } from '../strings/index.js';
import { renderMessage } from './render.js';

export { renderMessage };   // re-exported for back-compat (callers/tests import it here)

export class TelegramChannelAdapter {
  floorsTrust = 'post-receipt';
  #bridge; #chatId; #replyTo; #strings;

  /** @param {{ bridge:{ sendReply(a:object):Promise<void> }, chatId:string, strings?:object }} a */
  constructor({ bridge, chatId, strings = getStrings() }) {
    if (!bridge || typeof bridge.sendReply !== 'function') throw new Error('TelegramChannelAdapter: bridge with sendReply() required');
    if (!chatId) throw new Error('TelegramChannelAdapter: chatId required');
    this.#bridge = bridge;
    this.#chatId = String(chatId);
    this.#strings = strings;
  }

  /** Let the bot thread replies under the current inbound message. */
  setReplyTo(messageId) { this.#replyTo = messageId == null ? undefined : String(messageId); }

  floor(raw, opts = {}) { return floorMessage(raw, opts); }

  async send(msg) {
    const { text, buttons } = renderMessage(msg, this.#strings);
    if (!text && !buttons) return;
    await this.#bridge.sendReply({ chatId: this.#chatId, replyTo: this.#replyTo, text, buttons });
  }
}
