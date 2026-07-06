/**
 * wireCircleStoreInbound — ingest peer sync envelopes into a CircleItemStore (cluster L3 · no-pod-sync INBOUND).
 *
 * The counterpart to publish-on-write (`setSyncHook` / `wireStoreMirror`): subscribes to the notify-envelope
 * substrate and applies inbound items to the per-circle store. Because the CircleItemStore PRESERVES the remote
 * item id (`put` keeps `item.id`), sync is trivially idempotent — the same id on every device, so a received
 * item is just `put` (create-or-replace) and a removal is `delete` by id; no `syncedFromId` bookkeeping (the
 * legacy ItemStore needed it because it minted its own ids). Writes use `{sync:false}` so an ingest never
 * re-publishes the same item back to the mesh (the echo loop). Filtered by the envelope `ref` prefix → per-circle.
 *
 * Ingest is CAUSAL, not last-received-wins (Objective L): writes go through `put(payload, {sync:false, origin:true})`,
 * which PRESERVES the payload's origin `updatedAt`/`updatedBy` (instead of re-stamping to local ingest time) and
 * keeps the causally-newer side — a peer's OLDER edit can no longer clobber a newer local one just because it
 * arrived later; true concurrency resolves by a deterministic writer-id tiebreak. This is origin-timestamp +
 * writer-id last-writer-wins at item granularity (not a field-level merge); payloads without origin metadata fall
 * back to last-received-wins so pre-metadata peers still ingest. See `causalMerge.js` for guarantees/limits.
 *
 * @param {object} args
 * @param {{subscribe:(opts:{kind:string,callback:Function})=>(()=>void)}} args.notifyEnvelope  @canopy/notify-envelope (injected)
 * @param {{put:Function, delete:Function}} args.store  the CircleItemStore for this circle
 * @param {string} [args.kind='household-item']         add/update envelope kind
 * @param {string} [args.removed='household-item-removed']  removal envelope kind
 * @param {string} [args.prefix]                        only ingest envelopes whose `ref` includes this (per-circle scope)
 * @returns {() => void} unsubscribe
 */
export function wireCircleStoreInbound({
  notifyEnvelope, store, kind = 'household-item', removed = 'household-item-removed', prefix,
} = {}) {
  if (!notifyEnvelope || typeof notifyEnvelope.subscribe !== 'function' || !store || typeof store.put !== 'function') {
    return () => {};
  }
  const inScope = (ref) => typeof ref === 'string' && (prefix == null || ref.includes(prefix));

  const unsubAdd = notifyEnvelope.subscribe({
    kind,
    callback: (env) => {
      if (!inScope(env && env.ref)) return;
      const payload = env && env.payload;
      if (!payload || typeof payload.id !== 'string' || !payload.id) return;
      // id-preserving idempotent ingest; sync:false → no re-publish (echo guard); origin:true → causal merge
      // (preserve origin clock/writer, keep the causally-newer side — no arrival-order clobbering).
      Promise.resolve(store.put(payload, { sync: false, origin: true })).catch(() => { /* best-effort; next sync reconciles */ });
    },
  });

  const unsubRemoved = notifyEnvelope.subscribe({
    kind: removed,
    callback: (env) => {
      if (!inScope(env && env.ref)) return;
      const id = (env && env.payload && (env.payload.originalId ?? env.payload.id)) || null;
      if (typeof id === 'string' && id) {
        Promise.resolve(store.delete(id, { sync: false })).catch(() => { /* best-effort */ });
      }
    },
  });

  return () => {
    try { if (typeof unsubAdd === 'function') unsubAdd(); } catch { /* */ }
    try { if (typeof unsubRemoved === 'function') unsubRemoved(); } catch { /* */ }
  };
}
