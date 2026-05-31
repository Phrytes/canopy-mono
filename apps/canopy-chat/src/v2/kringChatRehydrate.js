/**
 * canopy-chat v2 — kring-chat boot-time rehydrator (SP-13.2.2).
 *
 * The kring view's GESPREK tab reads from `eventLog` which lives in
 * memory.  On page reload the log starts empty, so historical chats
 * (durable in stoop's itemStore from SP-13.2.1's hybrid storage path)
 * wouldn't be visible until new chats arrived.
 *
 * This substrate fetches stored chats via the `listKringChats` skill
 * and projects each item back into an eventLog `chat-message` event,
 * matching the shape `kringChatReceiver` produces on inbound peer
 * envelopes.  Idempotent: a shared `dedup` set (or the receiver's own
 * dedup) skips msgIds already replayed.
 *
 * Portable: no DOM, no RN, no module-level state.  Web + mobile boot
 * paths both call this once after the agent is ready.
 */

/**
 * Rehydrate chat history into the eventLog.
 *
 * @param {object} args
 * @param {Function} args.callSkill              `(appOrigin, opId, args) => Promise<*>`
 * @param {{append: Function}} args.eventLog
 * @param {Set<string>} [args.dedup]             optional shared msgId set
 *                                               (shared with kringChatReceiver
 *                                               to avoid double-render once a
 *                                               new envelope of an already-
 *                                               rehydrated msgId arrives)
 * @param {string} [args.groupId]                scope to one kring (default: all)
 * @param {number} [args.sinceTs]                strict cutoff (default: all)
 * @param {number} [args.limit]                  passed through (default 200, max 1000)
 * @param {{warn?: Function, info?: Function, debug?: Function}} [args.logger]
 * @returns {Promise<{rehydrated: number, skipped: number, error?: string}>}
 */
export async function rehydrateKringChatsFromStoop({
  callSkill,
  eventLog,
  dedup,
  groupId,
  sinceTs,
  limit,
  logger = console,
} = {}) {
  if (typeof callSkill !== 'function') {
    return { rehydrated: 0, skipped: 0, error: 'callSkill required' };
  }
  if (!eventLog || typeof eventLog.append !== 'function') {
    return { rehydrated: 0, skipped: 0, error: 'eventLog.append required' };
  }

  let res;
  try {
    res = await callSkill('stoop', 'listKringChats', { groupId, sinceTs, limit });
  } catch (err) {
    logger.warn?.('[kring-chat] rehydrate failed:', err?.message ?? err);
    return { rehydrated: 0, skipped: 0, error: String(err?.message ?? err) };
  }
  const items = Array.isArray(res?.items) ? res.items : [];

  let rehydrated = 0;
  let skipped = 0;
  for (const item of items) {
    const src = item?.source && typeof item.source === 'object' ? item.source : {};
    const msgId    = src.msgId;
    const circleId = src.circleId;
    const ts       = typeof src.ts === 'number' ? src.ts : null;
    const text     = item?.text;
    if (!msgId || !circleId || typeof text !== 'string' || !text) {
      skipped += 1; continue;
    }
    if (dedup && dedup.has(msgId)) { skipped += 1; continue; }
    if (dedup) dedup.add(msgId);

    const actor = src.fromActor ?? src.fromWebid ?? null;
    eventLog.append({
      id:    msgId,
      ts:    ts ?? Date.now(),
      app:   'kring',
      type:  'chat-message',
      actor,
      payload: {
        circleId,
        text,
        kind:          'chat-message',
        senderDisplay: actor,
      },
    });
    rehydrated += 1;
  }
  logger.info?.(`[kring-chat] rehydrated ${rehydrated} (skipped ${skipped})`);
  return { rehydrated, skipped };
}
