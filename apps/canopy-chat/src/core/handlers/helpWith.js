/**
 * Inbound help-with handlers.  Bundle H Phase 2 (#269) + Phase 4
 * (#271 — 2026-05-27).
 *
 * Two factories:
 *
 *   - `makeHandleHelpWithAccepted` — renders a confirmation text
 *     bubble in the DM thread (mirrors chat-message).
 *   - `makeHandleHelpWithResponse` (Phase 4) — produces a structured
 *     `responder-card` bubble that platforms render their own way
 *     (web: DOM widget with Accept/Decline/Counter buttons; mobile:
 *     RN TouchableOpacity bubble with the same buttons).  The
 *     business logic (when to fire, what data to surface) lives
 *     here; the platform's `appendResponderCard` callback decides
 *     HOW to render.
 *
 * @param {object} args
 * @param {(peerAddr: string) => ({id: string} | null)}                args.ensureDmThread
 * @param {(threadId: string, rendered: object) => void}               args.appendBubble
 * @param {(peerAddr: string, displayName: string) => void}            [args.updatePeerDisplay]
 * @param {(key: string, vars?: object) => string}                     args.t
 * @param {{info?, warn?, error?}}                                     [args.logger]
 * @returns {(fromAddr: string, payload: object) => void}
 */
import { renderReply } from '../../renderer.js';

export function makeHandleHelpWithAccepted({
  ensureDmThread, appendBubble, updatePeerDisplay, t, logger = console,
} = {}) {
  if (typeof ensureDmThread !== 'function') throw new Error('makeHandleHelpWithAccepted: ensureDmThread required');
  if (typeof appendBubble   !== 'function') throw new Error('makeHandleHelpWithAccepted: appendBubble required');
  if (typeof t              !== 'function') throw new Error('makeHandleHelpWithAccepted: t required');

  return function handleHelpWithAccepted(fromAddr, payload) {
    if (!payload?.itemId) {
      logger.debug?.('[peer] help-with-accepted missing itemId', payload);
      return;
    }
    if (payload.senderDisplay && typeof updatePeerDisplay === 'function') {
      updatePeerDisplay(fromAddr, payload.senderDisplay);
    }
    const thread = ensureDmThread(fromAddr);
    if (!thread) {
      logger.warn?.('[peer] help-with-accepted: no DM thread to deliver to');
      return;
    }
    const rendered = renderReply({
      payload:  '✓ Your offer was accepted. Coordinate next steps in this DM.',
      shape:    'text',
      threadId: thread.id,
    }, { t });
    appendBubble(thread.id, rendered);
  };
}

/**
 * Bundle H Phase 4 (#271, 2026-05-27) — lifted from
 * `apps/canopy-chat/web/main.js:2622`.  Builds + surfaces a structured
 * responder-card bubble in the DM thread paired with `fromAddr`.  The
 * card carries the post context + the helper's offer body + identifying
 * info; the host's `appendResponderCard` callback renders it (web: DOM
 * widget; mobile: RN bubble with Accept/Decline/Counter buttons that
 * dispatch through buttonSpecials).
 *
 * @param {object} args
 * @param {(peerAddr: string) => ({id: string} | null)}                args.ensureDmThread
 * @param {(threadId: string, data: object) => void}                    args.appendResponderCard
 *   data = {itemId, fromAddr, postText?, body, senderDisplay?}
 * @param {(peerAddr: string, displayName: string) => void}             [args.updatePeerDisplay]
 * @param {{info?, warn?, error?, debug?}}                              [args.logger]
 * @returns {(fromAddr: string, payload: object) => void}
 */
export function makeHandleHelpWithResponse({
  ensureDmThread, appendResponderCard, updatePeerDisplay, logger = console,
} = {}) {
  if (typeof ensureDmThread       !== 'function') throw new Error('makeHandleHelpWithResponse: ensureDmThread required');
  if (typeof appendResponderCard  !== 'function') throw new Error('makeHandleHelpWithResponse: appendResponderCard required');

  return function handleHelpWithResponse(fromAddr, payload) {
    if (!payload?.itemId || typeof payload?.body !== 'string' || payload.body === '') {
      logger.debug?.('[peer] help-with-response missing fields', payload);
      return;
    }
    if (payload.senderDisplay && typeof updatePeerDisplay === 'function') {
      updatePeerDisplay(fromAddr, payload.senderDisplay);
    }
    const thread = ensureDmThread(fromAddr);
    if (!thread) {
      logger.warn?.('[peer] help-with-response: no DM thread to deliver to');
      return;
    }
    appendResponderCard(thread.id, {
      itemId:        payload.itemId,
      fromAddr,
      postText:      typeof payload.postText === 'string' ? payload.postText : null,
      body:          payload.body,
      senderDisplay: payload.senderDisplay ?? null,
    });
  };
}
