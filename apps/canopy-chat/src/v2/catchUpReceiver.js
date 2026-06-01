/**
 * canopy-chat v2 — ε.4: negotiated catch-up receiver coordinator.
 *
 * Two responsibilities:
 *
 *   1. `requestCatchUp({circleId, sinceTs, knownPeers})` — fired
 *      from `catchUpStrategy.scheduleCatchUp`'s `peerCatchUp` handler.
 *      Broadcasts a `catch-up-request` to every known peer, collects
 *      offers for `offerWindowMs` (default 3000 ms), auto-accepts the
 *      FIRST offer, then waits for chunks + the `catch-up-end`.
 *
 *   2. `onPeerMessage(fromAddr, payload)` — peer-router handler for
 *      `catch-up-offer`, `catch-up-chunk`, `catch-up-end`.  Dispatched
 *      by subtype.
 *
 * State machine per requestId:
 *
 *     PENDING_OFFERS  ─(first valid offer arrives)─▶  ACCEPTED
 *     PENDING_OFFERS  ─(offerWindowMs elapses)────▶  TIMED_OUT
 *     ACCEPTED        ─(catch-up-end arrives)─────▶  DONE
 *     ACCEPTED        ─(chunkTimeoutMs idle)─────▶  TIMED_OUT
 *
 * V1 simplifications:
 *
 *   - First-offer-wins (no multi-offer chooser).  Later offers from
 *     other peers in the same window are ignored.
 *   - Receiver doesn't send a decline envelope to losing providers —
 *     they're silent on their end too.
 *   - Duplicate chunks (same requestId + seq) are deduped on the way
 *     in, so a flaky NKN reorder doesn't double-ingest.
 *
 * The coordinator's job ends at `inbox.ingestChatMessage(env, {source:
 * 'catchUp'})` — the inbox's own LRU + the itemStore's idempotent
 * insert handle the across-source dedup.
 *
 * `emitStatus` is an optional UI hook for the "Catching up…" indicator
 * (ε.5).  Status shape:
 *
 *     { phase: 'requesting',         circleId }
 *     { phase: 'collecting-offers',  circleId, offersSeen: n }
 *     { phase: 'streaming',          circleId, count: n, total: t }
 *     { phase: 'done',               circleId, count: n }
 *     { phase: 'no-offers',          circleId }
 *     { phase: 'timed-out',          circleId, reason: 'chunk' | 'offer' }
 */

import {
  CATCH_UP_SUBTYPES,
  isValidOffer,
  isValidChunk,
  isValidEnd,
  buildRequest,
  buildAccept,
  makeRequestId,
} from './catchUpProtocol.js';

const DEFAULT_OFFER_WINDOW_MS = 3000;
const DEFAULT_CHUNK_TIMEOUT_MS = 10_000;

/**
 * @param {object} args
 * @param {(nknAddr: string, envelope: object) => Promise<*>} args.sendToPeer
 * @param {{ingestChatMessage: Function}} args.inbox            — ε.1 inbox.
 * @param {number} [args.offerWindowMs]                          default 3000.
 * @param {number} [args.chunkTimeoutMs]                         default 10_000.
 * @param {(status: object) => void} [args.emitStatus]           "Catching up…" hook.
 * @param {() => string} [args.makeId]                           override makeRequestId (tests).
 * @param {{info?, warn?, error?, debug?}} [args.logger]
 *
 * @returns {{
 *   onPeerMessage: (fromAddr: string, payload: object) => Promise<void>,
 *   requestCatchUp: ({circleId, sinceTs, knownPeers, fromNknAddr}: object)
 *     => Promise<{strategy: 'negotiated', accepted: boolean, count: number, source: string, requestId?: string}>,
 *   _state: Map<string, object>,    // exposed for tests
 * }}
 */
