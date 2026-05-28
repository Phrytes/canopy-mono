/**
 * Inbound buurt-post handler.  Bundle H Phase 2 (#269) — lifted from
 * `apps/canopy-chat/web/main.js:807` (Slice 1, 2026-05-24).
 *
 * Ingests a peer's fan-out post into the local stoop substrate via
 * `stoop.ingestRemotePost`.  Handles dedup + eviction-filter inside
 * the skill; we just publish a notification on success.
 *
 * The NKN sender address is recorded alongside `fromPubKey` so
 * [Help with] / row-button actions can route a follow-up back over
 * the wire to the original poster.
 *
 * @param {object} args
 * @param {(appOrigin: string, opId: string, args: object) => Promise<*>} args.callSkill
 * @param {(event: object) => void}                                        [args.publishEvent]
 * @param {{info?, warn?, error?}}                                         [args.logger]
 * @returns {(fromAddr: string, envelope: object) => Promise<void>}
 */
export function makeHandleBuurtPost({
  callSkill, publishEvent, logger = console,
} = {}) {
  if (typeof callSkill !== 'function') throw new Error('makeHandleBuurtPost: callSkill required');

  return async function handleBuurtPost(fromAddr, envelope) {
    const { groupId, fromPubKey, payload } = envelope ?? {};
    logger.info?.('[peer] buurt-post received: groupId=' + groupId
      + ' from=' + String(fromAddr).slice(0, 16) + '… requestId=' + payload?.requestId);
    if (!payload?.requestId) {
      logger.warn?.('[peer] buurt-post missing payload.requestId', envelope);
      return;
    }
    let result;
    try {
      result = await callSkill('stoop', 'ingestRemotePost', {
        payload,
        fromPubKey:  fromPubKey ?? fromAddr,
        fromNknAddr: fromAddr,
      });
    } catch (err) {
      logger.error?.('[peer] handleBuurtPost failed', err);
      return;
    }
    if (result?.error) {
      logger.warn?.('[peer] ingestRemotePost rejected', result.error, payload.requestId);
      return;
    }
    if (result?.deduped) {
      logger.info?.('[peer] buurt-post deduped (already have requestId=' + payload.requestId + ')');
      return;
    }
    if (result?.evicted) {
      logger.info?.('[peer] buurt-post from evicted member dropped', payload.from);
      return;
    }
    logger.info?.('[peer] buurt-post ingested: new itemId=' + result?.itemId);
    publishEvent?.({
      app:   'stoop',
      type:  'notification',
      actor: payload.from ?? fromAddr,
      payload: {
        message: `📥 ${payload.kind ?? payload.type ?? 'post'} in ${groupId ?? 'buurt'}: ${payload.text ?? '(no text)'}`,
        ...(payload.requestId ? { postId: payload.requestId } : {}),
        ...(groupId           ? { groupId }                   : {}),
      },
    });
  };
}
