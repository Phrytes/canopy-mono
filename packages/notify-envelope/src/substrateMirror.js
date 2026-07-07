/**
 * wireItemMirror — the generic item-store substrate mirror (OBJ-2 S2).
 *
 * The single shared core behind tasks-v0's `wireTasksSubstrateMirror` and
 * household's `wireHouseholdSubstrateMirror`, which were ~identical copies. It
 * wires a per-scope "publish on write, mirror on receive" flow over a
 * `@canopy/notify-envelope` + `@canopy/pseudo-pod` pair so an item written on
 * device A shows up in device B's `@canopy/item-store` ItemStore. The
 * app-specific bits are injected, so behaviour is unchanged per app:
 *   - `kind` / `removedKind` — the envelope kinds ('task', 'household-item', …)
 *   - `uriPrefix`            — the per-scope URI namespace (string or fn(scopeId))
 *   - `toDraft`              — reconstruct an `addItems` draft from a synced payload
 *   - `inferAction`          — map a local→next transition to a sync action tag
 *   - `scopeField`           — optional metadata field stamped on published envelopes
 *
 * It is transport-agnostic: it doesn't know whether the notify-envelope's
 * transport is the in-process bus or canopy-chat's secure-mesh wire.
 *
 * `itemStore` is the RAW ItemStore (substrate API: addItems / applySync /
 * removeSync / listOpen / listClosed), NOT a legacy adapter.
 *
 * (Stoop's mirror is intentionally NOT built on this — it has a different shape:
 * kind 'request', a backfill model, evictionRoster + agentRegistry, add-only.)
 *
 * @param {object} args
 * @param {import('@canopy/item-store').ItemStore} args.itemStore
 * @param {object} args.notifyEnvelope
 * @param {object} args.pseudoPod
 * @param {string} args.scopeId                 crew/circle id (URI namespace)
 * @param {string} args.kind                    envelope kind for item writes
 * @param {string} [args.removedKind]           envelope kind for hard-deletes (default `${kind}-removed`)
 * @param {string|((scopeId:string)=>string)} args.uriPrefix
 * @param {(payload:object, fromPubKey:string|null)=>object} args.toDraft
 * @param {(local:object, next:object)=>string} [args.inferAction]
 * @param {string|null} [args.scopeField]       e.g. 'circleId' | 'circleId' — stamped on published envelopes
 * @param {Array<{pubKey:string}>} [args.peers]
 * @param {string|null} [args.selfPubKey]
 * @returns {Promise<{
 *   addPeer:(pubKey:string)=>Promise<void>, removePeer:(pubKey:string)=>void,
 *   stop:()=>Promise<void>, listPeers:()=>string[], getPeers:()=>string[],
 *   urlFor:(itemId:string)=>string,
 *   publish:(item:object, opts?:object)=>Promise<void>,
 *   publishRemoved:(originalId:string, opts?:object)=>Promise<void>,
 * }>}
 */
