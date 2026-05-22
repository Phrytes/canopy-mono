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
}) {
  return {
    help: async () => formatHelp(catalog, t),
    newthread: async (args) => createNewThread(args, { threadStore, setActive, t }),
    threads:   async ()     => listThreads({ threadStore, t }),
    embed:     async (args) => createEmbed(args, { catalog, callSkill, t, localActor }),
    'embed-file': async (args) => createFileEmbed(args, { localActor, t }),
    'embed-time': async (args) => createTimeEmbed(args, { localActor, t }),
    sendto:    async (args) => sendToPeer(args, {
      catalog, callSkill, t, localActor, simPeers, threadStore,
    }),
    apps:      async (args) => appsToggle(args, { catalog, appRegistry, t }),
    signin:    async (args) => signinFlow(args, { externalFlow, t }),
    brief:     async (args) => runBriefBuiltin(args, { briefRunner, t }),
    logs:      async (args) => runLogsBuiltin(args, { eventLog, t }),
  };
}

/**
 * `/logs [--app=X] [--type=Y] [--actor=Z] [--since=ISO] [--mute=app:type] [--limit=N]`
 * v0.7.1 — list recent network events from the EventLog (14d retention).
 * `--mute` is a side-effect: adds the kind to the mute set + reports.
 */
async function runLogsBuiltin(args, { eventLog, t }) {
  if (!eventLog) return { ok: false, error: t('logs.no_log') };

  // Side-effect: --mute=app:type
  if (typeof args?.mute === 'string' && args.mute.includes(':')) {
    const [app, type] = args.mute.split(':', 2);
    eventLog.mute(app, type);
    return { ok: true, message: t('logs.muted', { app, type }) };
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
 * `/signin [issuer]` — v0.6.2 external-flow demo.  Opens the
 * (mock) external sign-in URL via the openExternalFlow primitive.
 * The callback wakes the chat thread with a fake webid.
 *
 * Real OIDC binding lands when @canopy/oidc-session is composed
 * (v0.7+); this slice proves the FRAMEWORK works.
 */
async function signinFlow(args, { externalFlow, t }) {
  if (!externalFlow || typeof externalFlow.open !== 'function') {
    return { ok: false, error: t('signin.no_flow') };
  }
  const issuer = String(args?.issuer ?? '').trim() || 'mock';
  try {
    await externalFlow.open({ issuer });
    return {
      ok: true,
      message: t('signin.opening', { issuer }),
    };
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

  const action = args?.action;
  const name   = args?.app;

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
 * `/embed-file <path>` — v0.5.5 builtin.  Synthesises a fake file
 * snapshot from the user-supplied path.  Real folio integration
 * (calling folio's Q29 fileSnapshot skill) lands when folio's
 * manifest declares the embed primitive — until then this stub
 * proves the renderer works.
 */
async function createFileEmbed(args, { localActor, t }) {
  const path = String(args?.path ?? '').trim();
  if (!path) return { ok: false, error: t('embed-file.no_path') };
  const baseName = path.split('/').pop();
  return {
    kind:      'file-card',
    appOrigin: 'folio',
    itemRef:   { app: 'folio', type: 'file', id: path },
    snapshot:  {
      id:    path,
      type:  'file',
      name:  baseName,
      mime:  mimeFromExtension(baseName),
      bytes: Math.floor(Math.random() * 1024 * 1024 * 4),
      path,
    },
    issuedBy:  localActor ?? 'webid:local-demo-user',
  };
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
 * `/embed-time <eventId>` — v0.5.5 builtin.  Synthesises a fake
 * calendar-event snapshot for the demo (no app currently owns
 * calendar events; the primitive is here for J7 completeness).
 */
async function createTimeEmbed(args, { localActor, t }) {
  const eventId = String(args?.eventId ?? '').trim();
  if (!eventId) return { ok: false, error: t('embed-time.no_event') };
  const now = Date.now();
  return {
    kind:      'time-card',
    appOrigin: 'household',
    itemRef:   { app: 'household', type: 'time', id: eventId },
    snapshot:  {
      id:       eventId,
      type:     'time',
      title:    `Event ${eventId}`,
      startAt:  new Date(now + 2 * 3_600_000).toISOString(),
      endAt:    new Date(now + 3 * 3_600_000).toISOString(),
      timezone: 'UTC',
      location: 'Demo venue',
    },
    issuedBy:  localActor ?? 'webid:local-demo-user',
  };
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
