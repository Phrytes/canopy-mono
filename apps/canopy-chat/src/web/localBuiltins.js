/**
 * canopy-chat — chat-shell built-in skill handlers.
 *
 * Some ops declared on canopy-chat's own manifest (`/help` today,
 * `/brief` + `/threads` in later phases) don't dispatch to any
 * app agent.  They're handled LOCALLY by the chat shell: the
 * handler reads from the merged catalog + chat-shell state and
 * returns a regular skill payload.
 *
 * Pattern: pass `catalog` + `t` into `createLocalBuiltins`; the
 * returned object maps `(opId) → handler(args) → payload`.
 * `web/main.js` checks `appOrigin === 'canopy-chat'` in callSkill
 * and routes to one of these handlers; everything else goes to the
 * real agent.
 *
 * Phase v0.1+ — companion to the manifest definitions in
 * `apps/canopy-chat/manifest.js`.
 */

import { describeFilter }    from '../filter.js';
import { buildEmbed }        from '../embed.js';
import { openExternalFlow }  from '../externalFlow.js';

/**
 * Build the local-builtins dispatcher.
 *
 * @param {object} deps
 * @param {import('../manifestMerge.js').MergedCatalog} deps.catalog
 * @param {(key: string, params?: object) => string}   deps.t
 * @param {import('../threadStore.js').ThreadStore}    [deps.threadStore]
 *   Required for /newthread and /threads.
 * @param {(threadId: string) => void}                 [deps.setActive]
 *   Called by /newthread to switch active thread to the new one.
 * @param {(appOrigin: string, opId: string, args: object) => Promise<*>} [deps.callSkill]
 *   Required for /embed — fetches the snapshot via the catalog's
 *   Q29 declaration.
 * @returns {{[opId: string]: (args: object) => Promise<*>}}
 */
export function createLocalBuiltins({
  catalog, t, threadStore, setActive, callSkill, localActor,
  simPeers,                  // v0.5.6 — { '<peer>': { threadId, webid } }
  appRegistry,               // v0.6 OQ-4.B
  externalFlow,              // v0.6.2 — { open, getActiveThreadId, mockSigninUrl }
  briefRunner,               // v0.7 — () => Promise<BriefReply>
  eventLog,                  // v0.7.1 — EventLog instance
  openLogsPanel,             // v0.7.1c — () => void (opens side-panel)
  findRunner,                // v0.7.5 — ({query}) => Promise<FindReply>
  openFilePicker,            // v0.7.13 — () => Promise<File|null>
  podAuth,                   // v0.7.P1 — real Solid OIDC wrapper
}) {
  return {
    help: async () => formatHelp(catalog, t),
    newthread: async (args) => createNewThread(args, { threadStore, setActive, t }),
    threads:   async ()     => listThreads({ threadStore, t }),
    embed:     async (args) => createEmbed(args, { catalog, callSkill, t, localActor }),
    'embed-file': async (args) => createFileEmbed(args, { localActor, t, simPeers, threadStore, callSkill, openFilePicker }),
    'embed-time': async (args) => createTimeEmbed(args, { localActor, t, simPeers, threadStore, callSkill }),
    sendto:    async (args) => sendToPeer(args, {
      catalog, callSkill, t, localActor, simPeers, threadStore,
    }),
    apps:      async (args) => appsToggle(args, { catalog, appRegistry, t }),
    // v0.7.5 / v0.7.1c — also expose openLogsPanel reachable to
    // handlers (currently only used by /logs but reads well at this
    // layer).
    signin:    async (args) => signinFlow(args, { podAuth, externalFlow, t }),
    whoami:    async (args) => whoami(args, { podAuth, t }),
    signout:   async (args) => signOutFlow(args, { podAuth, t }),
    brief:     async (args) => runBriefBuiltin(args, { briefRunner, t }),
    logs:      async (args) => runLogsBuiltin(args, { eventLog, t, openLogsPanel }),
    find:      async (args) => runFindBuiltin(args, { findRunner, t }),
  };
}

async function runFindBuiltin(args, { findRunner, t }) {
  const q = String(args?.query ?? args?._match ?? '').trim();
  if (!q) return { ok: false, error: t('find.no_query') };
  if (typeof findRunner !== 'function') {
    return { ok: false, error: t('find.no_runner') };
  }
  return findRunner({ query: q });
}

