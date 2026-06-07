// CanopyChatBot — the canopy-chat multiplexer. Same structure as TelegramFeedbackBot, but
// the front-end is NATURAL LANGUAGE: participants type freely ("I think the waiting lists
// are too long", "ok I'm done", "yes send them all") and an intent classifier maps the
// non-command turns to actions. Explicit button callbacks (fp:*) still work, so the chat UI
// can offer buttons too. Everything past routing is the shared dispatcher + actions.
//
// Decoupled from the substrate via the minimal onMessage/sendReply bridge contract — the
// @canopy/chat-agent InMemoryBridge satisfies it (wired live in scripts/canopy-chat-smoke.js).

import { ChannelDispatcher } from './dispatcher.js';
import { CanopyChatChannelAdapter } from './canopy-chat-adapter.js';
import { getStrings } from '../strings/index.js';
import { parseControl, runAction } from './actions.js';
import { classifyIntent } from './intent.js';

export class CanopyChatBot {
  #bridge; #pod; #config; #model; #participantFor; #strings; #sessions = new Map();

  /** @param {{ bridge, pod, config, participantFor?:(chatId:string)=>string }} a */
  constructor({ bridge, pod, config, participantFor }) {
    if (!bridge || typeof bridge.onMessage !== 'function' || typeof bridge.sendReply !== 'function') {
      throw new Error('CanopyChatBot: bridge with onMessage()/sendReply() required');
    }
    this.#bridge = bridge;
    this.#pod = pod;
    this.#config = config;
    this.#model = config?.llm?.model;
    this.#strings = getStrings(config?.language?.preferred);
    this.#participantFor = participantFor || ((chatId) => `cc:${chatId}`);
  }

  #session(chatId) {
    let s = this.#sessions.get(chatId);
    if (!s) {
      const adapter = new CanopyChatChannelAdapter({ bridge: this.#bridge, chatId, strings: this.#strings });
      const dispatcher = new ChannelDispatcher({ adapter, pod: this.#pod, config: this.#config, participant: this.#participantFor(chatId) });
      s = { adapter, dispatcher, points: [] };
      this.#sessions.set(chatId, s);
    }
    return s;
  }

  #say(chatId, text, buttons) { return this.#bridge.sendReply({ chatId: String(chatId), text, buttons }); }

  async start() {
    this.#bridge.onMessage((m) => this.handle(m));
    if (typeof this.#bridge.start === 'function') await this.#bridge.start();
  }

  async stop() { if (typeof this.#bridge.stop === 'function') await this.#bridge.stop(); }

  /** Route one inbound turn: explicit control first, else natural-language intent. */
  async handle(m) {
    const chatId = String(m.chatId);
    const text = (m.text || '').trim();
    const session = this.#session(chatId);
    session.adapter.setReplyTo(m.messageId);

    const action = parseControl(text) || await classifyIntent(text, { model: this.#model });
    const say = (txt, buttons) => this.#say(chatId, txt, buttons);
    return runAction(action, { session, say, strings: this.#strings });
  }
}