export function makeCatchUpReceiver({
  sendToPeer,
  inbox,
  offerWindowMs   = DEFAULT_OFFER_WINDOW_MS,
  chunkTimeoutMs  = DEFAULT_CHUNK_TIMEOUT_MS,
  emitStatus      = null,
  makeId          = makeRequestId,
  logger          = console,
} = {}) {
  if (typeof sendToPeer !== 'function')          throw new Error('makeCatchUpReceiver: sendToPeer required');
  if (!inbox || typeof inbox.ingestChatMessage !== 'function') {
    throw new Error('makeCatchUpReceiver: inbox.ingestChatMessage required');
  }

  /**
   * In-flight requests, keyed by requestId.  Entry shape:
   *
   *   {
   *     circleId, sinceTs, fromNknAddr,
   *     status: 'PENDING_OFFERS' | 'ACCEPTED' | 'DONE' | 'TIMED_OUT',
   *     offers: Array<{from, offer}>,
   *     acceptedFrom: string|null,
   *     chunksSeen: Set<number>,
   *     inserted: number,
   *     deduped: number,
   *     expectedTotal: number|null,
   *     offerTimer: any,
   *     chunkTimer: any,
   *     resolve: Function,
   *   }
   */
  const state = new Map();

  /**
   * De-dupe on (circleId, sinceTs): one outbound request at a time.
   * Map: key → requestId.  Cleared when the request enters DONE /
   * TIMED_OUT.
   */
  const inFlightByGroup = new Map();
  const inFlightKey = (circleId, sinceTs) => `${circleId}::${Number.isFinite(sinceTs) ? sinceTs : 0}`;

  const safeEmit = (s) => {
    if (typeof emitStatus !== 'function') return;
    try { emitStatus(s); }
    catch (err) { logger.warn?.('[catch-up] emitStatus threw', err?.message ?? err); }
  };

  /** Finish a request: clear state + run resolver. */
  function finalize(requestId, outcome) {
    const entry = state.get(requestId);
    if (!entry) return;
    clearTimeout(entry.offerTimer);
    clearTimeout(entry.chunkTimer);
    state.delete(requestId);
    inFlightByGroup.delete(inFlightKey(entry.circleId, entry.sinceTs));
    entry.resolve?.(outcome);
  }

  /**
   * The offer window has elapsed.  If at least one valid offer was
   * received, accept the FIRST one and transition to ACCEPTED.
   * Otherwise resolve as no-offers.
   */
  async function onOfferWindowElapsed(requestId) {
    const entry = state.get(requestId);
    if (!entry) return;
    if (entry.status !== 'PENDING_OFFERS') return;
    if (entry.offers.length === 0) {
      entry.status = 'TIMED_OUT';
      safeEmit({ phase: 'no-offers', circleId: entry.circleId });
      finalize(requestId, {
        strategy: 'negotiated',
        accepted: false,
        count: 0,
        source: 'no-offers',
        requestId,
      });
      return;
    }
    // First-offer-wins.
    const winner = entry.offers[0];
    entry.status         = 'ACCEPTED';
    entry.acceptedFrom   = winner.from;
    entry.expectedTotal  = winner.offer.count;

    // Chunk timeout: reset on every arriving chunk.
    entry.chunkTimer = setTimeout(() => {
      const e2 = state.get(requestId);
      if (!e2) return;
      e2.status = 'TIMED_OUT';
      safeEmit({ phase: 'timed-out', circleId: e2.circleId, reason: 'chunk' });
      finalize(requestId, {
        strategy: 'negotiated',
        accepted: true,
        count: e2.inserted + e2.deduped,
        source: 'chunk-timeout',
        requestId,
      });
    }, chunkTimeoutMs);
    if (typeof entry.chunkTimer?.unref === 'function') entry.chunkTimer.unref();

    safeEmit({
      phase: 'streaming',
      circleId: entry.circleId,
      count: 0,
      total: winner.offer.count,
    });

    try {
      await sendToPeer(winner.from, buildAccept({
        requestId,
        mode: 'all',
      }));
    } catch (err) {
      logger.warn?.('[catch-up] send accept failed', err?.message ?? err);
      // The provider never gets our accept → it won't stream.
      // We'll still hit the chunk-timeout above and clean up.
    }
  }

  /** Reset the chunk timer (called on every valid chunk arrival). */
  function resetChunkTimer(entry, requestId) {
    clearTimeout(entry.chunkTimer);
    entry.chunkTimer = setTimeout(() => {
      const e2 = state.get(requestId);
      if (!e2) return;
      e2.status = 'TIMED_OUT';
      safeEmit({ phase: 'timed-out', circleId: e2.circleId, reason: 'chunk' });
      finalize(requestId, {
        strategy: 'negotiated',
        accepted: true,
        count: e2.inserted + e2.deduped,
        source: 'chunk-timeout',
        requestId,
      });
    }, chunkTimeoutMs);
    if (typeof entry.chunkTimer?.unref === 'function') entry.chunkTimer.unref();
  }

  /**
   * Peer-router handler for the THREE response subtypes.  Dispatches
   * by `payload.subtype`.
   */
  async function onPeerMessage(fromAddr, payload) {
    const subtype = payload?.subtype;
    if (subtype === CATCH_UP_SUBTYPES.OFFER)  return onOffer(fromAddr, payload);
    if (subtype === CATCH_UP_SUBTYPES.CHUNK)  return onChunk(fromAddr, payload);
    if (subtype === CATCH_UP_SUBTYPES.END)    return onEnd(fromAddr, payload);
    // Other subtypes aren't ours — silent.
  }

  async function onOffer(fromAddr, payload) {
    if (!isValidOffer(payload)) {
      logger.debug?.('[catch-up] dropping malformed offer');
      return;
    }
    const entry = state.get(payload.requestId);
    if (!entry) {
      // Stale offer for a request we already finalized.  Silent.
      logger.debug?.('[catch-up] offer for unknown requestId', payload.requestId);
      return;
    }
    if (entry.status !== 'PENDING_OFFERS') {
      // Already accepted a different offer; ignore.
      logger.debug?.('[catch-up] offer ignored (already accepted)', payload.requestId);
      return;
    }
    entry.offers.push({ from: fromAddr, offer: payload });
    safeEmit({
      phase: 'collecting-offers',
      circleId: entry.circleId,
      offersSeen: entry.offers.length,
    });
  }

  async function onChunk(fromAddr, payload) {
    if (!isValidChunk(payload)) {
      logger.debug?.('[catch-up] dropping malformed chunk');
      return;
    }
    const entry = state.get(payload.requestId);
    if (!entry || entry.status !== 'ACCEPTED') {
      // Chunk for a request we're not in ACCEPTED state for — silent.
      return;
    }
    if (entry.acceptedFrom && fromAddr !== entry.acceptedFrom) {
      // Chunk from a different peer than the one we accepted — drop.
      logger.debug?.('[catch-up] chunk from wrong peer, ignoring', fromAddr);
      return;
    }
    if (entry.chunksSeen.has(payload.seq)) {
      // Duplicate chunk — silent dedupe.
      return;
    }
    entry.chunksSeen.add(payload.seq);
    resetChunkTimer(entry, payload.requestId);

    const items = Array.isArray(payload.items) ? payload.items : [];
    for (const env of items) {
      try {
        const r = await inbox.ingestChatMessage(env, { source: 'catchUp' });
        if (r?.result === 'inserted')      entry.inserted += 1;
        else if (r?.result === 'deduped')  entry.deduped  += 1;
      } catch (err) {
        logger.warn?.('[catch-up] inbox ingest threw', err?.message ?? err);
      }
    }

    safeEmit({
      phase: 'streaming',
      circleId: entry.circleId,
      count: entry.inserted + entry.deduped,
      total: entry.expectedTotal ?? entry.inserted + entry.deduped,
    });
  }

  async function onEnd(fromAddr, payload) {
    if (!isValidEnd(payload)) {
      logger.debug?.('[catch-up] dropping malformed end');
      return;
    }
    const entry = state.get(payload.requestId);
    if (!entry) return;
    if (entry.acceptedFrom && fromAddr !== entry.acceptedFrom) {
      // End from a non-winner — silent.
      return;
    }
    entry.status = 'DONE';
    safeEmit({ phase: 'done', circleId: entry.circleId, count: entry.inserted + entry.deduped });
    finalize(payload.requestId, {
      strategy: 'negotiated',
      accepted: true,
      count: entry.inserted + entry.deduped,
      source: 'streamed',
      requestId: payload.requestId,
      inserted: entry.inserted,
      deduped:  entry.deduped,
      totalSent: payload.totalSent,
    });
  }

  /**
   * Sender-side coordinator: broadcast a `catch-up-request` to every
   * known peer, collect offers for `offerWindowMs`, auto-accept the
   * first, ingest chunks via the inbox.
   *
   * @param {object} args
   * @param {string} args.circleId
   * @param {number} [args.sinceTs]
   * @param {Array<{addr: string}|string>} [args.knownPeers]
   * @param {string} [args.fromNknAddr]                  this agent's NKN addr
   * @returns {Promise<{strategy: 'negotiated', accepted: boolean, count: number, source: string, requestId?: string}>}
   */
  function requestCatchUp({ circleId, sinceTs, knownPeers = [], fromNknAddr = '' } = {}) {
    if (!circleId) {
      return Promise.resolve({
        strategy: 'negotiated', accepted: false, count: 0, source: 'no-circleId',
      });
    }
    const since = Number.isFinite(sinceTs) ? sinceTs : 0;

    // In-flight de-dupe: one request per (circleId, sinceTs).
    const key = inFlightKey(circleId, since);
    if (inFlightByGroup.has(key)) {
      const existingId = inFlightByGroup.get(key);
      logger.info?.('[catch-up] de-duped: already in flight', existingId);
      return Promise.resolve({
        strategy: 'negotiated',
        accepted: false,
        count: 0,
        source: 'in-flight',
        requestId: existingId,
      });
    }

    // Normalize peer list.  Accept either `{addr}` or bare strings.
    const peers = (Array.isArray(knownPeers) ? knownPeers : [])
      .map((p) => (typeof p === 'string' ? p : p?.addr))
      .filter((a) => typeof a === 'string' && a);
    if (peers.length === 0) {
      safeEmit({ phase: 'no-offers', circleId });
      return Promise.resolve({
        strategy: 'negotiated', accepted: false, count: 0, source: 'no-peers',
      });
    }

    const requestId = makeId();
    inFlightByGroup.set(key, requestId);

    let resolveFn;
    const settled = new Promise((res) => { resolveFn = res; });

    const entry = {
      circleId, sinceTs: since, fromNknAddr,
      status: 'PENDING_OFFERS',
      offers: [],
      acceptedFrom: null,
      chunksSeen: new Set(),
      inserted: 0,
      deduped: 0,
      expectedTotal: null,
      offerTimer: null,
      chunkTimer: null,
      resolve: resolveFn,
    };
    state.set(requestId, entry);

    safeEmit({ phase: 'requesting', circleId });

    // Fire the broadcast.  We don't wait — sendToPeer per peer in
    // parallel; failures are logged but the request still proceeds
    // (other peers may answer).
    const requestEnv = buildRequest({
      groupId:     circleId,
      sinceTs:     since,
      requestId,
      fromNknAddr,
    });
    for (const addr of peers) {
      sendToPeer(addr, requestEnv).catch((err) =>
        logger.warn?.('[catch-up] request send failed for', addr, err?.message ?? err));
    }

    // Schedule the offer window.
    entry.offerTimer = setTimeout(() => {
      onOfferWindowElapsed(requestId).catch((err) =>
        logger.warn?.('[catch-up] onOfferWindowElapsed threw', err?.message ?? err));
    }, offerWindowMs);
    if (typeof entry.offerTimer?.unref === 'function') entry.offerTimer.unref();

    safeEmit({ phase: 'collecting-offers', circleId, offersSeen: 0 });

    return settled;
  }

  return { onPeerMessage, requestCatchUp, _state: state };
}
