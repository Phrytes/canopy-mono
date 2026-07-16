/**
 * Inbound `shared-copy` handler — the RECEIVE side of the SILENT out-of-circle delivery (Frits' call).
 *
 * A peer who SILENTLY shares an item out of their circle pushes the sealed COPY over the relay directly to this
 * device's peer as a `{ subtype:'shared-copy', sealed, itemMeta, from }` envelope (circleShare.js
 * `shareSilentCopyToPublishedKey` → the injected `sendSharedCopy`). The peer router (peerRouter.js) dispatches
 * on `payload.subtype`, so registering this handler under `'shared-copy'` in the router's `handlers` map lands
 * every received copy into the per-user "shared with me" store (sharedWithMeStore.js). The recipient later opens
 * each copy with the sealing key derived from their OWN network identity (see sharedWithMe.js `openSharedCopy`).
 *
 * Mirrors makeHandleFileShare: pure, portable (no DOM/RN), best-effort — a malformed envelope is dropped with a
 * warning, never thrown (the router already swallows rejections, but we guard the store IO ourselves too).
 *
 * @param {object}   args
 * @param {{add:(entry:object)=>Promise<*>}} args.store     the sharedWithMeStore (its `.add` appends + dedupes)
 * @param {(event:object)=>void}             [args.publishEvent]  optional log/notification sink
 * @param {(rows:Array)=>void}               [args.onReceived]    optional re-render hook (fed the new list)
 * @param {{info?,warn?,error?}}             [args.logger]
 * @returns {(fromAddr:string, payload:object) => void}
 */
export function makeHandleSharedCopy({
  store, publishEvent, onReceived, logger = console,
} = {}) {
  if (!store || typeof store.add !== 'function') {
    throw new Error('makeHandleSharedCopy: a shared-with-me store with .add() is required');
  }

  return function handleSharedCopy(fromAddr, payload) {
    const sealed = payload?.sealed;
    if (!sealed || typeof sealed !== 'object') {
      logger.warn?.('[peer] shared-copy missing sealed payload', payload);
      return;
    }
    const itemMeta = (payload?.itemMeta && typeof payload.itemMeta === 'object') ? payload.itemMeta : {};
    const entry = {
      sealed,
      itemMeta,
      from:       typeof payload?.from === 'string' ? payload.from : fromAddr,
      receivedAt: Date.now(),
    };
    Promise.resolve(store.add(entry))
      .then((rows) => {
        try { onReceived?.(rows); } catch { /* re-render is best-effort */ }
        publishEvent?.({
          app:     'circle',
          type:    'notification',
          actor:   entry.from,
          payload: { message: `📥 shared with you: ${itemMeta.sourceType ?? 'item'}` },
        });
      })
      .catch((err) => logger.error?.('[peer] shared-copy store failed', err));
  };
}
