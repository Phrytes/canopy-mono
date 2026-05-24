/**
 * #217 (2026-05-24) — extracted catch-up handlers from main.js.
 *
 * Slice 5 (catch-up on reconnect):
 *
 *   - `makeRequestCatchUpFromKnownPeers` — sender-side.  After NKN
 *     transport (re)connects, fire 'catch-up-request' to each known
 *     peer in each buurt asking for posts added after our last-seen
 *     high-water mark.
 *
 *   - `makeHandleCatchUpRequest` — receiver-side.  Looks up missing
 *     posts via stoop.listBuurtPostsSince + sends each back via the
 *     existing 'buurt-post' envelope (which the receiver's normal
 *     ingest path already handles + deduplicates).
 *
 * Same dep pattern as meshIntros.js: callSkill + sendPeer + logger.
 */

/**
 * @typedef {object} CatchUpDeps
 * @property {(appOrigin: string, opId: string, args: object) => Promise<*>} callSkill
 * @property {(addr: string, payload: object) => Promise<*>}                  sendPeer
 * @property {() => string|null}                                              [getMyPubKey]
 * @property {{info?: Function, warn?: Function, error?: Function}}           [logger]
 */

/**
 * @param {CatchUpDeps} deps
 */
export function makeRequestCatchUpFromKnownPeers({ callSkill, sendPeer, logger = console }) {
  return async function requestCatchUpFromKnownPeers() {
    let buurts = [];
    try {
      const r = await callSkill('stoop', 'listMyBuurts', {});
      buurts = r?.buurts ?? [];
    } catch (err) {
      logger.warn?.('[catch-up] listMyBuurts failed', err);
      return;
    }
    for (const groupId of buurts) {
      let sinceMs = 0;
      try {
        const hi = await callSkill('stoop', 'getLatestPostAddedAt', { groupId });
        sinceMs = hi?.latestAt ?? 0;
      } catch { /* swallow */ }
      let roster = [];
      try {
        const r = await callSkill('stoop', 'listGroupRoster', { groupId });
        roster = r?.members ?? [];
      } catch { /* swallow */ }
      for (const m of roster) {
        if (!m?.addr) continue;
        try {
          await sendPeer(m.addr, {
            type:    'p2p-chat',
            subtype: 'catch-up-request',
            groupId,
            sinceMs,
            sentAt:  Date.now(),
          });
        } catch (err) {
          logger.warn?.('[catch-up] send failed for', m.addr, err);
        }
      }
      logger.info?.(`[catch-up] requested posts since ${new Date(sinceMs).toISOString()}`
        + ` for groupId=${groupId} from ${roster.length} peer(s)`);
    }
  };
}

/**
 * @param {CatchUpDeps} deps
 */
export function makeHandleCatchUpRequest({ callSkill, sendPeer, getMyPubKey, logger = console }) {
  return async function handleCatchUpRequest(fromAddr, payload) {
    const { groupId, sinceMs } = payload ?? {};
    if (!groupId) return;
    let posts = [];
    try {
      const r = await callSkill('stoop', 'listBuurtPostsSince', { groupId, sinceMs: sinceMs ?? 0 });
      posts = r?.posts ?? [];
    } catch (err) {
      logger.warn?.('[catch-up] listBuurtPostsSince failed', err);
      return;
    }
    if (posts.length === 0) {
      logger.info?.(`[catch-up] no new posts to send to ${fromAddr.slice(0, 16)}…`);
      return;
    }
    for (const post of posts) {
      const { _addedAt, ...payloadCore } = post;
      try {
        await sendPeer(fromAddr, {
          type:       'p2p-chat',
          subtype:    'buurt-post',
          groupId,
          fromPubKey: payloadCore.fromPubKey ?? (typeof getMyPubKey === 'function' ? getMyPubKey() : null),
          payload:    payloadCore,
          catchUp:    true,
          sentAt:     Date.now(),
        });
      } catch (err) {
        logger.warn?.('[catch-up] send post failed', err);
      }
    }
    logger.info?.(`[catch-up] sent ${posts.length} post(s) to ${fromAddr.slice(0, 16)}…`);
  };
}
