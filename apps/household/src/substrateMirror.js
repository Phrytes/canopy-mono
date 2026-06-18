/**
 * Household substrate-mirror — cross-device household-item fan-out.
 *
 * A faithful twin of `apps/tasks-v0/src/substrateMirror.js`
 * (wireTasksSubstrateMirror) adapted for Household's generic items.
 * Wires `@canopy/notify-envelope` + `@canopy/pseudo-pod` into a
 * per-circle "publish on write, mirror on receive" flow so an item
 * added on device A shows up on device B's itemStore.
 *
 * **Per-circle roster.** The substrate's `pseudoPod` is per-device,
 * not per-circle. The mirror tracks its own per-circle `recipients`
 * set; publishItem reads it at publish time to direct fan-out.
 *
 * NB: `itemStore` here is the RAW `@canopy/item-store` ItemStore
 * (reach it via `InMemoryStore.substrate`), NOT the legacy
 * `{addItem,...}` adapter — so it exposes
 * addItems/applySync/removeSync/listOpen/listClosed.
 *
 * @param {object} args
 * @param {import('@canopy/item-store').ItemStore} args.itemStore
 * @param {object} args.notifyEnvelope   — shared per-bundle instance.
 * @param {object} args.pseudoPod        — shared per-bundle instance.
 * @param {string} args.circleId         — circle identifier (URI namespace).
 * @param {Array<{pubKey: string}>} [args.peers]
 * @param {string} [args.selfPubKey]     — local agent address; filtered out
 *                                          of the recipient roster (self).
 * @returns {Promise<{
 *   addPeer:    (pubKey: string) => Promise<void>,
 *   removePeer: (pubKey: string) => void,
 *   stop:       () => Promise<void>,
 *   listPeers:  () => string[],
 *   getPeers:   () => string[],
 *   urlFor:     (itemId: string) => string,
 *   publishItem:        (item: object, opts?: object) => Promise<void>,
 *   publishItemRemoved: (originalId: string, opts?: object) => Promise<void>,
 * }>}
 */
