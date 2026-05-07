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
 * @returns {Promise<{
 *   addPeer:  (pubKey: string) => Promise<void>,
 *   stop:     () => Promise<void>,
 *   listPeers: () => string[],
 * }>}
 */
import { subscribe } from '@canopy/core';

export async function wireGroupBroadcastMirror({ agent, itemStore, group, peers = [] }) {
  const requestsTopic = `${group}/requests`;
  const offs = new Map();   // pubKey → off-fn

  async function mirror(request, fromPubKey) {
    if (!request) return;
    const requestId = request.requestId;
    if (!requestId) return;
    // Dedupe — if we've already mirrored this requestId, skip. Cheap
    // O(N) scan; H5's open-request volume is small (tens at most).
    const open = await itemStore.listOpen();
    if (open.some((i) => i?.source?.requestId === requestId)) return;
    const payload = request.payload ?? {};
    /** Stoop V1 (2026-05-06): use the broadcast payload's `kind` when
     *  present so the board renders the right chip on every member's
     *  view (legacy H5 broadcasts didn't include `kind`; default to
     *  the legacy 'request'). */
    const kind = typeof payload.kind === 'string' && payload.kind ? payload.kind : 'request';
    const draft = {
      type:           kind,
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
      },
    };
    if (typeof payload.dueAt === 'number') draft.dueAt = payload.dueAt;
    await itemStore.addItems([draft],
      { actor: request.from ?? payload.from ?? `pubkey:${fromPubKey.slice(0, 12)}` });
  }

  async function addPeer(pubKey) {
    if (!pubKey || pubKey === agent.address) return;
    if (offs.has(pubKey)) return;
    const off = await subscribe(agent, pubKey, requestsTopic, (parts) => {
      const dp = parts?.find?.((p) => p?.type === 'DataPart');
      mirror(dp?.data, pubKey).catch(() => { /* swallow — UI will reflect on next post */ });
    });
    offs.set(pubKey, off);
  }

  async function stop() {
    for (const [, off] of offs) {
      try { await off(); } catch { /* ignore */ }
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
        },
        claimsTopic: null,
      };
      await mirror(synthRequest, pubKey).catch(() => { /* swallow */ });
    }
  }

  for (const p of peers) await addPeer(p.pubKey);

  return { addPeer, stop, listPeers, backfillFrom };
}
