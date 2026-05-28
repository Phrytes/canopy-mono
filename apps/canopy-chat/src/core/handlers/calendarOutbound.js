/**
 * Outbound calendar cross-peer hook.  Bundle calendar cross-peer
 * (#238, 2026-05-27) — lifted from `apps/canopy-chat/web/main.js:1497`
 * (the v0.7.P3c block inside the calendar branch of the web
 * `callSkill` wrapper).
 *
 * Web's calendar branch in callSkill does two things AFTER the
 * substrate write:
 *   (a) addEvent with `attendees-nkn` arg → fans out `calendar-invite`
 *       envelopes to each NKN address (via `sendPeer`).
 *   (b) rsvp* (Accept / Decline / Tentative) on an event whose
 *       organiser is an NKN address → sends a `calendar-rsvp` envelope
 *       back to the organiser.
 *
 * Plus a stub branch for `cancelEvent` propagation (currently logs
 * only — see comments below).
 *
 * The factory returns `afterCallSkill(appOrigin, opId, args, result)`
 * — a thin hook the platform calls after each successful dispatch.
 * Returns a promise that resolves when all cross-peer effects have
 * settled (or rejected, individually swallowed).  Non-calendar ops
 * pass through as no-ops.
 *
 * Deps:
 *   - `callSkill(appOrigin, opId, args)` — for the `getEventSnapshot`
 *     lookup (we need the snapshot to construct the invite payload +
 *     to find the organiser NKN for the RSVP path).
 *   - `sendPeer(addr, payload)` — fire the envelope (agent.sendPeerMessage
 *     on both platforms).
 *   - `isPeerConnected() → boolean` — gate so we don't try to send
 *     when NKN isn't up.  Cheap; both platforms have it.
 *   - `publishEvent(event)` — optional; emits a /logs notification
 *     for "📤 invite sent" / "❌ invite failed" diagnostics.
 *
 * NOTE: the snapshot read uses the `calendar` appOrigin (not
 * 'household'/'calendar_X' as web's call-skill does internally) —
 * because we call BACK through the SAME `callSkill` dependency we
 * received.  Each platform's callSkill knows how to route 'calendar'.
 */

const RSVP_OP_TO_RESPONSE = Object.freeze({
  rsvpAccept:    'accepted',
  rsvpDecline:   'declined',
  rsvpTentative: 'tentative',
});

/**
 * @param {object} args
 * @param {(appOrigin: string, opId: string, args?: object) => Promise<*>} args.callSkill
 * @param {(addr: string, payload: object) => Promise<*>}                   args.sendPeer
 * @param {() => boolean}                                                    [args.isPeerConnected]
 * @param {(event: object) => void}                                          [args.publishEvent]
 * @param {{info?, warn?, error?}}                                           [args.logger]
 * @returns {(appOrigin: string, opId: string, args: object, result: object) => Promise<void>}
 */
export function makeCalendarOutboundHook({
  callSkill, sendPeer, isPeerConnected, publishEvent, logger = console,
} = {}) {
  if (typeof callSkill !== 'function') throw new Error('makeCalendarOutboundHook: callSkill required');
  if (typeof sendPeer  !== 'function') throw new Error('makeCalendarOutboundHook: sendPeer required');

  const peerUp = () =>
    typeof isPeerConnected !== 'function' ? true : !!isPeerConnected();

  return async function afterCallSkill(appOrigin, opId, dispatchArgs, result) {
    if (appOrigin !== 'calendar') return;
    if (!result?.ok) return;

    // (a) addEvent with attendees-nkn → send calendar-invite envelopes.
    if (opId === 'addEvent' && dispatchArgs?.['attendees-nkn']) {
      const targets = String(dispatchArgs['attendees-nkn']).split(/[,\s]+/)
        .map((s) => s.trim()).filter(Boolean);
      if (targets.length === 0)  return;
      if (!peerUp()) {
        logger.warn?.('[calendar-outbound] skipped invite fan-out — peer transport not connected');
        return;
      }
      let snapshot = null;
      try {
        snapshot = await callSkill('calendar', 'getEventSnapshot', { id: result.itemId });
      } catch (err) {
        logger.error?.('[calendar-outbound] getEventSnapshot for invite-fan-out failed', err);
        return;
      }
      if (!snapshot?.id) return;
      const eventPayload = {
        id:        snapshot.id,
        title:     snapshot.title,
        startsAt:  snapshot.startAt,
        endsAt:    snapshot.endAt,
        location:  snapshot.location,
        attendees: snapshot.fields?.attendees
          ? String(snapshot.fields.attendees).split(/,\s*/)
          : [],
        organiser: snapshot.fields?.organiser,
      };
      for (const target of targets) {
        try {
          await sendPeer(target, {
            type:    'p2p-chat',
            subtype: 'calendar-invite',
            event:   eventPayload,
            sentAt:  Date.now(),
          });
          publishEvent?.({
            app: 'calendar', type: 'notification',
            payload: { message: `📤 invite sent to ${String(target).slice(0, 16)}…` },
          });
        } catch (err) {
          logger.error?.('[calendar-outbound] invite send failed', target, err);
          publishEvent?.({
            app: 'calendar', type: 'notification',
            payload: { message: `❌ invite send failed: ${err?.message ?? err}` },
          });
        }
      }
      return;
    }

    // (b) rsvp* with success on an event whose organiser is an NKN
    //     address → send calendar-rsvp envelope back.  The organiser
    //     NKN is stashed in snapshot.fields.organiser by the receiver's
    //     `calendar-invite` ingest (handleCalendarInvite sets
    //     `organiser: event.organiser ?? fromNknAddr`).
    const rsvpResponse = RSVP_OP_TO_RESPONSE[opId];
    if (rsvpResponse && dispatchArgs?.id) {
      if (!peerUp()) {
        logger.warn?.('[calendar-outbound] skipped RSVP fan-out — peer transport not connected');
        return;
      }
      let snapshot = null;
      try {
        snapshot = await callSkill('calendar', 'getEventSnapshot', { id: dispatchArgs.id });
      } catch (err) {
        logger.error?.('[calendar-outbound] getEventSnapshot for RSVP fan-out failed', err);
        return;
      }
      const organiser = snapshot?.fields?.organiser;
      // Only send when organiser looks like an NKN address (not a webid).
      if (!organiser || typeof organiser !== 'string' || organiser.startsWith('webid:')) return;
      try {
        await sendPeer(organiser, {
          type:    'p2p-chat',
          subtype: 'calendar-rsvp',
          eventId: dispatchArgs.id,
          response: rsvpResponse,
          sentAt:  Date.now(),
        });
        publishEvent?.({
          app: 'calendar', type: 'notification',
          payload: { message: `📤 RSVP ${rsvpResponse} sent to ${organiser.slice(0, 16)}…` },
        });
      } catch (err) {
        logger.error?.('[calendar-outbound] RSVP send failed', err);
      }
      return;
    }

    // (c) cancelEvent — currently a stub on web because the cancelled
    //     event's `attendees-nkn` isn't recovered post-cancel.  We
    //     surface a notification for /logs visibility (matches web).
    if (opId === 'cancelEvent' && dispatchArgs?.id) {
      publishEvent?.({
        app: 'calendar', type: 'notification',
        payload: {
          message: `🗑 event cancelled (peer propagation TBD): ${dispatchArgs.id}`,
        },
      });
    }
  };
}
