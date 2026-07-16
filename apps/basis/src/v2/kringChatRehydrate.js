/**
 * basis v2 — kring-chat boot-time rehydrator (SP-13.2.2).
 *
 * The kring view's GESPREK tab reads from `eventLog` which lives in
 * memory.  On page reload the log starts empty, so historical chats
 * (durable in stoop's itemStore from SP-13.2.1's hybrid storage path)
 * wouldn't be visible until new chats arrived.
 *
 * Since ε.1, every kring-chat insert path routes through the shared
 * `chatMessageInbox`.  This rehydrator:
 *
 *   • fetches stored chats via the `listKringChats` skill
 *   • normalizes each `item` into the same envelope shape NKN delivers
 *     (`{ subtype, circleId, msgId, ts, text, fromActor }`)
 *   • hands the envelope to `inbox.ingestChatMessage(env, { source:
 *     'rehydrator' })`, which validates / dedupes / appends in the
 *     same way the receiver path does.
 *
 * Sharing the inbox's LRU with the receiver protects against the
 * boot-time race where a peer's envelope for msgId X arrives mid-boot,
 * ingest stores it, AND the rehydrator then re-reads it from itemStore
 * — without the shared gate that would render the bubble twice.
 *
 * Portable: no DOM, no RN, no module-level state.  Web + mobile boot
 * paths both call this once after the agent is ready.
 */

/**
 * Rehydrate chat history into the eventLog via the shared inbox.
 *
 * @param {object} args
 * @param {Function} args.callSkill           `(appOrigin, opId, args) => Promise<*>`
 * @param {{ingestChatMessage: Function}} [args.inbox]
 *                                            ε.1+ — preferred entry point.
 *                                            When omitted, an `eventLog` (+
 *                                            optional `dedup`) is required so
 *                                            existing call sites keep working.
 * @param {{append: Function}} [args.eventLog] legacy entry point.
 * @param {Set<string>} [args.dedup]          legacy shared msgId set.
 * @param {string} [args.groupId]
 * @param {number} [args.sinceTs]
 * @param {number} [args.limit]
 * @param {{warn?, info?, debug?}} [args.logger]
 * @returns {Promise<{rehydrated: number, skipped: number, error?: string}>}
 */
export async function rehydrateKringChatsFromStoop({
  callSkill,
  inbox    = null,
  eventLog = null,
  dedup    = null,
  groupId,
  sinceTs,
  limit,
  logger   = console,
} = {}) {
  if (typeof callSkill !== 'function') {
    return { rehydrated: 0, skipped: 0, error: 'callSkill required' };
  }

  // Resolve the insertion strategy.  Preferred: caller passed a shared
  // inbox so the rehydrator + receiver dedupe through ONE LRU.  Legacy:
  // caller passed `eventLog` (+ optional `dedup` Set) directly — we
  // keep that working so existing tests + transitional call sites
  // don't have to migrate in the same commit.
  let insert;
  if (inbox && typeof inbox.ingestChatMessage === 'function') {
    insert = async (env) => {
      const r = await inbox.ingestChatMessage(env, { source: 'rehydrator' });
      return r?.result === 'inserted';
    };
  } else if (eventLog && typeof eventLog.append === 'function') {
    insert = makeLegacyInsert({ eventLog, dedup });
  } else {
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
  let skipped    = 0;
  for (const item of items) {
    const envelope = itemToEnvelope(item);
    if (!envelope) { skipped += 1; continue; }
    const inserted = await insert(envelope);
    if (inserted) rehydrated += 1;
    else          skipped    += 1;
  }
  logger.info?.(`[kring-chat] rehydrated ${rehydrated} (skipped ${skipped})`);
  return { rehydrated, skipped };
}

/**
 * Convert a stoop `listKringChats` item into the NKN envelope shape
 * the inbox expects.  Returns `null` for items that are missing
 * msgId / circleId / text so the caller counts them as skipped.
 */
function itemToEnvelope(item) {
  const src = item?.source && typeof item.source === 'object' ? item.source : null;
  if (!src) return null;
  const msgId    = src.msgId;
  const circleId = src.circleId;
  const text     = item?.text;
  const ts       = typeof src.ts === 'number' && Number.isFinite(src.ts) ? src.ts : Date.now();
  if (typeof msgId !== 'string'    || !msgId)    return null;
  if (typeof circleId !== 'string' || !circleId) return null;
  if (typeof text !== 'string'     || !text)     return null;
  return {
    subtype:   'kring-chat-message',
    circleId,
    msgId,
    ts,
    text,
    fromActor: src.fromActor ?? src.fromWebid ?? null,
    // media P1 — stored media pointer+snapshot (broadcast/ingest persisted it
    // in `source.media`); rides the envelope so the rehydrated bubble keeps
    // its photo chip. Absent stays absent — legacy items map unchanged.
    ...(src.media && typeof src.media === 'object' && !Array.isArray(src.media)
      ? { media: src.media } : {}),
  };
}

/**
 * Pre-ε.1 insertion path: append straight to eventLog with an optional
 * shared dedup Set.  Kept so tests + transitional callers that pass an
 * `eventLog` (without an inbox) still work.  When all callers route
 * through the inbox this branch can be deleted.
 */
function makeLegacyInsert({ eventLog, dedup }) {
  return async function legacyInsert(envelope) {
    if (dedup && dedup.has(envelope.msgId)) return false;
    if (dedup) dedup.add(envelope.msgId);
    const actor = envelope.fromActor ?? null;
    eventLog.append({
      id:    envelope.msgId,
      ts:    envelope.ts,
      app:   'kring',
      type:  'chat-message',
      actor,
      payload: {
        circleId: envelope.circleId,
        text:     envelope.text,
        kind:     'chat-message',
        senderDisplay: actor,
      },
    });
    return true;
  };
}
