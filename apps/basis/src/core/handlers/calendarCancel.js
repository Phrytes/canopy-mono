/**
 * Inbound calendar-cancel handler — the receive side of the cross-peer cancel
 * fan-out (`calendarOutbound` (c)).  On a peer's `calendar-cancel` envelope,
 * cancel the matching local event so the cancellation propagates to invitees.
 *
 * Cancel is a soft delete (`state → 'cancelled'`, record kept), so applying it
 * is idempotent: a second envelope for an already-cancelled event is a no-op
 * the substrate tolerates.  No bubble — an event notification is enough (the
 * event was already on the invitee's calendar).
 *
 * @param {object} args
 * @param {(appOrigin: string, opId: string, args: object) => Promise<*>} args.callSkill
 * @param {(event: object) => void}                                        [args.publishEvent]
 * @param {{info?, warn?, error?}}                                         [args.logger]
 * @returns {(fromAddr: string, payload: object) => Promise<void>}
 */
export function makeHandleCalendarCancel({
  callSkill, publishEvent, logger = console,
} = {}) {
  if (typeof callSkill !== 'function') throw new Error('makeHandleCalendarCancel: callSkill required');

  return async function handleCalendarCancel(fromAddr, payload) {
    const { eventId } = payload ?? {};
    if (!eventId) {
      logger.warn?.('[peer] calendar-cancel invalid', payload);
      return;
    }
    try {
      await callSkill('calendar', 'cancelEvent', { id: eventId, actor: fromAddr });
    } catch (err) {
      logger.error?.('[peer] failed to apply cancel locally', err);
      return;
    }
    publishEvent?.({
      app:     'calendar',
      type:    'notification',
      actor:   fromAddr,
      payload: { message: `📅 event cancelled by ${String(fromAddr).slice(0, 16)}…${payload?.title ? `: ${payload.title}` : ''}` },
    });
  };
}
