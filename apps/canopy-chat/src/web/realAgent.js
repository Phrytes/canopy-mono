/**
 * canopy-chat — v0.1.5 real-Agent boot.
 *
 * Replaces the v0.1.4 mockAgent with a REAL `@canopy/core` Agent
 * running in the browser.  Resolves OQ-1.C empirically: yes, the
 * Agent class boots cleanly under Vite's bundler with no Node shims
 * required for the relay + internal-transport surface.
 *
 * Topology:
 *   - InternalBus shared in-process (no network round-trip yet)
 *   - Two agents on the bus:
 *       hostAgent — owns the household skills (listOpen, markComplete)
 *       chatAgent — canopy-chat's "client" identity; invokes against
 *                   the host's address
 *
 * v0.1.5 ships in-process only (proves the Agent boots in browser).
 * A future slice swaps the InternalBus for a real `RelayTransport`
 * pointing at a canopy relay (the relay code already works in browser
 * via `globalThis.WebSocket` — verified in `core/src/transport/
 * RelayTransport.js:200`).  That's a runtime-config change, not a
 * code change.
 *
 * Phase v0.1 sub-slice 1.3 per `/Project Files/canopy-chat/coding-plan.md`.
 */

import {
  Agent, AgentIdentity, InternalBus, InternalTransport, DataPart,
} from '@canopy/core';
import { VaultMemory, VaultLocalStorage } from '@canopy/vault';
import { createSecureAgent } from '@canopy/secure-agent';
import { createBrowserTasksAgent } from '@canopy-app/tasks-v0/browser';
import { createBrowserStoopAgent } from '@canopy-app/stoop/browser';

/**
 * Pick the right vault for the runtime.  Used here only for the
 * HOST agent (in-process app skills; no cross-peer); the CHAT
 * agent's vault is selected by createSecureAgent's picker via the
 * identityVaultPrefix opt.
 */
function makeBrowserVault(prefix) {
  if (typeof globalThis.localStorage !== 'undefined') {
    try { return new VaultLocalStorage({ prefix }); } catch { /* defensive */ }
  }
  return new VaultMemory();
}

/**
 * v0.7.P3a — try to restore an existing identity; generate fresh if
 * the vault is empty.  Either way returns a usable AgentIdentity.
 * (Host-only helper; createSecureAgent handles this for the chat side.)
 */
async function restoreOrGenerate(vault) {
  try {
    if (await vault.has('agent-privkey')) {
      return await AgentIdentity.restore(vault);
    }
  } catch { /* fall through to generate */ }
  return AgentIdentity.generate(vault);
}

import { mockHouseholdManifest } from './mockAgent.js';
import {
  CalendarStore, registerCalendarSkills,
} from '@canopy-app/calendar';

const SEED_CHORES = [
  { id: 'c-1', label: 'Dishwasher',         type: 'chore', state: 'open' },
  { id: 'c-2', label: 'Bins out',           type: 'chore', state: 'open' },
  { id: 'c-3', label: 'Vacuum living room', type: 'chore', state: 'open' },
];

/**
 * Boot two in-process Agents on a shared InternalBus:
 *   - `host` owns the household skills
 *   - `chat` is canopy-chat's invoking identity
 *
 * Returns the same shape as `createMockHouseholdAgent`:
 *   { manifest, callSkill, reset, state }
 *
 * @returns {Promise<{
 *   manifest: object,
 *   callSkill: (appOrigin: string, opId: string, args: object) => Promise<*>,
 *   reset: () => void,
 *   state: () => Array<object>,
 *   meta: { hostAddress: string, chatAddress: string, transport: 'internal' },
 * }>}
 */
