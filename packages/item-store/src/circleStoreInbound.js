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
 * (v0 is last-received-wins: `put` re-stamps `updatedAt` to the local ingest time, so origin timestamps aren't
 * preserved — a version-vector / origin-clock refinement is a follow-up. Functionally the item appears on peers.)
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
      // id-preserving idempotent ingest; sync:false → no re-publish (echo guard).
      Promise.resolve(store.put(payload, { sync: false })).catch(() => { /* best-effort; next sync reconciles */ });
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