export async function wireHouseholdSubstrateMirror({
  itemStore,
  notifyEnvelope,
  pseudoPod,
  circleId,
  peers = [],
  selfPubKey = null,
}) {
  if (!itemStore?.addItems) throw new Error('wireHouseholdSubstrateMirror: itemStore required');
  if (!notifyEnvelope?.subscribe) throw new Error('wireHouseholdSubstrateMirror: notifyEnvelope required');
  if (!pseudoPod?.write) throw new Error('wireHouseholdSubstrateMirror: pseudoPod required');
  if (typeof circleId !== 'string' || !circleId) {
    throw new Error('wireHouseholdSubstrateMirror: circleId required');
  }

  const recipients = new Set();
  function addPeerSync(pubKey) {
    if (!pubKey || typeof pubKey !== 'string') return;
    if (selfPubKey && pubKey === selfPubKey) return;
    recipients.add(pubKey);
  }
  for (const p of peers) addPeerSync(p?.pubKey);

  /**
   * The mirror handler — turns an inbound `household-item` envelope's
   * payload into a local itemStore item. Dedupes on `payload.id` via
   * the `syncedFromId` marker stashed at first-receive.
   */
  async function mirror(payload, fromPubKey) {
    if (!payload || typeof payload.id !== 'string' || !payload.id) return;

    const open   = await itemStore.listOpen();
    const closed = await itemStore.listClosed();
    const matches = (i) => i?.source?.syncedFromId === payload.id;
    const existing = open.find(matches) ?? closed.find(matches);

    // Already have it → apply the new state via applySync (gate-bypass;
    // preserves audit + emit). Publishers send full item state on every
    // mutation; this branch handles the receive-side application.
    if (existing) {
      const action = _inferAction(existing, payload);
      try {
        await itemStore.applySync({
          syncedFromId: payload.id,
          nextState:    _stripIdentity(payload),
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

    // Reconstruct an addItems-shaped partial. We carry over the
    // ORIGINAL author (payload.addedBy) — not fromPubKey — because the
    // publishing device might be a relay node. Carry generic item
    // fields only; tasks-only fields (dependencies/requiredSkills/
    // approval/reviewLog/parentTaskId/...) are intentionally dropped.
    const draft = {
      type:           payload.type ?? 'task',
      text:           payload.text ?? '(synced)',
      ...(payload.dueAt !== undefined ? { dueAt: payload.dueAt } : {}),
      ...(payload.notes ? { notes: payload.notes } : {}),
      ...(payload.embeds ? { embeds: payload.embeds } : {}),
      ...(payload.visibility ? { visibility: payload.visibility } : {}),
      source: {
        synced:        true,
        syncedFromId:  payload.id,
        fromPubKey,
        ...(payload.source ?? {}),
      },
    };

    await itemStore.addItems(
      [draft],
      {
        actor: payload.addedBy ?? `pubkey:${(fromPubKey ?? '').slice(0, 12) || 'broadcast'}`,
        actionOverride: 'sync',
      },
    );
  }

  /**
   * Per-circle URI prefix on the pseudoPod for this circle's items.
   * The publisher embeds the URI in the envelope's `ref`; receivers
   * filter by this prefix so the same notify-envelope subscription can
   * host multiple circles without cross-talk.
   */
  const uriPrefix = `/household/circles/${circleId}/items/`;
  function urlFor(itemId) {
    return `pseudo-pod://${pseudoPod.deviceId ?? 'self'}${uriPrefix}${itemId}`;
  }

  const unsubscribe = notifyEnvelope.subscribe({
    kind: 'household-item',
    callback: (envelope) => {
      const ref = envelope?.ref;
      if (typeof ref !== 'string' || !ref.includes(uriPrefix)) return;
      const fromPubKey = envelope.fromActor ?? null;
      mirror(envelope.payload, fromPubKey).catch(() => {
        /* swallow — UI reflects on next sync */
      });
    },
  });

  // `household-item-removed` envelopes signal a hard-delete. Payload
  // carries `{originalId}` (the sender's item id); the receiver finds
  // its local copy by syncedFromId and hard-deletes via removeSync.
  const unsubscribeRemoved = notifyEnvelope.subscribe({
    kind: 'household-item-removed',
    callback: (envelope) => {
      const ref = envelope?.ref;
      if (typeof ref !== 'string' || !ref.includes(uriPrefix)) return;
      const originalId = envelope?.payload?.originalId;
      if (typeof originalId !== 'string' || !originalId) return;
      const fromPubKey = envelope.fromActor ?? null;
      itemStore.removeSync({ syncedFromId: originalId }, {
        remoteActor: fromPubKey ? `pubkey:${fromPubKey.slice(0, 12)}` : null,
      }).catch(() => { /* swallow */ });
    },
  });

  /**
   * Q-D auto-heal — when a peer writes with an older `_v` than ours,
   * `pseudoPod` emits `'stale-peer'` carrying our fresher local copy.
   * Republish that back to the stale peer so they converge. Silent.
   */
  function _onStalePeer(event) {
    const uri = event?.uri;
    if (typeof uri !== 'string' || !uri.includes(uriPrefix)) return;
    const stalePeer = event.fromActor;
    if (typeof stalePeer !== 'string' || stalePeer.length === 0) return;
    const localBytes = event.localBytes;
    if (typeof localBytes === 'undefined' || localBytes === null) return;
    if (selfPubKey && stalePeer === selfPubKey) return;
    notifyEnvelope.publish({
      type:       'household-item',
      ref:        uri,
      payload:    localBytes,
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
    if (typeof unsubscribeStale === 'function') {
      try { unsubscribeStale(); } catch { /* swallow */ }
    }
    recipients.clear();
  }
  function listPeers() { return [...recipients]; }
  function getPeers()  { return [...recipients]; }

  /**
   * Publish an item's full current state to every peer in the roster.
   * Called by Household skills after every mutation so receivers can
   * `applySync` the new state. Best-effort fan-out — local write is the
   * source of truth.
   */
  async function publishItem(item, opts = {}) {
    if (!item?.id || recipients.size === 0) return;
    try {
      const uri = urlFor(item.id);
      const { etag, _v } = await pseudoPod.write(uri, item);
      await notifyEnvelope.publish({
        type:       'household-item',
        ref:        uri,
        payload:    item,
        etag,
        _v,
        recipients: [...recipients],
        ...(opts.fromActor ?? selfPubKey ? { fromActor: opts.fromActor ?? selfPubKey } : {}),
        circleId,
      });
    } catch (_err) { /* best-effort */ }
  }

  /**
   * Publish a hard-delete signal for an item to every peer. Receivers
   * call `itemStore.removeSync({syncedFromId: originalId})`. Best-effort.
   */
  async function publishItemRemoved(originalId, opts = {}) {
    if (typeof originalId !== 'string' || !originalId) return;
    if (recipients.size === 0) return;
    try {
      const uri = urlFor(originalId);
      await notifyEnvelope.publish({
        type:       'household-item-removed',
        ref:        uri,
        payload:    { originalId },
        recipients: [...recipients],
        ...(opts.fromActor ?? selfPubKey ? { fromActor: opts.fromActor ?? selfPubKey } : {}),
        circleId,
      });
    } catch (_err) { /* best-effort */ }
  }

  return {
    addPeer, removePeer, stop, listPeers, getPeers, urlFor,
    publishItem, publishItemRemoved,
  };
}

// ── Internal helpers ──────────────────────────────────────────────

/**
 * Infer which sync action best describes the transition from `local`
 * to `next` for a household item. Simplified vs tasks — no reviewLog
 * branch (household has none).
 */
function _inferAction(local, next) {
  if (!local.completedAt && next.completedAt)        return 'complete';
  if (local.assignee && !next.assignee)              return 'revoke';
  if (!local.assignee && next.assignee)              return 'claim';
  if (local.assignee && next.assignee && local.assignee !== next.assignee) return 'reassign';
  return 'update';
}

/**
 * Strip identity fields (id, _etag, addedAt) from a payload before
 * merging into the local item — `applySync` preserves local identity
 * and overwrites the rest.
 */
function _stripIdentity(payload) {
  const { id: _id, _etag: _etag, addedAt: _addedAt, ...rest } = payload;
  return rest;
}
