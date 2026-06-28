// InternalBusBridge — the PRODUCTION in-process MessagingBridge (M1). The feedback bot is
// co-hosted with the participant's chat agent on the SAME shared @canopy/core InternalBus, so a
// feedback turn never leaves the process — no network, no transport. It is the real partner for
// CanopyChatBot (InMemoryBridge stays the test double).
//
// Implements @canopy/chat-agent's MessagingBridge contract (id / start / stop / onMessage /
// sendReply). The bus is INJECTED (the canopy-chat host owns it — see realAgent.js's shared
// `bus`), so this module imports no @canopy/* itself and stays portable per the node-portability
// convention. Channels on the bus:
//   fp:msg:<botAddress>   — participant → bot (a feedback turn)
//   fp:reply:<chatId>     — bot → participant (a rendered reply)
//   fp:done:<corrId>      — bot → participant (delivery ack once the turn is fully handled)
//
// `connectFeedbackParticipant` is the participant-side glue the web mount (and tests) use to
// post turns and receive replies over the same bus.

const SEND = (addr) => `fp:msg:${addr}`;
const REPLY = (chatId) => `fp:reply:${chatId}`;
const DONE = (corrId) => `fp:done:${corrId}`;

export class InternalBusBridge {
  #bus; #addr; #handler = null; #started = false; #listener;

  /** @param {{ bus, address?:string, id?:string }} a  bus = the shared InternalBus (Emitter
   *   with on/off/emit); address = the bot's address on the bus. */
  constructor({ bus, address = 'fp-bot', id = 'internal-bus' } = {}) {
    if (!bus || typeof bus.on !== 'function' || typeof bus.emit !== 'function') {
      throw new Error('InternalBusBridge: a shared InternalBus (on/off/emit) is required');
    }
    this.id = id;
    this.#bus = bus;
    this.#addr = address;
    this.#listener = (env) => this.#deliver(env);
  }

  get address() { return this.#addr; }

  async start() { if (!this.#started) { this.#bus.on(SEND(this.#addr), this.#listener); this.#started = true; } }
  async stop()  { if (this.#started) { this.#bus.off(SEND(this.#addr), this.#listener); this.#started = false; } }

  onMessage(handler) { this.#handler = handler; }

  /** Outbound reply — posted on the participant's own channel (chatId = participant address). */
  async sendReply({ chatId, replyTo, text, buttons, kind, points } = {}) {
    this.#bus.emit(REPLY(chatId), { bridgeId: this.id, chatId, replyTo, text, buttons, kind, points });
  }

  // Inbound turn → IncomingMessage → handler. Acks `fp:done` when the turn is fully handled
  // (so the participant side can await delivery deterministically — useful for UI + tests).
  async #deliver(env) {
    if (!this.#handler) return;
    const msg = {
      bridgeId: this.id,
      chatId: env.chatId ?? env.from,
      messageId: env.messageId ?? `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sender: { bridgeUid: env.from, displayName: env.sender?.displayName ?? 'participant', webid: env.sender?.webid },
      text: env.text ?? '',
      replyTo: env.replyTo,
      isAddressed: true,
    };
    try { await this.#handler(msg); }
    finally { if (env.corrId) this.#bus.emit(DONE(env.corrId), true); }
  }
}

/**
 * Participant-side client: post feedback turns to the bot and receive replies, over the same
 * shared bus. `send(text)` resolves once the bot has fully handled the turn (via the fp:done
 * ack), so callers don't race the async journey.
 * @param {object} bus  the shared InternalBus
 * @param {{ botAddress?:string, chatId:string, onReply?:(r:object)=>void }} a
 * @returns {{ send:(text:string)=>Promise<void>, replies:object[], close:()=>void }}
 */
export function connectFeedbackParticipant(bus, { botAddress = 'fp-bot', chatId, onReply } = {}) {
  if (!chatId) throw new Error('connectFeedbackParticipant: chatId required');
  const replies = [];
  const onReplyEvt = (r) => { replies.push(r); onReply?.(r); };
  bus.on(REPLY(chatId), onReplyEvt);
  let n = 0;
  return {
    replies,
    send(text) {
      const corrId = `${chatId}:${++n}`;
      return new Promise((resolve) => {
        bus.once(DONE(corrId), () => resolve());
        bus.emit(SEND(botAddress), { from: chatId, chatId, messageId: corrId, corrId, text, sender: { displayName: 'participant' } });
      });
    },
    close() { bus.off(REPLY(chatId), onReplyEvt); },
  };
}
