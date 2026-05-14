/**
 * Tasks substrate-mirror — cross-device task fan-out (Phase 52.9.3,
 * 2026-05-14, Tasks V2 ninth slice).
 *
 * Mirror of `apps/stoop/src/substrateMirror.js` adapted for Tasks's
 * task items. Wires `@canopy/notify-envelope` + `@canopy/pseudo-
 * pod` into a per-crew "publish on write, mirror on receive" flow so
 * a task added on device A shows up on device B's itemStore.
 *
 * **Scope of this slice:** `addTask` fan-out only. Updates (claim,
 * complete, submit/approve/reject, removeTask) replicate locally to
 * the pseudoPod's Lamport `_v` counter but are NOT yet mirrored into
 * peers' itemStores — a follow-up slice will lift more itemStore
 * mutations into the substrate. Today this covers the most common
 * "where did the task go?" cross-device case.
 *
 * **What this gives the crew:**
 * - One global subscription per crew bundle (kind = 'task' envelopes).
 * - The receive path runs the Q-D 3-way Lamport version compare via
 *   `pseudoPod.writeFromPeer`; `'stale-peer'` events fire for
 *   app-level auto-heal (follow-up).
 * - The wire is owned by notify-envelope, not pubsub topics — apps
 *   subscribe by `kind: 'task'` plus a per-crew URI prefix filter.
 *
 * **Per-crew roster.** The substrate's `pseudoPod` is per-device,
 * not per-crew. The mirror tracks its own per-crew `recipients` set;
 * `addTask` reads it at publish time to direct fan-out.
 *
 * @param {object} args
 * @param {import('@canopy/item-store').ItemStore} args.itemStore
 * @param {object} args.notifyEnvelope   — shared per-bundle instance.
 * @param {object} args.pseudoPod        — shared per-bundle instance.
 * @param {string} args.crewId           — crew identifier (URI namespace).
 * @param {Array<{pubKey: string}>} [args.peers]
 * @param {string} [args.selfPubKey]     — local agent address; filtered out
 *                                          of the recipient roster (self).
 * @returns {Promise<{
 *   addPeer:    (pubKey: string) => Promise<void>,
 *   removePeer: (pubKey: string) => void,
 *   stop:       () => Promise<void>,
 *   listPeers:  () => string[],
 *   getPeers:   () => string[],
 *   urlFor:     (taskId: string) => string,
 * }>}
 */
export async function wireTasksSubstrateMirror({
  itemStore,
  notifyEnvelope,
  pseudoPod,
  crewId,
  peers = [],
  selfPubKey = null,
}) {
  if (!itemStore?.addItems) throw new Error('wireTasksSubstrateMirror: itemStore required');
  if (!notifyEnvelope?.subscribe) throw new Error('wireTasksSubstrateMirror: notifyEnvelope required');
  if (!pseudoPod?.write) throw new Error('wireTasksSubstrateMirror: pseudoPod required');
  if (typeof crewId !== 'string' || !crewId) {
    throw new Error('wireTasksSubstrateMirror: crewId required');
  }

  const recipients = new Set();
  function addPeerSync(pubKey) {
    if (!pubKey || typeof pubKey !== 'string') return;
    if (selfPubKey && pubKey === selfPubKey) return;
    recipients.add(pubKey);
  }
  for (const p of peers) addPeerSync(p?.pubKey);

  /**
   * The mirror handler — turns an inbound `task` envelope's payload
   * into a local itemStore item. Dedupes on `payload.id` (item id);
   * substrate's `writeFromPeer` already ran the Q-D version compare
   * by the time this fires.
   */
  async function mirror(payload, fromPubKey) {
    if (!payload || typeof payload.id !== 'string' || !payload.id) return;

    // Dedupe via `source.syncedFromId` — the local item-store
    // materialises a fresh `ulid()` for every addItems call, so the
    // sender's `payload.id` doesn't match a local id directly. The
    // mirror stashes the original id on `source.syncedFromId`; that's
    // the field we check on subsequent receives.
    const open   = await itemStore.listOpen();
    const closed = await itemStore.listClosed();
    const matches = (i) => i?.source?.syncedFromId === payload.id;
    if (open.some(matches) || closed.some(matches)) return;

    // Reconstruct an addItems-shaped partial. We carry over the
    // ORIGINAL author (payload.addedBy) — not fromPubKey — because
    // the publishing device might be a relay node. The actor on the
    // resulting audit entry reflects the real author.
    const draft = {
      type:           payload.type ?? 'task',
      ...(payload.kind !== undefined ? { kind: payload.kind } : {}),
      text:           payload.text ?? '(synced)',
      ...(payload.notes ? { notes: payload.notes } : {}),
      ...(payload.dependencies   ? { dependencies:   payload.dependencies }   : {}),
      ...(payload.requiredSkills ? { requiredSkills: payload.requiredSkills } : {}),
      ...(payload.dueAt !== undefined ? { dueAt: payload.dueAt } : {}),
      ...(payload.visibility ? { visibility: payload.visibility } : {}),
      ...(payload.definitionOfDone ? { definitionOfDone: payload.definitionOfDone } : {}),
      ...(payload.approval ? { approval: payload.approval } : {}),
      ...(payload.parentTaskId ? { parentTaskId: payload.parentTaskId } : {}),
      ...(payload.scheduledAt     !== undefined ? { scheduledAt:     payload.scheduledAt }     : {}),
      ...(payload.estimateMinutes !== undefined ? { estimateMinutes: payload.estimateMinutes } : {}),
      ...(payload.embeds ? { embeds: payload.embeds } : {}),
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
   * Per-crew URI prefix on the pseudoPod for this crew's tasks. The
   * publisher embeds the URI in the envelope's `ref`; receivers filter
   * by this prefix so the same notify-envelope subscription can host
   * multiple crews without cross-talk.
   */
  const uriPrefix = `/tasks/crews/${crewId}/tasks/`;
  function urlFor(taskId) {
    return `pseudo-pod://${pseudoPod.deviceId ?? 'self'}${uriPrefix}${taskId}`;
  }

  const unsubscribe = notifyEnvelope.subscribe({
    kind: 'task',
    callback: (envelope) => {
      const ref = envelope?.ref;
      if (typeof ref !== 'string' || !ref.includes(uriPrefix)) return;
      const fromPubKey = envelope.fromActor ?? null;
      mirror(envelope.payload, fromPubKey).catch(() => {
        /* swallow — UI reflects on next sync */
      });
    },
  });

  /**
   * Q-D auto-heal (Phase 52.14, mirror of Stoop A1) — when a peer
   * writes with an older `_v` than ours, `pseudoPod` emits
   * `'stale-peer'` carrying our fresher local copy. Republish that
   * back to the stale peer so they converge. Silent (no UI
   * affordance); same lean as Stoop's V2.5 default.
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
      type:       'task',
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
    if (typeof unsubscribeStale === 'function') {
      try { unsubscribeStale(); } catch { /* swallow */ }
    }
    recipients.clear();
  }
  function listPeers() { return [...recipients]; }
  function getPeers()  { return [...recipients]; }

  return { addPeer, removePeer, stop, listPeers, getPeers, urlFor };
}