export async function wireItemMirror({
  itemStore,
  notifyEnvelope,
  pseudoPod,
  scopeId,
  kind,
  removedKind,
  uriPrefix,
  toDraft,
  inferAction = defaultInferAction,
  scopeField = null,
  peers = [],
  selfPubKey = null,
}) {
  if (!itemStore?.addItems)      throw new Error('wireItemMirror: itemStore required');
  if (!notifyEnvelope?.subscribe) throw new Error('wireItemMirror: notifyEnvelope required');
  if (!pseudoPod?.write)         throw new Error('wireItemMirror: pseudoPod required');
  if (typeof kind !== 'string' || !kind)     throw new Error('wireItemMirror: kind required');
  if (typeof toDraft !== 'function')          throw new Error('wireItemMirror: toDraft required');
  if (typeof scopeId !== 'string' || !scopeId) throw new Error('wireItemMirror: scopeId required');

  const removed = removedKind ?? `${kind}-removed`;
  const prefix  = typeof uriPrefix === 'function' ? uriPrefix(scopeId) : uriPrefix;
  if (typeof prefix !== 'string' || !prefix) throw new Error('wireItemMirror: uriPrefix required');

  const recipients = new Set();
  function addPeerSync(pubKey) {
    if (!pubKey || typeof pubKey !== 'string') return;
    if (selfPubKey && pubKey === selfPubKey) return;
    recipients.add(pubKey);
  }
  for (const p of peers) addPeerSync(p?.pubKey);

  // Receive handler — turn an inbound payload into a local item. Dedupe on
  // `payload.id` via the `source.syncedFromId` marker stashed at first-receive.
  async function mirror(payload, fromPubKey) {
    if (!payload || typeof payload.id !== 'string' || !payload.id) return;

    const open    = await itemStore.listOpen();
    const closed  = await itemStore.listClosed();
    const matches = (i) => i?.source?.syncedFromId === payload.id;
    const existing = open.find(matches) ?? closed.find(matches);

    if (existing) {
      const action = inferAction(existing, payload);
      try {
        await itemStore.applySync({
          syncedFromId: payload.id,
          nextState:    stripIdentity(payload),
          action,
        }, {
          remoteActor: payload.completedBy
                    ?? payload.assignee
                    ?? payload.addedBy
                    ?? (fromPubKey ? `pubkey:${fromPubKey.slice(0, 12)}` : null),
        });
      } catch (_err) { /* swallow — best-effort sync */ }
      return;
    }

    const draft = toDraft(payload, fromPubKey);
    await itemStore.addItems([draft], {
      actor:          payload.addedBy ?? `pubkey:${(fromPubKey ?? '').slice(0, 12) || 'broadcast'}`,
      actionOverride: 'sync',
    });
  }

  function urlFor(itemId) {
    return `pseudo-pod://${pseudoPod.deviceId ?? 'self'}${prefix}${itemId}`;
  }

  const unsubscribe = notifyEnvelope.subscribe({
    kind,
    callback: (envelope) => {
      const ref = envelope?.ref;
      if (typeof ref !== 'string' || !ref.includes(prefix)) return;
      mirror(envelope.payload, envelope.fromActor ?? null).catch(() => { /* UI reflects next sync */ });
    },
  });

  const unsubscribeRemoved = notifyEnvelope.subscribe({
    kind: removed,
    callback: (envelope) => {
      const ref = envelope?.ref;
      if (typeof ref !== 'string' || !ref.includes(prefix)) return;
      const originalId = envelope?.payload?.originalId;
      if (typeof originalId !== 'string' || !originalId) return;
      const fromPubKey = envelope.fromActor ?? null;
      itemStore.removeSync({ syncedFromId: originalId }, {
        remoteActor: fromPubKey ? `pubkey:${fromPubKey.slice(0, 12)}` : null,
      }).catch(() => { /* swallow */ });
    },
  });

  // Q-D auto-heal — a peer wrote an older `_v`; republish our fresher copy.
  function _onStalePeer(event) {
    const uri = event?.uri;
    if (typeof uri !== 'string' || !uri.includes(prefix)) return;
    const stalePeer = event.fromActor;
    if (typeof stalePeer !== 'string' || stalePeer.length === 0) return;
    if (typeof event.localBytes === 'undefined' || event.localBytes === null) return;
    if (selfPubKey && stalePeer === selfPubKey) return;
    notifyEnvelope.publish({
      type:       kind,
      ref:        uri,
      payload:    event.localBytes,
      etag:       event.localEtag ?? null,
      _v:         event.localV,
      recipients: [stalePeer],
      ...(selfPubKey ? { fromActor: selfPubKey } : {}),
    }).catch(() => { /* best-effort heal */ });
  }
  const unsubscribeStale = pseudoPod.on?.('stale-peer', _onStalePeer) ?? null;

  async function addPeer(pubKey) { addPeerSync(pubKey); }
  function removePeer(pubKey)   { if (typeof pubKey === 'string') recipients.delete(pubKey); }
  async function stop() {
    try { unsubscribe(); } catch { /* swallow */ }
    try { unsubscribeRemoved(); } catch { /* swallow */ }
    if (typeof unsubscribeStale === 'function') { try { unsubscribeStale(); } catch { /* swallow */ } }
    recipients.clear();
  }
  function listPeers() { return [...recipients]; }
  function getPeers()  { return [...recipients]; }

  async function publish(item, opts = {}) {
    if (!item?.id || recipients.size === 0) return;
    try {
      const uri = urlFor(item.id);
      const { etag, _v } = await pseudoPod.write(uri, item);
      await notifyEnvelope.publish({
        type:       kind,
        ref:        uri,
        payload:    item,
        etag,
        _v,
        recipients: [...recipients],
        ...(opts.fromActor ?? selfPubKey ? { fromActor: opts.fromActor ?? selfPubKey } : {}),
        ...(scopeField ? { [scopeField]: scopeId } : {}),
      });
    } catch (_err) { /* best-effort */ }
  }

  async function publishRemoved(originalId, opts = {}) {
    if (typeof originalId !== 'string' || !originalId) return;
    if (recipients.size === 0) return;
    try {
      const uri = urlFor(originalId);
      await notifyEnvelope.publish({
        type:       removed,
        ref:        uri,
        payload:    { originalId },
        recipients: [...recipients],
        ...(opts.fromActor ?? selfPubKey ? { fromActor: opts.fromActor ?? selfPubKey } : {}),
        ...(scopeField ? { [scopeField]: scopeId } : {}),
      });
    } catch (_err) { /* best-effort */ }
  }

  return { addPeer, removePeer, stop, listPeers, getPeers, urlFor, publish, publishRemoved };
}

/**
 * Default action inference (household / tasks-without-reviewLog). Tasks injects
 * its own variant with the submit/approve/reject reviewLog branch.
 */
export function defaultInferAction(local, next) {
  if (!local.completedAt && next.completedAt)        return 'complete';
  if (local.assignee && !next.assignee)              return 'revoke';
  if (!local.assignee && next.assignee)              return 'claim';
  if (local.assignee && next.assignee && local.assignee !== next.assignee) return 'reassign';
  return 'update';
}

/** Strip identity fields before applySync merges the rest into the local item. */
export function stripIdentity(payload) {
  const { id: _id, _etag: _etag, addedAt: _addedAt, ...rest } = payload;
  return rest;
}
