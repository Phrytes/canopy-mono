/**
 * Group-broadcast mirror — Phase 7 polish.
 *
 * SkillMatch is matchmaking-shaped: its inbound dispatcher silently
 * drops requests whose `requiredSkills` don't intersect the receiver's
 * local skill profile. That's correct for "auto-claim on a skill-tagged
 * task" — but it leaves the H5 web UI's "Open in the group" list empty
 * for any member whose skills don't match.
 *
 * `wireGroupBroadcastMirror` adds a parallel subscription on each peer's
 * `<group>/requests` topic that mirrors every inbound request into the
 * local `itemStore`, deduplicating on `source.requestId`. It composes
 * directly over `core.protocol.pubSub` (no SkillMatch involvement) so
 * the visibility path is independent of skill-matching.
 *
 * The two subscriptions coexist: SkillMatch keeps doing claim-flow work
 * via its own subscription; the mirror just observes and writes. Same
 * topic, two listeners on the same agent — `pubSub.subscribe` adds a
 * local listener (Emitter is multi-listener) and tells the publisher
 * once per call (publisher-side Set dedupes the registration).
 *
 * Returns an `addPeer(pubKey)` function so the testbed can extend the
 * mirror's roster as new members spawn (mirroring `SkillMatch.addPeer`).
 *
 * @param {object} args
 * @param {import('@canopy/core').Agent} args.agent
 * @param {import('@canopy/item-store').ItemStore} args.itemStore
 * @param {string} args.group
 * @param {Array<{pubKey: string}>} [args.peers]
 * @param {import('./lib/EvictionRoster.js').EvictionRoster} [args.evictionRoster]
 *   Optional Phase 35 (V2.5) auto-evict filter — when supplied, posts
 *   whose `from` webid is past `expiresAt + GRACE_MS` are dropped
 *   silently before the local mirror.
 * @returns {Promise<{
 *   addPeer:  (pubKey: string) => Promise<void>,
 *   stop:     () => Promise<void>,
 *   listPeers: () => string[],
 * }>}
 */
import { subscribe } from '@canopy/core';

