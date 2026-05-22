/**
 * @canopy-app/calendar — skill registrations.
 *
 * `registerCalendarSkills(agent, store, opts)` registers every
 * manifest-declared op as an agent skill backed by `CalendarStore`.
 * Used by `createCalendarAgent` AND by canopy-chat (which composes
 * the same skills onto its in-process hostAgent for the v0.7.10
 * demo).
 *
 * Skill signature follows @canopy/core convention: handler receives
 * `{ parts }` with the first DataPart's `data` carrying the args
 * (the chat-shell's callSkill wraps args in a DataPart).
 */

import { DataPart } from '@canopy/core';

/**
 * @param {import('@canopy/core').Agent}     agent
 * @param {import('../CalendarStore.js').CalendarStore} store
 * @param {object}  [opts]
 * @param {() => object} [opts.simulateSync]   v0.6 sync hint shape
 * @param {(event: object) => void} [opts.publishEvent]
 *   v0.7.7 notifier event publisher (item-changed on add/cancel/rsvp).
 */
export function registerCalendarSkills(agent, store, opts = {}) {
  const simulateSync = typeof opts.simulateSync === 'function'
    ? opts.simulateSync : () => undefined;
  const publishEvent = typeof opts.publishEvent === 'function'
    ? opts.publishEvent : () => {};
  // v0.7.10 — optional prefix to disambiguate when multiple apps
  // share a hostAgent (e.g. briefSummary, searchEvents).  Caller
  // passes 'calendar_' to register as 'calendar_briefSummary' etc;
  // remaps live in canopy-chat's main.js callSkill.
  const prefix = typeof opts.skillPrefix === 'string' ? opts.skillPrefix : '';
  const reg = (name, fn) => agent.register(`${prefix}${name}`, fn);

  // v0.7.12 — multi-pod RSVP coordination.  Caller (canopy-chat
  // main.js) wires an inviteAttendee callback that posts an invite
  // embed to each attendee's thread (sim-peer in the demo; real
  // cross-pod chat-p2p in production).  Signature:
  //   inviteAttendee(webid, snapshot) → Promise<void>
  const inviteAttendee = typeof opts.inviteAttendee === 'function'
    ? opts.inviteAttendee : null;

  reg('addEvent', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    try {
      const event = await store.addEvent(a);
      publishEvent({
        app: 'calendar', type: 'item-changed',
        actor: a.actor ?? 'webid:local-demo-user',
        itemRef: { app: 'calendar', type: 'calendar-event', id: event.id },
        payload: { message: `✓ Added event: ${event.title}` },
      });

      // v0.7.12 — dispatch invites to attendees.  Each gets the
      // event card in their own thread; they RSVP via the embed's
      // [Accept]/[Decline]/[Tentative] buttons (manifest-driven
      // since v0.7.13).  Responses broadcast back via the
      // calendar's rsvp* skills (which already publishEvent + the
      // organiser's open record panels go stale per v0.6.3
      // reactive refresh).
      let invitedCount = 0;
      if (inviteAttendee && Array.isArray(event.attendees)) {
        const snapshot = buildInviteSnapshot(event);
        for (const webid of event.attendees) {
          try {
            await inviteAttendee(webid, snapshot);
            invitedCount += 1;
          } catch { /* per-attendee failures shouldn't block the event */ }
        }
      }

      return [DataPart({
        ok:      true,
        message: invitedCount > 0
          ? `✓ Added event: ${event.title}  (sent invitation to ${invitedCount} ${invitedCount === 1 ? 'attendee' : 'attendees'})`
          : `✓ Added event: ${event.title}`,
        itemId:  event.id,
        _sync:   simulateSync(),
      })];
    } catch (err) {
      return [DataPart({ ok: false, error: err.message })];
    }
  });

  reg('listEvents', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    const days = typeof a.days === 'number' ? a.days : 7;
    const since = Date.now();
    const until = since + days * 86_400_000;
    const events = await store.listInRange({ since, until });
    return [DataPart({
      items: events.map((e) => ({
        id:    e.id,
        label: `${formatDate(e.startsAt)} · ${e.title}`,
        type:  'calendar-event',
        state: e.state ?? 'open',
      })),
      _sync: simulateSync(),
    })];
  });

  reg('rsvpAccept',    async (args) => rsvpHandler(args, 'accepted',  store, simulateSync, publishEvent));
  reg('rsvpDecline',   async (args) => rsvpHandler(args, 'declined',  store, simulateSync, publishEvent));
  reg('rsvpTentative', async (args) => rsvpHandler(args, 'tentative', store, simulateSync, publishEvent));

  reg('cancelEvent', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    try {
      await store.cancel({ eventId: a.id, actor: a.actor });
      publishEvent({
        app: 'calendar', type: 'item-changed',
        actor: a.actor ?? 'webid:local-demo-user',
        itemRef: { app: 'calendar', type: 'calendar-event', id: a.id },
        payload: { message: `✓ Cancelled event ${a.id}` },
      });
      return [DataPart({ ok: true, message: `✓ Event cancelled.`, itemId: a.id, _sync: simulateSync() })];
    } catch (err) {
      return [DataPart({ ok: false, error: err.message })];
    }
  });

  reg('getEventSnapshot', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    const event = await store.getById(a.id);
    if (!event) return [DataPart({ ok: false, error: `No event with id "${a.id}".` })];
    const rsvp = event.rsvp ?? {};
    const summary = Object.keys(rsvp).length === 0
      ? null
      : Object.entries(rsvp).map(([w, r]) => `${w}: ${r}`).join(', ');
    return [DataPart({
      id:    event.id,
      type:  'calendar-event',
      state: event.state ?? 'open',
      title: event.title,
      // Time-card renderer reads these:
      startAt:  event.startsAt,
      endAt:    event.endsAt,
      ...(event.location ? { location: event.location } : {}),
      fields: {
        state:     event.state ?? 'open',
        organiser: event.organiser ?? 'unknown',
        ...(event.attendees?.length ? { attendees: event.attendees.join(', ') } : {}),
        ...(summary ? { rsvp: summary } : {}),
      },
    })];
  });

  reg('briefSummary', async () => {
    const since = Date.now();
    const until = since + 86_400_000;        // today + tomorrow window
    const events = await store.listInRange({ since, until });
    if (events.length === 0) return [DataPart({ ok: true })];   // skipped by /brief
    return [DataPart({
      items:   events.slice(0, 5).map((e) => ({ id: e.id, label: `${formatDate(e.startsAt)} ${e.title}` })),
      message: `${events.length} upcoming event${events.length === 1 ? '' : 's'}`,
    })];
  });

  reg('getIcsFeed', async () => {
    const { ics, uri } = await store.getIcsFeed();
    const eventCount = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
    return [DataPart({
      message:
        `iCal feed for your calendar (${eventCount} event${eventCount === 1 ? '' : 's'}):\n` +
        `  ${uri}\n\n` +
        `Subscribe to this URI from Apple Calendar / Google Calendar / Proton.\n` +
        `(v0.7.11: lives on the local pseudo-pod; a real-pod attach makes\n` +
        ` it externally reachable.)`,
    })];
  });

  reg('searchEvents', async ({ parts }) => {
    const q = String(parts?.[0]?.data?.query ?? '');
    const hits = await store.search(q);
    return [DataPart({
      items: hits.map((e) => ({
        id:    e.id,
        label: `${formatDate(e.startsAt)} · ${e.title}`,
        type:  'calendar-event',
      })),
    })];
  });
}

