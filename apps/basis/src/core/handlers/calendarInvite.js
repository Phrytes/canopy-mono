/**
 * Inbound calendar-invite handler. Bundle H Phase 2 — lifted
 * from `apps/basis/web/main.js:477`.
 *
 * On a peer's `calendar-invite` envelope: persists the event locally
 * via `calendar.addEvent` (with `_organiserAddr` so the RSVP knows
 * where to send), then renders a time-card embed in the chat shell's
 * "main" thread.  Publishes a notification event so /logs + matching
 * threads also surface the invite.
 *
 * Deps:
 *   - `callSkill('calendar', 'addEvent', …)` — the substrate write
 *   - `addMainBubble(bubble)` — adds a shell-message to the host's
 *     main/landing thread; caller pre-binds the thread (web:
 *     store.getThread('main').addShellMessage; mobile: lambda that
 *     calls appendBubble(MAIN_THREAD_ID, bubble))
 *   - `publishEvent(event)` — fan into the event router (notifications)
 *
 * @param {object} args
 * @param {(appOrigin: string, opId: string, args: object) => Promise<*>} args.callSkill
 * @param {(bubble: object) => void}                                       args.addMainBubble
 * @param {(event: object) => void}                                        [args.publishEvent]
 * @param {{info?, warn?, error?}}                                         [args.logger]
 * @returns {(fromAddr: string, payload: object) => Promise<void>}
 */
export function makeHandleCalendarInvite({
  callSkill, addMainBubble, publishEvent, logger = console,
} = {}) {
  if (typeof callSkill     !== 'function') throw new Error('makeHandleCalendarInvite: callSkill required');
  if (typeof addMainBubble !== 'function') throw new Error('makeHandleCalendarInvite: addMainBubble required');

  return async function handleCalendarInvite(fromAddr, payload) {
    const event = payload?.event;
    if (!event?.id || !event?.title || !event?.startsAt) {
      logger.warn?.('[peer] calendar-invite missing fields', payload);
      return;
    }
    try {
      await callSkill('calendar', 'addEvent', {
        id:            event.id,
        title:         event.title,
        when:          event.startsAt,
        until:         event.endsAt,
        location:      event.location,
        attendees:     event.attendees ?? [],
        organiser:     event.organiser ?? fromAddr,
        _organiserAddr: fromAddr,
      });
    } catch (err) {
      logger.error?.('[peer] failed to ingest invite locally', err);
      return;
    }
    addMainBubble({
      kind:           'embed-card',
      messageId:      `invite-${event.id}`,
      threadId:       null,
      lifecycleState: 'live',
      embed: {
        kind:      'time-card',
        appOrigin: 'calendar',
        itemRef:   { app: 'calendar', type: 'calendar-event', id: event.id },
        snapshot: {
          id:       event.id,
          type:     'calendar-event',
          title:    event.title,
          startAt:  event.startsAt,
          endAt:    event.endsAt,
          ...(event.location ? { location: event.location } : {}),
          state:    'open',
          fields:   {
            state:     'open',
            organiser: event.organiser ?? fromAddr,
            ...(event.attendees?.length ? { attendees: event.attendees.join(', ') } : {}),
          },
        },
        issuedBy: fromAddr,
      },
    });
    publishEvent?.({
      app:     'calendar',
      type:    'notification',
      actor:   fromAddr,
      payload: { message: `📅 calendar invite: ${event.title}` },
    });
  };
}
