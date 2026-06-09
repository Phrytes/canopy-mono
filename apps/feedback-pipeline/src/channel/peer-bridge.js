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
// Wire shape (a thin subtype on the peer payload, routed like canopy-chat's peerRouter):
//   { subtype: 'fp-msg',   text, messageId, displayName?, webid?, replyTo? }   participant → bot
//   { subtype: 'fp-reply', text, buttons?, replyTo? }                          bot → participant

const SUBTYPE_MSG = 'fp-msg';
const SUBTYPE_REPLY = 'fp-reply';

export class PeerBridge {
  #peer; #handler = null; #started = false;

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
    await this.#peer.sendTo(chatId, { subtype: SUBTYPE_REPLY, replyTo, text, buttons });
  }

  /** The host wires sa.peer's onPeerMessage to THIS (or routes the `fp-msg` subtype here, like
   *  canopy-chat's peerRouter). Bound so it can be handed straight to `connect({onPeerMessage})`. */
  onPeerMessage = async (env) => {
    const { from, payload } = env ?? {};
    if (!this.#started || !this.#handler || payload?.subtype !== SUBTYPE_MSG) return;
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