/**
 * `/logs [--app=X] [--type=Y] [--actor=Z] [--since=ISO] [--mute=app:type] [--limit=N]`
 * v0.7.1 — list recent network events from the EventLog (14d retention).
 * `--mute` is a side-effect: adds the kind to the mute set + reports.
 */
async function runLogsBuiltin(args, { eventLog, t, openLogsPanel }) {
  if (!eventLog) return { ok: false, error: t('logs.no_log') };

  // v0.7.1c — bare /logs opens the side-panel; --inline reverts to
  // the v0.7.1b chat-inline list; --mute=app:type keeps working
  // either way.
  if (typeof args?.mute === 'string' && args.mute.includes(':')) {
    const [app, type] = args.mute.split(':', 2);
    eventLog.mute(app, type);
    return { ok: true, message: t('logs.muted', { app, type }) };
  }

  const hasFilterFlag =
       !!args?.app   || !!args?.type || !!args?.actor
    || !!args?.since || typeof args?.limit === 'number'
    || !!args?.inline;
  if (!hasFilterFlag && typeof openLogsPanel === 'function') {
    openLogsPanel();
    return { ok: true, message: t('logs.panel_opened') };
  }

  // Build filter from flag args.
  const filter = {};
  if (typeof args?.app   === 'string' && args.app   !== '') filter.apps       = [args.app];
  if (typeof args?.type  === 'string' && args.type  !== '') filter.eventTypes = [args.type];
  if (typeof args?.actor === 'string' && args.actor !== '') filter.actors     = [args.actor];

  // since: accept ISO date string OR 'today' / 'yesterday'.
  let since;
  if (typeof args?.since === 'string' && args.since !== '') {
    const lower = args.since.trim().toLowerCase();
    if (lower === 'today') {
      const d = new Date(); d.setHours(0,0,0,0); since = d.getTime();
    } else if (lower === 'yesterday') {
      const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - 1);
      since = d.getTime();
    } else {
      const parsed = new Date(args.since);
      if (!Number.isNaN(parsed.getTime())) since = parsed.getTime();
    }
  }

  const limit = typeof args?.limit === 'number' ? args.limit : 20;
  const events = eventLog.query({
    filter: Object.keys(filter).length > 0 ? filter : undefined,
    since,
    excludeMuted: true,
    limit,
  });

  if (events.length === 0) {
    return { ok: true, message: t('logs.empty') };
  }
  return {
    items: events.map((e) => ({
      id:    e.id,
      label: formatLogRow(e),
    })),
    message: t('logs.heading', { count: events.length }),
  };
}

function formatLogRow(e) {
  const time = new Date(e.ts).toISOString().slice(11, 16);   // HH:MM
  const date = new Date(e.ts).toISOString().slice(5, 10);    // MM-DD
  const actor = e.actor ? ` ${e.actor}` : '';
  const text  = e.payload?.message ?? e.payload?.text ?? `[${e.app}/${e.type}]`;
  return `${date} ${time}${actor} · ${text}`;
}

/**
 * `/brief [--refresh]` — v0.7 builtin.  Delegates to briefRunner
 * (closure created in web/main.js with the live callSkill +
 * cache).  The argument controls cache-bypass only.
 */
async function runBriefBuiltin(args, { briefRunner, t }) {
  if (typeof briefRunner !== 'function') {
    return { ok: false, error: t('brief.no_runner') };
  }
  return briefRunner({ bypassCache: !!args?.refresh });
}

/**
 * `/signin [--issuer=X]` — v0.7.P1 real Solid OIDC.  Triggers a
 * full-page redirect to the chosen pod issuer.  When the user
 * returns, main.js's boot handler completes the round-trip + this
 * thread gets a confirmation via the signed-in event.
 *
 * `podAuth` is the test seam — main.js passes the real podAuth
 * module; tests pass a stub.  When podAuth isn't wired (test or
 * partial build), falls back to the v0.6.2 mock externalFlow.
 */
