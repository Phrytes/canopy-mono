/**
 * canopy-chat — v0.2 web demo entry.
 *
 * Multi-thread workspace.  Sidebar lists every thread; user can
 * create new threads with filter + permissions; clicking switches
 * the active thread.  Events from skill dispatches fan out through
 * the EventRouter to every thread whose filter matches (per OQ-4).
 *
 * Pipeline:
 *   user input → parseInput → resolveDispatch → runDispatch
 *              → renderReply → ACTIVE thread state → DOM render
 *   mutation reply → EventRouter.deliver(item-changed event)
 *                  → matching threads receive notifications
 *
 * Phase v0.2 sub-slice 2.3.
 */

import {
  parseInput, mergeManifests, resolveDispatch, runDispatch,
  renderReply, ThreadStore, createDefaultThreadStore, createEventRouter,
  initLocalisation, t, setLang, detectDeviceLang, currentLang,
  describeFilter, canopyChatManifest,
  IndexedDBStore, attachPersistence,
  collectFollowUps, claimEmbed,
  AppRegistry, filterCatalog,
  openExternalFlow, parseCallbackUrl, resumeInFlightFlows,
  runBrief, createBriefCache,
  runFind,
  EventLog, RETENTION_MS,
} from '../src/index.js';
import { buildFormSpec, validateAndCoerce } from '../src/forms/buildFormSpec.js';
import { renderStream }              from '../src/web/domAdapter.js';
import { renderForm }                from '../src/web/domForm.js';
import { renderSidebar }             from '../src/web/threadSidebar.js';
import { renderLogsPanel }           from '../src/web/logsPanel.js';
import { createRealHouseholdAgent }  from '../src/web/realAgent.js';
import { mockTasksManifest,
         mockStoopManifest,
         mockFolioManifest }         from '../src/web/mockAgent.js';
import { calendarManifest }          from '@canopy-app/calendar/manifest';
import { createLocalBuiltins }       from '../src/web/localBuiltins.js';
import * as podAuth                  from '../src/web/podAuth.js';
import { createPodWriter, discoverPodRoot } from '../src/web/podStorage.js';

/* ── DOM refs ──────────────────────────────────────────── */

const sidebarEl  = document.getElementById('sidebar');
const messagesEl = document.getElementById('messages');
const logsPanelEl = document.getElementById('logs-panel');
const formEl     = document.getElementById('input-form');
const inputEl    = document.getElementById('chat-input');
const langEnBtn  = document.getElementById('lang-en');
const langNlBtn  = document.getElementById('lang-nl');
const headerNameEl   = document.getElementById('active-thread-name');
const headerFilterEl = document.getElementById('active-thread-filter');

/* ── state ─────────────────────────────────────────────── */

// v0.7.7 — pass a publishEvent callback that defers to the router
// (created further down).  Forward-ref pattern: skill mutations
// fire publishEvent which dispatches into the router; the router
// fans out to matching threads + appends to the EventLog.
let publishEventRef = () => {};   // overwritten right after router is constructed
const agent = await createRealHouseholdAgent({
  publishEvent: (event) => publishEventRef(event),
});
// v0.4 cross-app surface: stoop + folio manifests join the merged
// catalog so users see their commands in /help.  Q32 runtime filter
// drops folio's sync/watch (node-only) ops in the browser build.
const rawCatalog = mergeManifests([
  { manifest: canopyChatManifest },
  { manifest: agent.manifest },
  { manifest: mockTasksManifest },    // v0.7.2 — slash decls (skills already on host)
  { manifest: mockStoopManifest },
  { manifest: mockFolioManifest },
  { manifest: calendarManifest },     // v0.7.10 — calendar app
], { runtime: 'browser' });

// v0.6 OQ-4.B — app-toggle registry.  Filters disabled apps out of
// the catalog seen by parser/router/dispatch/renderer.  Persistence
// rides on the same IndexedDB store as threads in a future slice;
// today the registry is in-memory + survives the session.
const appRegistry = new AppRegistry();
appRegistry.syncWithCatalog(rawCatalog.appOrigins);
let catalog = filterCatalog(rawCatalog, appRegistry);
appRegistry.subscribe(() => { catalog = filterCatalog(rawCatalog, appRegistry); });

const manifestsByOrigin = {
  'canopy-chat': canopyChatManifest,
  'household':   agent.manifest,
  'tasks-v0':    mockTasksManifest,
  'stoop':       mockStoopManifest,
  'folio':       mockFolioManifest,
  'calendar':    calendarManifest,
};

// v0.2.4 — IndexedDB persistence.  Load existing threads on boot;
// seed defaults on fresh install; subscribe so future changes
// persist automatically.
/**
 * v0.7.P1-followup — was Main's persisted filter the OLD wildcard?
 * matchesKey treats `[]` and absent allow-lists as wildcard, so
 * `{}` matches every event.  We check via deep-equal to the empty
 * object (treating null/undefined/empty as the same condition).
 */
function isPermissiveWildcard(filter) {
  if (filter == null) return true;
  if (typeof filter !== 'object' || Array.isArray(filter)) return false;
  return Object.keys(filter).length === 0;
}

const idb = new IndexedDBStore();
let store;
const persisted = await idb.loadAll();
if (persisted.length > 0) {
  // Hydrate from disk.
  store = new ThreadStore();
  for (const t0 of persisted) {
    // v0.7.P1-followup 2026-05-23 — filter migration.  Threads
    // persisted before the {not:{}} fix have filter `{}` (the old
    // wildcard, which actually matches ALL events).  On hydration
    // we upgrade Main's filter to the new strict default so
    // routed events no longer flood Main as duplicate bubbles.
    // v0.7.P1-followup, 2nd pass: ALWAYS force Main's filter to the
    // strict {not:{}} regardless of the persisted value.  The earlier
    // version only ran when the filter was an empty object, but
    // some persisted threads have variations the wildcard check
    // missed (e.g. {apps: [], eventTypes: []} from older versions).
    // Main is the typed-input thread; it should NEVER receive
    // auto-routed events.  This is the right default for the
    // canonical 'main' thread.
    let migratedFilter = (t0.id === 'main') ? { not: {} } : t0.filter;
    const created = store.createThread({
      id:          t0.id,
      name:        t0.name,
      filter:      migratedFilter,
      permissions: t0.permissions,
    });
    created.createdAt = t0.createdAt;
    // v0.7.P1-followup — strip auto-routed event bubbles that
    // polluted Main when its filter was permissive.  We keep
    // user-typed messages + dispatch replies; drop shell-text
    // notifications that came from the EventRouter delivery path
    // (these are still in /logs).  Heuristic: shell-rendered
    // text messages whose messageId starts with 'notif-' came
    // from the EventRouter (per events.js #appendNotificationTo).
    created.messages = (t0.messages ?? []).filter((m) =>
      !(m.origin === 'shell'
        && typeof m.messageId === 'string'
        && m.messageId.startsWith('notif-'))
    );
    for (const [opId, listing] of t0._listings) {
      created._listings.set(opId, listing);
    }
  }
} else {
  store = createDefaultThreadStore();
  // Seed an extra "Household alerts" thread for the J8 demo (only
  // on fresh install — existing users keep their layout).
  store.createThread({
    id:     'household-alerts',
    name:   'Household alerts',
    filter: { apps: ['household'], eventTypes: ['item-changed', 'notification'] },
    permissions: { allowCommands: true },
  });
}

