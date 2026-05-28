/**
 * Inbound peer-message subtype router.  Bundle H (#268, 2026-05-27)
 * — lifted from the inline `onPeerMessage` block in
 * `apps/canopy-chat/web/main.js:346`.
 *
 * Shape matches what `sa.peer.connect({onPeerMessage})` calls when
 * an envelope arrives:
 *
 *     onPeerMessage({ from, payload }) → void
 *
 * The dispatch is keyed on `payload.subtype`.  Callers supply a
 * `handlers` map; missing subtypes fall through to `defaultHandler`
 * (typical use: plain chat-message bubbles).  Handlers can be sync
 * or async — the router awaits internally + logs on rejection so
 * the caller never sees an unhandled promise.
 *
 * The router is portable: zero DOM, zero RN, no module-level state.
 * Each platform passes its own handler-map flavoured for its UI
 * (web → DOM bubbles, mobile → React state updates).  This is the
 * abstraction that lets canopy-chat-mobile process inbound peer
 * envelopes without duplicating the 100-line `if (subtype === …)`
 * chain from web/main.js.
 */

/**
 * @typedef {object} PeerEnvelope
 * @property {string} from
 * @property {object} payload          must carry `subtype` to be routed
 *
 * @typedef {(fromAddr: string, payload: object) => (void | Promise<*>)} PeerHandler
 */

/**
 * Build a subtype-dispatched onPeerMessage callback.
 *
 * @param {object}                args
 * @param {Object<string, PeerHandler>} args.handlers       subtype → handler map
 * @param {PeerHandler}           [args.defaultHandler]    fired when subtype is missing OR not in `handlers`
 * @param {{info?: Function, warn?: Function, error?: Function, debug?: Function}} [args.logger]
 * @returns {(env: PeerEnvelope) => void}
 */
export function makePeerRouter({
  handlers   = {},
  defaultHandler,
  logger     = console,
} = {}) {
  return function onPeerMessage(env) {
    const { from, payload } = env ?? {};
    logger.info?.('[peer] received from', from, payload);

    const subtype = payload?.subtype;
    const h = (subtype && typeof handlers[subtype] === 'function')
      ? handlers[subtype]
      : null;
    if (h) {
      _runSafe(h, from, payload, subtype, logger);
      return;
    }
    if (typeof defaultHandler === 'function') {
      _runSafe(defaultHandler, from, payload, 'default', logger);
      return;
    }
    logger.debug?.('[peer] unhandled subtype', subtype, 'from', from);
  };
}

function _runSafe(handler, from, payload, label, logger) {
  try {
    const r = handler(from, payload);
    if (r && typeof r.then === 'function') {
      r.catch((err) => logger.error?.(`[peer] ${label} failed`, err));
    }
  } catch (err) {
    logger.error?.(`[peer] ${label} threw`, err);
  }
}