export async function createRealHouseholdAgent(opts = {}) {
  let chores = SEED_CHORES.map((c) => ({ ...c }));

  // v0.7.12 — multi-pod RSVP coordination (simulated for the demo).
  // calendar.addEvent calls this when attendees are present; default
  // is no-op (registerCalendarSkills's inviteAttendee:null path).
  // main.js wires the real impl post-construction (forward-ref) since
  // it owns the simPeers map + threadStore.
  let inviteAttendeeRef = async (/* webid, snapshot */) => {};

  // v0.7.7 — optional event publisher.  When supplied, mutation
  // skills publish item-changed events via this callback so the
  // chat-shell EventRouter routes them to matching threads.
  // Unblocks J8's "household alerts" real-event demo.
  const publishEvent = typeof opts.publishEvent === 'function'
    ? opts.publishEvent
    : () => {};

  const bus = new InternalBus();

  // Host agent — in-process app skills (household, tasks-v0, stoop,
  // folio, calendar).  No cross-peer; vault picks the standard browser
  // localStorage path.  Built manually because it's a pure backend.
  const hostVault = opts.hostVault ?? makeBrowserVault('cc-host-id:');
  const hostId    = await restoreOrGenerate(hostVault);
  const hostTransport = new InternalTransport(bus, hostId.pubKey);
  const hostAgent = new Agent({ identity: hostId, transport: hostTransport });

  // Chat agent — the user-facing surface.  Built via @canopy/secure-agent
  // factory so every safety primitive (identity persistence, SecurityLayer,
  // mute/block, helloGate, signed WebID claim, audit log, …) is wired
  // by default rather than re-assembled per app.
  //
  // - bus: shared with hostAgent so chatAgent.invoke(hostAgent.address)
  //        works in-process via InternalBus
  // - vault: opt.chatVault wins (tests inject VaultMemory); otherwise
  //   picker chooses VaultLocalStorage by prefix 'cc-chat-id:'
  // - auditLog: persistent under 'cc-audit'; autoLogs identity.rotate /
  //   mute / claim.sign / caps.issue / peer.connect
  // - muteListVaultKey: persistent peer mute across reloads
  // - nknLib: not passed here — main.js calls sa.peer.connect() once
  //   window.nkn is loaded from the CDN
  // - onPeerMessage: not passed here — main.js wires it when connecting
  //
  // SECURITY: any opt below this comment that is RESET / DISABLED needs
  // a `// SECURITY: opted out — <reason>` comment per
  // Project Files/conventions/architectural-layering.md.
  const sa = await createSecureAgent({
    bus,
    vault:               opts.chatVault,
    identityVaultPrefix: 'cc-chat-id:',
    muteListVaultKey:    'cc-mute',
    auditLog:            { vaultKey: 'cc-audit' },
    // onPeerMessage + nknLib supplied later via setPeerWiring().
    // Pass-through for extra factory opts (tests + future ops):
    // identityResolver, capabilityIssuer, policyEngine, groupManager,
    // a2aTls, rateLimit, usePerfectFwdSec, webidClaim, helloGate, …
    ...(opts.secureAgentOpts ?? {}),
  });
  const chatAgent = sa.agent;
  const chatId    = chatAgent.identity;

  // v0.6 demo — household runs as a 'decentralized' crew with three
  // simulated peers.  Mostly online; one randomly unreachable so the
  // sync-hint UI surfaces a recognisable pattern.  Real apps populate
  // _sync from their actual sync-engine state.
  const SIM_PEERS = ['webid:anne', 'webid:karl', 'webid:maria'];
  function simulateSync() {
    const offline = Math.random() < 0.4
      ? [SIM_PEERS[Math.floor(Math.random() * SIM_PEERS.length)]]
      : [];
    return {
      style:       'decentralized',
      peers:       SIM_PEERS.filter((p) => !offline.includes(p)),
      pending:     [],
      unreachable: offline,
    };
  }

  /* ─────────── v0.7.10 — Calendar app skills ─────────── */
  // Composed via @canopy-app/calendar's registerCalendarSkills.  The
  // calendar app's CalendarStore is built fresh per agent instance
  // (in-memory pseudo-pod for v0.7.10; v0.7.11 swaps to real pod).
  //
  // v0.7.10 limitation: all 5 apps' skills register on ONE hostAgent.
  // For brief / search, app-prefixed names (calendar_briefSummary,
  // tasks_briefSummary, ...) avoid the collision.  main.js's callSkill
  // remaps the bare op id → the prefixed id.  v0.7.11+ may mount each
  // app as its own agent on the InternalBus for cleaner architecture.
  const calendarStore = new CalendarStore({ actor: 'webid:local-demo-user' });
  registerCalendarSkills(hostAgent, calendarStore, {
    simulateSync,
    publishEvent,
    skillPrefix: 'calendar_',     // ← namespaces colliding skill ids
    // v0.7.12 — invite-attendee callback wired by main.js (which has
    // the simPeers map).  Forward-ref pattern: realAgent doesn't
    // know about main.js's threadStore + simPeers at construction,
    // so we expose a setter the caller wires post-construction.
    inviteAttendee: (webid, snapshot) => inviteAttendeeRef(webid, snapshot),
  });

  // v0.7.P2 — caller (main.js) wires the pod writer on sign-in via
  // this setter; calendar's .ics feed then write-throughs to
  // <pod>/canopy/calendar/feed.ics.
  const setCalendarPodWriter = (writer) => calendarStore.setPodWriter(writer);
  // v0.7.P2.1 — surface pod-write success / failure as notification
  // events so /logs + matching threads pick them up.
  if (typeof calendarStore.setPodEventSink === 'function') {
    calendarStore.setPodEventSink((event) => {
      publishEvent({
        app:  'calendar',
        type: event.kind === 'pod-write-error' ? 'notification' : 'item-changed',
        payload: {
          message: event.kind === 'pod-write-ok'
            ? `📤 pod write OK: ${event.url}`
            : `❌ pod write failed (${event.status ?? 'no status'}): ${event.error}`,
        },
      });
    });
  }

  // Register the household skills on the HOST agent.  Skills take
  // `{parts}` per @canopy/core convention; we transport args via a
  // DataPart and reply with another DataPart whose `.data` is the
  // canopy-chat payload shape.
  hostAgent.register('listOpen', async () => {
    const open = chores.filter((c) => c.state === 'open');
    // v0.6 — annotate every-other row with synthetic _lastSync so the
    // per-row 'stale Xh ago' badge has something to render.
    const now = Date.now();
    const decorated = open.map((c, i) => i % 2 === 0
      ? { ...c, _lastSync: now - 3 * 3_600_000 }   // 3h ago
      : c);
    return [DataPart({ items: decorated, _sync: simulateSync() })];
  });

  // /profile — record-shape demo.
  hostAgent.register('getProfile', async () => {
    const open = chores.filter((c) => c.state === 'open').length;
    const done = chores.filter((c) => c.state === 'done').length;
    return [DataPart({
      title:        'Household',
      name:         'Casa de Demo',
      openChores:   open,
      doneChores:   done,
      memberCount:  3,
      polite:       true,
      established:  '2026-05-21',
    })];
  });

  // v0.4 — household membership demo (declared in mockHouseholdManifest
  // but the skill was missing from the host agent — caught by user
  // testing 2026-05-23).
  // v0.7 Q30 — briefSummary for the /brief aggregator.
  hostAgent.register('briefSummary', async () => {
    const open = chores.filter((c) => c.state === 'open');
    if (open.length === 0) return [DataPart({ ok: true })];   // empty → /brief skips
    return [DataPart({
      items:   open.map((c) => ({ id: c.id, label: c.label })),
      message: `${open.length} chore${open.length === 1 ? '' : 's'} open`,
    })];
  });

  hostAgent.register('addMember', async ({ parts }) => {
    const args = parts?.[0]?.data ?? {};
    const name = String(args.name ?? '').trim();
    if (!name) {
      return [DataPart({ ok: false, error: 'name required' })];
    }
    return [DataPart({
      ok:         true,
      message:    `✓ Added member: ${name}`,
      memberName: name,
    })];
  });

  // v0.5 Q29 — snapshot factory for the J7 embed primitive.  Declared
  // in mockHouseholdManifest, consumed by canopy-chat's /embed
  // built-in.  Same kind of host-agent gap as addMember; caught by
  // user testing 2026-05-23 + a defensive guard added to runDispatch
  // alongside this commit.
  hostAgent.register('getChoreSnapshot', async ({ parts }) => {
    const args = parts?.[0]?.data ?? {};
    const id = args?.choreId;
    const target = chores.find((c) => c.id === id);
    if (!target) {
      return [DataPart({ ok: false, error: `No chore with id "${id}".` })];
    }
    return [DataPart({
      id:    target.id,
      type:  target.type,
      state: target.state,
      title: target.label,
      fields: {
        state:       target.state,
        assigned_to: 'unassigned',
      },
    })];
  });

  hostAgent.register('markComplete', async ({ parts }) => {
    const args = parts?.[0]?.data ?? {};
    const id = args?.choreId;
    const target = chores.find((c) => c.id === id);
    if (!target) {
      return [DataPart({ ok: false, error: `No chore with id "${id}".` })];
    }
    if (target.state === 'done') {
      return [DataPart({ ok: false, error: `Chore "${target.label}" is already done.` })];
    }
    target.state = 'done';
    // v0.7.7 — publish item-changed event for J8 reactive demo.
    publishEvent({
      app:     'household',
      type:    'item-changed',
      actor:   'webid:local-demo-user',
      itemRef: { app: 'household', type: 'chore', id: target.id },
      payload: { message: `✓ Done: ${target.label}` },
    });
    return [DataPart({
      ok:      true,
      message: `✓ Done: ${target.label}`,
      itemId:  target.id,
      // v0.6 — mutation reply carries _sync; chat shell renders the
      // suffix below the bubble.
      _sync:   simulateSync(),
    })];
  });

  /* ─── v0.7.cc — household: add-chore / nudge / remove-chore ─── */

  hostAgent.register('addChore', async ({ parts }) => {
    const args = parts?.[0]?.data ?? {};
    const label = String(args.label ?? '').trim();
    if (!label) return [DataPart({ ok: false, error: 'label required' })];
    const id = `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    chores.push({ id, label, type: 'chore', state: 'open' });
    publishEvent({
      app: 'household', type: 'item-changed',
      actor: 'webid:local-demo-user',
      itemRef: { app: 'household', type: 'chore', id },
      payload: { message: `✓ Added chore: ${label}` },
    });
    return [DataPart({
      ok: true, message: `✓ Added chore: ${label}`,
      itemId: id, _sync: simulateSync(),
    })];
  });

  hostAgent.register('nudgePeer', async ({ parts }) => {
    const args = parts?.[0]?.data ?? {};
    const peer  = String(args.peer  ?? '').trim();
    const chore = args.chore ? String(args.chore).trim() : null;
    if (!peer) return [DataPart({ ok: false, error: 'peer required' })];
    const msg = chore
      ? `Hey ${peer}, friendly nudge about: ${chore}`
      : `Hey ${peer}, friendly nudge about the open chores`;
    publishEvent({
      app: 'household', type: 'notification',
      actor: 'webid:local-demo-user',
      itemRef: chore ? { app: 'household', type: 'chore', id: chore } : null,
      payload: { message: msg, target: peer },
    });
    return [DataPart({
      ok: true, message: `📣 Nudged ${peer}${chore ? ` about "${chore}"` : ''}.`,
    })];
  });

  hostAgent.register('removeChore', async ({ parts }) => {
    const args = parts?.[0]?.data ?? {};
    const id = args?.choreId;
    const target = chores.find((c) => c.id === id);
    if (!target) return [DataPart({ ok: false, error: `No chore with id "${id}".` })];
    // Q27 destructive — two-step confirm.  Bare call returns a
    // confirmation prompt; --confirm=true actually removes.
    if (!args.confirm) {
      return [DataPart({
        ok: true,
        message: `⚠ Remove chore "${target.label}"?  Re-run with --confirm=true to proceed.`,
        confirmRequired: true,
        itemId: target.id,
      })];
    }
    chores = chores.filter((c) => c.id !== id);
    publishEvent({
      app: 'household', type: 'item-changed',
      actor: 'webid:local-demo-user',
      itemRef: { app: 'household', type: 'chore', id: target.id },
      payload: { message: `🗑 Removed: ${target.label}` },
    });
    return [DataPart({
      ok: true, message: `🗑 Removed: ${target.label}`,
      itemId: target.id, _sync: simulateSync(),
    })];
  });

  // v0.7.5 — searchChores: text search across cached chores.
  hostAgent.register('searchChores', async ({ parts }) => {
    const q = String(parts?.[0]?.data?.query ?? '').toLowerCase();
    if (!q) return [DataPart({ items: [] })];
    const hits = chores.filter((c) => c.label.toLowerCase().includes(q));
    return [DataPart({
      items: hits.map((c) => ({ id: c.id, label: c.label, type: 'chore' })),
    })];
  });

  // v0.7.6 — resolveContact convention.  Returns webid + display
  // name when the query matches a known household member.
  hostAgent.register('resolveContact', async ({ parts }) => {
    const query = String(parts?.[0]?.data?.query ?? '').toLowerCase();
    const members = [
      { displayName: 'Anne',  webid: 'webid:anne',  handle: 'anne'  },
      { displayName: 'Karl',  webid: 'webid:karl',  handle: 'karl'  },
      { displayName: 'Maria', webid: 'webid:maria', handle: 'maria' },
    ];
    const exact = members.find((m) => m.handle === query || m.displayName.toLowerCase() === query);
    if (exact) return [DataPart({ ...exact, confidence: 'exact' })];
    const fuzzy = members.find((m) => m.displayName.toLowerCase().includes(query) && query.length >= 2);
    if (fuzzy) return [DataPart({ ...fuzzy, confidence: 'fuzzy' })];
    return [DataPart({ ok: false, error: `No contact matches "${query}"` })];
  });


  /* ─────────── v0.7.4 — folio browser-side skills ─────────── */
  const SEED_FILES = [
    { id: '/notes/shared/anne.md',  name: 'anne.md',  type: 'file', mime: 'text/markdown', bytes: 1234, state: 'synced' },
    { id: '/notes/recipes.md',      name: 'recipes.md', type: 'file', mime: 'text/markdown', bytes: 5678, state: 'synced' },
    { id: '/docs/lease.pdf',        name: 'lease.pdf',  type: 'file', mime: 'application/pdf', bytes: 102400, state: 'synced' },
  ];
  let files = SEED_FILES.map((f) => ({ ...f }));

  hostAgent.register('readNote', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    const target = files.find((f) => f.id === a.path || f.name === a.path);
    if (!target) return [DataPart({ ok: false, error: `No file at "${a.path}".` })];
    return [DataPart({
      message: `[demo] Contents of ${target.name} would be shown here. ${target.bytes} bytes; mime ${target.mime}.`,
    })];
  });

  hostAgent.register('shareFolder', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    const folder = String(a.folder ?? '').trim();
    const withWebid = String(a.with ?? '').trim();
    if (!folder)    return [DataPart({ ok: false, error: 'folder required' })];
    if (!withWebid) return [DataPart({ ok: false, error: 'with (webid) required' })];
    return [DataPart({
      ok:      true,
      message: `✓ Shared "${folder}" with ${withWebid}.`,
      _sync:   simulateSync(),
    })];
  });

  hostAgent.register('listFiles', async () => {
    return [DataPart({ items: files, _sync: simulateSync() })];
  });

  hostAgent.register('verifyPodState', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    return [DataPart({
      message: `[demo] ${a.relPath ?? 'file'} matches pod state (sha + size verified).`,
    })];
  });

  hostAgent.register('deleteFromPod', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    const idx = files.findIndex((f) => f.id === a.relPath || f.name === a.relPath);
    if (idx === -1) return [DataPart({ ok: false, error: `No file at "${a.relPath}".` })];
    const removed = files.splice(idx, 1)[0];
    return [DataPart({
      ok: true, message: `✓ Deleted from pod: ${removed.name}`, _sync: simulateSync(),
    })];
  });

  // v0.7.13 — getFileSnapshot (Q29 cardSnapshotSkill for /embed-file
  // when the user picks an existing folio file by name/path).
  hostAgent.register('getFileSnapshot', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    const target = files.find((f) => f.id === a.path || f.name === a.path);
    if (!target) return [DataPart({ ok: false, error: `No file at "${a.path}".` })];
    return [DataPart({
      id:    target.id,
      type:  'file',
      name:  target.name,
      mime:  target.mime,
      bytes: target.bytes,
      path:  target.id,
      state: target.state ?? 'synced',
    })];
  });

  // v0.7.13 — downloadFile: receiver-side action.  In a real browser
  // build this triggers a Blob download; for the demo (no real bytes
  // server-side) we synthesise a placeholder reply.
  hostAgent.register('downloadFile', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    const target = files.find((f) => f.id === a.path || f.name === a.path);
    return [DataPart({
      ok:      true,
      message: target
        ? `↓ Downloading ${target.name} (${target.bytes} bytes, ${target.mime})… [demo: no real bytes]`
        : `↓ Downloading ${a.path} from sender's pod… [demo]`,
    })];
  });

  // v0.7.13 — saveToMyPod: receiver-side action.  Cross-pod copy:
  // the receiver reads the sender's pod URL + writes to their own
  // pod's /shared-with-me/ tree.  Demo: just confirm.
  hostAgent.register('saveToMyPod', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    return [DataPart({
      ok:      true,
      message: `📥 Saved "${a.name ?? a.path ?? 'file'}" to your pod's /shared-with-me/ folder. [demo]`,
      _sync:   simulateSync(),
    })];
  });

  // v0.7.5 — searchFiles.
  hostAgent.register('searchFiles', async ({ parts }) => {
    const q = String(parts?.[0]?.data?.query ?? '').toLowerCase();
    if (!q) return [DataPart({ items: [] })];
    const hits = files.filter((f) => f.name.toLowerCase().includes(q) || f.id.toLowerCase().includes(q));
    return [DataPart({
      items: hits.map((f) => ({ id: f.id, label: f.name, type: 'file' })),
    })];
  });

  hostAgent.register('folio_briefSummary', async () => {
    if (files.length === 0) return [DataPart({ ok: true })];
    return [DataPart({
      count: files.length,
      label: `file${files.length === 1 ? '' : 's'} in folio`,
    })];
  });

  /* ─── v0.7.cc — folio status (record reply) ─── */

  hostAgent.register('folioStatus', async () => {
    const synced = files.filter((f) => f.state === 'synced').length;
    const conflicted = files.filter((f) => f.state === 'conflict').length;
    return [DataPart({
      title:        'Folio sync status',
      lastSync:     new Date().toISOString(),
      fileCount:    files.length,
      syncedCount:  synced,
      conflictCount: conflicted,
      sharedFolders: 0,
    })];
  });

  await Promise.all([
    hostAgent.start(),
    chatAgent.start(),
  ]);

  // hello-exchange so each agent knows the other.  InternalBus
  // delivers synchronously enough that one hello is sufficient.
  await chatAgent.hello(hostAgent.address);

  /* ─── tasks-v0 real crew agent (slice 1 — integration plan
   *     2026-05-23) ─────────────────────────────────────────────
   *
   * Replaces the previous mock-task handlers (~210 lines) with
   * the actual tasks-v0 Crew agent composed in-process.  Boots
   * 110 real skills (addTask, claimTask, completeTask, submitTask,
   * approveTask, rejectTask, listMyInbox, listOpen, listMine,
   * getTaskSnapshot, provisionMyCrew, …).
   *
   * Separate identity vault prefix so crew identity is isolated
   * from chat identity (per integration-plan decision #2).
   */
  const tasksIdentityVault = opts.tasksIdentityVault
    ?? makeBrowserVault('cc-tasks-id:');
  // Register the chatAgent's pubKey as the local member ("admin")
  // AND keep the legacy webid:* members for demo cross-actor tests.
  // Real tasks-v0 skills use `from` (caller) to look up the actor's
  // role; without the chatAgent's pubKey in the member list, every
  // call from canopy-chat would be treated as a stranger + denied
  // by RolePolicy.
  const tasksCrew = await createBrowserTasksAgent({
    bus,
    identityVault: tasksIdentityVault,
    crewConfig: opts.tasksCrewConfig ?? {
      crewId:  'cc-default',
      name:    'Canopy-chat tasks',
      kind:    'household',
      members: [
        // chatAgent's pubKey is what tasks-v0 sees as `from`; bind
        // it to the local-demo-user webid + admin role.
        { webid: chatId.pubKey, displayName: 'me', role: 'admin' },
        // Aliases so existing CC tests that mention 'webid:anne'
        // / 'webid:karl' / 'webid:maria' still resolve to known
        // crew members.
        { webid: 'webid:anne',  displayName: 'Anne',  role: 'coordinator' },
        { webid: 'webid:karl',  displayName: 'Karl',  role: 'member'      },
        { webid: 'webid:maria', displayName: 'Maria', role: 'member'      },
      ],
    },
    label: 'TasksCrew(cc)',
  });
  await chatAgent.hello(tasksCrew.address);

  // Pre-seed the demo crew with the same 4 tasks the mock used —
  // existing tests + the user-facing demo expect /mytasks to show
  // these out of the box.  Skip when caller passes seedTasks:false
  // (clean-slate fixtures, e.g. for persistence tests).
  if (opts.seedTasks !== false) {
    const SEED_TASKS = [
      { text: "Set up Anne's bedroom", requiredSkill: 'household' },
      { text: 'Fix the leaky tap',     requiredSkill: 'plumbing'  },
      { text: 'Order groceries',       assignee: 'webid:anne'     },
      { text: 'Take out the bins',     assignee: 'webid:karl'     },
    ];
    for (const seed of SEED_TASKS) {
      try {
        await chatAgent.invoke(tasksCrew.address, 'addTask', [DataPart(seed)]);
      } catch (err) {
        if (typeof console !== 'undefined') {
          console.warn('[realAgent] seed task failed:', err.message ?? err);
        }
      }
    }
  }

  /* ─── stoop real agent (slice 2b — integration plan 2026-05-23) ──
   *
   * Replaces the previous mock-stoop handlers (~85 lines: listFeed,
   * postRequest, searchPosts, stoop_briefSummary, getStoopProfile,
   * revealPeer) with the actual Stoop NeighborhoodAgent composed
   * in-process.  Boots 110 real stoop skills; ~6 surface via chat
   * ops today, the rest reachable via agent.callSkill('stoop', …).
   *
   * Separate identity vault prefix (`cc-stoop-id:`) so stoop's per-
   * buurt identity is isolated from chat + tasks (decision #2).
   * IndexedDBPersist via opts.persistDb keeps the local cache alive
   * across page reloads (slice 2a).
   */
  const stoopIdentityVault = opts.stoopIdentityVault
    ?? makeBrowserVault('cc-stoop-id:');
  const stoopAgent = await createBrowserStoopAgent({
    bus,
    identityVault: stoopIdentityVault,
    // Bind chatAgent's pubKey as the local actor so real stoop
    // skills' `from` lookups resolve back to 'me' (admin role).
    localActor: chatId.pubKey,
    group:      opts.stoopGroup ?? 'cc-default-buurt',
    members:    opts.stoopMembers ?? [
      { webid: chatId.pubKey,     displayName: 'me',    role: 'admin'       },
      { webid: 'webid:anne',      displayName: 'Anne',  role: 'coordinator' },
      { webid: 'webid:karl',      displayName: 'Karl',  role: 'member'      },
      { webid: 'webid:maria',     displayName: 'Maria', role: 'member'      },
    ],
    persistDb:  opts.stoopPersistDb,   // browser IDB; opt-in via caller
    label:      'StoopAgent(cc)',
  });
  await chatAgent.hello(stoopAgent.address);

  // Pre-seed the local actor's stoop handle + displayName so
  // /stoop-profile has something to show (real getMyProfile returns
  // {entry: null} until the user first sets these).  Opts out with
  // seedStoopProfile:false.
  if (opts.seedStoopProfile !== false) {
    try {
      await chatAgent.invoke(stoopAgent.address, 'setMyHandle', [DataPart({
        handle: opts.stoopHandle ?? 'frits-westend-42',
      })]);
      await chatAgent.invoke(stoopAgent.address, 'setMyDisplayName', [DataPart({
        displayName: opts.stoopDisplayName ?? 'Frits',
      })]);
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.warn('[realAgent] seed stoop profile failed:', err.message ?? err);
      }
    }
  }

  // Pre-seed 3 demo posts so /feed has content out of the box
  // (matches the previous mock seed; opts.seedStoopPosts:false to opt out).
  if (opts.seedStoopPosts !== false) {
    const SEED_POSTS = [
      { kind: 'ask',   text: 'Anne needs help moving a couch' },
      { kind: 'offer', text: 'Karl offers tomato seedlings'   },
      { kind: 'ask',   text: 'Maria looking for a bike pump'  },
    ];
    for (const seed of SEED_POSTS) {
      try {
        await chatAgent.invoke(stoopAgent.address, 'postRequest', [DataPart(seed)]);
      } catch (err) {
        if (typeof console !== 'undefined') {
          console.warn('[realAgent] seed stoop post failed:', err.message ?? err);
        }
      }
    }
  }

  /**
   * canopy-chat's CallSkill shape: `(appOrigin, opId, args) → payload`.
   *
   * Two routing targets:
   *   - 'household'  → hostAgent (chores, members, calendar skills,
   *                    stoop mock-real, folio mock-real)
   *   - 'tasks-v0'   → tasksCrew.address (the REAL tasks crew agent
   *                    via slice-1 integration; 110 skills)
   *
   * Some opIds are renamed across the boundary (the chat surface
   * uses `myInbox` historically; tasks-v0 exposes `listMyInbox`).
   * Adapt here so the chat-shell renderer stays stable.
   */
  const TASKS_OP_ALIAS = {
    myInbox:  'listMyInbox',                  // canopy-chat → tasks-v0
    // listMine on real tasks-v0 filters by t.assignee === from (only
    // tasks ALREADY assigned to me).  The chat-shell semantic of
    // /mytasks is broader — "everything actionable in my crew".  Map
    // to listOpen so the chat user sees what they expect.
    listMine: 'listOpen',
    // briefSummary / searchTasks: tasks-v0 doesn't expose these as
    // own skills today; canopy-chat derives them from listOpen below.
  };

  /**
   * Map real tasks-v0 status → chat-shell `state` field.
   *
   * Real status values (from item-store dag.js effectiveStatus):
   *   ready / blocked / claimed / submitted / rejected / complete
   * Chat-shell expects (mock-era):
   *   open / claimed / done
   *
   * 'rejected' goes back to 'claimed' (assignee can retry).
   * 'blocked' surfaces as 'open' for the chat-shell (UI gates the
   * action by openDeps.length).
   */
  function _statusToChatState(status, task) {
    if (task?.completedAt || status === 'complete') return 'done';
    if (status === 'submitted') return 'submitted';
    if (status === 'rejected')  return 'claimed';
    if (status === 'claimed' || task?.assignee) return 'claimed';
    return 'open';   // ready / blocked / undefined
  }

  /**
   * Stoop opId aliases — chat-shell vocabulary → real skill name.
   *   /feed       → listOpen     (no `listFeed` in real stoop)
   *   /stoop-profile → getMyProfile
   *   /reveal     → setPeerReveal
   */
  const STOOP_OP_ALIAS = {
    listFeed:        'listOpen',
    getStoopProfile: 'getMyProfile',
    revealPeer:      'setPeerReveal',
  };

  /** Slugify a name → safe crewId for provisionMyCrew. */
  function _slugifyCrewId(name) {
    const slug = String(name ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'crew';
    return /^[a-z0-9]/.test(slug) ? slug : `c-${slug}`;
  }

  const callSkill = async (appOrigin, opId, args) => {
    if (appOrigin === 'household') {
      const parts = [DataPart(args ?? {})];
      const result = await chatAgent.invoke(hostAgent.address, opId, parts);
      const first = Array.isArray(result) ? result[0] : null;
      return first?.data ?? null;
    }
    if (appOrigin === 'tasks-v0') {
      // Derived ops (not in the real crew agent): build the reply
      // from listMine + a small shape adapter.
      if (opId === 'briefSummary' || opId === 'tasks_briefSummary') {
        const list = await callSkill('tasks-v0', 'listMine', {});
        const items = (list?.items ?? []).filter((t) => t.state === 'open');
        if (items.length === 0) return { ok: true };   // empty → /brief skips
        return {
          items:   items.map((t) => ({ id: t.id, label: t.text ?? t.title })),
          message: `${items.length} open task${items.length === 1 ? '' : 's'}`,
        };
      }
      if (opId === 'searchTasks') {
        const q = String(args?.query ?? '').toLowerCase();
        if (!q) return { items: [] };
        const list = await callSkill('tasks-v0', 'listMine', {});
        const hits = (list?.items ?? []).filter((t) =>
          String(t.text ?? t.title ?? '').toLowerCase().includes(q),
        );
        return {
          items: hits.map((t) => ({ id: t.id, label: t.text ?? t.title, type: 'task' })),
        };
      }
      const realOpId = TASKS_OP_ALIAS[opId] ?? opId;
      // Per-op arg normalisation between the chat-shell vocabulary
      // and tasks-v0's real skill arg names.
      let realArgs = args ?? {};
      if (realOpId === 'provisionMyCrew' && !realArgs.crewId && realArgs.name) {
        // /crew-new sends a human name; real skill demands a slug.
        realArgs = { ...realArgs, crewId: _slugifyCrewId(realArgs.name) };
      }
      if (realOpId === 'rejectTask' && realArgs.reason && !realArgs.note) {
        // Chat-shell calls the rejection field `reason`; the real
        // item-store wants `note` (audit-log convention).
        realArgs = { ...realArgs, note: realArgs.reason };
      }
      // Pass through any reject note so the adapter can append it
      // to the chat-shell reply message.
      const noteHint = (realOpId === 'rejectTask') ? realArgs.note : undefined;
      if (realOpId === 'submitTask' && realArgs.note == null) {
        // submitTask also requires a non-empty note (audit-log).
        realArgs = { ...realArgs, note: 'submitted via chat' };
      }
      const parts = [DataPart(realArgs)];
      const result = await chatAgent.invoke(tasksCrew.address, realOpId, parts);
      const first = Array.isArray(result) ? result[0] : null;
      const data  = first?.data ?? null;
      if (data && noteHint) data.noteHint = noteHint;
      return adaptTasksReply(opId, data);
    }
    if (appOrigin === 'stoop') {
      // Derived: briefSummary builds a summary from listOpen since
      // stoop doesn't expose its own briefSummary skill.
      if (opId === 'briefSummary' || opId === 'stoop_briefSummary') {
        const list = await callSkill('stoop', 'listFeed', {});
        const items = list?.items ?? [];
        if (items.length === 0) return { ok: true };   // empty → /brief skips
        return {
          items:   items.slice(0, 3).map((p) => ({ id: p.id, label: p.text ?? p.label })),
          message: `${items.length} buurt request${items.length === 1 ? '' : 's'}`,
        };
      }
      // Derived: searchPosts (no dedicated skill in stoop today).
      if (opId === 'searchPosts') {
        const q = String(args?.query ?? '').toLowerCase();
        if (!q) return { items: [] };
        const list = await callSkill('stoop', 'listFeed', {});
        const hits = (list?.items ?? []).filter((p) =>
          String(p.text ?? p.label ?? '').toLowerCase().includes(q),
        );
        return {
          items: hits.map((p) => ({ id: p.id, label: p.text ?? p.label, type: 'post' })),
        };
      }
      const realOpId = STOOP_OP_ALIAS[opId] ?? opId;
      // Arg normalisation between chat-shell vocabulary + real stoop.
      let realArgs = args ?? {};
      if (realOpId === 'setPeerReveal') {
        // Chat-shell sends {peer, action: 'on'/'off'}; real takes
        // {peerWebid, reveal: boolean}.
        if (realArgs.peer && !realArgs.peerWebid) {
          realArgs = { ...realArgs, peerWebid: realArgs.peer };
        }
        if (typeof realArgs.action === 'string' && realArgs.reveal === undefined) {
          realArgs = { ...realArgs, reveal: realArgs.action.toLowerCase() === 'on' };
        }
      }
      const parts = [DataPart(realArgs)];
      const result = await chatAgent.invoke(stoopAgent.address, realOpId, parts);
      const first  = Array.isArray(result) ? result[0] : null;
      return adaptStoopReply(opId, first?.data ?? null, realArgs);
    }
    throw new Error(`realAgent: unknown appOrigin "${appOrigin}"`);
  };

  /**
   * Bridge real tasks-v0 reply shapes → canopy-chat's chat-shell
   * expectations.  Real skills return rich shapes
   * (e.g. `{task: {id, text, ...}}`); canopy-chat's renderer expects
   * the mock-era shapes (`{ok, message, itemId, _sync}`).
   *
   * Adapters keep the chat-shell stable while we run with real
   * tasks-v0 underneath.  Eventually the chat-shell renderer
   * absorbs the richer shape natively + these adapters fall away.
   */
  function adaptTasksReply(opId, data) {
    if (data == null) return null;
    // Skill returned an error envelope — pass through unchanged.
    if (data.ok === false) return data;

    // Real task skills variously return {task: ...} (addTask /
    // submitTask) OR {result: ...} (claimTask / completeTask) — the
    // field name differs by skill.  Normalise to a task variable.
    const task = data.task ?? data.result ?? null;

    // addTask: {task} → {ok, message, itemId, _sync}
    if (opId === 'addTask' && task) {
      return {
        ok:      true,
        message: `✓ Added task: ${task.text ?? task.title ?? task.id}`,
        itemId:  task.id,
        task,
        _sync:   simulateSync(),
      };
    }
    // claimTask / completeTask / submitTask / approveTask / rejectTask:
    // shape adapter — emit the chat-shell ok/message envelope.
    const verbMap = {
      claimTask:   'Claimed',
      completeTask:'Completed',
      submitTask:  'Submitted',
      approveTask: 'Approved',
      rejectTask:  'Rejected',
    };
    if (verbMap[opId] && task) {
      const title = task.text ?? task.title ?? task.id;
      // Reject path: surface the audit-log note in the message so
      // the chat-shell + user see WHY the task was rejected.
      const noteSuffix = (opId === 'rejectTask' && data.noteHint)
        ? ` — ${data.noteHint}` : '';
      return {
        ok:      true,
        message: `✓ ${verbMap[opId]}: ${title}${noteSuffix}`,
        itemId:  task.id,
        task,
        _sync:   simulateSync(),
      };
    }
    // listMine / listOpen: real returns {items: [...]} of task records.
    // Real items carry `status` (ready/claimed/submitted/rejected/
    // complete/blocked) but the chat-shell renderer + most tests
    // expect a mock-era `state` field (open/claimed/done).  Add the
    // mapped `state` alongside the original status.
    if ((opId === 'listMine' || opId === 'listOpen' || opId === 'listMyInbox' || opId === 'myInbox')
        && Array.isArray(data.items)) {
      return {
        ...data,
        items: data.items.map((t) => ({ ...t, state: _statusToChatState(t.status, t) })),
        _sync: simulateSync(),
      };
    }
    // getTaskSnapshot: real returns {task: {...}} → flatten to embed-card shape
    if (opId === 'getTaskSnapshot' && data.task) {
      const t = data.task;
      return {
        id:    t.id,
        type:  'task',
        state: t.state ?? 'open',
        title: t.text ?? t.title ?? t.id,
        fields: { state: t.state ?? 'open', assignee: t.assignee ?? 'unassigned' },
      };
    }
    // provisionMyCrew: real returns {crew: {...}} (or similar) →
    // adapt to mock-era {ok, message, crewId}.
    if (opId === 'provisionMyCrew') {
      const crewId = data.crewId ?? data.crew?.crewId ?? data.id ?? null;
      return {
        ok:      true,
        message: `✓ Crew provisioned (id=${crewId ?? '?'})`,
        crewId,
        crew:    data.crew ?? data,
        _sync:   simulateSync(),
      };
    }
    // Default: pass through.
    return data;
  }

  /**
   * Bridge real stoop reply shapes → canopy-chat's chat-shell
   * expectations.  Mock-era shapes the chat renderer was built
   * against:
   *   postRequest     → {ok, message, itemId, _sync}
   *   listFeed/Open   → {items: [{id, label, state, ...}], _sync}
   *   getMyProfile    → {title, handle, displayName, buurt, ...}
   *   setPeerReveal   → {ok, message, peer, action}
   */
  function adaptStoopReply(opId, data, args) {
    if (data == null) return null;
    if (data.ok === false || data.error)  {
      // Pass through error envelopes; canopy-chat dispatch handles them.
      return data.ok === false ? data : { ok: false, error: data.error };
    }

    // postRequest: {requestId, claims} → {ok, message, itemId, _sync}
    if (opId === 'postRequest' && data.requestId) {
      const text = args?.text ?? '(post)';
      return {
        ok:      true,
        message: `✓ Posted: ${text}`,
        itemId:  data.requestId,
        request: data,                       // preserve full shape
        _sync:   simulateSync(),
      };
    }
    // listFeed / listOpen / listMyRequests: items[] of {id, text, ...}
    // → add a `label` alias on each row + add _sync envelope so the
    // chat shell's renderer picks up the standard chat shapes.
    if ((opId === 'listFeed' || opId === 'listOpen' || opId === 'listMyRequests')
        && Array.isArray(data.items)) {
      return {
        ...data,
        items: data.items.map((p) => ({
          ...p,
          label: p.text ?? p.label ?? p.id,
          // Chat-shell convention: `state: open|done`.  Stoop posts
          // are "open" while addedBy is set + not closed; "done"
          // when there's a `closedAt`.
          state: p.closedAt ? 'done' : 'open',
        })),
        _sync: simulateSync(),
      };
    }
    // getMyProfile: real returns {entry: {handle, displayName, ...}|null}
    // → adapt to {title, handle, displayName, buurt}.
    if (opId === 'getStoopProfile') {
      const e = data.entry ?? {};
      return {
        title:       'Stoop profile',
        handle:      e.handle ?? null,
        displayName: e.displayName ?? null,
        buurt:       opts.stoopGroup ?? 'cc-default-buurt',
      };
    }
    // setPeerReveal: real returns {} on success → adapt to mock shape.
    if (opId === 'revealPeer') {
      const peer   = args?.peer ?? args?.peerWebid ?? '(peer)';
      const action = args?.action ?? (args?.reveal ? 'on' : 'off');
      return {
        ok: true,
        message: action === 'on'
          ? `🔓 Reveal flipped on for ${peer}. (Bilateral — they must flip on their side too.)`
          : `🔒 Reveal flipped off for ${peer}.`,
        peer, action,
      };
    }
    // Default: pass through.
    return data;
  }

  return {
    manifest: mockHouseholdManifest,    // SAME declaration as v0.1.4 mock
    callSkill,
    reset() { chores = SEED_CHORES.map((c) => ({ ...c })); },
    state() { return chores.map((c) => ({ ...c })); },
    meta: {
      hostAddress: hostAgent.address,
      chatAddress: chatAgent.address,
      transport:   'internal',
    },
    // v0.7.12 — caller wires the invite-attendee callback after
    // construction (so the simPeers map + threadStore from main.js
    // are visible here).
    setInviteAttendee(fn) {
      if (typeof fn === 'function') inviteAttendeeRef = fn;
    },
    // v0.7.P2 — caller wires the pod-writer on sign-in / clears on
    // sign-out so calendar's .ics feed writes-through to the user's
    // pod under <pod>/canopy/calendar/feed.ics.
    setCalendarPodWriter,
    // Expose identity info for /me + /pod-status.  pubKeys are stable
    // across refreshes because identity is persisted to VaultLocalStorage.
    identity: {
      host: { pubKey: hostId.pubKey, stableId: hostId.stableId },
      chat: { pubKey: chatId.pubKey, stableId: chatId.stableId },
    },

    // Cross-peer state (delegates to sa.peer).  Same surface main.js
    // already consumes: peer.address / peer.status / peer.error.
    peer: sa.peer,

    /**
     * Connect the NKN cross-peer transport.  Called by main.js when
     * nkn-sdk is loaded (window.nkn from CDN).  Late-binding wiring
     * for { nknLib, onPeerMessage } supported by sa.peer.connect.
     */
    async connectPeerTransport({ nknLib, onPeerMessage }) {
      if (!nknLib) throw new Error('connectPeerTransport: nknLib required (window.nkn)');
      await sa.peer.connect({ nknLib, onPeerMessage });
      return sa.peer;
    },

    /**
     * Fire-and-forget cross-peer send.  Auto-HI on first contact,
     * SecurityLayer sign+encrypt — both handled inside the factory.
     * S1 mute-block: throws when targetAddress is muted.
     */
    async sendPeerMessage(targetAddress, payload) {
      return sa.peer.sendTo(targetAddress, payload);
    },

    /**
     * Rotate the chat-agent's Ed25519 identity.  Old key stays valid
     * for a 7-day grace period; KeyRotation.broadcast notifies known
     * peers.  S6 autoLog fires 'identity.rotate'.
     */
    async rotateChatIdentity(rotateOpts = {}) {
      return sa.rotateIdentity(rotateOpts);
    },

    /** Diagnostic for /security-status (proxies through the factory). */
    securityStatus() { return sa.securityStatus(); },

    /**
     * Direct access to the underlying secure-agent.  Lets new
     * canopy-chat commands (mute, audit-tail, claim, …) tap every
     * primitive the factory wires without re-exposing each one.
     */
    sa,
  };
}
