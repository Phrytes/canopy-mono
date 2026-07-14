// TelegramFeedbackBot — the multiplexer that turns one Telegram bot into the participant
// journey for many chats. Each chat gets its own ChannelDispatcher (over a
// TelegramChannelAdapter bound to that chatId); inbound text and button callbacks are
// routed to dispatcher actions. The dispatcher + floors are shared with canopy-chat — this
// file only does Telegram-specific routing (architecture §1.3 "build once, two adapters").
//
// Decoupled from the substrate via the minimal bridge interface (onMessage / sendReply /
// start / stop) — the real @canopy/chat-agent TelegramBridge satisfies it; a fake bridge
// does in tests. Pseudonyms come from `participantFor(chatId)` (default tg:<chatId>; a real
// deployment passes an HMAC so the pod never holds a reversible chat id).

import { ChannelDispatcher } from './dispatcher.js';
import { TelegramChannelAdapter } from './telegram-adapter.js';
import { getStrings } from '../strings/index.js';
import { parseControl, runAction } from './actions.js';
import { hmacPseudonym } from './pseudonym.js';

export class TelegramFeedbackBot {
  #bridge; #pod; #config; #participantFor; #onActivate; #strings; #ownPod; #sessions = new Map();

  /**
   * @param {{ bridge, pod, config, participantFor?:(chatId:string)=>string,
   *           onActivate?:(participant:string)=>Promise<void> }} a
   *   onActivate runs ONCE per chat (first message) — for a CSS pod, provision the
   *   participant's ACP container (with the bot service as writer) before any write.
   */
  constructor({ bridge, pod, config, participantFor, pseudonymSecret, onActivate, ownPod }) {
    if (!bridge || typeof bridge.onMessage !== 'function' || typeof bridge.sendReply !== 'function') {
      throw new Error('TelegramFeedbackBot: bridge with onMessage()/sendReply() required');
    }
    this.#bridge = bridge;
    this.#pod = pod;
    this.#config = config;
    this.#strings = getStrings(config?.language?.preferred);   // locale follows the project
    // Pseudonym: an explicit participantFor wins; else a KEYED HMAC of the chatId (secret held
    // off the pod) so the pod never stores a reversible id. With neither, fall back to the raw
    // tg:<chatId> but WARN — that pod would hold a reversible identifier.
    if (participantFor) this.#participantFor = participantFor;
    else if (pseudonymSecret) this.#participantFor = (chatId) => hmacPseudonym(pseudonymSecret, chatId);
    else {
      console.warn('[tg] no pseudonymSecret/participantFor — the pod will hold a REVERSIBLE tg:<chatId>; set FP_PSEUDONYM_SECRET');
      this.#participantFor = (chatId) => `tg:${chatId}`;
    }
    this.#onActivate = onActivate;
    this.#ownPod = ownPod ?? null;   // Option C — bot-held pod for each participant's raw record
  }

  // async: provisions the participant's pod container once, on the chat's first message.
  async #session(chatId) {
    let s = this.#sessions.get(chatId);
    if (!s) {
      const participant = this.#participantFor(chatId);
      const adapter = new TelegramChannelAdapter({ bridge: this.#bridge, chatId, strings: this.#strings });
      const dispatcher = new ChannelDispatcher({ adapter, pod: this.#pod, config: this.#config, participant, ownPod: this.#ownPod });
      s = { adapter, dispatcher, points: [], participant };
      this.#sessions.set(chatId, s);   // set before awaiting so a 2nd message won't double-provision
      if (this.#onActivate) {
        try { await this.#onActivate(participant); }
        catch (e) { console.error(`[tg] provisioning ${participant} failed: ${e.message}`); }
      }
    }
    return s;
  }

  #say(chatId, text, buttons) { return this.#bridge.sendReply({ chatId: String(chatId), text, buttons }); }

  async start() {
    this.#bridge.onMessage((m) => this.handle(m));
    if (typeof this.#bridge.start === 'function') await this.#bridge.start();
  }

  async stop() { if (typeof this.#bridge.stop === 'function') await this.#bridge.stop(); }

  /** Route one inbound message (free text or a button callback). Returns for tests. */
  async handle(m) {
    const chatId = String(m.chatId);
    const text = (m.text || '').trim();
    const session = await this.#session(chatId);
    session.adapter.setReplyTo(m.messageId);

    // Telegram's grammar is explicit slashes + button callbacks; anything else is feedback.
    // `m.edited` (a message the participant edited in the TG client) rides along so the stored
    // contribution can be flagged edited.
    const action = parseControl(text) || { kind: 'message', text, edited: Boolean(m.edited) };
    const say = (txt, buttons) => this.#say(chatId, txt, buttons);
    return runAction(action, { session, say, strings: this.#strings });
  }
}
