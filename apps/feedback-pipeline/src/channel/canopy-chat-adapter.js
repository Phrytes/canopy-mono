// CanopyChatChannelAdapter — the "pre-send" surface (architecture §1.3). Unlike Telegram,
// canopy-chat runs ON the participant's device with browser-held keys, so the floor runs
// BEFORE anything leaves the device — nothing raw is sent. `floorsTrust` is 'pre-send', the
// honest label for that stronger guarantee. Past the floor it's the same channel-agnostic
// dispatcher + the same renderer/strings as Telegram.
//
// Decoupled from the substrate via the same minimal bridge contract (sendReply) — the
// @canopy/chat-agent InMemoryBridge satisfies it; a fake bridge does in tests.

import { floorMessage } from '../floors/index.js';
import { getStrings } from '../strings/index.js';
import { renderMessage } from './render.js';

export class CanopyChatChannelAdapter {
  floorsTrust = 'pre-send';
  #bridge; #chatId; #replyTo; #strings;

  /** @param {{ bridge:{ sendReply(a:object):Promise<void> }, chatId:string, strings?:object }} a */
  constructor({ bridge, chatId, strings = getStrings() }) {
    if (!bridge || typeof bridge.sendReply !== 'function') throw new Error('CanopyChatChannelAdapter: bridge with sendReply() required');
    if (!chatId) throw new Error('CanopyChatChannelAdapter: chatId required');
    this.#bridge = bridge;
    this.#chatId = String(chatId);
    this.#strings = strings;
  }

  setReplyTo(messageId) { this.#replyTo = messageId == null ? undefined : String(messageId); }

  // On canopy-chat this runs on-device (browser), before the message leaves.
  floor(raw, opts = {}) { return floorMessage(raw, opts); }

  async send(msg) {
    const { text, buttons } = renderMessage(msg, this.#strings);
    if (!text && !buttons) return;
    // text+buttons stay the canonical render; for the review, also pass the structured points so a rich
    // surface can offer inline per-point edit (pre-fill the editor with the current curated text).
    // For the review, also pass the structured points AND the card labels in the BOT's language (s) — the
    // rich surfaces render these instead of their app-locale strings, so the cards match the bot regardless
    // of the participant's device locale (doorgeefluik: the bot drives its surface's language).
    const s = this.#strings;
    const extra = msg?.type === 'review' && Array.isArray(msg.points)
      ? { kind: 'review', points: msg.points, labels: {
          send_one: s.reviewSend, send_all: s.consentAll, send_none: s.cancel,
          original: s.originalLabel, edited: s.editedTag, save_edit: s.reviewSave, cancel_edit: s.reviewCancelEdit,
        } }
      : {};
    await this.#bridge.sendReply({ chatId: this.#chatId, replyTo: this.#replyTo, text, buttons, ...extra });
  }
}
