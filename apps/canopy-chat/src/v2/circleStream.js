/**
 * canopy-chat v2 — cross-circle Stream projection (shared, board 5B).
 *
 * The per-circle chat is the default; the Stream is the opposite lens —
 * ONE timeline interleaving every circle's inbound events by time, with a
 * circle-tag kept per row.  It's an unfiltered projection over the
 * existing EventLog (the firehose the /logs page already records), so this
 * module is pure: the host passes `events` (newest-first, e.g.
 * `eventLog.query({ excludeMuted: true })`) + the `circles` list, and gets
 * back tagged rows ready to render.  Web + mobile share this; the
 * renderers are thin.
 */

/**
 * Best-effort circle id for a logged event.  Events don't carry a
 * first-class circleId, so we read the usual audience fields off the
 * payload (circleId ≡ crewId ≡ groupId — see [[circleid-crewid-alias]]),
 * falling back to the itemRef.  Returns null when the event isn't
 * circle-scoped (it still shows in the Stream, just untagged).
 */
export function eventCircleId(event) {
  const p = event && typeof event.payload === 'object' && event.payload ? event.payload : {};
  return (
    p.circleId
    ?? p.crewId
    ?? p.groupId
    ?? p.buurtId
    ?? p.audience
    ?? event?.itemRef?.circleId
    ?? null
  );
}

/**
 * Project a logged-event list into circle-tagged Stream rows, newest
 * first.  Pure — no fetching, no filtering by circle (that's the point).
 *
 * @param {object}   [opts]
 * @param {object[]} [opts.events=[]]   LoggedEvent[] (newest-first)
 * @param {object[]} [opts.circles=[]]  normalized circles ({ id, name, ... })
 * @returns {{ id, ts, app, type, actor, circleId, circleName, event }[]}
 */
export function buildCircleStream({ events = [], circles = [] } = {}) {
  const byId = new Map((circles || []).map((c) => [c.id, c]));
  return (events || [])
    .filter((e) => e && typeof e === 'object')
    .map((e) => {
      const circleId = eventCircleId(e);
      const circle = circleId != null ? byId.get(circleId) : null;
      return {
        id:         e.id,
        ts:         typeof e.ts === 'number' ? e.ts : 0,
        app:        e.app ?? null,
        type:       e.type ?? null,
        actor:      e.actor ?? null,
        circleId:   circleId ?? null,
        circleName: circle?.name ?? null,
        event:      e,
      };
    })
    .sort((a, b) => b.ts - a.ts);
}
