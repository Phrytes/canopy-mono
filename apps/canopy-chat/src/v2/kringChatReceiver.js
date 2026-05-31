/**
 * canopy-chat v2 — kring chat-message receiver substrate (SP-13.2.1).
 *
 * Builds a `(fromNknAddr, payload) => void` handler that matches the
 * shape registered on the existing peer-router.  On a valid envelope:
 *
 *   1. Reject + skip when payload is malformed or msgId is a duplicate.
 *   2. Append a `chat-message` event scoped to the circleId so the
 *      kring view's `buildKringStream` picks it up on next render.
 *
 * The handler closes over an EventLog (`append(event)`) and an
 * optional dedup cache (Map-like with .has/.add).  Hosts (web +
 * mobile) instantiate one per agent at boot.
 */

const DEFAULT_DEDUP_CAP = 256;

/**
 * Build the kring-chat-message peer handler.
 *
 * @param {object} args
 * @param {{append: Function}} args.eventLog
 * @param {Set<string> | null} [args.dedup]   shared dedup set (msgId);
 *                                            internal LRU if omitted
 * @param {(payload: object, fromNknAddr: string) => string | null}
 *        [args.resolveActor]  optional projector (e.g. webid → display)
 * @param {{warn?: Function, info?: Function, debug?: Function}}
 *        [args.logger]
 * @param {number} [args.dedupCap]            internal LRU cap
 * @returns {(fromNknAddr: string, payload: object) => void}
 */
export function makeKringChatPeerHandler({
  eventLog,
  dedup       = null,
  resolveActor = null,
  logger      = console,
  dedupCap    = DEFAULT_DEDUP_CAP,
} = {}) {
  if (!eventLog || typeof eventLog.append !== 'function') {
    throw new Error('makeKringChatPeerHandler: eventLog.append required');
  }
  const seen = dedup ?? new LruSet(dedupCap);

  return function onKringChatMessage(fromNknAddr, payload) {
    if (!isValidEnvelope(payload)) {
      logger.warn?.('[kring-chat] dropping malformed envelope', payload);
      return;
    }
    if (seen.has(payload.msgId)) {
      logger.debug?.('[kring-chat] duplicate msgId, skipping', payload.msgId);
      return;
    }
    seen.add(payload.msgId);

    const actor = (typeof resolveActor === 'function'
      ? resolveActor(payload, fromNknAddr)
      : payload.fromActor) ?? fromNknAddr ?? null;

    eventLog.append({
      id:    payload.msgId,
      ts:    payload.ts,
      app:   'kring',
      type:  'chat-message',
      actor,
      payload: {
        circleId: payload.circleId,
        text:     payload.text,
        kind:     'chat-message',
        // Stamp the wire-level sender so receiver-side bubbles show
        // the right name when MemberMap resolution kicks in later.
        senderDisplay: actor,
      },
    });
    logger.info?.('[kring-chat] received', payload.msgId, 'circle=' + payload.circleId);
  };
}

function isValidEnvelope(p) {
  return (
    p
    && typeof p === 'object'
    && p.subtype === 'kring-chat-message'
    && typeof p.circleId === 'string' && p.circleId
    && typeof p.msgId    === 'string' && p.msgId
    && typeof p.text     === 'string' && p.text
    && typeof p.ts       === 'number' && Number.isFinite(p.ts)
  );
}

// Tiny LRU set: drops the oldest entry once `cap` is exceeded.
// Map preserves insertion order, so the first key on iteration is
// the oldest — exactly what we want for FIFO eviction.
class LruSet {
  constructor(cap) { this.cap = cap; this.m = new Map(); }
  has(k) { return this.m.has(k); }
  add(k) {
    if (this.m.has(k)) { this.m.delete(k); this.m.set(k, 1); return; }
    this.m.set(k, 1);
    if (this.m.size > this.cap) {
      const oldest = this.m.keys().next().value;
      if (oldest !== undefined) this.m.delete(oldest);
    }
  }
}