export async function wireGroupBroadcastMirror({
  agent, itemStore, group, peers = [], evictionRoster = null,
}) {
  const requestsTopic = `${group}/requests`;
  const offs = new Map();   // pubKey → off-fn

  async function mirror(request, fromPubKey) {
    if (!request) return;
    const requestId = request.requestId;
    if (!requestId) return;
    // Phase 35 (V2.5) — silently drop posts from evicted members.
    // The "from" field is the post-author's webid; check it against
    // the roster before doing any other work.
    if (evictionRoster) {
      const fromWebid = request.from ?? request.payload?.from ?? null;
      if (fromWebid && evictionRoster.isEvicted(fromWebid)) return;
    }
    // Dedupe — if we've already mirrored this requestId, skip. Cheap
    // O(N) scan; H5's open-request volume is small (tens at most).
    const open = await itemStore.listOpen();
    if (open.some((i) => i?.source?.requestId === requestId)) return;
    const payload = request.payload ?? {};
    /** Phase 52.7.2 cut-over (2026-05-14): broadcasts now carry the
     *  canonical `type` + `kind` fields directly. The legacy shape
     *  encoded the UI intent in `payload.kind` and the receiver
     *  reconstructed `type: payload.kind`. Post-cut-over both fields
     *  flow verbatim — receivers' boards render the right chip from
     *  the canonical kind. Missing fields fall back to the legacy V0
     *  default ({type: 'request'}). */
    const type = typeof payload.type === 'string' && payload.type
      ? payload.type
      : 'request';
    const draft = {
      type,
      ...(typeof payload.kind === 'string' && payload.kind ? { kind: payload.kind } : {}),
      text:           payload.text ?? '(broadcast)',
      requiredSkills: request.requiredSkills ?? [],
      visibility:     'household',
      source: {
        requestId,
        broadcast:    true,
        from:         request.from ?? payload.from ?? null,
        fromPubKey,
        claimsTopic:  request.claimsTopic ?? null,
        // Stoop V1 Phase 12: forward the taxonomy match so receivers
        // can render category chips + run Layer-1 matching against
        // their own skills profile.
        categoryId:   payload.categoryId ?? null,
        skillTags:    Array.isArray(payload.skillTags) ? payload.skillTags : [],
        // Phase 39 — copy the attachment metadata (thumbnail + size
        // info, no full bytes).  No `ref` field yet — the recipient
        // populates it after a `requestAttachment` round-trip.
        attachments:  Array.isArray(payload.attachments) ? payload.attachments : [],
      },
    };
    if (typeof payload.dueAt === 'number') draft.dueAt = payload.dueAt;
    await itemStore.addItems([draft],
      { actor: request.from ?? payload.from ?? `pubkey:${fromPubKey.slice(0, 12)}` });
  }

  async function addPeer(pubKey) {
    if (!pubKey || pubKey === agent.address) return;
    // Race-safe dedup: stash an in-flight Promise SYNCHRONOUSLY before
    // awaiting subscribe. Concurrent callers (e.g. initial-peers loop +
    // PeerGraph seed + agent.on('peer') listener — all triggered around
    // bundle bring-up) hit `offs.has(pubKey)` and return immediately,
    // sharing the original subscription. Without this, each path
    // raced into `subscribe()` and TWO `agent.on('publish', listener)`
    // registrations landed; every inbound broadcast fired the mirror
    // handler twice, racing the open-listOpen dedup → duplicate items.
    if (offs.has(pubKey)) return;
    const subPromise = subscribe(agent, pubKey, requestsTopic, (parts) => {
      const dp = parts?.find?.((p) => p?.type === 'DataPart');
      mirror(dp?.data, pubKey).catch(() => { /* swallow — UI reflects on next post */ });
    });
    offs.set(pubKey, subPromise);
    try {
      const off = await subPromise;
      offs.set(pubKey, off);
    } catch (err) {
      offs.delete(pubKey);
      throw err;
    }
  }

  async function stop() {
    for (const [, off] of offs) {
      // `off` is either an unsubscribe-fn (resolved) or an in-flight
      // Promise that resolves to one. Await first; tolerate both.
      try {
        const fn = (typeof off === 'function') ? off : await off;
        if (typeof fn === 'function') await fn();
      } catch { /* ignore */ }
    }
    offs.clear();
  }

  function listPeers() { return [...offs.keys()]; }

  /**
   * Backfill — replay an array of items from `pubKey` through the
   * same mirror() path live broadcasts use, so a member who joins
   * AFTER the publisher's posts went out still sees them on the
   * board.  The dedupe inside mirror() makes this idempotent.
   *
   * @param {string} pubKey                publisher's pubKey
   * @param {Array<object>} items          items as stored in the publisher's itemStore
   */
  async function backfillFrom(pubKey, items) {
    if (!Array.isArray(items)) return;
    for (const it of items) {
      if (!it || it.completedAt) continue;
      // Skip items the publisher itself received as a mirror — only
      // forward originals (their `addedBy` is the publisher's webid,
      // and `source.broadcast` is not set).
      if (it.source?.broadcast) continue;
      const synthRequest = {
        requestId:      it.id,
        from:           it.addedBy,
        requiredSkills: it.requiredSkills ?? [],
        payload: {
          requestId:  it.id,
          text:       it.text,
          from:       it.addedBy,
          kind:       it.type,
          dueAt:      it.dueAt,
          categoryId: it.source?.categoryId ?? null,
          skillTags:  it.source?.skillTags  ?? [],
          // Phase 39 — backfill carries attachment metadata too,
          // already in broadcast shape (no `ref`, no `dataB64`).
          attachments: Array.isArray(it.source?.attachments) ? it.source.attachments : [],
        },
        claimsTopic: null,
      };
      await mirror(synthRequest, pubKey).catch(() => { /* swallow */ });
    }
  }

  for (const p of peers) await addPeer(p.pubKey);

  return { addPeer, stop, listPeers, backfillFrom };
}