async function rsvpHandler({ parts }, response, store, simulateSync, publishEvent) {
  const a = parts?.[0]?.data ?? {};
  const actor = a.actor ?? 'webid:local-demo-user';
  try {
    const event = await store.rsvp({ eventId: a.id, actor, response });
    publishEvent({
      app: 'calendar', type: 'item-changed',
      actor,
      itemRef: { app: 'calendar', type: 'calendar-event', id: a.id },
      payload: { message: `${actor} ${response}: ${event.title}` },
    });
    return [DataPart({
      ok:      true,
      message: `✓ ${capitalize(response)}: ${event.title}`,
      itemId:  a.id,
      _sync:   simulateSync(),
    })];
  } catch (err) {
    return [DataPart({ ok: false, error: err.message })];
  }
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/**
 * v0.7.12 — build the snapshot the inviteAttendee callback embeds
 * in each attendee's thread.  Same shape as getEventSnapshot's
 * output so the time-card renderer + appliesTo gating work
 * unchanged on the receiver side.
 */
function buildInviteSnapshot(event) {
  return {
    id:    event.id,
    type:  'calendar-event',
    state: 'open',
    title: event.title,
    startAt:  event.startsAt,
    endAt:    event.endsAt,
    ...(event.location ? { location: event.location } : {}),
    fields: {
      state:     'open',
      organiser: event.organiser ?? 'unknown',
      ...(event.attendees?.length ? { attendees: event.attendees.join(', ') } : {}),
    },
  };
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  } catch {
    return String(iso);
  }
}
