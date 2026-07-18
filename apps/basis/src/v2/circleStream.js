/**
 * basis v2 — cross-circle Stream projection (shared, board 5B).
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

import { taskRowProvenance } from './streamActions.js';

/**
 * Best-effort circle id for a logged event.  Events don't carry a
 * first-class circleId, so we read the usual audience fields off the
 * payload (circleId ≡ circleId ≡ groupId — see [[circleid-crewid-alias]]),
 * falling back to the itemRef.  Returns null when the event isn't
 * circle-scoped (it still shows in the Stream, just untagged).
 */
export function eventCircleId(event) {
  const p = event && typeof event.payload === 'object' && event.payload ? event.payload : {};
  return (
    p.circleId
    ?? p.circleId
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
      // First-class task provenance (taskId + addedBy) for task/chore/reminder
      // rows, so the owner-only entrust check downstream is DETERMINISTIC (not a
      // best-effort payload dig). Null for non-task rows → the fields are absent
      // and the row renders exactly as before (backwards-compatible).
      const prov = taskRowProvenance(e);
      return {
        id:         e.id,
        ts:         typeof e.ts === 'number' ? e.ts : 0,
        app:        e.app ?? null,
        type:       e.type ?? null,
        actor:      e.actor ?? null,
        circleId:   circleId ?? null,
        circleName: circle?.name ?? null,
        ...(prov ? { taskId: prov.taskId, addedBy: prov.addedBy } : {}),
        event:      e,
      };
    })
    .sort((a, b) => b.ts - a.ts);
}

/**
 * SP-13 — kring-scoped Stream projection (board 2B right / 8C).  Tap
 * a kring on the launcher and you land on its content surface: the
 * cross-kring `buildCircleStream` rows narrowed to a single circle,
 * optionally filtered by a row "kind" (vraag / aanbod / leen / chore /
 * reminder — same enum the chips on board 2B render).
 *
 * `kindFilter = null` (or 'all') = no kind filter.  Unknown kinds pass
 * through unfiltered; the helper is forward-compatible with new chips.
 *
 * @param {object}   [opts]
 * @param {object[]} [opts.events=[]]
 * @param {object[]} [opts.circles=[]]
 * @param {?string}  [opts.circleId=null]   active circle (null = unscoped)
 * @param {?string}  [opts.kindFilter=null] one of KIND_CHIPS keys, or null
 * @returns {ReturnType<typeof buildCircleStream>}
 */
export function buildKringStream({
  events = [], circles = [], circleId = null, kindFilter = null,
} = {}) {
  const rows = buildCircleStream({ events, circles });
  const scoped = circleId == null ? rows : rows.filter((r) => r.circleId === circleId);
  if (!kindFilter || kindFilter === 'all') return scoped;
  const wanted = String(kindFilter).toLowerCase();
  return scoped.filter((r) => {
    const p = r.event?.payload && typeof r.event.payload === 'object' ? r.event.payload : {};
    const cands = [p.kind, r.event?.type, r.type, r.event?.kind];
    return cands.some((c) => typeof c === 'string' && c.toLowerCase() === wanted);
  });
}

/** Kind keys the board 2B filter strip exposes, in render order. */
export const KRING_STREAM_KIND_FILTERS = ['all', 'vraag', 'aanbod', 'leen'];
