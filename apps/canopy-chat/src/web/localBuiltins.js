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

import { describeFilter } from '../filter.js';
import { buildEmbed }     from '../embed.js';

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
export function createLocalBuiltins({ catalog, t, threadStore, setActive, callSkill, localActor }) {
  return {
    help: async () => formatHelp(catalog, t),
    newthread: async (args) => createNewThread(args, { threadStore, setActive, t }),
    threads:   async ()     => listThreads({ threadStore, t }),
    embed:     async (args) => createEmbed(args, { catalog, callSkill, t, localActor }),
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
