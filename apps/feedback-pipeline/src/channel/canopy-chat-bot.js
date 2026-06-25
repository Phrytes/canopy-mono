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
import { pollAndOpenVerification } from '../verify/round-control.js';

export class CanopyChatBot {
  #bridge; #pod; #centralPod; #controlStore; #config; #model; #participantFor; #identityFor; #strings; #sessions = new Map();

  /** @param {{ bridge, pod, config, participantFor?:(chatId:string)=>string,
   *           identityFor?:(chatId:string)=>{publicKey:string,privateKey:string},
   *           centralPod?, controlStore? }} a
   *  canopy-chat runs ON the participant's device, so `identityFor` can return the participant's
   *  own signing keypair (from their vault) — contributions are then signed and accepted by a
   *  verify-enabled project. When `centralPod` + `controlStore` are supplied, the verify-summary
   *  loop is active: `pod` is the participant's OWN pod (Stage-1 contributions + the summary source),
   *  the verified summary goes to `centralPod`, and `pollVerification` opens any lead-triggered round. */
  constructor({ bridge, pod, config, participantFor, identityFor, centralPod, controlStore }) {
    if (!bridge || typeof bridge.onMessage !== 'function' || typeof bridge.sendReply !== 'function') {
      throw new Error('CanopyChatBot: bridge with onMessage()/sendReply() required');
    }
    this.#bridge = bridge;
    this.#pod = pod;
    this.#centralPod = centralPod ?? null;
    this.#controlStore = controlStore ?? null;
    this.#config = config;
    this.#model = config?.llm?.model;
    this.#strings = getStrings(config?.language?.preferred);
    this.#participantFor = participantFor || ((chatId) => `cc:${chatId}`);
    this.#identityFor = identityFor;
  }

  #session(chatId) {
    let s = this.#sessions.get(chatId);
    if (!s) {
      const adapter = new CanopyChatChannelAdapter({ bridge: this.#bridge, chatId, strings: this.#strings });
      const dispatcher = new ChannelDispatcher({
        adapter, pod: this.#pod, config: this.#config,
        participant: this.#participantFor(chatId), identity: this.#identityFor?.(chatId),
        centralPod: this.#centralPod,
      });
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

  /** Verify-summary loop — on contact-open, open the verify-turn for any lead-triggered round this
   *  participant hasn't verified yet. No-op when the loop isn't wired (no centralPod/controlStore). */
  async pollVerification(chatId, { summarise } = {}) {
    if (!this.#controlStore || !this.#centralPod) return null;
    const session = this.#session(String(chatId));
    return pollAndOpenVerification({
      dispatcher: session.dispatcher, controlStore: this.#controlStore,
      projectId: this.#config?.projectId, participant: this.#participantFor(String(chatId)),
      centralPod: this.#centralPod, model: this.#model, ...(summarise ? { summarise } : {}),
    });
  }
}
