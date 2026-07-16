/**
 * contactThreadChannel — the CLIENT end of a contact/bot peer link
 * (feedback-extension P5, the platform half of "journey A").
 *
 * P4 made a bot's named skills dispatchable (a slash command → a router). This
 * is the COMPLEMENT: a free-text conversation with a contact-bot in its own DM
 * thread — the participant sends a turn, the bot replies asynchronously, the
 * reply lands back in that thread. It is the client mirror of the feedback
 * repo's `PeerBridge` (which is the bot SIDE of the same link).
 *
 * TRANSPORT-AGNOSTIC by construction: it rides an injected `sendToPeer(addr,
 * payload)` — i.e. `agent.sendPeerMessage` / `sa.peer.sendTo`, which routes
 * through `core` `RoutingStrategy` (priority: internal > local > mdns >
 * rendezvous > relay > nkn > … > a2a). So the same channel reaches the bot over
 * mDNS on a LAN, a WebRTC rendezvous/relay link on the internet, or NKN as the
 * bootstrap/fallback rung — the channel never names a transport. Inbound replies
 * arrive via the shell's existing `makePeerRouter` subtype dispatch.
 *
 * SUBTYPE-INJECTABLE so the platform stays decoupled from any one bot's wire
 * shape (the repo-boundary rule: the platform ships the generic channel; a bot's
 * project wiring — e.g. feedback's `PeerBridge` with `fp-msg`/`fp-reply` — passes
 * its own subtypes). Defaults to the generic `contact-msg`/`contact-reply`.
 *
 * Pure: no DOM, no RN, no transport import — web and mobile share it; each shell
 * injects `sendToPeer` + registers `replyHandler(onReply)` in its peer router.
 */

/** Generic platform subtypes for a contact-thread turn / reply. */
export const DEFAULT_CONTACT_SUBTYPES = { out: 'contact-msg', in: 'contact-reply' };

/**
 * @param {object} deps
 * @param {(addr: string, payload: object) => any} deps.sendToPeer
 *   the shell's peer send (`agent.sendPeerMessage` / `sa.peer.sendTo`).
 * @param {{ out: string, in: string }} [deps.subtypes]
 *   wire subtypes for outbound turns / inbound replies. Default generic; a bot's
 *   project wiring overrides (e.g. `{ out:'fp-msg', in:'fp-reply' }`).
 * @param {() => number} [deps.now]   clock (injectable for tests).
 * @param {() => string} [deps.genId] message-id factory (injectable for tests).
 * @returns {{
 *   sendTurn: (turn: object) => { messageId: string, sent: Promise<any> },
 *   replyHandler: (onReply: (reply: object) => void) => ((fromAddr: string, payload: object) => void),
 *   subtypes: { out: string, in: string },
 * }}
 */
export function createContactThreadChannel({
  sendToPeer,
  subtypes = DEFAULT_CONTACT_SUBTYPES,
  now = () => Date.now(),
  genId,
} = {}) {
  const mkId = typeof genId === 'function'
    ? genId
    : () => `ct-${now()}-${Math.random().toString(36).slice(2, 8)}`;

  /**
   * Send one conversational turn to the contact's bot over the peer transport.
   *
   * @param {object} turn
   * @param {string}  turn.peerAddr     the bot's peer address (from the contact record).
   * @param {string}  turn.threadId     the contact-thread id (so the reply routes back here).
   * @param {string}  turn.text         the user's message.
   * @param {string}  [turn.messageId]  caller-supplied id (else generated) — echoed on the reply's `replyTo`.
   * @param {string}  [turn.replyTo]    id of a prior bot message this answers (for IR round-trips).
   * @param {object}  [turn.sender]     `{ displayName?, webid? }` so the bot knows who it's talking to.
   * @returns {{ messageId: string, sent: Promise<any> }}
   *   the (possibly generated) message id + a promise for the SEND (not the reply,
   *   which arrives asynchronously through `replyHandler`).
   */
  function sendTurn({ peerAddr, threadId, text, messageId, replyTo, sender } = {}) {
    if (!peerAddr) throw new Error('contactThreadChannel.sendTurn: peerAddr is required');
    if (typeof sendToPeer !== 'function') throw new Error('contactThreadChannel: sendToPeer is required');
    const id = messageId ?? mkId();
    const payload = {
      subtype:   subtypes.out,
      threadId,
      text:      text ?? '',
      messageId: id,
      replyTo,
      ts:        now(),
    };
    if (sender?.displayName) payload.displayName = sender.displayName;
    if (sender?.webid)       payload.webid       = sender.webid;
    const sent = Promise.resolve(sendToPeer(peerAddr, payload));
    return { messageId: id, sent };
  }

  /**
   * Build a `makePeerRouter`-compatible handler for the inbound reply subtype.
   * Register it under `subtypes.in` in the shell's peer router; it normalises
   * the bot's reply envelope and forwards it to `onReply`.
   *
   * @param {(reply: { fromAddr: string, threadId?: string, text: string, buttons?: object[], replyTo?: string, messageId?: string }) => void} onReply
   * @returns {(fromAddr: string, payload: object) => void}
   */
  function replyHandler(onReply) {
    return makeInboundHandler(subtypes.in, onReply);
  }

  /**
   * Build a `makePeerRouter`-compatible handler for an INBOUND PEER TURN (S1 #3 —
   * peer↔peer DM). A bot answers with `subtypes.in` (`contact-reply`); a PERSON
   * DMs you with the SAME `subtypes.out` (`contact-msg`) they'd send anywhere —
   * peer DM is symmetric. Register this under `subtypes.out` so a peer's message
   * lands in your thread with them (routed by sender address, since their
   * `threadId` is their own view, not yours). Same normalised shape as a reply.
   *
   * @param {(msg: { fromAddr: string, threadId?: string, text: string, buttons?: object[], replyTo?: string, messageId?: string }) => void} onMessage
   * @returns {(fromAddr: string, payload: object) => void}
   */
  function messageHandler(onMessage) {
    return makeInboundHandler(subtypes.out, onMessage);
  }

  function makeInboundHandler(subtype, cb) {
    return function onContactInbound(fromAddr, payload) {
      if (!payload || payload.subtype !== subtype) return;   // not ours
      if (typeof cb !== 'function') return;
      cb({
        fromAddr,
        threadId:  payload.threadId,
        text:      payload.text ?? '',
        buttons:   Array.isArray(payload.buttons) ? payload.buttons : undefined,
        replyTo:   payload.replyTo,
        messageId: payload.messageId,
      });
    };
  }

  return { sendTurn, replyHandler, messageHandler, subtypes };
}
