/**
 * canopy-chat v2 — kring policy-broadcast receiver substrate (γ-next.policy).
 *
 * Sibling of `kringRulesReceiver.js` (γ-next.rules).  Where the rules
 * receiver stashes the incoming rules doc in a per-kring "pending" cache,
 * the policy receiver does the same for the circlePolicy document.  The
 * settings editor reads the cache on mount and passes the policy via
 * γ.4's conflict resolver via the existing `incomingPolicy` opt.
 *
 * Hosts (web + mobile) construct one handler per agent at boot and
 * register it on the peer-router under subtype `'kring-policy-broadcast'`.
 *
 *   1. Validate envelope shape.
 *   2. Dedup by msgId (small LRU) so a replay doesn't churn the cache.
 *   3. Call `pendingStore.set(circleId, policy)`.
 *
 * Cache survives across boots (web: localStorage, mobile: AsyncStorage)
 * so a broadcast that arrives while the editor is closed still gets
 * resolved on the next open.  When multiple broadcasts arrive while
 * the editor is closed, last-write-wins — the latest broadcast is the
 * one the user sees.  (Out-of-order arrivals are bounded by msgId
 * dedup; resolution itself runs the per-field 3-way merge against the
 * versions history, so an older policy doc still detects the divergence.)
 *
 * Note on shape: circlePolicy is structured (nested `features:{...}`,
 * nested `push:{...}` on the override sibling, and several enum axes)
 * but the receiver/cache pipeline treats it opaquely — JSON round-trip
 * preserves the structure and γ.4's `detectPolicyConflicts` /
 * `applyPolicyResolution` know the field-by-field merge rules.  Same
 * substrate shape as recipes / rules.
 */

const DEFAULT_DEDUP_CAP = 256;

/**
 * Build the kring-policy-broadcast peer handler.
 *
 * @param {object} args
 * @param {{set: Function, get?: Function, clear?: Function}}
 *        args.pendingStore                                     per-kring cache
 *                                                              (set(circleId, policy)).
 * @param {Set<string> | null} [args.dedup]                     local-LRU dedup
 * @param {{warn?: Function, info?: Function, debug?: Function}}
 *        [args.logger]
 * @param {number} [args.dedupCap]                              internal LRU cap
 * @returns {(fromPeerAddr: string, payload: object) => Promise<void>}
 */
export function makeKringPolicyPeerHandler({
  pendingStore,
  dedup       = null,
  logger      = console,
  dedupCap    = DEFAULT_DEDUP_CAP,
} = {}) {
  if (!pendingStore || typeof pendingStore.set !== 'function') {
    throw new Error('makeKringPolicyPeerHandler: pendingStore.set required');
  }
  const seen = dedup ?? new LruSet(dedupCap);

  return async function onKringPolicyBroadcast(fromPeerAddr, payload) {
    if (!isValidEnvelope(payload)) {
      logger.warn?.('[kring-policy] dropping malformed envelope', payload);
      return;
    }
    if (seen.has(payload.msgId)) {
      logger.debug?.('[kring-policy] duplicate msgId, skipping', payload.msgId);
      return;
    }
    seen.add(payload.msgId);

    try {
      await pendingStore.set(payload.circleId, payload.policy);
      logger.info?.('[kring-policy] cached pending', payload.msgId,
        'circle=' + payload.circleId);
    } catch (err) {
      logger.warn?.('[kring-policy] pendingStore.set failed', err?.message ?? err);
    }
  };
}

function isValidEnvelope(p) {
  return (
    p
    && typeof p === 'object'
    && p.subtype === 'kring-policy-broadcast'
    && typeof p.circleId === 'string' && p.circleId
    && typeof p.msgId    === 'string' && p.msgId
    && typeof p.ts       === 'number' && Number.isFinite(p.ts)
    && p.policy && typeof p.policy === 'object'
  );
}

// Tiny LRU set — identical shape to kringRulesReceiver's.
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
