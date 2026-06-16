/**
 * canopy-chat v2 — kring recipe-broadcast receiver substrate (γ-next.recipe).
 *
 * Sibling of `kringChatReceiver.js` (SP-13.2.1).  Where the chat receiver
 * appends bubbles to the EventLog, the recipe receiver stashes the
 * incoming recipe in a per-kring "pending" cache.  The recipe editor
 * reads the cache on mount and passes the recipe to γ.3's conflict
 * resolver via the existing `incomingRecipe` opt.
 *
 * Hosts (web + mobile) construct one handler per agent at boot and
 * register it on the peer-router under subtype `'kring-recipe-broadcast'`.
 *
 *   1. Validate envelope shape.
 *   2. Dedup by msgId (small LRU) so a replay doesn't churn the cache.
 *   3. Call `pendingStore.set(circleId, recipe)`.
 *
 * Cache survives across boots (web: localStorage, mobile: AsyncStorage)
 * so a broadcast that arrives while the editor is closed still gets
 * resolved on the next open.  When multiple broadcasts arrive while
 * the editor is closed, last-write-wins — the latest broadcast is the
 * one the user sees.  (Out-of-order arrivals are bounded by msgId
 * dedup; resolution itself runs the per-block 3-way merge against the
 * versions history, so an older recipe still detects the divergence.)
 */

const DEFAULT_DEDUP_CAP = 256;

/**
 * Build the kring-recipe-broadcast peer handler.
 *
 * @param {object} args
 * @param {{set: Function, get?: Function, clear?: Function}}
 *        args.pendingStore                                     per-kring cache
 *                                                              (set(circleId, recipe)).
 * @param {Set<string> | null} [args.dedup]                     local-LRU dedup
 * @param {{warn?: Function, info?: Function, debug?: Function}}
 *        [args.logger]
 * @param {number} [args.dedupCap]                              internal LRU cap
 * @returns {(fromPeerAddr: string, payload: object) => Promise<void>}
 */
export function makeKringRecipePeerHandler({
  pendingStore,
  dedup       = null,
  logger      = console,
  dedupCap    = DEFAULT_DEDUP_CAP,
} = {}) {
  if (!pendingStore || typeof pendingStore.set !== 'function') {
    throw new Error('makeKringRecipePeerHandler: pendingStore.set required');
  }
  const seen = dedup ?? new LruSet(dedupCap);

  return async function onKringRecipeBroadcast(fromPeerAddr, payload) {
    if (!isValidEnvelope(payload)) {
      logger.warn?.('[kring-recipe] dropping malformed envelope', payload);
      return;
    }
    if (seen.has(payload.msgId)) {
      logger.debug?.('[kring-recipe] duplicate msgId, skipping', payload.msgId);
      return;
    }
    seen.add(payload.msgId);

    try {
      await pendingStore.set(payload.circleId, payload.recipe);
      logger.info?.('[kring-recipe] cached pending', payload.msgId,
        'circle=' + payload.circleId);
    } catch (err) {
      logger.warn?.('[kring-recipe] pendingStore.set failed', err?.message ?? err);
    }
  };
}

function isValidEnvelope(p) {
  return (
    p
    && typeof p === 'object'
    && p.subtype === 'kring-recipe-broadcast'
    && typeof p.circleId === 'string' && p.circleId
    && typeof p.msgId    === 'string' && p.msgId
    && typeof p.ts       === 'number' && Number.isFinite(p.ts)
    && p.recipe && typeof p.recipe === 'object'
  );
}

// Tiny LRU set — identical shape to kringChatReceiver's.
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