// Persist future changes asynchronously.
attachPersistence({ threadStore: store, idb });

const router = createEventRouter({ threadStore: store });
// v0.7.7 — wire the agent's publishEvent so real mutations route
// through the EventRouter.  Each event gets a fresh id; ts auto-set
// by the router's normaliseEvent.
publishEventRef = (event) => {
  const enriched = {
    id: `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    ts: Date.now(),
    ...event,
  };
  router.deliver(enriched);
};

// v0.6.2 — external-flow callback handler.  When the deep-link
// receiver fires (or the EventRouter wakes us via a delivered event),
// resume the thread with a confirmation message.  Real OIDC binding
// would also exchange the code for a session here; the mock returns
// a deterministic fake webid.
async function onSigninCallback(flow, params) {
  const t0 = store.getThread(flow.threadId);
  if (!t0) return;
  await dropFlow(flow.sessionId);
  const errored = params?.error ?? params?.code === undefined;
  const text = errored
    ? t('signin.failed',    { reason: params?.error ?? 'no code returned' })
    : t('signin.completed', { webid:  `webid:mock-${flow.sessionId.slice(-6)}` });
  t0.addShellMessage({
    kind:           'text',
    messageId:      `signin-cb-${flow.sessionId}`,
    threadId:       flow.threadId,
    lifecycleState: 'live',
    text,
  });
  if (typeof renderActiveStream === 'function') renderActiveStream();
}

await initLocalisation({ lng: detectDeviceLang() });
updateLangButtons();

// v0.5.1 — local actor identity for embed issuance.  Real
// identity wiring lands in v0.6 with the OIDC sign-in flow (J6);
// v0.5.x uses a stable demo webid so the [Claim] button correctly
// hides when the local user is the issuer.
const LOCAL_ACTOR = 'webid:local-demo-user';

// v0.5.6 — simulated cross-peer demo.  A second thread + identity
// representing "Anne" — lets /send-to anne route an embed to Anne's
// thread without real network.  Real cross-peer delivery rides on
// each hosting app's chat surface (per v0.5.3 audit).
const SIM_ANNE_THREAD_ID = 'sim-anne';
const SIM_ANNE_WEBID     = 'webid:anne';

if (!store.getThread(SIM_ANNE_THREAD_ID)) {
  store.createThread({
    id:          SIM_ANNE_THREAD_ID,
    name:        "Anne's view (simulated)",
    filter:      { actors: [SIM_ANNE_WEBID] },
    permissions: { allowCommands: false },   // read-only thread — represents Anne's chat
  });
}

const SIM_PEERS = {
  anne: { threadId: SIM_ANNE_THREAD_ID, webid: SIM_ANNE_WEBID },
};

// v0.7.12 — multi-pod RSVP coordination (simulated for the demo).
// When calendar.addEvent has attendees, the calendar app calls this
// to dispatch an invite-card to each attendee's thread.  Receivers
// RSVP via the embed's [Accept]/[Decline]/[Tentative] buttons
// (manifest-driven since v0.7.13).  Responses broadcast back via
// the calendar's rsvp* skills (which publishEvent → the organiser's
// open record panels reactively refresh per v0.6.3).
//
// In real cross-pod work this becomes:
//   - lookup attendee's chat surface (stoop's chat-p2p or notifier
//     push to their webid)
//   - send the invite envelope across the wire
//   - the attendee's calendar receives, persists their copy + opens
//     a chat thread with the invite-card
//
// Demo: attendee=webid → simPeer thread lookup; append embed-card
// directly to their thread.
async function inviteAttendee(webid, snapshot) {
  // Map webid → simPeer entry.  webid:anne → anne, etc.
  const peerName = webid.replace(/^webid:/, '');
  const peer     = SIM_PEERS[peerName];
  if (!peer) return;     // unknown attendee; demo can't reach them
  const dest = store.getThread(peer.threadId);
  if (!dest) return;
  dest.addShellMessage({
    kind:           'embed-card',
    messageId:      `invite-${snapshot.id}-${peerName}`,
    threadId:       peer.threadId,
    lifecycleState: 'live',
    embed: {
      kind:      'time-card',
      appOrigin: 'calendar',
      itemRef:   { app: 'calendar', type: 'calendar-event', id: snapshot.id },
      snapshot,
      issuedBy:  LOCAL_ACTOR,   // sender is the organiser (us)
    },
  });
}
// Wire it once the agent exists.  Done immediately below (the agent
// is already constructed above this block).
if (typeof agent.setInviteAttendee === 'function') {
  agent.setInviteAttendee(inviteAttendee);
}

// v0.7.P3b — connect NKN cross-peer transport.  Triggers async,
// non-blocking; takes 5-90s on first connect.  On success the user
// can /me to see their NKN address + /test-peer <addr> [text] to
// send a ping.  Inbound messages render as text bubbles in Main.
async function connectPeerImpl() {
  // v0.7.P3b — try to detect what's happening if the CDN didn't
  // load.  nkn-sdk sets window.nkn (UMD default).  Some builds set
  // it as 'nknSdk' or similar — try a few candidates before failing.
  const nknLib =
       (typeof window !== 'undefined' && window.nkn)
    ?? (typeof globalThis !== 'undefined' && globalThis.nkn)
    ?? null;
  if (!nknLib) {
    const loadError = (typeof window !== 'undefined') ? window.__cc_nkn_load_error : null;
    const loaded    = (typeof window !== 'undefined') ? window.__cc_nkn_loaded     : null;
    const hint = loadError
      ? `CDN load failed (${loadError}).  Check network + CSP.`
      : loaded
        ? 'CDN script loaded but did not set window.nkn — check the version pinned in index.html.'
        : 'CDN script not loaded yet.  Wait a moment + retry /peer-connect, or check network.';
    throw new Error(`nkn-sdk not available.  ${hint}`);
  }
  if (typeof agent.connectPeerTransport !== 'function') {
    throw new Error('Peer transport not supported by this agent build.');
  }
  return agent.connectPeerTransport({
    nknLib,
    onPeerMessage: ({ from, payload }) => {
      console.info('[peer] received from', from, payload);

      // v0.7.P3c — subtype-aware dispatch.  Three known types:
      //   'chat-message'     → plain text bubble (P3b)
      //   'calendar-invite'  → time-card embed in Main + add to
      //                        local calendar with _organiserNkn
      //   'calendar-rsvp'    → update local event's rsvp field
      const subtype = payload?.subtype;

      if (subtype === 'calendar-invite' && payload?.event) {
        handleCalendarInvite(from, payload).catch((err) =>
          console.error('[peer] calendar-invite failed', err));
        return;
      }
      if (subtype === 'calendar-rsvp' && payload?.eventId) {
        handleCalendarRsvp(from, payload).catch((err) =>
          console.error('[peer] calendar-rsvp failed', err));
        return;
      }

      // Default: plain chat message → bubble in Main.
      const body = (payload && typeof payload === 'object' && typeof payload.body === 'string')
        ? payload.body
        : JSON.stringify(payload);
      const main = store.getThread('main') ?? store.getActiveThread();
      if (main) {
        const rendered = renderReply({
          payload: `📨 from ${from.slice(0, 16)}…: ${body}`,
          shape:   'text',
          threadId: main.id,
        }, { t });
        main.addShellMessage(rendered);
        if (store.getActiveThread()?.id === main.id) renderActiveStream();
      } else {
        console.warn('[peer] no Main thread to deliver to — dropped:', body);
      }
      publishEventRef({
        app:     'canopy-chat',
        type:    'notification',
        actor:   from,
        payload: { message: `📨 peer message: ${body}` },
      });
    },
  });
}

/**
 * v0.7.P3c — handle incoming 'calendar-invite' envelope.
 *
 * Adds the event to the LOCAL calendar (same id as organiser; stores
 * organiser's NKN address in _organiserNkn so a later RSVP knows
 * where to reply).  Then synthesises a time-card embed in Main so
 * the user sees [Accept]/[Decline]/[Tentative] buttons.
 */
async function handleCalendarInvite(fromNknAddr, payload) {
  const event = payload.event;
  if (!event?.id || !event?.title || !event?.startsAt) {
    console.warn('[peer] calendar-invite missing fields', payload);
    return;
  }
  // Persist locally via calendar.addEvent.  Pass the explicit id +
  // _organiserNkn so the receiver's calendar stays in sync with the
  // organiser's view + the RSVP knows where to dispatch.
  try {
    await callSkill('calendar', 'addEvent', {
      id:           event.id,
      title:        event.title,
      when:         event.startsAt,
      until:        event.endsAt,
      location:     event.location,
      attendees:    event.attendees ?? [],
      organiser:    event.organiser ?? fromNknAddr,
      _organiserNkn: fromNknAddr,
    });
  } catch (err) {
    console.error('[peer] failed to ingest invite locally', err);
    return;
  }
  // Render time-card embed in Main so the user sees the invitation.
  const main = store.getThread('main');
  if (!main) return;
  main.addShellMessage({
    kind:           'embed-card',
    messageId:      `invite-${event.id}`,
    threadId:       main.id,
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
          organiser: event.organiser ?? fromNknAddr,
          ...(event.attendees?.length ? { attendees: event.attendees.join(', ') } : {}),
        },
      },
      issuedBy:  fromNknAddr,
    },
  });
  if (store.getActiveThread()?.id === main.id) renderActiveStream();
  publishEventRef({
    app:     'calendar',
    type:    'notification',
    actor:   fromNknAddr,
    payload: { message: `📅 calendar invite: ${event.title}` },
  });
}

/**
 * v0.7.P3c — handle incoming 'calendar-rsvp' envelope.
 *
 * Looks up the local event by id; applies the response via the
 * existing rsvp* skills.  Publishes a notification so /logs +
 * matching threads see the RSVP.
 */
async function handleCalendarRsvp(fromNknAddr, payload) {
  const { eventId, response } = payload;
  if (!eventId || !['accepted', 'declined', 'tentative'].includes(response)) {
    console.warn('[peer] calendar-rsvp invalid', payload);
    return;
  }
  const skillName = {
    accepted:  'rsvpAccept',
    declined:  'rsvpDecline',
    tentative: 'rsvpTentative',
  }[response];
  // Use the peer's NKN address as the actor key so the rsvp map
  // distinguishes attendees.
  try {
    await callSkill('calendar', skillName, { id: eventId, actor: fromNknAddr });
  } catch (err) {
    console.error('[peer] failed to apply RSVP locally', err);
    return;
  }
  publishEventRef({
    app:     'calendar',
    type:    'notification',
    actor:   fromNknAddr,
    payload: { message: `📅 RSVP ${response} from ${fromNknAddr.slice(0, 16)}…` },
  });
}

// v0.7.P3b-followup 2026-05-23: NKN auto-connect moved to AFTER the
// eventLog is attached (below) so the '🔗 NKN connected' event is
// captured in /logs.  Previously this block fired here + the
// async then() ran BEFORE eventLog.attachToRouter — events were
// published but eventLog hadn't subscribed yet → lost from /logs.
// Search for the deferred call near the eventLog wiring.

// v0.7.P1 — real Solid OIDC boot.  After the user returns from the
// pod issuer's auth page, the URL carries `?code=...&state=...&iss=...`
// and the issuer expects us to call handleIncomingRedirect() so the
// Inrupt lib completes the round-trip.  Result: an authenticated
// session that subsequent skills (and the future pod-attach in
// v0.7.P2) can read.
//
// Fire-and-forget — boot continues whether or not a session restores.
// v0.7.P3c diagnostic — log the redirect outcome to console so we
// can see what's happening when /whoami stays 'not signed in' even
// after a successful trip to the issuer (esp. for solidcommunity).
podAuth.handleRedirect({ restorePreviousSession: true })
  .then((session) => {
    if (typeof podAuth.getRawSessionInfo === 'function') {
      const raw = podAuth.getRawSessionInfo();
      console.info('[podAuth] handleRedirect resolved.  Raw session:', raw);
    }
    if (!session) {
      console.info('[podAuth] no logged-in session restored (use /whoami for state).');
      return;
    }
    // Strip the OIDC redirect params from the URL so a refresh
    // doesn't try to handle the same redirect again.
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      const url = new URL(window.location.href);
      ['code', 'state', 'iss'].forEach((k) => url.searchParams.delete(k));
      window.history.replaceState({}, document.title, url.toString());
    }
    // v0.7.P2 + P2.2 — wire the pod writer into calendar so the .ics
    // feed write-throughs to <pod>/canopy/calendar/feed.ics.
    //
    // P2.2: discover the user's REAL pod root via the pim:storage
    // triple in their WebID document (Inrupt-style providers serve
    // the WebID on id.inrupt.com but the actual storage lives at
    // storage.inrupt.com/<uuid>/; the URL-only heuristic returned
    // the wrong path → all writes 404'd).  Discovery is async +
    // best-effort; if it fails we fall back to the URL heuristic.
    if (typeof agent.setCalendarPodWriter === 'function') {
      (async () => {
        try {
          let podRoot;
          try {
            podRoot = await discoverPodRoot(session);
          } catch (err) {
            console.warn('[podAuth] discoverPodRoot failed; falling back to URL heuristic', err);
          }
          const writer = createPodWriter(session, podRoot ? { podRoot } : {});
          agent.setCalendarPodWriter(writer);
          // Surface the discovered pod root in the chat so the user
          // immediately knows where their data lives.
          publishEventRef({
            app:     'canopy-chat',
            type:    'notification',
            actor:   session.webid,
            payload: { message: `Pod root: ${writer.podRoot}` },
          });
        } catch (err) {
          console.warn('[podAuth] failed to wire calendar pod writer', err);
        }
      })();
    }
    // Surface the welcome in the Main thread.
    const main = store.getThread('main');
    if (main) {
      const rendered = renderReply({
        payload: t('signin.welcome', { webid: session.webid }),
        shape:   'text', threadId: main.id,
      }, { t });
      main.addShellMessage(rendered);
      if (store.getActiveThread()?.id === main.id) renderActiveStream();
    }
    // Also publish into the EventRouter so /logs records it.
    publishEventRef({
      app:     'canopy-chat',
      type:    'notification',
      actor:   session.webid,
      payload: { message: `Signed in as ${session.webid}` },
    });
    // Refresh the sidebar so the new identity chip can render.
    renderSidebarHere?.();
  })
  .catch((err) => {
    console.error('[podAuth] handleRedirect failed', err);
  });

// v0.6.2 — external-flow wiring.  In-flight state persists to IDB's
// 'cc-in-flight-flows' object store.  The mock sign-in URL is
// canopy-chat's own page with a query param that auto-triggers the
// callback after a short delay (so the demo round-trip works
// without a real OIDC provider).
const IN_FLIGHT_IDB_KEY = 'cc-in-flight-flows';
async function persistFlow(flow) {
  // Read-modify-write the in-flight list in IDB.
  const all = await idb.loadInFlight().catch(() => []);
  const next = [...all.filter((f) => f.sessionId !== flow.sessionId), flow];
  await idb.saveInFlight(next);
}
async function dropFlow(sessionId) {
  const all = await idb.loadInFlight().catch(() => []);
  await idb.saveInFlight(all.filter((f) => f.sessionId !== sessionId));
}

// Mock sign-in URL — reuses canopy-chat's own page with ?mock-oidc=1
// + the session id; the deep-link receiver fires the callback when
// the URL has cc-callback=<sessionId>.  In real OIDC, this becomes
// the issuer's authorization endpoint.
function mockSigninUrl(sessionId) {
  const here = globalThis.location?.origin ?? 'http://localhost:5173';
  return `${here}/?mock-oidc=1&cc-callback=${encodeURIComponent(sessionId)}`;
}

// v0.7 — /brief aggregator cache (60s TTL per OQ-7.A).
const briefCache = createBriefCache();

// v0.7.1c — log-panel toggle.  /logs opens the side-panel; clicking
// [×] closes it.  EventLog subscribers re-render on every appended
// event so the panel stays live.
function openLogsPanel() {
  logsPanelEl.hidden = false;
  logsPanelEl.classList.remove('cc-logs-closed');
  logsPanelEl.classList.add('cc-logs-open');
  renderLogsPanel(logsPanelEl, {
    doc: document,
    eventLog,
    onClose: () => {
      logsPanelEl.hidden = true;
      logsPanelEl.classList.remove('cc-logs-open');
      logsPanelEl.classList.add('cc-logs-closed');
    },
    onViewContext: (itemRef) => {
      const t0 = activeThread();
      if (!t0) return;
      // Demo only: append a text bubble describing the item ref.
      // Future: navigate to the item's mini-page via /embed-like
      // lookup if a Q29 cardSnapshotSkill is declared.
      const rendered = renderReply({
        payload: `→ ${itemRef.app}.${itemRef.type}.${itemRef.id} (context navigation lands when item-pages exist)`,
        shape:   'text', threadId: t0.id,
      }, { t });
      t0.addShellMessage(rendered);
      renderActiveStream();
    },
    onMute: () => { /* eventLog handles + re-renders via the panel itself */ },
    onOpenInChat: (event) => {
      // Find a thread whose filter matches the event's app+type;
      // if one exists, switch to it.  Otherwise create one.
      const threads = store.listThreads();
      const match = threads.find((th) => {
        const apps  = th.filter?.apps      ?? [];
        const types = th.filter?.eventTypes ?? [];
        return (apps.includes(event.app)  || apps.includes('*')  || apps.length === 0)
            && (types.includes(event.type) || types.includes('*') || types.length === 0);
      });
      if (match) {
        store.setActiveThread(match.id);
      } else {
        const created = store.createThread({
          name:        `${event.app} alerts`,
          filter:      { apps: [event.app], eventTypes: [event.type] },
          permissions: { allowCommands: true },
        });
        store.setActiveThread(created.id);
      }
      logsPanelEl.hidden = true;
      logsPanelEl.classList.remove('cc-logs-open');
      logsPanelEl.classList.add('cc-logs-closed');
    },
  });
}

// Re-render the logs panel when new events arrive (so the live
// stream updates without needing to re-type /logs).
let logsPanelDirty = null;
function scheduleLogsPanelRerender() {
  if (logsPanelEl.hidden) return;
  if (logsPanelDirty) return;
  logsPanelDirty = setTimeout(() => {
    logsPanelDirty = null;
    if (!logsPanelEl.hidden) openLogsPanel();   // rerender
  }, 100);
}

// v0.7.1 — network-events log (D.1).  Hydrates from IndexedDB; prunes
// 14-day cutoff on boot (per OQ-7.B); attaches to the EventRouter so
// every delivered event flows in automatically.
const persistedEvents = await idb.loadEvents().catch(() => []);
const persistedMuted  = await idb.loadMutedEvents().catch(() => []);
// Prune on boot for speed (avoids scanning the whole log in JS).
await idb.pruneEventsBefore(Date.now() - RETENTION_MS).catch(() => {});
const eventLog = new EventLog({
  initial: persistedEvents,
  muted:   persistedMuted,
  persist: (events) => idb.saveEvents(events),
});
eventLog.setMutedPersistor((muted) => idb.saveMutedEvents(muted));
eventLog.attachToRouter(router);
// Live-rerender the logs panel when new events flow in.
eventLog.subscribe(() => scheduleLogsPanelRerender());

// v0.7.P3b-followup — NKN auto-connect, now AFTER eventLog is
// wired so the connect notification + every inbound peer message
// reliably hits /logs.
if (typeof window !== 'undefined' && window.nkn) {
  connectPeerImpl()
    .then((ctrl) => {
      console.info('[peer] connected, NKN address:', ctrl.address);
      publishEventRef({
        app: 'canopy-chat', type: 'notification',
        payload: { message: `🔗 NKN connected: ${ctrl.address}` },
      });
    })
    .catch((err) => {
      console.warn('[peer] NKN connect failed:', err.message);
    });
}

// callSkill is declared further down; createLocalBuiltins needs it
// for the /embed factory.  Forward-declared variable + helper.
let callSkillRef;
// Pass `catalog` as a getter so /apps and /help always see the
// CURRENT filtered catalog (re-derived when appRegistry changes).
const localBuiltins = createLocalBuiltins({
  // Builtins receive the current rawCatalog for app listing; opsById
  // / commandMenu are read at call time on the filtered catalog via
  // the dispatch path.  /apps surfaces both enabled AND disabled
  // apps (so the user can re-enable).
  catalog: rawCatalog,
  t,
  threadStore: store,
  setActive:   (id) => store.setActiveThread(id),
  callSkill:   (appOrigin, opId, args) => callSkillRef(appOrigin, opId, args),
  localActor:  LOCAL_ACTOR,
  simPeers:    SIM_PEERS,
  appRegistry,
  eventLog,
  briefRunner: (opts) => runBrief({ catalog, callSkill, cache: briefCache, bypassCache: opts?.bypassCache }),
  findRunner:  (opts) => runFind({ catalog, callSkill, query: opts?.query }),
  openLogsPanel: () => openLogsPanel(),
  // v0.7.13 — browser File API picker for /embed-file --pick.  Opens
  // a hidden <input type="file"> programmatically + resolves with the
  // selected File (or null if the user cancels).
  openFilePicker: () => new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    let settled = false;
    inp.addEventListener('change', () => {
      if (settled) return;
      settled = true;
      const file = inp.files?.[0] ?? null;
      document.body.removeChild(inp);
      resolve(file);
    });
    // Some browsers fire focus when the dialog closes via Cancel +
    // never fire change.  Use focus as a fallback to resolve(null).
    setTimeout(() => {
      window.addEventListener('focus', () => {
        setTimeout(() => {
          if (settled) return;
          settled = true;
          if (inp.parentNode) document.body.removeChild(inp);
          resolve(null);
        }, 300);
      }, { once: true });
    }, 0);
    inp.click();
  }),
  // v0.7.P1 — real Inrupt browser OIDC for /signin + /whoami + /signout.
  // podAuth.* delegates to @inrupt/solid-client-authn-browser; the
  // signinFlow handler in localBuiltins prefers podAuth.startSignIn
  // over the mock externalFlow when both are available.
  podAuth,
  // v0.7.P2 — when the user signs out, unwire the calendar pod
  // writer so subsequent mutations no longer hit the now-stale
  // session.fetch + go local-only.
  onSignOut: () => {
    if (typeof agent.setCalendarPodWriter === 'function') {
      agent.setCalendarPodWriter(null);
    }
  },
  // v0.7.P3a — expose the persistent agent identity (chat-side
  // pubKey + stableId) to handlers like /me.
  agent,
  // v0.7.P3b — connect the NKN peer transport.  Called by /peer-
  // connect builtin or auto-fired on sign-in (below).  When
  // window.nkn is missing (CDN not loaded yet), returns rejected
  // promise.
  connectPeer: () => connectPeerImpl(),
  externalFlow: {
    /**
     * Open a sign-in flow.  Persists in-flight state + navigates to
     * the (mock) external page.  When the user returns via the
     * callback URL, the deep-link receiver below fires `onCallback`
     * which resumes the chat thread.
     */
    async open({ issuer }) {
      const active = store.activeThread;
      if (!active) throw new Error('no active thread');
      await openExternalFlow({
        url:        mockSigninUrl('{sessionId}'),
        threadId:   active.id,
        opId:       'signin',
        prefilledArgs: issuer ? { issuer } : undefined,
        purpose:    'oidc-signin',
        eventRouter: router,
        onCallback: onSigninCallback,
        persistFlow,
      });
    },
  },
});

const callSkill = async (appOrigin, opId, args) => {
  if (appOrigin === 'canopy-chat') {
    const handler = localBuiltins[opId];
    if (!handler) throw new Error(`No local handler for canopy-chat.${opId}`);
    return handler(args ?? {});
  }
  // v0.7.2/3/4 — all 4 apps now run as real skills on the same
  // host agent.  Skill ids are flat (no collisions in the v0.7 demo);
  // briefSummary ids are app-scoped (tasks_briefSummary etc) to
  // avoid the Q30 fan-out hitting the wrong one.
  if (appOrigin === 'household') {
    return agent.callSkill(appOrigin, opId, args);
  }
  if (appOrigin === 'tasks-v0') {
    // tasks-v0's brief skill is registered as 'tasks_briefSummary'.
    const realOp = opId === 'briefSummary' ? 'tasks_briefSummary' : opId;
    return agent.callSkill('household', realOp, args);
  }
  if (appOrigin === 'stoop') {
    const realOp = opId === 'briefSummary' ? 'stoop_briefSummary' : opId;
    return agent.callSkill('household', realOp, args);
  }
  if (appOrigin === 'folio') {
    const realOp = opId === 'briefSummary' ? 'folio_briefSummary' : opId;
    return agent.callSkill('household', realOp, args);
  }
  if (appOrigin === 'calendar') {
    // Calendar skills are registered with the 'calendar_' prefix on
    // the host agent (per v0.7.10 multi-app collision-avoidance).
    const result = await agent.callSkill('household', `calendar_${opId}`, args);

    // v0.7.P3c — cross-peer side-effects.
    //
    // (a) addEvent with attendees-nkn → dispatch invite envelopes
    //     to each NKN address.
    // (b) rsvp* with success on an event that has _organiserNkn →
    //     dispatch rsvp envelope back to the organiser.
    try {
      if (opId === 'addEvent' && result?.ok && args['attendees-nkn']) {
        const targets = String(args['attendees-nkn']).split(/[,\s]+/)
          .map((s) => s.trim()).filter(Boolean);
        if (targets.length > 0 && agent.peer?.status === 'connected') {
          // Pull the event back for the snapshot.
          const snapshot = await agent.callSkill('household',
            'calendar_getEventSnapshot', { id: result.itemId });
          if (snapshot?.id) {
            for (const t of targets) {
              try {
                await agent.sendPeerMessage(t, {
                  type:    'p2p-chat',
                  subtype: 'calendar-invite',
                  event: {
                    id:        snapshot.id,
                    title:     snapshot.title,
                    startsAt:  snapshot.startAt,
                    endsAt:    snapshot.endAt,
                    location:  snapshot.location,
                    attendees: snapshot.fields?.attendees ? snapshot.fields.attendees.split(/,\s*/) : [],
                    organiser: snapshot.fields?.organiser,
                  },
                  sentAt: Date.now(),
                });
                publishEventRef({
                  app: 'calendar', type: 'notification',
                  payload: { message: `📤 invite sent to ${t.slice(0, 16)}…` },
                });
              } catch (err) {
                console.error('[peer] invite send failed', t, err);
                publishEventRef({
                  app: 'calendar', type: 'notification',
                  payload: { message: `❌ invite send failed: ${err.message ?? err}` },
                });
              }
            }
          }
        }
      }
      if (
        (opId === 'rsvpAccept' || opId === 'rsvpDecline' || opId === 'rsvpTentative')
        && result?.ok && args?.id
        && agent.peer?.status === 'connected'
      ) {
        // Find the event's _organiserNkn via the snapshot path.
        // (Snapshot doesn't expose it directly; for v0.7.P3c we
        // route by inspecting whichever the local store knows.
        // Workaround: in the receiver-side flow, args.actor was set
        // to the organiser's NKN address on ingest — so when this
        // user RSVPs, the snapshot's organiser is the organiser's
        // NKN address.)
        const snapshot = await agent.callSkill('household',
          'calendar_getEventSnapshot', { id: args.id });
        const organiser = snapshot?.fields?.organiser;
        if (organiser && organiser.startsWith && !organiser.startsWith('webid:')) {
          // Looks like an NKN address (not a webid).  Send RSVP.
          const response = opId === 'rsvpAccept'  ? 'accepted'
                          : opId === 'rsvpDecline' ? 'declined'
                          : 'tentative';
          try {
            await agent.sendPeerMessage(organiser, {
              type:    'p2p-chat',
              subtype: 'calendar-rsvp',
              eventId: args.id,
              response,
              sentAt:  Date.now(),
            });
            publishEventRef({
              app: 'calendar', type: 'notification',
              payload: { message: `📤 RSVP ${response} sent to ${organiser.slice(0, 16)}…` },
            });
          } catch (err) {
            console.error('[peer] RSVP send failed', err);
          }
        }
      }
      // v0.7.P3c-followup — propagate cancellations to peers.
      // When the organiser cancels an event with attendees-nkn, send
      // a 'calendar-cancelled' envelope to each so they see the
      // event drop from THEIR /upcoming too.
      if (opId === 'cancelEvent' && result?.ok && args?.id
          && agent.peer?.status === 'connected') {
        // Look up the (now-cancelled) event for its attendees-nkn list.
        // CalendarStore stores _attendeesNkn iff we stash them at
        // addEvent time.  v0.7.P3c-followup adds that stash; until
        // then attendees-nkn isn't recoverable post-cancel, so this
        // branch is a no-op until the data carries forward.
        // Reactive path TBD; this scaffolding emits the publishEvent
        // for /logs visibility.
        publishEventRef({
          app: 'calendar', type: 'notification',
          payload: { message: `🚫 Cancelled locally; peer notification deferred to v0.7.P3c+` },
        });
      }
    } catch (err) {
      console.warn('[peer] calendar cross-peer side-effect failed', err);
    }

    return result;
  }
  return { ok: false, error: `${appOrigin}.${opId} not wired in this demo build` };
};
callSkillRef = callSkill;

/* ── render orchestration ──────────────────────────────── */

function activeThread() { return store.getActiveThread(); }

function renderAll() {
  renderSidebarHere();
  renderActiveHeader();
  renderActiveStream();
}

function renderSidebarHere() {
  renderSidebar(sidebarEl, {
    doc:      document,
    store,
    onSelect: (id) => { store.setActiveThread(id); },
    t,
  });
}

function renderActiveHeader() {
  const t0 = activeThread();
  if (!t0) {
    headerNameEl.textContent = '';
    headerFilterEl.textContent = '';
    return;
  }
  headerNameEl.textContent = t0.name;
  const filterText = describeFilter(t0.filter);
  headerFilterEl.textContent = filterText === '*' ? '' : `(${filterText})`;
}

function renderActiveStream() {
  const t0 = activeThread();
  if (!t0) {
    while (messagesEl.firstChild) messagesEl.removeChild(messagesEl.firstChild);
    return;
  }
  renderStream(messagesEl, t0.messages, makeCtx());
}

function makeCtx() {
  return {
    doc: document,
    localActor: LOCAL_ACTOR,
    manifestsByOrigin,
    onButtonTap,
    onCloseMessage: (messageId) => {
      const t0 = activeThread();
      if (!t0) return;
      t0.closeMessage(messageId);
      renderActiveStream();
    },
    onClaimEmbed: (messageId) => {
      // v0.5.1 — receiver-claim path.  Find the message, claim its
      // embed in-place, re-render.  The claim is local-state only in
      // v0.5.x; real cross-peer claim propagation rides on the
      // hosting chat substrate (stoop's chat-p2p, etc.) and is
      // app-side work (deferred per v0.5.3 audit).
      const t0 = activeThread();
      if (!t0) return;
      const msg = t0.messages.find((m) => m.messageId === messageId);
      if (!msg?.rendered?.embed) return;
      msg.rendered.embed = claimEmbed(msg.rendered.embed, LOCAL_ACTOR);
      renderActiveStream();
    },
    onFollowUp: async (entry) => {
      // v0.4 — clicking a follow-up button dispatches it as if the
      // user had typed the slash with the prefilled args.
      const t0 = activeThread();
      if (!t0) return;
      const parse = {
        kind: 'slash', opId: entry.opId, args: entry.prefilledArgs ?? {},
        threadId: t0.id, command: '(followup)', body: '',
      };
      const route = resolveDispatch(parse, catalog);
      // If args are missing, the form gate kicks in — that's correct UX.
      if (route.kind === 'needsForm') {
        await handleUserText(`/${entry.opId}`, t0);
        return;
      }
      if (route.kind !== 'ready') return;
      await dispatchAndRender(route, t0);
    },
  };
}

/* ── greeting on the Main thread ───────────────────────── */

// v0.7 defensive — `store.getThread('main')` returns undefined when
// the user previously deleted the Main thread (the workspace can
// have any combination of threads now that /newthread + sidebar
// delete exist).  Show the greeting on Main when it exists AND
// is empty; otherwise skip silently — the user already has chat
// history and doesn't need the welcome message.
{
  const main = store.getThread('main');
  if (main && main.messages.length === 0) {
    const greeting = renderReply({
      payload: 'Welcome to canopy-chat (v0.2). Try /help. Create more threads via the sidebar.',
      shape:   'text',
      threadId: main.id,
    }, { t });
    main.addShellMessage(greeting);
  }
}

renderAll();

/* ── subscriptions ─────────────────────────────────────── */

store.subscribe(() => {
  // ThreadStore changes (create/delete/update/active) → re-render
  // sidebar + the active thread's stream + header.
  renderAll();
});

router.onRouted(() => {
  // An event was delivered to ≥0 threads.  Cheapest correct move:
  // re-render the active thread (the matched threads' state is
  // already in store — just the visible one needs refresh).
  renderActiveStream();
});

/* ── input handler ─────────────────────────────────────── */

// v0.7 catch-up — terminal-style command history.  Up/down arrows
// cycle through previous user messages.  Stored in-memory only;
// each thread's full history is in t0.messages anyway.
const inputHistory = [];
let   inputHistoryIdx = -1;
let   inputPendingDraft = '';

inputEl.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  if (inputHistory.length === 0) return;
  // Only cycle when the caret is at start/end of input — preserves
  // multi-line editing if a future input ever uses textarea.
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (inputHistoryIdx === -1) {
      // First press — save the current draft so we can restore it.
      inputPendingDraft = inputEl.value;
      inputHistoryIdx = inputHistory.length - 1;
    } else if (inputHistoryIdx > 0) {
      inputHistoryIdx -= 1;
    }
    inputEl.value = inputHistory[inputHistoryIdx];
    // Move cursor to end for predictable edit behaviour.
    setTimeout(() => inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length), 0);
  } else if (e.key === 'ArrowDown') {
    if (inputHistoryIdx === -1) return;
    e.preventDefault();
    if (inputHistoryIdx < inputHistory.length - 1) {
      inputHistoryIdx += 1;
      inputEl.value = inputHistory[inputHistoryIdx];
    } else {
      // Past the newest — restore the draft.
      inputHistoryIdx = -1;
      inputEl.value = inputPendingDraft;
    }
  }
});

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  // Append to history (de-dup against the last entry; same as bash).
  if (inputHistory[inputHistory.length - 1] !== text) inputHistory.push(text);
  // Cap history at 200 entries.
  if (inputHistory.length > 200) inputHistory.shift();
  inputHistoryIdx = -1;
  inputPendingDraft = '';

  inputEl.value = '';

  const t0 = activeThread();
  if (!t0) return;
  t0.addUserMessage(text);
  renderActiveStream();

  // Permission gate (v0.2: allowCommands)
  if (t0.permissions.allowCommands === false) {
    const rendered = renderReply({
      payload: 'This thread does not accept commands.',
      shape:   'text', threadId: t0.id,
    }, { t });
    t0.addShellMessage(rendered);
    renderActiveStream();
    return;
  }

  await handleUserText(text, t0);
});

/* ── language switch ───────────────────────────────────── */

langEnBtn.addEventListener('click', async () => { await setLang('en'); updateLangButtons(); renderAll(); });
langNlBtn.addEventListener('click', async () => { await setLang('nl'); updateLangButtons(); renderAll(); });

function updateLangButtons() {
  const cur = currentLang();
  langEnBtn.setAttribute('aria-current', cur === 'en' ? 'true' : 'false');
  langNlBtn.setAttribute('aria-current', cur === 'nl' ? 'true' : 'false');
}

/* ── core flow ─────────────────────────────────────────── */

async function handleUserText(text, thread) {
  const parse = parseInput(text, catalog, { threadId: thread.id });
  const route = resolveDispatch(parse, catalog);

  if (route.kind === 'unknown') {
    const rendered = renderReply({
      payload:  t('reply.unknown_command', { input: text }),
      shape:    'text', threadId: thread.id,
    }, { t });
    thread.addShellMessage(rendered);
    renderActiveStream();
    return;
  }

  if (route.kind === 'error') {
    const rendered = renderReply({
      payload: null, shape: 'text', threadId: thread.id,
      error:   { code: route.code, message: route.message },
    }, { t });
    thread.addShellMessage(rendered);
    renderActiveStream();
    return;
  }

  if (route.kind === 'needsForm') {
    // v0.3.0 — render an inline form; on submit, retry dispatch.
    const spec = buildFormSpec({
      opParams:      catalog.opsById.get(route.opId)?.op?.params ?? [],
      missing:       route.missing,
      prefilledArgs: route.prefilledArgs,
      opId:          route.opId,
      appOrigin:     route.appOrigin,
      threadId:      thread.id,
    });
    const formEl = renderForm(spec, {
      doc: document, t,
      // v0.7.Q34 — picker fetcher: when a field declares
      // pickerSource: { listOp, filter?, appOrigin? }, the form
      // renders a click-to-pick list.  We resolve the list-op via
      // callSkill — same dispatch path the user-typed /listOp would
      // take.  `decl.appOrigin` defaults to the op's appOrigin so
      // intra-app references work without extra wiring.
      pickerFetcher: async (decl) => {
        const appOrigin = decl.appOrigin ?? route.appOrigin;
        const reply = await callSkill(appOrigin, decl.listOp, decl.filter ?? {});
        const items = Array.isArray(reply?.items) ? reply.items : [];
        return items.map((it) => ({
          id:    String(it.id ?? ''),
          label: String(it.label ?? it.text ?? it.title ?? it.id ?? ''),
        }));
      },
      onSubmit: async (values) => {
        const v = validateAndCoerce(spec, values);
        if (!v.ok) {
          const errMsg = v.errors.map((e) => `${e.field}: ${e.message}`).join('; ');
          const errEl = renderReply({
            payload: null, shape: 'text', threadId: thread.id,
            error:   { code: 'form-invalid', message: errMsg },
          }, { t });
          thread.addShellMessage(errEl);
          renderActiveStream();
          return;
        }
        // Dispatch with the full args.
        const parse = {
          kind: 'slash', opId: route.opId, args: v.args,
          threadId: thread.id, command: '(form)', body: '',
        };
        const route2 = resolveDispatch(parse, catalog);
        if (route2.kind !== 'ready') {
          const errEl = renderReply({
            payload: `Form submission failed: ${route2.kind}`,
            shape: 'text', threadId: thread.id,
          }, { t });
          thread.addShellMessage(errEl);
          renderActiveStream();
          return;
        }
        await dispatchAndRender(route2, thread);
      },
      onCancel: () => {
        const cancelMsg = renderReply({
          payload: t('form.cancelled', { defaultValue: 'Form cancelled.' }),
          shape: 'text', threadId: thread.id,
        }, { t });
        thread.addShellMessage(cancelMsg);
        renderActiveStream();
      },
    });
    // Append the form DOM directly into the messages stream as a
    // shell-side "live" message.  We synthesise a thread message so
    // the thread.tail() and lifecycle machinery treat it like any
    // other shell reply.
    thread.addShellMessage({
      kind:           'form',
      messageId:      `form-${Date.now()}`,
      threadId:       thread.id,
      lifecycleState: 'live',
      formElement:    formEl,
      text:           `Form: ${route.opId}`,
    });
    // v0.7 catch-up — the renderer's new 'form' case returns
    // formElement directly (see domAdapter.renderFormShape), so the
    // earlier setTimeout patch is no longer needed.  Just rerender.
    renderActiveStream();
    return;
  }

  if (route.kind === 'needsConfirm') {
    const note = `This op needs confirmation (${route.severity}): ${route.message ?? ''} — confirm UX lands in v0.3+`;
    const rendered = renderReply({
      payload: note, shape: 'text', threadId: thread.id,
    }, { t });
    thread.addShellMessage(rendered);
    renderActiveStream();
    return;
  }

  // ready → dispatch + render + (maybe) emit item-changed event.
  await dispatchAndRender(route, thread);
}

async function dispatchAndRender(route, thread) {
  const reply = await runDispatch(route, callSkill);
  // v0.4 — when dispatch succeeded, look up follow-up suggestions
  // (per-op Q31 hints from the catalog + cross-app chains from the
  // static registry) and attach them to the reply so the renderer
  // surfaces them as buttons under the text.
  if (!reply.error) {
    const followUps = collectFollowUps(route.opId, route.appOrigin, reply.payload, catalog);
    if (followUps.length > 0) reply.followUps = followUps;
  }
  const rendered = renderReply(reply, {
    t,
    appOrigin:         route.appOrigin,
    manifestsByOrigin,
  });
  thread.addShellMessage(rendered, { opId: route.opId });

  // Mutation? Fan out per OQ-4 — every thread with a matching
  // filter sees an 'item-changed' event EXCEPT the thread the user
  // dispatched from (the mutation reply already appears there, so
  // a notification copy would duplicate).
  const op = catalog.opsById.get(route.opId)?.op;
  const isMutation = op?.verb && !['list', 'help'].includes(op.verb)
                   && !reply.error;
  if (isMutation && reply.payload) {
    router.deliver({
      app:     route.appOrigin,
      type:    'item-changed',
      payload: {
        message: typeof reply.payload.message === 'string'
          ? reply.payload.message
          : `${route.appOrigin}.${route.opId} completed`,
        op:      route.opId,
        result:  reply.payload,
      },
    }, { excludeThreadIds: [thread.id] });
  }

  renderActiveStream();
}

/* ── button tap handler ─────────────────────────────────── */

async function onButtonTap(opId, itemId, extra) {
  const t0 = activeThread();
  if (!t0) return;

  // v0.7 catch-up — demo-* stub ops fire from receiver-action buttons
  // on file/time cards (no backing app yet; tasks #111/#112).  Reply
  // is a placeholder text so the user sees the click registered.
  if (typeof opId === 'string' && opId.startsWith('demo-')) {
    const rendered = renderReply({
      payload: t('demo.stub', { op: opId, item: itemId }),
      shape:   'text', threadId: t0.id,
    }, { t });
    t0.addShellMessage(rendered);
    renderActiveStream();
    return;
  }

  const entry = catalog.opsById.get(opId);
  if (!entry) return;
  const firstReq = (entry.op.params ?? []).find(
    (p) => p?.required && (p.kind === 'string' || p.kind === 'enum'),
  );
  const args = firstReq ? { [firstReq.name]: itemId } : { id: itemId };
  const parse = {
    kind: 'slash', opId, args, threadId: t0.id,
    command: '(button)', body: itemId,
  };
  const route = resolveDispatch(parse, catalog);
  if (route.kind !== 'ready') return;
  await dispatchAndRender(route, t0);
}

/* ── v0.6.2 deep-link receiver — boot-time ──────────────── */

// On boot, check the URL for a callback fragment + load persisted
// in-flight flows.  resumeInFlightFlows fires the matching callback
// (if any) and re-registers the rest on the EventRouter so events
// arriving later still wake the right thread.
//
// For the demo: when the URL has ?mock-oidc=1, simulate the OIDC
// provider by setting cc-callback=<sessionId> in a separate tick
// so the receiver picks it up.  Real OIDC would have its own
// redirect machinery here.

(async function bootDeepLinkReceiver() {
  try {
    const persisted = await idb.loadInFlight().catch(() => []);
    const callback  = parseCallbackUrl(globalThis.location?.href ?? '');
    resumeInFlightFlows({
      persisted,
      eventRouter: router,
      onCallback:  onSigninCallback,
      callback,
    });
    if (callback) {
      // Clean up the URL so a future reload doesn't re-fire the
      // callback.  Use replaceState — no extra history entry.
      try {
        globalThis.history?.replaceState?.({}, '', globalThis.location.pathname);
      } catch { /* swallow */ }
      renderActiveStream();
    }
  } catch (err) {
    console.warn('canopy-chat: deep-link receiver failed', err);
  }
})();
