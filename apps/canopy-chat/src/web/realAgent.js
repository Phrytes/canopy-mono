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
import { createBrowserFolioAgent } from '@canopy-app/folio/browser';

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


  /* folio's web-only handlers used to live here (~125 lines of mock-
   * real handlers registered on hostAgent).  Slice 4 of the
   * integration-plan-2026-05-23 moved them into a dedicated browser
   * agent — see the `createBrowserFolioAgent` boot block below the
   * tasks/stoop blocks, and the 'folio' branch in `callSkill`.
   *
   * shareFolder now issues a REAL PodCapabilityToken via
   * autoShare.mintShareToken; the other skills retained their
   * placeholder reply shapes (real bytes/pod-IO is deferred to slice
   * 5 + the mobile pivot).
   */

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

  /* ─── folio web-only agent (slice 4 — integration plan 2026-05-23) ──
   *
   * Replaces the previous in-host folio handlers (~125 lines: readNote
   * / shareFolder / listFiles / searchFiles / getFileSnapshot /
   * verifyPodState / deleteFromPod / downloadFile / saveToMyPod /
   * folio_briefSummary / folioStatus) with a dedicated folio agent
   * composed in-process.  shareFolder now issues a REAL
   * PodCapabilityToken via autoShare.mintShareToken; the other skills
   * preserve their mock-era reply shapes (real pod-IO + Blob bytes
   * stay deferred per the slice-4 scope reduction).
   *
   * Separate identity vault prefix (`cc-folio-id:`) so folio's web
   * identity is isolated from chat / tasks / stoop (decision #2).
   * podRoot is reserved — when canopy-chat lands real pod-attached
   * folio writes (slice 5 / mobile), pass `opts.folioPodRoot` so
   * shareFolder tokens carry the real pod URI.
   */
  const folioIdentityVault = opts.folioIdentityVault
    ?? makeBrowserVault('cc-folio-id:');
  const folioAgent = await createBrowserFolioAgent({
    bus,
    identityVault: folioIdentityVault,
    podRoot:       opts.folioPodRoot,
    seedFiles:     opts.folioSeedFiles,   // pass [] for clean-slate fixtures
    label:         'FolioAgent(cc)',
  });
  await chatAgent.hello(folioAgent.address);

  /**
   * canopy-chat's CallSkill shape: `(appOrigin, opId, args) → payload`.
   *
   * Routing targets:
   *   - 'household'  → hostAgent (chores, members, calendar skills)
   *   - 'tasks-v0'   → tasksCrew.address (the REAL tasks crew agent
   *                    via slice-1 integration; 110 skills)
   *   - 'stoop'      → stoopAgent.address (slice-2b NeighborhoodAgent)
   *   - 'folio'      → folioAgent.address (slice-4 web-only agent)
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
      if (realOpId === 'issueInvite') {
        // Chat-shell flag `ttl-hours` → real arg `ttlMs`.  Default 24h
        // when omitted.
        const hours = Number.isFinite(Number(realArgs['ttl-hours']))
          ? Number(realArgs['ttl-hours']) : 24;
        realArgs = { ...realArgs, ttlMs: hours * 60 * 60 * 1000 };
      }
      // #190 (B3) — crew admin skills require crewId; auto-inject
      // from the configured crew so the user doesn't have to type it.
      const CREW_AUTO_INJECT = new Set([
        'getCrewConfig', 'pauseCrew', 'unpauseCrew',
        'archiveCrew',   'unarchiveCrew', 'issueInvite',
        'listAwaitingApproval', 'getMyCrews',
      ]);
      if (CREW_AUTO_INJECT.has(realOpId) && !realArgs.crewId) {
        const crewId = opts.tasksCrewConfig?.crewId ?? 'cc-default';
        realArgs = { ...realArgs, crewId };
      }
      if (realOpId === 'archiveCrew' && realArgs.confirm !== true) {
        // Q27 two-step confirm.
        return {
          ok: false,
          error: 'Archiving the crew puts it read-only. Re-run with --confirm=true to proceed.',
        };
      }
      if (realOpId === 'redeemInvite' && typeof realArgs.invite === 'string') {
        // User pastes either a QR URL (`stoop-invite://<base64url>`) or
        // raw JSON.  Decode the URL form back to the invite object that
        // the real skill expects.  Pass JSON through unchanged.
        let inv = realArgs.invite.trim();
        const PREFIX = 'stoop-invite://';
        if (inv.startsWith(PREFIX)) {
          try {
            const b64 = inv.slice(PREFIX.length);
            const padded = b64.replace(/-/g, '+').replace(/_/g, '/')
                              + '=='.slice(0, (4 - b64.length % 4) % 4);
            const json = typeof globalThis.atob === 'function'
              ? globalThis.atob(padded) : padded;
            realArgs = { ...realArgs, invite: JSON.parse(json) };
          } catch (err) {
            return { ok: false, error: `Couldn't decode invite URL: ${err.message ?? err}` };
          }
        } else if (inv.startsWith('{')) {
          try {
            realArgs = { ...realArgs, invite: JSON.parse(inv) };
          } catch (err) {
            return { ok: false, error: `Couldn't parse invite JSON: ${err.message ?? err}` };
          }
        }
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
      if (realOpId === 'setHolidayMode') {
        // Chat-shell sends {on: 'on'|'off'} (enum from /holiday-mode
        // <on|off>); real skill takes {on: boolean}.
        if (typeof realArgs.on === 'string') {
          realArgs = { ...realArgs, on: realArgs.on.toLowerCase() === 'on' };
        }
      }
      // Chat-shell trust enums use English ('known' / 'trusted');
      // stoop's underlying skill persists Dutch ('bekend' / 'vertrouwd').
      // Translate at the boundary so the chat surface stays EN-first.
      const TRUST_EN_TO_NL = { known: 'bekend', trusted: 'vertrouwd' };
      if (realOpId === 'listContacts') {
        // Chat-shell flag `min-trust` → real arg `minTrust`.
        if (realArgs['min-trust'] && !realArgs.minTrust) {
          realArgs = {
            ...realArgs,
            minTrust: TRUST_EN_TO_NL[realArgs['min-trust']] ?? realArgs['min-trust'],
          };
        }
      }
      if (realOpId === 'setContactTrust') {
        if (realArgs.level === 'none') {
          // Chat-shell uses 'none' to clear; real skill takes null.
          realArgs = { ...realArgs, level: null };
        } else if (TRUST_EN_TO_NL[realArgs.level]) {
          realArgs = { ...realArgs, level: TRUST_EN_TO_NL[realArgs.level] };
        }
      }
      if (realOpId === 'getContactShareQr' && realArgs.trust) {
        // Chat-shell flag `trust` → real arg `trustOffer` + EN→NL.
        realArgs = {
          ...realArgs,
          trustOffer: TRUST_EN_TO_NL[realArgs.trust] ?? realArgs.trust,
        };
      }
      // #189 — buurt/group skills.  Several require groupId; the
      // chat-shell knows which buurt this agent is in (single-buurt
      // mode), so auto-inject when missing.
      const REQUIRES_GROUP_ID = new Set([
        'getGroupRules', 'leaveGroup', 'getMyMembershipStatus',
        'editGroupRules', 'removeMember',
      ]);
      if (REQUIRES_GROUP_ID.has(realOpId) && !realArgs.groupId) {
        realArgs = {
          ...realArgs,
          groupId: opts.stoopGroup ?? 'cc-default-buurt',
        };
      }
      if (realOpId === 'leaveGroup' && realArgs.confirm !== true) {
        // Q27-style two-step confirm.  Short-circuit before invoke.
        return {
          ok: false,
          error: 'Leaving your buurt is irreversible. Re-run with --confirm=true to proceed.',
        };
      }
      // Synthesize a `/groups` op locally — there's no listMyGroups
      // skill in single-buurt mode; we render what we know.  After
      // invoke for member count.
      if (realOpId === 'getCurrentGroup') {
        const membersResult = await chatAgent.invoke(
          stoopAgent.address, 'listGroupMembers',
          [DataPart({ groupId: opts.stoopGroup ?? 'cc-default-buurt' })],
        );
        const members = membersResult?.[0]?.data?.members ?? [];
        return {
          title:       'Your buurt',
          groupId:     opts.stoopGroup ?? 'cc-default-buurt',
          memberCount: members.length,
          mode:        'single-buurt (V0)',
          note:        'Multi-buurt support requires multi-agent topology — separate slice.',
        };
      }
      const parts = [DataPart(realArgs)];
      const result = await chatAgent.invoke(stoopAgent.address, realOpId, parts);
      const first  = Array.isArray(result) ? result[0] : null;
      return adaptStoopReply(opId, first?.data ?? null, realArgs);
    }
    if (appOrigin === 'folio') {
      // Folio's web-only skills already return chat-shell-shaped
      // replies (no adapter layer needed today).  The one alias is
      // briefSummary → folio_briefSummary so the chat-shell's generic
      // /brief op reaches folio's named briefSummary skill.
      const realOpId = (opId === 'briefSummary') ? 'folio_briefSummary' : opId;
      const parts = [DataPart(args ?? {})];
      const result = await chatAgent.invoke(folioAgent.address, realOpId, parts);
      const first  = Array.isArray(result) ? result[0] : null;
      return first?.data ?? null;
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
    // #192 (B8) — DAG hard-dep blocking surface.  Real skill returns
    // {error: 'has-open-dependencies', openDeps: [...]} when the user
    // tries to complete a task whose subtasks aren't done.  Translate
    // to a clear chat-shell message + structured payload the UI can
    // render the dep IDs from.
    if ((opId === 'completeTask' || opId === 'approveTask')
        && data?.error === 'has-open-dependencies') {
      const deps = Array.isArray(data.openDeps) ? data.openDeps : [];
      return {
        ok:    false,
        error: `🔒 Blocked: ${deps.length} open dependenc${deps.length === 1 ? 'y' : 'ies'} (${deps.slice(0, 3).join(', ')}${deps.length > 3 ? '…' : ''}). Close the sub-tasks first.`,
        openDeps: deps,
      };
    }
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
    // mapped `state` alongside the original status.  #192 (B8): also
    // surface a `blockedBy` label when the task has openDeps so the
    // user sees the gate without clicking [Mark complete] first.
    if ((opId === 'listMine' || opId === 'listOpen' || opId === 'listMyInbox' || opId === 'myInbox')
        && Array.isArray(data.items)) {
      return {
        ...data,
        items: data.items.map((t) => {
          const openDeps = Array.isArray(t.openDeps) ? t.openDeps : [];
          const baseRow = { ...t, state: _statusToChatState(t.status, t) };
          if (openDeps.length > 0) {
            baseRow.blockedBy = openDeps;
            baseRow.label = `${t.text ?? t.title ?? t.id} 🔒 blocked by ${openDeps.length} dep${openDeps.length === 1 ? '' : 's'}`;
          }
          return baseRow;
        }),
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
    // issueInvite: real returns {invite: {...JWT-shaped token...}} →
    // record-shape reply with a `qr` URI the chat-shell renders as
    // an actual scannable QR canvas (see classifyFieldKind + the
    // 'qr' branch in domAdapter.renderRecordPanel).  Inviter can
    // [Copy] the URL fallback or have the invitee scan the QR.
    if (opId === 'issueInvite' && data.invite) {
      const inv = data.invite;
      const json = typeof inv === 'string' ? inv : JSON.stringify(inv);
      // Browser-safe base64url encode (no Buffer dep).
      const b64url = typeof globalThis.btoa === 'function'
        ? globalThis.btoa(json)
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
        : json;
      const qrUri = `stoop-invite://${b64url}`;
      const expires = inv?.expiresAt
        ? new Date(inv.expiresAt).toISOString()
        : '(no expiry)';
      return {
        title:    'Crew invite',
        role:     inv?.role ?? 'member',
        expires,
        invite:   qrUri,   // classified as kind:'qr' by classifyFieldKind
        message:  `🎟️ Single-use invite minted. Have the invitee scan the QR or paste the URL into /redeem-invite.`,
      };
    }
    // redeemInvite: real returns {groupProof, members, ...} → friendly text.
    if (opId === 'redeemInvite' && (data.groupProof || data.members)) {
      const memberCount = Array.isArray(data.members) ? data.members.length : '?';
      return {
        ok: true,
        message: `✓ Joined crew. ${memberCount} members visible. /mytasks shows the crew's tasks.`,
        crew:   data,
        _sync:  simulateSync(),
      };
    }
    // #191 (B5) — getMyCrews: {crews: [{crewId, name, kind, counts}]}
    // → chat-shell list with crew-shape rows.  Each row's label
    // surfaces counters inline so the user sees the dashboard at a
    // glance without expanding rows.
    if (opId === 'getMyCrews' && Array.isArray(data.crews)) {
      if (data.crews.length === 0) {
        return {
          items:   [],
          message: 'You\'re not in any crews yet. Use /crew-new to create one.',
        };
      }
      let totalOpen = 0, totalOverdue = 0, totalMine = 0, totalApproval = 0;
      const items = data.crews.map((c) => {
        const cnt = c.counts ?? {};
        totalOpen     += cnt.open ?? 0;
        totalOverdue  += cnt.overdue ?? 0;
        totalMine     += cnt.mine ?? 0;
        totalApproval += cnt.awaitingApproval ?? 0;
        const stats = [
          `${cnt.open ?? 0} open`,
          cnt.overdue ? `${cnt.overdue} overdue` : null,
          cnt.mine    ? `${cnt.mine} mine`       : null,
          cnt.awaitingApproval ? `${cnt.awaitingApproval} awaiting approval` : null,
        ].filter(Boolean).join(' · ');
        return {
          id:    c.crewId,
          type:  'crew',
          label: `${c.name} (${c.kind}) — ${stats}`,
          crewId: c.crewId,
          name:   c.name,
          kind:   c.kind,
          counts: cnt,
        };
      });
      return {
        items,
        message: `Crews: ${data.crews.length} · Total: ${totalOpen} open, ${totalOverdue} overdue, ${totalMine} mine, ${totalApproval} awaiting approval`,
        _sync: simulateSync(),
      };
    }
    // #190 (B3) — getCrewConfig: {crew: {...}} or {crew: null} →
    // record reply with members + paused/archived state.
    if (opId === 'getCrewConfig') {
      const crew = data.crew;
      if (!crew) {
        return {
          title:   'Crew config',
          status:  'not-found',
          message: 'No crew config found for this id.',
        };
      }
      return {
        title:       'Crew config',
        crewId:      crew.crewId,
        name:        crew.name ?? crew.crewId,
        kind:        crew.kind ?? 'household',
        memberCount: Array.isArray(crew.members) ? crew.members.length : 0,
        members:     (crew.members ?? []).map((m) => ({
          webid:       m.webid,
          displayName: m.displayName,
          role:        m.role ?? 'member',
        })),
        paused:      !!crew.paused,
        archived:    !!crew.archived,
      };
    }
    // #190 — pauseCrew / unpauseCrew / archiveCrew / unarchiveCrew:
    // real returns {ok, paused?, archived?} → friendly text reply.
    if (opId === 'pauseCrew' && data.ok) {
      return {
        ok: true,
        message: data.paused
          ? '⏸️ Crew paused. No new tasks; existing tasks remain workable.'
          : '✓ Crew already unpaused.',
        _sync: simulateSync(),
      };
    }
    if (opId === 'unpauseCrew' && data.ok) {
      return {
        ok: true,
        message: data.paused
          ? '✓ Crew is paused.'
          : '▶️ Crew resumed. New tasks can be added again.',
        _sync: simulateSync(),
      };
    }
    if (opId === 'archiveCrew' && data.ok) {
      return {
        ok: true,
        message: data.archived
          ? '📦 Crew archived. Read-only ledger; use /unarchive-crew to reverse.'
          : '✓ Crew already unarchived.',
        _sync: simulateSync(),
      };
    }
    if (opId === 'unarchiveCrew' && data.ok) {
      return {
        ok: true,
        message: data.archived
          ? '✓ Crew is archived.'
          : '✓ Crew unarchived. Active again.',
        _sync: simulateSync(),
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
    // setHolidayMode: real returns {holidayMode: bool} → friendly text.
    if (opId === 'setHolidayMode' && typeof data.holidayMode === 'boolean') {
      return {
        ok: true,
        message: data.holidayMode
          ? '🌙 Holiday mode on. Notifications suppressed; your skills marked unavailable.'
          : '🌅 Holiday mode off. Notifications and skill-match resume.',
        holidayMode: data.holidayMode,
      };
    }
    // getHolidayMode: real returns {holidayMode: bool} → record reply.
    if (opId === 'getHolidayMode' && typeof data.holidayMode === 'boolean') {
      return {
        title:       'Holiday mode',
        holidayMode: data.holidayMode,
        status:      data.holidayMode ? 'on' : 'off',
      };
    }
    // listContacts: real returns {contacts: [...]} → chat-shell {items: [...]}.
    // Each contact carries {webid, displayName?, handle?, trustLevel?, tags?, ...};
    // surface displayName || handle || webid as the label.  Stoop
    // persists trustLevel in Dutch ('bekend'/'vertrouwd'); we translate
    // to EN for the chat surface.
    const TRUST_NL_TO_EN = { bekend: 'known', vertrouwd: 'trusted' };
    if (opId === 'listContacts' && Array.isArray(data.contacts)) {
      return {
        items: data.contacts.map((c) => ({
          id:          c.webid,
          type:        'contact',
          webid:       c.webid,
          label:       c.displayName ?? c.handle ?? c.webid,
          handle:      c.handle ?? null,
          trustLevel:  c.trustLevel ? (TRUST_NL_TO_EN[c.trustLevel] ?? c.trustLevel) : null,
          tags:        c.tags ?? [],
        })),
        _sync: simulateSync(),
      };
    }
    // addContact / setContactTrust / setContactTags: real returns
    // {contact} → friendly text reply.
    if ((opId === 'addContact' || opId === 'setContactTrust' || opId === 'setContactTags')
        && data.contact) {
      const c = data.contact;
      const who = c.displayName ?? c.handle ?? c.webid;
      const trustEn = c.trustLevel
        ? (TRUST_NL_TO_EN[c.trustLevel] ?? c.trustLevel) : null;
      const msg = opId === 'addContact'
        ? `✓ Added contact: ${who}`
        : opId === 'setContactTrust'
          ? `✓ Trust level updated for ${who}: ${trustEn ?? '(cleared)'}`
          : `✓ Tags updated for ${who}: ${(c.tags ?? []).join(', ') || '(none)'}`;
      return {
        ok: true, message: msg, contact: { ...c, trustLevel: trustEn }, _sync: simulateSync(),
      };
    }
    // removeContact: real returns {ok: true} → friendly text.
    if (opId === 'removeContact' && data.ok === true) {
      const who = args?.webid ?? '(contact)';
      return {
        ok: true,
        message: `✓ Removed contact: ${who}`,
        _sync: simulateSync(),
      };
    }
    // getContactShareQr: real returns {payload: 'stoop-contact://...'}
    // → record reply with the URL spelt out (user can paste into any
    // QR generator).  Canvas-rendered QR image is a follow-up.
    if (opId === 'getContactShareQr' && data.payload) {
      return {
        title:    'Share your contact card',
        trust:    args?.trustOffer ?? args?.trust ?? 'bekend',
        payload:  data.payload,
        message:  'Copy the payload above + paste into any QR generator.  The receiver scans + uses /add-contact to add you with the proposed trust level.',
      };
    }
    // #189 — listGroupMembers: {groupId, members: []} → chat-shell list.
    // Each member carries webid/handle/displayName/role from MemberMap.
    if (opId === 'listGroupMembers' && Array.isArray(data.members)) {
      return {
        items: data.members.map((m) => ({
          id:          m.webid,
          type:        'member',
          webid:       m.webid,
          label:       m.displayName ?? m.handle ?? m.webid,
          handle:      m.handle ?? null,
          role:        m.role ?? 'member',
        })),
        _sync: simulateSync(),
      };
    }
    // #189 — getGroupRules: real returns a rules-item or null →
    // record-shape reply with the latest rules text.
    if (opId === 'getGroupRules') {
      if (!data || data.error) {
        return {
          title:   'Group rules',
          status:  'no-rules-set',
          message: 'No rules have been set for this buurt yet.',
        };
      }
      // Real shape: rules item with source.rulesText (or similar).
      const item = data.item ?? data;
      const rulesText = item?.source?.rulesText
        ?? item?.source?.text
        ?? item?.text
        ?? '(rules payload shape unknown — see console)';
      if (typeof console !== 'undefined' && rulesText.startsWith('(rules')) {
        console.warn('[realAgent] getGroupRules: unexpected payload shape', data);
      }
      return {
        title:   'Group rules',
        groupId: item?.source?.groupId ?? args?.groupId ?? '(unknown)',
        rules:   rulesText,
        addedAt: item?.addedAt ? new Date(item.addedAt).toISOString() : null,
      };
    }
    // #189 — leaveGroup: real returns {ok} or {error}.  Confirm-gated
    // above; when invoked for real, friendly text.
    if (opId === 'leaveGroup' && data.ok) {
      return {
        ok: true,
        message: '👋 Left the buurt. Your local data stays; you no longer receive feed updates.',
        _sync: simulateSync(),
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

    // A1 (2026-05-23) — second cross-peer transport: WebSocket relay.
    // Symmetric to .peer; main.js + the /set-relay slash use these.
    relay: sa.relay,
    get transportMode() { return sa.transportMode; },
    setTransportMode:    sa.setTransportMode,

    // The slash handlers persist the relay URL + transport mode here.
    // Expose the SA's identity-vault so /set-relay can stash both
    // across reloads (key: cc-relay-url; cc-transport-mode).
    vault: sa.identity?.vault ?? sa.vault ?? null,

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
