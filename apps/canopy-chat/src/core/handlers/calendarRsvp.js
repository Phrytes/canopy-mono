/**
 * Inbound calendar-rsvp handler.  Bundle H Phase 2 (#269) — lifted
 * from `apps/canopy-chat/web/main.js:861`.
 *
 * Applies a peer's RSVP to a local event via the
 * `rsvpAccept`/`rsvpDecline`/`rsvpTentative` skills.  No bubble —
 * the organiser already sees the event in their calendar; an event
 * notification is enough.
 *
 * @param {object} args
 * @param {(appOrigin: string, opId: string, args: object) => Promise<*>} args.callSkill
 * @param {(event: object) => void}                                        [args.publishEvent]
 * @param {{info?, warn?, error?}}                                         [args.logger]
 * @returns {(fromAddr: string, payload: object) => Promise<void>}
 */
export function makeHandleCalendarRsvp({
  callSkill, publishEvent, logger = console,
} = {}) {
  if (typeof callSkill !== 'function') throw new Error('makeHandleCalendarRsvp: callSkill required');

  const SKILL_BY_RESPONSE = Object.freeze({
    accepted:  'rsvpAccept',
    declined:  'rsvpDecline',
    tentative: 'rsvpTentative',
  });

  return async function handleCalendarRsvp(fromAddr, payload) {
    const { eventId, response } = payload ?? {};
    const skillName = SKILL_BY_RESPONSE[response];
    if (!eventId || !skillName) {
      logger.warn?.('[peer] calendar-rsvp invalid', payload);
      return;
    }
    try {
      await callSkill('calendar', skillName, { id: eventId, actor: fromAddr });
    } catch (err) {
      logger.error?.('[peer] failed to apply RSVP locally', err);
      return;
    }
    publishEvent?.({
      app:     'calendar',
      type:    'notification',
      actor:   fromAddr,
      payload: { message: `📅 RSVP ${response} from ${String(fromAddr).slice(0, 16)}…` },
    });
  };
}
