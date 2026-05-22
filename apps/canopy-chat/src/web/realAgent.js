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
import { VaultMemory } from '@canopy/vault';

import { mockHouseholdManifest } from './mockAgent.js';

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

  // v0.7.7 — optional event publisher.  When supplied, mutation
  // skills publish item-changed events via this callback so the
  // chat-shell EventRouter routes them to matching threads.
  // Unblocks J8's "household alerts" real-event demo.
  const publishEvent = typeof opts.publishEvent === 'function'
    ? opts.publishEvent
    : () => {};

  const bus      = new InternalBus();
  const hostId   = await AgentIdentity.generate(new VaultMemory());
  const chatId   = await AgentIdentity.generate(new VaultMemory());

  // InternalTransport's address must equal the agent's pubKey so the
  // bus routes envelopes to the right listener.
  const hostTransport = new InternalTransport(bus, hostId.pubKey);
  const chatTransport = new InternalTransport(bus, chatId.pubKey);

  const hostAgent = new Agent({ identity: hostId, transport: hostTransport });
  const chatAgent = new Agent({ identity: chatId, transport: chatTransport });

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

  /* ─────────── v0.7.2 — tasks-v0 real skills ─────────── */
  // Mock-but-realistic task state.  Same shape as tasks-v0's real
  // itemStore; lives in canopy-chat's browser memory for the demo.
  // When tasks-v0's real agent migrates browser-side (separate
  // effort), this stub is replaced by composing its actual agent.
  const SEED_TASKS = [
    { id: 't-1', text: 'Set up Anne\'s bedroom', type: 'task', state: 'open',    assignee: null,        requiredSkill: 'household' },
    { id: 't-2', text: 'Fix the leaky tap',      type: 'task', state: 'open',    assignee: null,        requiredSkill: 'plumbing'  },
    { id: 't-3', text: 'Order groceries',        type: 'task', state: 'claimed', assignee: 'webid:anne',requiredSkill: null        },
    { id: 't-4', text: 'Take out the bins',      type: 'task', state: 'done',    assignee: 'webid:karl',requiredSkill: null        },
  ];
  let tasks = SEED_TASKS.map((t) => ({ ...t }));

  hostAgent.register('addTask', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    const text = String(a.text ?? '').trim();
    if (!text) return [DataPart({ ok: false, error: 'text required' })];
    const id = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const task = {
      id, text, type: 'task', state: 'open',
      assignee:      a.assignee      ?? null,
      requiredSkill: a.requiredSkill ?? null,
    };
    tasks.push(task);
    publishEvent({
      app: 'tasks-v0', type: 'item-changed',
      itemRef: { app: 'tasks-v0', type: 'task', id },
      payload: { message: `✓ Added task: ${text}` },
    });
    return [DataPart({
      ok: true, message: `✓ Added task: ${text}`, itemId: id, _sync: simulateSync(),
    })];
  });

  hostAgent.register('listMine', async () => {
    // v0.7 demo: 'mine' interpreted as 'open + claimed by anyone';
    // real tasks-v0 filters by actor's webid.
    const items = tasks.filter((t) => t.state === 'open' || t.state === 'claimed');
    return [DataPart({ items, _sync: simulateSync() })];
  });

  hostAgent.register('claimTask', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    const target = tasks.find((t) => t.id === a.id);
    if (!target) return [DataPart({ ok: false, error: `No task with id "${a.id}".` })];
    if (target.state !== 'open') {
      return [DataPart({ ok: false, error: `Task "${target.text}" not in open state.` })];
    }
    target.state    = 'claimed';
    target.assignee = a.assignee ?? 'webid:local-demo-user';
    return [DataPart({
      ok: true, message: `✓ Claimed: ${target.text}`, itemId: target.id, _sync: simulateSync(),
    })];
  });

  hostAgent.register('completeTask', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    const target = tasks.find((t) => t.id === a.id);
    if (!target) return [DataPart({ ok: false, error: `No task with id "${a.id}".` })];
    if (target.state === 'done') {
      return [DataPart({ ok: false, error: `Task "${target.text}" is already done.` })];
    }
    target.state = 'done';
    publishEvent({
      app: 'tasks-v0', type: 'item-changed',
      itemRef: { app: 'tasks-v0', type: 'task', id: target.id },
      payload: { message: `✓ Completed: ${target.text}` },
    });
    return [DataPart({
      ok: true, message: `✓ Completed: ${target.text}`, itemId: target.id, _sync: simulateSync(),
    })];
  });

  hostAgent.register('getTaskSnapshot', async ({ parts }) => {
    const id = parts?.[0]?.data?.id;
    const target = tasks.find((t) => t.id === id);
    if (!target) return [DataPart({ ok: false, error: `No task with id "${id}".` })];
    return [DataPart({
      id:    target.id,
      type:  'task',
      state: target.state,
      title: target.text,
      fields: {
        state:    target.state,
        assignee: target.assignee ?? 'unassigned',
        ...(target.requiredSkill ? { requires: target.requiredSkill } : {}),
      },
    })];
  });

  // v0.7.5 — searchTasks: text search across cached tasks.
  hostAgent.register('searchTasks', async ({ parts }) => {
    const q = String(parts?.[0]?.data?.query ?? '').toLowerCase();
    if (!q) return [DataPart({ items: [] })];
    const hits = tasks.filter((tk) => tk.text.toLowerCase().includes(q));
    return [DataPart({
      items: hits.map((tk) => ({ id: tk.id, label: tk.text, type: 'task' })),
    })];
  });

  // Tasks-v0 briefSummary for the /brief aggregator (Q30).
  hostAgent.register('tasks_briefSummary', async () => {
    const open = tasks.filter((t) => t.state === 'open');
    if (open.length === 0) return [DataPart({ ok: true })];   // empty → skipped
    return [DataPart({
      items:   open.map((t) => ({ id: t.id, label: t.text })),
      message: `${open.length} open task${open.length === 1 ? '' : 's'}`,
    })];
  });

  /* ─────────── v0.7.3 — stoop real skills ─────────── */
  const SEED_POSTS = [
    { id: 'p-1', label: 'Anne needs help moving a couch',   state: 'open',   actor: 'webid:anne' },
    { id: 'p-2', label: 'Karl offers tomato seedlings',     state: 'open',   actor: 'webid:karl' },
    { id: 'p-3', label: 'Maria looking for a bike pump',    state: 'open',   actor: 'webid:maria' },
  ];
  let posts = SEED_POSTS.map((p) => ({ ...p }));

  hostAgent.register('listFeed', async () => {
    return [DataPart({
      items: posts.filter((p) => p.state === 'open'),
      _sync: simulateSync(),
    })];
  });

  hostAgent.register('postRequest', async ({ parts }) => {
    const a = parts?.[0]?.data ?? {};
    const text = String(a.text ?? '').trim();
    if (!text) return [DataPart({ ok: false, error: 'text required' })];
    const id = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    posts.unshift({ id, label: text, state: 'open', actor: 'webid:local-demo-user' });
    publishEvent({
      app: 'stoop', type: 'notification',
      actor: 'webid:local-demo-user',
      itemRef: { app: 'stoop', type: 'post', id },
      payload: { message: `New buurt post: ${text}` },
    });
    return [DataPart({
      ok: true, message: `✓ Posted: ${text}`, itemId: id, _sync: simulateSync(),
    })];
  });

  // v0.7.5 — searchPosts.
  hostAgent.register('searchPosts', async ({ parts }) => {
    const q = String(parts?.[0]?.data?.query ?? '').toLowerCase();
    if (!q) return [DataPart({ items: [] })];
    const hits = posts.filter((p) => p.label.toLowerCase().includes(q));
    return [DataPart({
      items: hits.map((p) => ({ id: p.id, label: p.label, type: 'post' })),
    })];
  });

  hostAgent.register('stoop_briefSummary', async () => {
    const open = posts.filter((p) => p.state === 'open');
    if (open.length === 0) return [DataPart({ ok: true })];
    return [DataPart({
      items:   open.slice(0, 3).map((p) => ({ id: p.id, label: p.label })),
      message: `${open.length} buurt request${open.length === 1 ? '' : 's'}`,
    })];
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

  await Promise.all([
    hostAgent.start(),
    chatAgent.start(),
  ]);

  // hello-exchange so each agent knows the other.  InternalBus
  // delivers synchronously enough that one hello is sufficient.
  await chatAgent.hello(hostAgent.address);

  /**
   * canopy-chat's CallSkill shape: `(appOrigin, opId, args) → payload`.
   * We invoke from chatAgent against hostAgent's address.  Args get
   * wrapped in a DataPart; the host's skill unwraps + replies with a
   * DataPart whose `.data` is the payload canopy-chat expects.
   */
  const callSkill = async (appOrigin, opId, args) => {
    if (appOrigin !== 'household') {
      throw new Error(`realAgent: unknown appOrigin "${appOrigin}"`);
    }
    const parts = [DataPart(args ?? {})];
    const result = await chatAgent.invoke(hostAgent.address, opId, parts);
    // Skills reply with [DataPart] containing the payload object.
    const first = Array.isArray(result) ? result[0] : null;
    return first?.data ?? null;
  };

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
  };
}
