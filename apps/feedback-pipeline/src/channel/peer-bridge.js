// PeerBridge — the EXTERNAL MessagingBridge (M5). The feedback bot runs as its own agent
// (its own WebID) and talks to participants over @canopy/secure-agent's peer transport
// (sa.peer). Mirror of InternalBusBridge, but across a network peer link instead of the
// in-process bus. The external bot is typically UNSIGNED (no participant key on the server),
// so a verify-enabled project refuses its writes gracefully (handled in the dispatcher).
//
// Implements @canopy/chat-agent's MessagingBridge. The `peer` is INJECTED (sendTo + the host
// wiring its onPeerMessage to ours), so this module imports no @canopy/* and the transport
// (NKN, etc.) is never named here — `transportMode` lives with the secure-agent, not the bridge.
//
// Wire shape (a thin subtype on the peer payload, routed like canopy-chat's peerRouter).
// The bot accepts its NATIVE shape AND canopy-chat's GENERIC contact-thread channel
// (the platform ships the generic channel; this bot — the dogfood — adapts to it,
// rather than the platform learning `fp-*`). It replies in whichever subtype it was
// addressed in, echoing the channel's `threadId` so the client routes the reply back:
//   participant → bot:  { subtype: 'fp-msg'   | 'contact-msg',  text, messageId, threadId?, displayName?, webid?, replyTo? }
//   bot → participant:  { subtype: 'fp-reply' | 'contact-reply', text, buttons?, threadId?, replyTo? }

// Inbound subtype → the reply subtype to answer it with.
const REPLY_FOR = { 'fp-msg': 'fp-reply', 'contact-msg': 'contact-reply' };
const ACCEPTED = Object.keys(REPLY_FOR);
const DEFAULT_REPLY = 'fp-reply';   // proactive sends with no prior inbound

export class PeerBridge {
  #peer; #handler = null; #started = false;
  // chatId → { replySubtype, threadId } learned from the last inbound, so a reply
  // answers in the same dialect + thread it arrived on.
  #replyMeta = new Map();

  /** @param {{ peer:{ sendTo:(addr:string,payload:any)=>Promise<void> }, id?:string }} a */
  constructor({ peer, id = 'peer' } = {}) {
    if (!peer || typeof peer.sendTo !== 'function') throw new Error('PeerBridge: a peer with sendTo() is required');
    this.id = id;
    this.#peer = peer;
  }

  async start() { this.#started = true; }
  async stop()  { this.#started = false; }

  onMessage(handler) { this.#handler = handler; }

  /** Outbound reply → the participant peer (chatId = the participant's peer address). */
  async sendReply({ chatId, replyTo, text, buttons } = {}) {
    const meta = this.#replyMeta.get(chatId);
    const payload = { subtype: meta?.replySubtype ?? DEFAULT_REPLY, replyTo, text, buttons };
    if (meta?.threadId != null) payload.threadId = meta.threadId;   // echo so the client routes it back
    await this.#peer.sendTo(chatId, payload);
  }

  /** The host wires sa.peer's onPeerMessage to THIS (or routes the `fp-msg`/`contact-msg`
   *  subtypes here, like canopy-chat's peerRouter). Bound so it can be handed straight to
   *  `connect({onPeerMessage})`. */
  onPeerMessage = async (env) => {
    const { from, payload } = env ?? {};
    if (!this.#started || !this.#handler) return;
    const sub = payload?.subtype;
    if (!ACCEPTED.includes(sub)) return;
    // Remember how to answer this peer (dialect + thread).
    this.#replyMeta.set(from, { replySubtype: REPLY_FOR[sub], threadId: payload.threadId });
    await this.#handler({
      bridgeId: this.id,
      chatId: from,
      messageId: payload.messageId ?? `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sender: { bridgeUid: from, displayName: payload.displayName ?? 'peer', webid: payload.webid },
      text: payload.text ?? '',
      replyTo: payload.replyTo,
      isAddressed: true,
    });
  };
}
