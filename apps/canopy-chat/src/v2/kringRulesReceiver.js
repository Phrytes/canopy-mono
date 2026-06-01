/**
 * canopy-chat v2 — kring rules-broadcast receiver substrate (γ-next.rules).
 *
 * Sibling of `kringRecipeReceiver.js` (γ-next.recipe).  Where the recipe
 * receiver stashes the incoming recipe in a per-kring "pending" cache,
 * the rules receiver does the same for the rules document.  The rules
 * editor reads the cache on mount and passes the rules via γ.4's
 * conflict resolver via the existing `incomingRules` opt.
 *
 * Hosts (web + mobile) construct one handler per agent at boot and
 * register it on the peer-router under subtype `'kring-rules-broadcast'`.
 *
 *   1. Validate envelope shape.
 *   2. Dedup by msgId (small LRU) so a replay doesn't churn the cache.
 *   3. Call `pendingStore.set(circleId, rulesDoc)`.
 *
 * Cache survives across boots (web: localStorage, mobile: AsyncStorage)
 * so a broadcast that arrives while the editor is closed still gets
 * resolved on the next open.  When multiple broadcasts arrive while
 * the editor is closed, last-write-wins — the latest broadcast is the
 * one the user sees.  (Out-of-order arrivals are bounded by msgId
 * dedup; resolution itself runs the per-field 3-way merge against the
 * versions history, so an older rules doc still detects the divergence.)
 */

const DEFAULT_DEDUP_CAP = 256;

/**
 * Build the kring-rules-broadcast peer handler.
 *
 * @param {object} args
 * @param {{set: Function, get?: Function, clear?: Function}}
 *        args.pendingStore                                     per-kring cache
 *                                                              (set(circleId, rulesDoc)).
 * @param {Set<string> | null} [args.dedup]                     local-LRU dedup
 * @param {{warn?: Function, info?: Function, debug?: Function}}
 *        [args.logger]
 * @param {number} [args.dedupCap]                              internal LRU cap
 * @returns {(fromNknAddr: string, payload: object) => Promise<void>}
 */
export function makeKringRulesPeerHandler({
  pendingStore,
  dedup       = null,
  logger      = console,
  dedupCap    = DEFAULT_DEDUP_CAP,
} = {}) {
  if (!pendingStore || typeof pendingStore.set !== 'function') {
    throw new Error('makeKringRulesPeerHandler: pendingStore.set required');
  }
  const seen = dedup ?? new LruSet(dedupCap);

  return async function onKringRulesBroadcast(fromNknAddr, payload) {
    if (!isValidEnvelope(payload)) {
      logger.warn?.('[kring-rules] dropping malformed envelope', payload);
      return;
    }
    if (seen.has(payload.msgId)) {
      logger.debug?.('[kring-rules] duplicate msgId, skipping', payload.msgId);
      return;
    }
    seen.add(payload.msgId);

    try {
      await pendingStore.set(payload.circleId, payload.rulesDoc);
      logger.info?.('[kring-rules] cached pending', payload.msgId,
        'circle=' + payload.circleId);
    } catch (err) {
      logger.warn?.('[kring-rules] pendingStore.set failed', err?.message ?? err);
    }
  };
}

function isValidEnvelope(p) {
  return (
    p
    && typeof p === 'object'
    && p.subtype === 'kring-rules-broadcast'
    && typeof p.circleId === 'string' && p.circleId
    && typeof p.msgId    === 'string' && p.msgId
    && typeof p.ts       === 'number' && Number.isFinite(p.ts)
    && p.rulesDoc && typeof p.rulesDoc === 'object'
  );
}

// Tiny LRU set — identical shape to kringRecipeReceiver's.
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