async function signinFlow(args, { podAuth, externalFlow, t }) {
  const issuer = String(args?.issuer ?? '').trim() || undefined;

  // Real OIDC path.
  if (podAuth && typeof podAuth.startSignIn === 'function') {
    try {
      // startSignIn navigates away; the promise only resolves on error.
      const resolved = podAuth.resolveIssuer?.(issuer);
      if (resolved === null) {
        return { ok: false, error: t('signin.unknown_issuer', { issuer }) };
      }
      const name = resolved?.name ?? issuer ?? 'default';
      // Fire-and-forget — the browser is about to navigate to the
      // issuer.  Return an opening message that may briefly flash
      // before the redirect.
      podAuth.startSignIn({ issuer }).catch((err) => {
        console.error('[signin] redirect failed', err);
      });
      return { ok: true, message: t('signin.opening', { issuer: name }) };
    } catch (err) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  }

  // Fallback (test workspace / pre-v0.7.P1 builds): the mock
  // externalFlow path.  Real builds always have podAuth wired.
  if (externalFlow && typeof externalFlow.open === 'function') {
    try {
      await externalFlow.open({ issuer: issuer ?? 'mock' });
      return { ok: true, message: t('signin.opening', { issuer: issuer ?? 'mock' }) };
    } catch (err) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  }

  return { ok: false, error: t('signin.no_flow') };
}

/**
 * `/whoami` — v0.7.P1.  Returns the current webid (signed in) or
 * a hint to use /signin.
 */
async function whoami(_args, { podAuth, t }) {
  if (!podAuth || typeof podAuth.getCurrentSession !== 'function') {
    return { message: t('whoami.unavailable') };
  }
  const sess = podAuth.getCurrentSession();
  if (!sess) return { message: t('whoami.not_signed_in') };
  return { message: t('whoami.signed_in', { webid: sess.webid }) };
}

/**
 * `/signout` — v0.7.P1.  Clears the local OIDC session.
 */
async function signOutFlow(_args, { podAuth, t }) {
  if (!podAuth || typeof podAuth.signOut !== 'function') {
    return { ok: false, error: t('signout.unavailable') };
  }
  try {
    await podAuth.signOut({});
    return { ok: true, message: t('signout.done') };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/**
 * `/apps [on|off] [name]` — v0.6 OQ-4.B chat-inline app-toggle.
 * Bare call lists apps + enabled state.  With action+name, toggles
 * and reports.
 */
async function appsToggle(args, { catalog, appRegistry, t }) {
  if (!appRegistry) return { ok: false, error: t('apps.no_registry') };

  // Positional binding: '/apps off stoop' parses to args._match='off stoop'
  // because flags-body packs positionals into _match for the router's
  // single-required-param binding.  Multi-positional commands like
  // /apps need to unpack manually.  Same pattern applies to any
  // 2+ positional flags-body op (user-reported 2026-05-23).
  const tokens = String(args?._match ?? '').trim().split(/\s+/).filter(Boolean);
  const action = args?.action ?? tokens[0];
  const name   = args?.app    ?? tokens[1];

  if (!action) {
    // List mode.
    const lines = [t('apps.heading')];
    const origins = catalog?.appOrigins ?? [];
    for (const origin of origins) {
      const on = appRegistry.isEnabled(origin) ? '●' : '○';
      lines.push(`  ${on} ${origin}`);
    }
    if (origins.length === 0) lines.push(`  ${t('apps.empty')}`);
    return { message: lines.join('\n') };
  }

  if (!name) {
    return { ok: false, error: t('apps.no_name', { action }) };
  }

  if (action === 'on' || action === 'off') {
    appRegistry.setEnabled(name, action === 'on');
    return {
      ok: true,
      message: action === 'on'
        ? t('apps.enabled',  { app: name })
        : t('apps.disabled', { app: name }),
    };
  }
  return { ok: false, error: t('apps.unknown_action', { action }) };
}

/**
 * `/send-to <peer> <itemId>` — v0.5.6 simulated cross-peer demo.
 *
 * Resolves the peer's destination thread from simPeers, builds an
 * embed against the catalog's Q29 factory (same path as /embed),
 * then appends a synthesised embed-card shell message DIRECTLY to
 * the peer's thread.  Returns a text confirmation in the sender's
 * active thread.
 *
 * This fakes the round-trip in a single browser tab.  Real cross-
 * peer delivery rides on the hosting app's chat surface (per v0.5.3).
 */
async function sendToPeer(args, { catalog, callSkill, t, localActor, simPeers, threadStore }) {
  const peer   = String(args?.peer ?? '').trim();
  const itemId = String(args?.itemId ?? '').trim();
  if (!peer)   return { ok: false, error: t('sendto.no_peer') };
  if (!itemId) return { ok: false, error: t('sendto.no_id') };
  if (!simPeers || !simPeers[peer]) {
    return { ok: false, error: t('sendto.unknown_peer', { peer }) };
  }
  const target = simPeers[peer];
  const destThread = threadStore?.getThread(target.threadId);
  if (!destThread) {
    return { ok: false, error: t('sendto.no_thread', { threadId: target.threadId }) };
  }

  // Use the same factory-discovery as /embed but make the recipient
  // perspective explicit — the embed's issuedBy is the local user;
  // the destination thread renders the [Claim] button because the
  // recipient (peer) is NOT the issuer.
  let snapshotSkill = null, snapshotAppOrigin = null;
  for (const [opId] of catalog.opsById) {
    const decl = catalog.embedSnapshotFor?.(opId);
    if (decl) { snapshotSkill = decl.snapshotSkill; snapshotAppOrigin = decl.appOrigin; break; }
  }
  if (!snapshotSkill) return { ok: false, error: t('embed.no_factory') };

  let snapshot;
  try {
    snapshot = await callSkill(snapshotAppOrigin, snapshotSkill, { choreId: itemId });
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
  if (!snapshot || snapshot.ok === false) {
    return { ok: false, error: snapshot?.error ?? 'snapshot failed' };
  }

  const embed = buildEmbed({
    appOrigin: snapshotAppOrigin,
    snapshot,
    issuedBy:  localActor ?? 'webid:local-demo-user',
  });

  // Synthesise an embed-card RenderedReply directly into the peer's
  // thread.  Bypasses the dispatch pipeline — this is the cross-peer
  // simulation path.
  destThread.addShellMessage({
    kind:           'embed-card',
    messageId:      `embed-from-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    threadId:       target.threadId,
    lifecycleState: 'live',
    embed,
  });

  return {
    ok:      true,
    message: t('sendto.sent', { peer, item: snapshot.title ?? itemId }),
  };
}

/**
 * `/embed-file` — v0.7.13.  Three modes:
 *   --path=<existing>  → look up via folio's Q29 getFileSnapshot;
 *                        embed real file metadata
 *   --pick             → opens browser File API picker; user
 *                        selects local file; reads bytes inline
 *   --name=X [...]     → synthesises (back-compat with v0.7.x)
 *
 * --share=<peer> routes to peer's thread.
 */
async function createFileEmbed(args, { localActor, t, simPeers, threadStore, callSkill, openFilePicker }) {
  const path  = String(args?.path ?? '').trim();
  const pick  = !!args?.pick;
  const name  = String(args?.name ?? '').trim();
  const share = String(args?.share ?? '').trim();
  const issuer = localActor ?? 'webid:local-demo-user';

  let snapshot = null;

  // Mode 1: --path → folio lookup via Q29.
  if (path && !pick) {
    if (typeof callSkill === 'function') {
      try {
        const r = await callSkill('folio', 'getFileSnapshot', { path });
        if (r && r.ok !== false && r.id) snapshot = r;
      } catch { /* fall through to synthesis */ }
    }
  }

  // Mode 2: --pick → browser File API.
  if (!snapshot && pick) {
    if (typeof openFilePicker !== 'function') {
      return { ok: false, error: t('embed-file.pick_unavailable') };
    }
    try {
      const file = await openFilePicker();
      if (!file) return { ok: false, error: t('embed-file.pick_cancelled') };
      // Read file as base64 (inline) so the embed can travel.  For
      // larger files (> ~1MB) a real implementation would pod-upload
      // first + embed a pod URI.  Defer the threshold to v0.7.14.
      const dataB64 = await readFileAsBase64(file);
      snapshot = {
        id:    `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type:  'file',
        name:  file.name,
        mime:  file.type || mimeFromExtension(file.name),
        bytes: file.size,
        dataB64,
        local: true,
      };
    } catch (err) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  }

  // Mode 3 / fallback: synthesise from --name.
  if (!snapshot) {
    if (!name && !path) return { ok: false, error: t('embed-file.no_input') };
    const finalName = name || (path.split('/').pop() ?? 'file');
    const mime = String(args?.mime ?? '').trim() || mimeFromExtension(finalName);
    const id   = path || `file-${Math.random().toString(36).slice(2, 8)}`;
    snapshot = {
      id, type: 'file', name: finalName, mime,
      bytes: Math.floor(Math.random() * 1024 * 1024 * 4),
      ...(path ? { path } : {}),
    };
  }

  const embed = {
    kind:      'file-card',
    appOrigin: 'folio',
    itemRef:   { app: 'folio', type: 'file', id: snapshot.id },
    snapshot,
    issuedBy:  issuer,
  };

  if (share) {
    const peer = simPeers?.[share];
    if (!peer) return { ok: false, error: t('sendto.unknown_peer', { peer: share }) };
    const destThread = threadStore?.getThread(peer.threadId);
    if (!destThread) return { ok: false, error: t('sendto.no_thread', { threadId: peer.threadId }) };
    destThread.addShellMessage({
      kind:           'embed-card',
      messageId:      `embed-from-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      threadId:       peer.threadId,
      lifecycleState: 'live',
      embed,
    });
    return { ok: true, message: t('sendto.sent', { peer: share, item: snapshot.name }) };
  }
  return embed;
}

/**
 * Read a browser File as base64 (data URL minus the prefix).
 * Pure browser-only via FileReader.
 *
 * @param {File} file
 * @returns {Promise<string>}
 */
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(new Error('FileReader not available in this runtime'));
      return;
    }
    const fr = new FileReader();
    fr.onload  = () => {
      const dataUrl = String(fr.result ?? '');
      const commaIdx = dataUrl.indexOf(',');
      resolve(commaIdx > 0 ? dataUrl.slice(commaIdx + 1) : dataUrl);
    };
    fr.onerror = () => reject(fr.error ?? new Error('FileReader failed'));
    fr.readAsDataURL(file);
  });
}

function mimeFromExtension(name) {
  const lower = (name ?? '').toLowerCase();
  if (lower.endsWith('.pdf'))  return 'application/pdf';
  if (lower.endsWith('.png'))  return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.md'))   return 'text/markdown';
  if (lower.endsWith('.txt'))  return 'text/plain';
  if (lower.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

/**
 * `/embed-time` — v0.7 catch-up.  Appointment maker (user F:
 * "calendar lookup as an appointment maker").  Until a real calendar
 * app exists, /embed-time CREATES an event card from the supplied
 * title + when + duration + location, optionally shared.
 *
 * `when` is parsed via the slack-style parseRelativeDate (OQ-3.A:
 * ISO + 'tomorrow' / 'next tuesday 3pm' / etc).
 * `duration` accepts '1h', '30m', '2h30m', '1d'; default 1h.
 *
 * Future: real calendar app + lookup-vs-create branch.
 */
async function createTimeEmbed(args, { localActor, t, simPeers, threadStore, callSkill }) {
  const title = String(args?.title ?? '').trim();
  const when  = String(args?.when  ?? '').trim();
  if (!title) return { ok: false, error: t('embed-time.no_title') };
  if (!when)  return { ok: false, error: t('embed-time.no_when') };

  let startAt;
  const direct = new Date(when);
  if (!Number.isNaN(direct.getTime())) {
    startAt = direct;
  } else {
    return { ok: false, error: t('embed-time.bad_when', { when }) };
  }
  const durationMs = parseDuration(String(args?.duration ?? '').trim()) ?? 3_600_000;
  const endAt = new Date(startAt.getTime() + durationMs);
  const location = String(args?.location ?? '').trim() || undefined;
  const share    = String(args?.share    ?? '').trim();
  const issuer   = localActor ?? 'webid:local-demo-user';

  // v0.7.10 — dispatch to the calendar app's real addEvent skill.
  // The calendar app persists the event to its store; we then build
  // the embed envelope from the persisted snapshot.
  let event;
  if (typeof callSkill === 'function') {
    try {
      const reply = await callSkill('calendar', 'addEvent', {
        title,
        startsAt: startAt.toISOString(),
        endsAt:   endAt.toISOString(),
        ...(location ? { location } : {}),
        attendees: share ? [share] : [],
        actor:     issuer,
      });
      if (reply?.ok === false) return reply;   // pass through error
      // Read back the snapshot for the embed.
      event = reply?.itemId
        ? await callSkill('calendar', 'getEventSnapshot', { id: reply.itemId })
        : null;
    } catch (err) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  }

  // Fall back to synthesized snapshot if calendar dispatch unavailable
  // (defensive — shouldn't happen in the v0.7.10 demo).
  if (!event || event.ok === false) {
    const id = `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    event = {
      id, type: 'time', title,
      startAt:  startAt.toISOString(),
      endAt:    endAt.toISOString(),
      ...(location ? { location } : {}),
    };
  }

  const embed = {
    kind:      'time-card',
    appOrigin: 'calendar',
    itemRef:   { app: 'calendar', type: 'calendar-event', id: event.id },
    snapshot: {
      id:    event.id,
      type:  event.type ?? 'calendar-event',
      title: event.title,
      startAt:  event.startAt  ?? event.startsAt,
      endAt:    event.endAt    ?? event.endsAt,
      timezone: 'UTC',
      ...(event.location ? { location: event.location } : {}),
      ...(event.fields   ? { fields:   event.fields   } : {}),
    },
    issuedBy: issuer,
  };

  if (share) {
    const peer = simPeers?.[share];
    if (!peer) return { ok: false, error: t('sendto.unknown_peer', { peer: share }) };
    const destThread = threadStore?.getThread(peer.threadId);
    if (!destThread) return { ok: false, error: t('sendto.no_thread', { threadId: peer.threadId }) };
    destThread.addShellMessage({
      kind:           'embed-card',
      messageId:      `embed-from-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      threadId:       peer.threadId,
      lifecycleState: 'live',
      embed,
    });
    return { ok: true, message: t('sendto.sent', { peer: share, item: title }) };
  }
  return embed;
}

/** Parse '1h' / '30m' / '2h30m' / '1d' / '90m' into ms.  Returns null on parse fail. */
function parseDuration(text) {
  if (!text) return null;
  let total = 0;
  const re = /(\d+)\s*([dhm])/g;
  let m, matched = false;
  while ((m = re.exec(text)) !== null) {
    matched = true;
    const n = parseInt(m[1], 10);
    if (m[2] === 'd') total += n * 86_400_000;
    if (m[2] === 'h') total += n *  3_600_000;
    if (m[2] === 'm') total += n *     60_000;
  }
  return matched ? total : null;
}

/**
 * `/embed <itemId>` — scan the merged catalog for ops that declare
 * a Q29 cardSnapshotSkill, fetch a snapshot, and return an embed-
 * card reply.
 *
 * v0.5.1 — supports `--claim` flag for sender-claim-on-behalf:
 *   /embed c-1                  → issued; receiver claims
 *   /embed c-1 --claim          → issued AND claimed by sender
 *                                  ("I'll handle this")
 *
 * Cross-peer P2P delivery rides on each app's existing chat surface
 * (e.g. stoop's sendChatMessage) — canopy-chat produces the
 * envelope; the source app delivers.  Not in canopy-chat's scope
 * to compose @canopy/chat-p2p directly (per v0.5.3 audit).
 */
async function createEmbed(args, { catalog, callSkill, t, localActor }) {
  // Parse args — supports both flag-style (--claim) and bare itemId.
  // The router's flag parser already split these for `/embed`; if
  // the user typed `/embed c-1 --claim`, args.itemId='c-1' and
  // args.claim=true.
  const itemId = String(args?.itemId ?? '').trim();
  const claimOnBehalf = !!args?.claim;
  if (!itemId) {
    return { ok: false, error: t('embed.no_id') };
  }
  if (typeof callSkill !== 'function') {
    return { ok: false, error: t('embed.no_callskill') };
  }

  let snapshotSkill = null;
  let snapshotAppOrigin = null;
  for (const [opId, entry] of catalog.opsById) {
    const decl = catalog.embedSnapshotFor?.(opId);
    if (decl) {
      snapshotSkill     = decl.snapshotSkill;
      snapshotAppOrigin = decl.appOrigin;
      break;
    }
  }
  if (!snapshotSkill) {
    return { ok: false, error: t('embed.no_factory') };
  }

  try {
    const snapshot = await callSkill(snapshotAppOrigin, snapshotSkill, { choreId: itemId });
    if (!snapshot || snapshot.ok === false) {
      return { ok: false, error: snapshot?.error ?? 'snapshot failed' };
    }
    const issuer = localActor ?? 'webid:local-demo-user';
    let embed = buildEmbed({
      appOrigin: snapshotAppOrigin,
      snapshot,
      issuedBy:  issuer,
    });
    if (claimOnBehalf) {
      // Sender claims-on-behalf — the receiver sees the embed
      // already claimed by the sender; can still react but knows
      // the issuer's already on it.
      embed = { ...embed, claimedBy: issuer, claimedAt: Date.now() };
    }
    return embed;
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/**
 * `/newthread <name>` — create + switch.
 *
 * @param {{name: string}} args
 */
function createNewThread(args, { threadStore, setActive, t }) {
  if (!threadStore) {
    return { ok: false, error: t('newthread.no_store') };
  }
  const name = String(args?.name ?? '').trim();
  if (!name) {
    return { ok: false, error: t('newthread.no_name') };
  }
  const thread = threadStore.createThread({
    name,
    filter:      {},   // wildcard — user can refine via sidebar later
    permissions: { allowCommands: true },
  });
  if (typeof setActive === 'function') setActive(thread.id);
  return {
    ok: true,
    message: t('newthread.created', { name: thread.name }),
    threadId: thread.id,
  };
}

/**
 * `/threads` — list all threads with their filters.
 */
function listThreads({ threadStore, t }) {
  if (!threadStore) {
    return { message: t('threads.no_store') };
  }
  const all = threadStore.listThreads();
  if (all.length === 0) {
    return { message: t('threads.empty') };
  }
  const lines = [t('threads.heading')];
  for (const th of all) {
    const filt    = describeFilter(th.filter);
    const filtStr = filt === '*' ? '' : ` (${filt})`;
    const active  = th.id === threadStore.activeId ? ' ●' : '';
    lines.push(`  ${th.name}${active}${filtStr}`);
  }
  return { message: lines.join('\n') };
}

/**
 * Render the `/help` reply as a single text payload.  Groups
 * commands by appOrigin so the user can see at a glance which app
 * owns what.
 *
 * @param {import('../manifestMerge.js').MergedCatalog} catalog
 * @param {(key: string, params?: object) => string}   t
 * @returns {{ message: string }}
 */
function formatHelp(catalog, t) {
  const commands = catalog?.commandMenu ?? [];
  if (commands.length === 0) {
    return { message: t('help.empty') };
  }

  // Group by appOrigin.  Sort each group's commands alphabetically.
  /** @type {Map<string, Array<{command: string, opId: string, hint: string}>>} */
  const byOrigin = new Map();
  for (const entry of commands) {
    const op   = catalog.opsById?.get(entry.opId)?.op;
    const hint = op?.surfaces?.chat?.hint ?? op?.id ?? '';
    const arr  = byOrigin.get(entry.appOrigin) ?? [];
    arr.push({ command: entry.command, opId: entry.opId, hint });
    byOrigin.set(entry.appOrigin, arr);
  }
  for (const arr of byOrigin.values()) {
    arr.sort((a, b) => a.command.localeCompare(b.command));
  }

  // Render: app heading + per-command line.  canopy-chat's own
  // built-ins surface under "Chat" not the app name.
  const lines = [t('help.heading')];
  // Stable origin order: canopy-chat (chat-shell built-ins) first,
  // then alphabetical.
  const origins = [...byOrigin.keys()].sort((a, b) => {
    if (a === 'canopy-chat') return -1;
    if (b === 'canopy-chat') return  1;
    return a.localeCompare(b);
  });
  for (const origin of origins) {
    const label = origin === 'canopy-chat'
      ? t('help.section_chat')
      : t('help.section_app', { app: origin });
    lines.push('');
    lines.push(label);
    for (const { command, hint } of byOrigin.get(origin)) {
      lines.push(`  ${command}  —  ${hint}`);
    }
  }
  return { message: lines.join('\n') };
}
